import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { ResearchChatService, stripUnknownCitations, verdictOf } from '../src/investigations/chat.js';
import { buildGraphListing, resolveAnswer } from '../src/investigations/graphQa.js';
import { InvestigationService } from '../src/investigations/service.js';
import { MemoryInvestigationStore } from '../src/investigations/store.js';
import type { InvestigationRecord } from '../src/investigations/types.js';
import type { JsonLlm } from '../src/proof/agents.js';
import type { Article } from '../src/research/articles.js';
import { RealtimeHub } from '../src/realtime/hub.js';
import { createHttpServer } from '../src/server.js';
import { MemoryTimelineStore } from '../src/timeline/store.js';

const ev = (id: string, title: string, sourceName = 'Pub') => ({ id, title, sourceName, sourceUrl: `https://x.test/${id}`, excerpt: `${title} excerpt` });
const record = (): InvestigationRecord => ({
  id: 'inv1', title: 'EU AI Act', topic: 'EU AI Act', visibility: 'public', status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', revision: 3,
  events: [
    { id: 'e1', title: 'Enforcement', evidence: [ev('a1', 'Fines reach 7% of turnover', 'CNBC'), ev('a2', 'AI Office opens probe', 'Reuters')] },
    { id: 'e2', title: 'Reactions', evidence: [ev('b1', 'Startups worry about costs', 'BBC')] },
  ],
  claims: [{ id: 'clm-fines', statement: 'Fines can reach 7% of turnover.', kind: 'statement', status: 'established', statusReason: 'Supported by 2 outlets.', disputed: false,
    evidence: [{ evidenceId: 'a1', stance: 'supports', quote: 'q', title: 'Fines reach 7% of turnover', publisher: 'CNBC' }] }],
  claimLinks: [],
});

describe('graph listing and answer resolution', () => {
  it('labels claims C1.. and articles E1.. with status and stance', () => {
    const l = buildGraphListing(record());
    expect(l.text).toMatch(/C1 \[ESTABLISHED\] Fines can reach 7% of turnover\. \| evidence: E1\(supports\)/);
    expect(l.text).toMatch(/E3 \| BBC \| undated \| Startups worry about costs/);
    expect(l.hasContent).toBe(true);
  });

  it('maps labels to ids, ignores unknown labels, lights a claim\'s own evidence', () => {
    const l = buildGraphListing(record());
    const r = resolveAnswer({ found: true, answer: 'Yes.', claims: ['C1', 'C9'], evidence: ['E2', 'E77'] }, l);
    expect(r.claimIds).toEqual(['clm-fines']);
    expect(r.evidence.map((e) => e.evidence.id).sort()).toEqual(['a1', 'a2']);
    expect(resolveAnswer({ found: true, answer: 'x', claims: ['C9'], evidence: [] }, l).found).toBe(false); // nothing real -> not found
  });

  it('extracts the verdict and strips unknown citations', () => {
    expect(verdictOf('### Verdict\nOutlets agree [[source:S1]].\n### Common ground\n- x')).toBe('Outlets agree.');
    expect(stripUnknownCitations('x [[source:S9]] y [[source:S2]]', new Set(['S2']))).toBe('x y [[source:S2]]');
  });
});

// ---- end to end ------------------------------------------------------------------------

let server: Server;
let base: string;
let wsUrl: string;
let store: MemoryInvestigationStore;
let graphAnswer: unknown;
const sockets: WebSocket[] = [];

beforeEach(async () => {
  const timeline = new MemoryTimelineStore();
  const hub = new RealtimeHub(timeline);
  store = new MemoryInvestigationStore();
  const articles: Article[] = [1, 2].map((n) => ({ url: `https://news.test/n${n}`, title: `Fresh article ${n}`, description: null, domain: 'news.test', sourceName: 'News', publishedAt: null, tool: 'context_get-news-search' }));
  const investigations = new InvestigationService({
    store, publish: (e) => hub.broadcast(e),
    collect: async (_r, on) => { for (const [i, a] of articles.entries()) await on(a, i + 1); return { articles: 2, summary: 'Two found.' }; },
  });
  const json: JsonLlm = async (schema, messages) => {
    expect(String(messages[0]!.content)).toMatch(/navigator for an evidence graph/);
    return schema.parse(graphAnswer);
  };
  const chat = new ResearchChatService({ store, investigations, publish: (e) => hub.broadcast(e), proof: { json } });
  server = createHttpServer({ store: timeline, hub, investigations, chat });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
  wsUrl = `ws://127.0.0.1:${port}/ws`;
  await store.create(record());
});

