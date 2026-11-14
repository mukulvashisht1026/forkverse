import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { FakeListChatModel } from '@langchain/core/utils/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { ResearchChatService } from '../src/investigations/chat.js';
import { InvestigationService } from '../src/investigations/service.js';
import { MemoryInvestigationStore } from '../src/investigations/store.js';
import type { InvestigationRecord } from '../src/investigations/types.js';
import { selectArticles, toPlainText, type ProofArticle } from '../src/proof/articles.js';
import { assignRoles, verifyFindings, type JsonLlm } from '../src/proof/agents.js';
import { RealtimeHub } from '../src/realtime/hub.js';
import { createHttpServer } from '../src/server.js';
import { MemoryTimelineStore } from '../src/timeline/store.js';

const PAD = ' Background paragraph about the regulation and its rollout across member states.'.repeat(8);
const TEXT: Record<string, string> = {
  'https://a.test/1': 'The AI Office opened its first investigation on Monday into a general-purpose model provider. Fines can reach 7% of global turnover according to officials.' + PAD,
  'https://b.test/1': 'Brussels launched its first AI Act probe this week. The AI Office opened its first investigation on Monday into a general-purpose model provider. Critics say startups face heavy compliance costs.' + PAD,
  'https://c.test/1': 'Officials confirmed fines can reach 7% of global turnover for the most serious breaches. Industry groups warned of a chilling effect on investment.' + PAD,
};

const art = (label: string, url: string, readable = true): ProofArticle => ({
  label, publisher: label, readable, text: readable ? TEXT[url] ?? '' : '',
  evidence: { id: `ev-${label}`, title: `Title ${label}`, sourceUrl: url, sourceName: `Pub ${label}` },
});

describe('proof engine units', () => {
  it('turns markdown into plain text for quote checks', () => {
    expect(toPlainText('# Head\nSee [the **report**](https://x.test/a(b)) and ![img](i.png) _now_.')).toBe('Head\nSee the report and now.');
  });

  it('selects one article per publisher, only with URLs, labelled S1..', () => {
    const picked = selectArticles({ id: 'e', title: 'E', evidence: [
      { id: '1', title: 'a', sourceName: 'Reuters', sourceUrl: 'https://r.test/1' },
      { id: '2', title: 'b', sourceName: 'reuters', sourceUrl: 'https://r.test/2' },
      { id: '3', title: 'c', sourceName: 'BBC' },
      { id: '4', title: 'd', sourceName: 'BBC', sourceUrl: 'https://bbc.test/4' },
    ] });
    expect(picked.map((p) => [p.label, p.evidence.id])).toEqual([['S1', '1'], ['S2', '4']]);
  });

  it('keeps only verbatim quotes and requires two outlets for a shared fact', () => {
    const articles = [art('S1', 'https://a.test/1'), art('S2', 'https://b.test/1'), art('S3', 'https://c.test/1'), art('S4', 'https://d.test/1', false)];
    const f = verifyFindings(
      { consensus: [
        { fact: 'First investigation opened', support: [
          { source: 'S1', quote: 'The AI Office opened its first investigation on Monday' },
          { source: 'S2', quote: 'the ai office  opened its first investigation on monday' }, // case/space-insensitive
        ] },
        { fact: 'Fines up to 7%', support: [
          { source: 'S1', quote: 'Fines can reach 7% of global turnover' },
          { source: 'S3', quote: 'fines may reach seven percent' }, // paraphrase -> rejected -> only 1 outlet left
        ] },
      ] },
      { angles: [{ source: 'S2', angle: 'Startup cost angle', quote: 'Critics say startups face heavy compliance costs' }, { source: 'S4', angle: 'unreadable' }],
        unique: [{ source: 'S3', detail: 'Chilling effect warning', quote: 'Industry groups warned of a chilling effect on investment' }, { source: 'S2', detail: 'made up', quote: 'not in the text at all' }],
        disputes: [] },
      articles,
    );
    expect(f.consensus.map((c) => c.fact)).toEqual(['First investigation opened']);
    expect(f.angles.map((a) => a.source)).toEqual(['S2']); // unreadable S4 dropped
    expect(f.unique.map((u) => u.source)).toEqual(['S3']);
    expect(f.quotesRejected).toBe(2);
    const roles = assignRoles(articles, f);
    expect(Object.fromEntries(roles)).toEqual({ S1: 'consensus', S2: 'consensus', S3: 'angle', S4: 'unreadable' });
  });
});

// ---- end to end: POST /research action verify_sources ---------------------------------

let server: Server;
let base: string;
let wsUrl: string;
let store: MemoryInvestigationStore;
const sockets: WebSocket[] = [];

const record = (): InvestigationRecord => ({
  id: 'inv', title: 'EU AI Act', topic: 'EU AI Act', visibility: 'public', status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', revision: 2,
  events: [
    { id: 'evt', title: 'AI Act enforcement', evidence: [
      { id: 'ea', title: 'A', sourceName: 'Alpha', sourceUrl: 'https://a.test/1' },
      { id: 'eb', title: 'B', sourceName: 'Beta', sourceUrl: 'https://b.test/1' },
      { id: 'ec', title: 'C', sourceName: 'Gamma', sourceUrl: 'https://c.test/1' },
      { id: 'ed', title: 'D', sourceName: 'Delta', sourceUrl: 'https://blocked.test/1' },
    ] },
    { id: 'thin', title: 'One source only', evidence: [{ id: 'x', title: 'X', sourceName: 'Solo', sourceUrl: 'https://x.test' }] },
  ],
});

