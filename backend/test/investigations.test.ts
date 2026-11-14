import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { InvestigationService, type Collect } from '../src/investigations/service.js';
import { MemoryInvestigationStore } from '../src/investigations/store.js';
import type { Article } from '../src/research/articles.js';
import { RealtimeHub } from '../src/realtime/hub.js';
import { createHttpServer } from '../src/server.js';
import { MemoryTimelineStore } from '../src/timeline/store.js';

const art = (n: number, extra: Partial<Article> = {}): Article => ({
  url: `https://news.test/a${n}`,
  title: `Article ${n}`,
  description: `About ${n}`,
  domain: 'news.test',
  sourceName: 'News Test',
  publishedAt: '2026-11-01T00:00:00.000Z',
  tool: 'context_get-news-search',
  ...extra,
});

let server: Server;
let base: string;
let wsUrl: string;
let service: InvestigationService;
let store: MemoryInvestigationStore;
let collectImpl: Collect;
const sockets: WebSocket[] = [];

beforeEach(async () => {
  const timeline = new MemoryTimelineStore();
  const hub = new RealtimeHub(timeline);
  store = new MemoryInvestigationStore();
  collectImpl = async (_req, onArticle) => {
    await onArticle(art(1), 1);
    await onArticle(art(2), 2);
    return { articles: 2, summary: 'Two articles found.' };
  };
  service = new InvestigationService({ store, publish: (e) => hub.broadcast(e), collect: (r, cb) => collectImpl(r, cb) });
  server = createHttpServer({ store: timeline, hub, investigations: service });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
  wsUrl = `ws://127.0.0.1:${port}/ws`;
});

afterEach(async () => {
  for (const s of sockets.splice(0)) s.close();
  await new Promise<void>((r) => server.close(() => r()));
});

const json = async (path: string, init?: RequestInit) => {
  const res = await fetch(base + path, { ...init, headers: { 'content-type': 'application/json' } });
  return { status: res.status, body: (await res.json()) as any };
};
const post = (path: string, body: unknown) => json(path, { method: 'POST', body: JSON.stringify(body) });
const settle = () => Promise.all([...service.running.values()]);