afterEach(async () => {
  for (const s of sockets.splice(0)) s.close();
  await new Promise<void>((r) => server.close(() => r()));
});

async function sse(id: string, body: unknown) {
  const res = await fetch(`${base}/api/investigations/${id}/research`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  const events = text.split('\n\n').map((f) => f.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('')).filter(Boolean).map((d) => JSON.parse(d));
  return { status: res.status, events };
}
async function wsFrames() {
  const ws = new WebSocket(wsUrl); sockets.push(ws);
  const frames: any[] = []; ws.on('message', (d) => frames.push(JSON.parse(String(d))));
  await new Promise((r) => ws.once('open', r));
  return frames;
}

describe('answer_question points at the graph', () => {
  it('found: short pointer, highlight event with claim + evidence ids, /ws frame for other viewers', async () => {
    const frames = await wsFrames();
    graphAnswer = { found: true, answer: 'Yes - the fine level is in the highlighted claim.', claims: ['C1'], evidence: ['E2'] };
    const r = await sse('inv1', { investigationId: 'inv1', action: 'answer_question', message: 'How large are the fines?' });
    expect(r.status).toBe(200);
    const hl = r.events.find((e) => e.type === 'highlight');
    expect(hl.nodeIds).toEqual(expect.arrayContaining(['clm-fines', 'e1']));
    expect(hl.evidenceIds.sort()).toEqual(['a1', 'a2']);
    const done = r.events.at(-1).message;
    expect(done.content).toBe('Yes - the fine level is in the highlighted claim.\n\n→ Highlighted 1 claim on the graph.');
    await new Promise((res) => setTimeout(res, 100));
    const final = frames.filter((f) => f.type === 'investigation:highlight').at(-1).payload;
    expect(final).toMatchObject({ final: true });
    expect(final.eventIds).toContain('clm-fines');
  });

  it('not found: says so, nothing highlighted', async () => {
    graphAnswer = { found: false, answer: 'The graph does not cover US export controls yet.', claims: [], evidence: [] };
    const r = await sse('inv1', { investigationId: 'inv1', action: 'answer_question', message: 'What about US export controls?' });
    const hl = r.events.find((e) => e.type === 'highlight');
    expect(hl).toEqual({ type: 'highlight', evidenceIds: [], nodeIds: [] });
    expect(r.events.at(-1).message.content).toMatch(/does not cover US export controls yet\. Use \*\*Extend evidence graph\*\*/);
  });

  it('empty graph: researches the topic right away instead of asking the user to', async () => {
    await store.create({ ...record(), id: 'empty', events: [], claims: [] });
    graphAnswer = null; // the navigator model must not be called for an empty graph
    const r = await sse('empty', { investigationId: 'empty', action: 'answer_question', message: 'DO IT' });
    expect(r.events.some((e) => e.type === 'graph_updated')).toBe(true);
    expect(r.events.at(-1).message.content).toMatch(/^The graph was empty, so I researched “EU AI Act”: 2 articles/);
  });

  it('extend_graph: one-line result and the new articles highlighted', async () => {
    const r = await sse('inv1', { investigationId: 'inv1', action: 'extend_graph', message: 'AI Act fines 2026' });
    expect(r.events.some((e) => e.type === 'graph_updated')).toBe(true);
    expect(r.events.find((e) => e.type === 'highlight').evidenceIds).toHaveLength(2);
    expect(r.events.at(-1).message.content).toMatch(/^Added 2 new articles about “AI Act fines 2026” \(highlighted\)/);
  });

  it('returns JSON errors before streaming', async () => {
    const missing = await fetch(`${base}/api/investigations/nope/research`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ investigationId: 'nope', action: 'answer_question', message: 'q' }) });
    expect(missing.status).toBe(404);
    const empty = await fetch(`${base}/api/investigations/inv1/research`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ investigationId: 'inv1', action: 'answer_question', message: '  ' }) });
    expect((await empty.json()).code).toBe('invalid_message');
  });
});