beforeEach(async () => {
  const timeline = new MemoryTimelineStore();
  const hub = new RealtimeHub(timeline);
  store = new MemoryInvestigationStore();
  const investigations = new InvestigationService({ store, publish: (e) => hub.broadcast(e), collect: async () => ({ articles: 0, summary: '' }) });
  const json: JsonLlm = async (schema, messages) => {
    const isCorroborator = String(messages[0]!.content).includes('CORROBORATOR');
    return schema.parse(isCorroborator
      ? { consensus: [{ fact: 'The AI Office opened its first investigation', support: [
          { source: 'S1', quote: 'The AI Office opened its first investigation on Monday' },
          { source: 'S2', quote: 'The AI Office opened its first investigation on Monday' }] }] }
      : { angles: [{ source: 'S1', angle: 'Enforcement-first' }, { source: 'S2', angle: 'Startup costs', quote: 'Critics say startups face heavy compliance costs' }, { source: 'S3', angle: 'Industry concern' }],
          unique: [{ source: 'S3', detail: 'Chilling effect warning', quote: 'Industry groups warned of a chilling effect on investment' }],
          disputes: [{ point: 'fabricated', positions: [{ source: 'S1', position: 'x', quote: 'invented quote' }, { source: 'S3', position: 'y', quote: 'another invented quote' }] }] });
  };
  const synthesis = '### Verdict\nOutlets agree the AI Office opened its first probe [[source:S1]] [[source:S2]], with different emphasis [[source:S3]] [[source:S9]].';
  const model = { stream: (...a: unknown[]) => new FakeListChatModel({ responses: [synthesis] }).stream(...(a as [never])) } as unknown as FakeListChatModel;
  const chat = new ResearchChatService({
    store, investigations, publish: (e) => hub.broadcast(e), model,
    proof: { json, scrape: async (url) => (TEXT[url] ? { ok: true, markdown: TEXT[url]! } : { ok: false, error: 'WEBSITE_BLOCKED' }) },
  });
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

const post = (body: unknown) => fetch(`${base}/api/investigations/inv/research`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ investigationId: 'inv', ...(body as object) }) });
const events = (text: string) => text.split('\n\n').map((f) => f.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('')).filter(Boolean).map((d) => JSON.parse(d));

describe('verify_sources over SSE', () => {
  it('runs both agents, verifies quotes, streams a report and colours the graph by role', async () => {
    const ws = new WebSocket(wsUrl); sockets.push(ws);
    const frames: any[] = []; ws.on('message', (d) => frames.push(JSON.parse(String(d))));
    await new Promise((r) => ws.once('open', r));

    const res = await post({ action: 'verify_sources', message: '', eventId: 'evt' });
    expect(res.status).toBe(200);
    const ev = events(await res.text());
    const types = ev.map((e) => e.type);
    expect(types[0]).toBe('message_start');
    expect(types.slice(-3)).toEqual(['proof', 'sources', 'message_complete']);
    const progress = ev.filter((e) => e.type === 'token').map((e) => e.text).join('');
    expect(progress).toMatch(/Reading 4 articles/);
    expect(progress).toMatch(/3 readable, 1 unavailable \(Delta\)/);
    expect(progress).toMatch(/Corroborator.*Skeptic/s);

    const report = ev.find((e) => e.type === 'proof').report;
    expect(report.stats).toEqual({ articles: 4, readable: 3, quotesVerified: 4, quotesRejected: 2 });
    expect(report.consensus).toHaveLength(1);
    expect(report.disputes).toEqual([]); // fabricated dispute quotes rejected
    expect(Object.fromEntries(report.sources.map((s: any) => [s.publisher, s.role]))).toEqual({ Alpha: 'consensus', Beta: 'consensus', Gamma: 'angle', Delta: 'unreadable' });
    expect(report.sources.find((s: any) => s.publisher === 'Delta').error).toBe('WEBSITE_BLOCKED');

    const done = ev.at(-1).message;
    expect(done.proof.eventId).toBe('evt');
    expect(done.content).not.toContain('S9');
    expect(done.content).toMatch(/Coverage: 3 of 4 articles read in full; 4 quotes verified/);

    await new Promise((r) => setTimeout(r, 100));
    const hl = frames.filter((f) => f.type === 'investigation:highlight').map((f) => f.payload);
    const final = hl.at(-1);
    expect(final.final).toBe(true);
    expect(final.roles).toEqual({ ea: 'consensus', eb: 'consensus', ec: 'angle', ed: 'unreadable' });
    expect(hl.some((h) => !h.final && h.evidenceIds.length === 4 && !h.roles)).toBe(true); // articles lit while reading

    const hist = await (await fetch(`${base}/api/investigations/inv/messages`)).json();
    expect(hist.items.at(-1).proof.stats.readable).toBe(3); // report persisted for re-highlighting
  });

  it('rejects events without two outlets and unknown events before streaming', async () => {
    const thin = await post({ action: 'verify_sources', message: '', eventId: 'thin' });
    expect(thin.status).toBe(400);
    expect((await thin.json()).code).toBe('not_enough_sources');
    const missing = await post({ action: 'verify_sources', message: '', eventId: 'nope' });
    expect(missing.status).toBe(404);
    expect((await missing.json()).code).toBe('event_not_found');
  });
});
