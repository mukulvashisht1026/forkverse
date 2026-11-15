import { describe, expect, it } from 'vitest';
import { InvestigationService } from '../src/investigations/service.js';
import { MemoryInvestigationStore } from '../src/investigations/store.js';
import { buildClaims } from '../src/claims/builder.js';
import type { InvestigationRecord } from '../src/investigations/types.js';
import type { JsonLlm } from '../src/proof/agents.js';
import { planTopic } from '../src/research/planner.js';
import { outcomeCaveat } from '../src/investigations/chat.js';
import { collectArticles } from '../src/research/run.js';
import { createAgentGraph } from '../src/agent/graph.js';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import { tool } from '@langchain/core/tools';
import { MemorySaver } from '@langchain/langgraph';
import { z } from 'zod';

describe('topic planner', () => {
  it('cleans a typo-ridden request into title, mode, queries and key terms', async () => {
    const json: JsonLlm = async (schema) => schema.parse({ title: 'Narendra Modi', mode: 'politician', entity: 'Narendra Modi', queries: ['Narendra Modi promises', 'Modi government record'], keyTerms: ['Modi', 'modi', 'narendra modi'] });
    const plan = await planTopic('LEST DO A NALAYS OF NARDNER MODI', json);
    expect(plan).toMatchObject({ title: 'Narendra Modi', mode: 'politician', entity: 'Narendra Modi', keyTerms: ['modi', 'narendra modi'] });
  });
  it('falls back to the raw words when the LLM is unavailable', async () => {
    const plan = await planTopic('EU AI Act fines', async () => { throw new Error('down'); });
    expect(plan.title).toBe('EU AI Act fines');
    expect(plan.mode).toBe('news');
  });
});

class Scripted extends BaseChatModel {
  constructor(private r: AIMessage[]) { super({}); }
  _llmType() { return 's'; }
  override bindTools() { return this as never; }
  async _generate(_m: BaseMessage[]): Promise<ChatResult> { const message = this.r.shift()!; return { generations: [{ message, text: String(message.content) }] }; }
}

describe('relevance with planner key terms', () => {
  it('keeps articles that mention ANY key term even when the raw topic has typos', async () => {
    const results = JSON.stringify({ data: [
      { url: 'https://a.test/1', title: 'Modi launches new scheme', source: { domain: 'a.test' } },
      { url: 'https://a.test/2', title: 'Cricket scores today', source: { domain: 'a.test' } },
    ] });
    const news = tool(async () => results, { name: 'context_get-news-search', description: 'n', schema: z.object({ query: z.string() }) });
    const graph = createAgentGraph({ model: new Scripted([new AIMessage({ content: '', tool_calls: [{ id: '1', name: 'context_get-news-search', args: { query: 'x' } }] }), new AIMessage('done')]), checkpointer: new MemorySaver(), tools: [news] });
    const strict = await collectArticles({ query: 'LEST DO A NALAYS OF NARDNER MODI', graph }, async () => {});
    expect(strict.articles).toBe(0); // the old all-words rule: the bug the user hit
    const graph2 = createAgentGraph({ model: new Scripted([new AIMessage({ content: '', tool_calls: [{ id: '1', name: 'context_get-news-search', args: { query: 'x' } }] }), new AIMessage('done')]), checkpointer: new MemorySaver(), tools: [news] });
    const titles: string[] = [];
    const planned = await collectArticles({ query: 'Narendra Modi', graph: graph2, keyTerms: ['modi'] }, async (a) => { titles.push(a.title); });
    expect(titles).toEqual(['Modi launches new scheme']);
    expect(planned.articles).toBe(1);
  });
});

describe('create uses the plan and builds the graph after research', () => {
  it('stores clean title/mode/entity, passes key terms, then calls afterRun', async () => {
    const store = new MemoryInvestigationStore();
    let seen: { keyTerms?: string[]; queries?: string[] } = {};
    let built = '';
    const service = new InvestigationService({
      store, publish: () => {},
      plan: async () => ({ title: 'Narendra Modi', mode: 'politician', entity: 'Narendra Modi', queries: ['Modi promises'], keyTerms: ['modi'], scope: 'timeline' }),
      collect: async (req, on) => { seen = { keyTerms: req.keyTerms, queries: req.queries }; await on({ url: 'https://a.test/1', title: 'Modi speech', description: null, domain: 'a.test', sourceName: 'A', publishedAt: null, tool: 'context_get-news-search' }, 1); return { articles: 1, summary: '' }; },
      afterRun: async (id) => { built = id; },
    });
    const { investigation } = await service.create({ topic: 'LEST DO A NALAYS OF NARDNER MODI' });
    await Promise.all([...service.running.values()]);
    expect(investigation).toMatchObject({ title: 'Narendra Modi', mode: 'politician', entity: 'Narendra Modi', description: 'Requested as: “LEST DO A NALAYS OF NARDNER MODI”' });
    expect(seen).toEqual({ keyTerms: ['modi'], queries: ['Modi promises'] });
    expect(built).toBe(investigation.id);
  });
});

