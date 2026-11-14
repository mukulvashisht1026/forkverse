import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { FakeListChatModel } from '@langchain/core/utils/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { citedLabels, ResearchChatService, retrieveSources, stripUnknownCitations } from '../src/investigations/chat.js';
import { InvestigationService } from '../src/investigations/service.js';
import { MemoryInvestigationStore } from '../src/investigations/store.js';
import type { InvestigationRecord } from '../src/investigations/types.js';
import type { Article } from '../src/research/articles.js';
import { RealtimeHub } from '../src/realtime/hub.js';
import { createHttpServer } from '../src/server.js';
import { MemoryTimelineStore } from '../src/timeline/store.js';

const ev = (id: string, title: string, excerpt?: string) => ({ id, title, ...(excerpt && { excerpt }), sourceName: 'Pub', sourceUrl: `https://x.test/${id}` });
const record = (): InvestigationRecord => ({
  id: 'inv1', title: 'EU AI Act', topic: 'EU AI Act', visibility: 'public', status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', revision: 3,
  events: [
    { id: 'e1', title: 'EU AI Act enforcement', evidence: [
      ev('a1', 'Fines under the AI Act explained', 'Penalties reach 7% of global turnover'),
      ev('a2', 'AI Office starts enforcement', 'The AI Office begins supervising general-purpose models'),
      ev('a3', 'Startups worry about compliance costs'),
    ] },
    { id: 'e2', title: 'Industry reaction', evidence: [ev('b1', 'Big tech lobbies on fines', 'Companies seek lower fines'), ev('b2', 'Weather today')] },
  ],
});

describe('retrieval and citations', () => {
  it('ranks evidence by question terms and labels S1..Sn', () => {
    const s = retrieveSources(record(), 'How large are the fines?');
    expect(s.map((x) => x.evidence.id).slice(0, 2).sort()).toEqual(['a1', 'b1']);
    expect(s[0]!.label).toBe('S1');
    expect(s.find((x) => x.evidence.id === 'b2')).toBeUndefined();
  });

  it('falls back to coverage across events for broad questions', () => {
    const s = retrieveSources(record(), 'Summarize everything');
    expect(new Set(s.map((x) => x.event.id))).toEqual(new Set(['e1', 'e2']));
    expect(s.length).toBeGreaterThanOrEqual(3);
  });

  it('extracts known citations in order and strips unknown ones', () => {
    const known = new Set(['S1', 'S2', 'S3']);
    expect(citedLabels('a [[source:S3]] b [[source:S1]] c [[source:S3]] [[source:S9]]', known)).toEqual(['S3', 'S1']);
    expect(stripUnknownCitations('x [[source:S9]] y [[source:S2]]', known)).toBe('x y [[source:S2]]');
    expect(stripUnknownCitations('fines [[source:S12]].', known)).toBe('fines.');
  });
});

// ---- end to end over HTTP + SSE + /ws ---------------------------------------------------

let server: Server;
let base: string;
let wsUrl: string;
let store: MemoryInvestigationStore;
let service: InvestigationService;
let answerText = '';
const sockets: WebSocket[] = [];