describe('investigation API', () => {
  it('creates an investigation, runs research, and exposes graph + run', async () => {
    const created = await post('/api/investigations', { topic: '  Trump manifesto  ', context: 'Agenda 47' });
    expect(created.status).toBe(202);
    const { investigation, run } = created.body;
    expect(investigation).toMatchObject({ title: 'Trump manifesto', topic: 'Trump manifesto', description: 'Agenda 47', visibility: 'public', status: 'active' });
    expect(investigation).not.toHaveProperty('revision');
    expect(run).toMatchObject({ investigationId: investigation.id, status: 'queued' });

    await settle();

    const done = await json(`/api/investigations/${investigation.id}/runs/${run.id}`);
    expect(done.body).toMatchObject({ status: 'succeeded' });
    expect(done.body.completedAt).toBeTruthy();

    const graph = await json(`/api/investigations/${investigation.id}/graph`);
    expect(graph.body.investigationId).toBe(investigation.id);
    expect(graph.body.revision).toBe(5); // created 1, +event, +2 evidence, +summary
    expect(graph.body.events).toHaveLength(1);
    expect(graph.body.events[0]).toMatchObject({ title: 'Trump manifesto', summary: 'Two articles found.' });
    expect(graph.body.events[0].evidence.map((e: any) => e.sourceUrl)).toEqual(['https://news.test/a1', 'https://news.test/a2']);
    expect(graph.body.events[0].evidence[0]).toMatchObject({ sourceName: 'News Test', relationship: 'News coverage', eventId: graph.body.events[0].id });

    const one = await json(`/investigations/${investigation.id}`);
    expect(one.body).toEqual({ ...investigation, updatedAt: graph.body.updatedAt }); // updatedAt moves as the graph grows
  });

  it('extends without losing earlier evidence, skips duplicates, rejects concurrent runs', async () => {
    const { body } = await post('/api/investigations', { topic: 'Topic A' });
    await settle();
    const id = body.investigation.id;

    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let skipped: string[] = [];
    collectImpl = async (req, onArticle) => {
      skipped = [...(req.skipIds ?? [])];
      await gate;
      await onArticle(art(3), 1);
      return { articles: 1, summary: '' };
    };

    const ext = await post(`/api/investigations/${id}/runs`, { topic: 'Topic A reactions' });
    expect(ext.status).toBe(202);
    expect(ext.body.graph.events).toHaveLength(1); // snapshot at request time

    const busy = await post(`/api/investigations/${id}/runs`, { topic: 'again' });
    expect(busy.status).toBe(409);
    expect(busy.body).toMatchObject({ code: 'run_in_progress', details: { runId: ext.body.run.id } });

    release();
    await settle();
    expect(skipped).toHaveLength(2); // evidence ids from the first run

    const graph = await json(`/api/investigations/${id}/graph`);
    expect(graph.body.events.map((e: any) => e.title)).toEqual(['Topic A', 'Topic A reactions']);
    expect(graph.body.events[0].evidence).toHaveLength(2);
    expect(graph.body.events[1].evidence.map((e: any) => e.title)).toEqual(['Article 3']);

    const runs = await json(`/api/investigations/${id}/runs`);
    expect(runs.body.items).toHaveLength(2);
  });

  it('records a failed run with an ApiErrorDto', async () => {
    collectImpl = async () => {
      throw new Error('Research tools are not available');
    };
    const { body } = await post('/api/investigations', { topic: 'Failing topic' });
    await settle();
    const run = await json(`/api/investigations/${body.investigation.id}/runs/${body.run.id}`);
    expect(run.body).toMatchObject({ status: 'failed', error: { code: 'research_failed', message: 'Research tools are not available' } });
  });

  it('lists public investigations newest first with an opaque cursor', async () => {
    for (const t of ['one', 'two', 'three']) {
      await post('/api/investigations', { topic: t });
      await settle();
    }
    const p1 = await json('/api/investigations?visibility=public&limit=2');
    expect(p1.body.items.map((i: any) => i.topic)).toEqual(['three', 'two']);
    expect(p1.body.items[0]).not.toHaveProperty('events');
    expect(typeof p1.body.nextCursor).toBe('string');
    const p2 = await json(`/api/investigations?limit=2&cursor=${encodeURIComponent(p1.body.nextCursor)}`);
    expect(p2.body.items.map((i: any) => i.topic)).toEqual(['one']);
    expect(p2.body).not.toHaveProperty('nextCursor');
  });

  it('returns contract errors', async () => {
    const empty = await post('/api/investigations', { topic: '   ' });
    expect(empty.status).toBe(400);
    expect(empty.body).toMatchObject({ code: 'invalid_topic', message: 'Topic is required.' });
    expect(empty.body.requestId).toBeTruthy();

    const missing = await json('/api/investigations/nope/graph');
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe('investigation_not_found');

    const priv = await json('/api/investigations?visibility=private');
    expect(priv.status).toBe(400);
    expect(priv.body.code).toBe('invalid_request');
  });

  it('pushes investigation:updated frames with id, revision and evidence over /ws', async () => {
    const ws = new WebSocket(wsUrl);
    sockets.push(ws);
    const frames: any[] = [];
    ws.on('message', (d) => frames.push(JSON.parse(String(d))));
    await new Promise((r) => ws.once('open', r));

    const { body } = await post('/api/investigations', { topic: 'Live topic' });
    await settle();
    await new Promise((r) => setTimeout(r, 100));

    const updates = frames.filter((f) => f.type === 'investigation:updated');
    expect(updates.every((f) => f.payload.investigationId === body.investigation.id)).toBe(true);
    const revisions = updates.map((f) => f.payload.revision);
    expect(revisions).toEqual([...revisions].sort((a, b) => a - b)); // monotonic
    expect(updates.filter((f) => f.payload.evidence).map((f) => f.payload.evidence.title)).toEqual(['Article 1', 'Article 2']);
    expect(updates.at(-1).payload.run.status).toBe('succeeded');
  });
});