describe('politician mode', () => {
  const PAD = ' Background text about the policy and the economy in detail.'.repeat(10);
  const TEXT: Record<string, string> = {
    'https://a.test/1': 'Modi promised to create 20 million jobs every year during the 2014 campaign.' + PAD,
    'https://b.test/1': 'Official data shows job creation fell well short of the promised 20 million a year.' + PAD,
    'https://c.test/1': 'Modi pledged to build 100 smart cities across India.' + PAD,
  };
  const rec = (): InvestigationRecord => ({
    id: 'p', title: 'Narendra Modi', topic: 'Narendra Modi', mode: 'politician', entity: 'Narendra Modi', visibility: 'public', status: 'active',
    createdAt: 'x', updatedAt: 'x', revision: 1,
    events: [{ id: 'e', title: 'Modi', evidence: [
      { id: 'a1', title: 'Jobs promise', sourceName: 'A', sourceUrl: 'https://a.test/1', publishedAt: '2014-04-01T00:00:00Z' },
      { id: 'b1', title: 'Jobs data', sourceName: 'B', sourceUrl: 'https://b.test/1', publishedAt: '2019-02-01T00:00:00Z' },
      { id: 'c1', title: 'Smart cities', sourceName: 'C', sourceUrl: 'https://c.test/1', publishedAt: '2015-06-01T00:00:00Z' },
    ] }],
  });

  it('claims are what the politician said; outcome reports become the branches; no follow-up = no_update', async () => {
    const json: JsonLlm = async (schema, messages) => {
      const sys = String(messages[0]!.content);
      const user = String(messages[1]!.content);
      if (sys.startsWith('This ONE news article is about a politician')) {
        if (user.includes('Jobs promise')) return schema.parse({ summary: 'Campaign jobs pledge.', claims: [{ statement: 'Modi promised 20 million jobs a year.', kind: 'statement', type: 'claim', quote: 'Modi promised to create 20 million jobs every year' }] });
        if (user.includes('Jobs data')) return schema.parse({ summary: 'Jobs data fell short.', claims: [{ statement: 'Job creation fell short of 20 million a year.', kind: 'development', type: 'outcome', quote: 'job creation fell well short of the promised 20 million a year' }] });
        return schema.parse({ summary: 'Smart cities pledge.', claims: [{ statement: 'Modi pledged 100 smart cities.', kind: 'statement', type: 'claim', quote: 'Modi pledged to build 100 smart cities across India' }] });
      }
      expect(sys).toMatch(/promise\/claim tracker for a politician/);
      return schema.parse({ entity: 'Narendra Modi', claims: [
        { key: 'C1', statement: 'Modi promised 20 million jobs a year.', kind: 'statement', outcome: 'not_fulfilled', members: [{ candidate: 'K1', stance: 'supports', role: 'source' }, { candidate: 'K2', stance: 'contradicts', role: 'outcome' }] },
        { key: 'C2', statement: 'Modi pledged 100 smart cities.', kind: 'statement', outcome: 'no_update', members: [{ candidate: 'K3', stance: 'supports', role: 'source' }] },
      ], links: [] });
    };
    const out = await buildClaims(rec(), { json, scrape: async (url) => ({ ok: true, markdown: TEXT[url]! }) });
    const jobs = out.claims.find((c) => c.statement.includes('jobs'))!;
    expect(jobs).toMatchObject({ outcome: 'not_fulfilled', disputed: false, occurredAt: '2014-04-01T00:00:00Z' });
    expect(jobs.evidence.map((e) => [e.evidenceId, e.role, e.stance, e.summary])).toEqual([['a1', 'source', 'supports', 'Campaign jobs pledge.'], ['b1', 'outcome', 'contradicts', 'Jobs data fell short.']]);
    expect(out.claims.find((c) => c.statement.includes('smart cities'))).toMatchObject({ outcome: 'no_update' });
  });
});

describe('outcome caveat', () => {
  const base = { id: 'x', title: 't', topic: 't', visibility: 'public', status: 'active', createdAt: 'x', updatedAt: 'x', revision: 1, events: [] } as unknown as InvestigationRecord;
  const claim = (outcome: string) => ({ id: 'c', statement: 's', kind: 'statement', status: 'pending', statusReason: '', disputed: false, outcome, evidence: [] });
  it('adds a note when only self-reported claims are highlighted', () => {
    expect(outcomeCaveat({ ...base, mode: 'politician', claims: [claim('no_update')] } as InvestigationRecord, ['c'])).toMatch(/no independent outcome report/);
  });
  it('stays silent with an outcome report or in news mode', () => {
    expect(outcomeCaveat({ ...base, mode: 'politician', claims: [claim('not_fulfilled')] } as InvestigationRecord, ['c'])).toBe('');
    expect(outcomeCaveat({ ...base, mode: 'news', claims: [claim('no_update')] } as InvestigationRecord, ['c'])).toBe('');
  });
});