beforeEach(async () => {
  const timeline = new MemoryTimelineStore();
  const hub = new RealtimeHub(timeline);
  store = new MemoryInvestigationStore();
  const articles: Article[] = [1, 2, 3].map((n) => ({ url: `https://news.test/n${n}`, title: `Fresh article ${n}`, description: null, domain: 'news.test', sourceName: 'News', publishedAt: null, tool: 'context_get-news-search' }));
  service = new InvestigationService({
    store, publish: (e) => hub.broadcast(e),
    collect: async (_r, on) => { for (const [i, a] of articles.entries()) await on(a, i + 1); return { articles: 3, summary: 'Three found.' }; },
  });
  const model = {
    stream: (...args: unknown[]) => new FakeListChatModel({ responses: [answerText] }).stream(...(args as [never])),
  } as unknown as FakeListChatModel;
  const chat = new ResearchChatService({ store, investigations: service, publish: (e) => hub.broadcast(e), model });
  server = createHttpServer({ store: timeline, hub, investigations: service, chat });
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
  const res = await fetch(`${base}/api/investigations/${id}/research`, {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify(body),
  });
  const text = await res.text();
  const events = text.split('\n\n').map((f) => f.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('')).filter(Boolean).map((d) => JSON.parse(d));
  return { status: res.status, type: res.headers.get('content-type'), events, raw: text };
}

async function wsFrames() {
  const ws = new WebSocket(wsUrl);
  sockets.push(ws);
  const frames: any[] = [];
  ws.on('message', (d) => frames.push(JSON.parse(String(d))));
  await new Promise((r) => ws.once('open', r));
  return frames;
}

describe('POST /investigations/:id/research', () => {
  it('answers from the graph, streams tokens, cites a subset and highlights exactly it over /ws', async () => {
    const frames = await wsFrames();
    answerText = 'Fines can reach 7% of turnover [[source:S1]], and companies lobby for lower fines [[source:S2]] [[source:S7]].\n\n### Conclusions\n- Penalties are significant [[source:S1]].';
    const r = await sse('inv1', { investigationId: 'inv1', action: 'answer_question', message: 'How large are the fines?' });

    expect(r.status).toBe(200);
    expect(r.type).toContain('text/event-stream');
    const types = r.events.map((e) => e.type);
    expect(types[0]).toBe('message_start');
    expect(types.filter((t) => t === 'token').length).toBeGreaterThan(10); // streamed
    expect(types.slice(-2)).toEqual(['sources', 'message_complete']);

    const done = r.events.at(-1).message;
    expect(done.content).not.toContain('S7'); // unknown citation stripped
    expect(done.sources.map((s: any) => s.id)).toEqual(['S1', 'S2']);
    expect(done.sources.every((s: any) => s.evidenceId && s.eventId && s.url.startsWith('https://'))).toBe(true);

    await new Promise((res) => setTimeout(res, 100));
    const hl = frames.filter((f) => f.type === 'investigation:highlight' && f.payload.investigationId === 'inv1');
    expect(hl[0].payload).toMatchObject({ evidenceIds: [], final: false }); // clear first
    expect(hl.some((f) => !f.payload.final && f.payload.evidenceIds.length === 1)).toBe(true); // live, as citations appear
    const final = hl.at(-1).payload;
    expect(final.final).toBe(true);
    expect(final.messageId).toBe(done.id);
    expect(final.evidenceIds.sort()).toEqual(done.sources.map((s: any) => s.evidenceId).sort());
    expect(final.eventIds.sort()).toEqual([...new Set(done.sources.map((s: any) => s.eventId))].sort());

    const hist = await (await fetch(`${base}/api/investigations/inv1/messages`)).json();
    expect(hist.investigationId).toBe('inv1');
    expect(hist.items.map((m: any) => m.role)).toEqual(['user', 'assistant']);
    expect(hist.items[1].sources).toHaveLength(2);
  });

  it('extend_graph runs research, sends graph_updated and highlights the new evidence', async () => {
    const frames = await wsFrames();
    const r = await sse('inv1', { investigationId: 'inv1', action: 'extend_graph', message: 'AI Act fines 2026' });
    const types = r.events.map((e) => e.type);
    expect(types).toContain('graph_updated');
    const graph = r.events.find((e) => e.type === 'graph_updated').graph;
    expect(graph.events).toHaveLength(3);
    const done = r.events.at(-1).message;
    expect(done.runId).toBeTruthy();
    expect(done.sources.map((s: any) => s.title)).toEqual(['Fresh article 1', 'Fresh article 2', 'Fresh article 3']);
    await new Promise((res) => setTimeout(res, 100));
    const final = frames.filter((f) => f.type === 'investigation:highlight').at(-1).payload;
    expect(final.final).toBe(true);
    expect(final.evidenceIds).toHaveLength(3);
  });

  it('answers honestly when the graph has no evidence, without calling the model', async () => {
    await store.create({ ...record(), id: 'empty', events: [] });
    answerText = 'SHOULD NOT BE USED';
    const r = await sse('empty', { investigationId: 'empty', action: 'answer_question', message: 'Anything?' });
    const done = r.events.at(-1).message;
    expect(done.content).toMatch(/no evidence/);
    expect(done.sources).toEqual([]);
  });

  it('returns JSON errors before streaming', async () => {
    const missing = await fetch(`${base}/api/investigations/nope/research`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ investigationId: 'nope', action: 'answer_question', message: 'q' }) });
    expect(missing.status).toBe(404);
    expect((await missing.json()).code).toBe('investigation_not_found');
    const mismatch = await fetch(`${base}/api/investigations/inv1/research`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ investigationId: 'other', action: 'answer_question', message: 'q' }) });
    expect(mismatch.status).toBe(400);
    const empty = await fetch(`${base}/api/investigations/inv1/research`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ investigationId: 'inv1', action: 'answer_question', message: '  ' }) });
    expect((await empty.json()).code).toBe('invalid_message');
  });
});
