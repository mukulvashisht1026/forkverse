import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { RealtimeHub } from '../src/realtime/hub.js';
import { createHttpServer } from '../src/server.js';
import { MemoryTimelineStore } from '../src/timeline/store.js';

let server: Server;
let base: string;
let wsUrl: string;
const sockets: WebSocket[] = [];

beforeEach(async () => {
  const store = new MemoryTimelineStore();
  server = createHttpServer({ store, hub: new RealtimeHub(store) });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
  wsUrl = `ws://127.0.0.1:${port}/ws`;
});

afterEach(async () => {
  for (const s of sockets.splice(0)) s.close();
  await new Promise<void>((r) => server.close(() => r()));
});

/** Open a socket and collect parsed frames. */
async function connect() {
  const ws = new WebSocket(wsUrl);
  sockets.push(ws);
  const frames: any[] = [];
  const waiters: Array<() => void> = [];
  ws.on('message', (d) => {
    frames.push(JSON.parse(String(d)));
    waiters.splice(0).forEach((w) => w());
  });
  await new Promise((r, j) => (ws.once('open', r), ws.once('error', j)));
  const next = async (type: string) => {
    for (let i = 0; i < 50; i++) {
      const f = frames.find((x) => x.type === type);
      if (f) {
        frames.splice(frames.indexOf(f), 1);
        return f;
      }
      await new Promise<void>((r) => {
        waiters.push(r);
        setTimeout(r, 100);
      });
    }
    throw new Error(`no ${type} frame`);
  };
  return { ws, next };
}

const post = (path: string, body: unknown, method = 'POST') =>
  fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('realtime timeline (REST + /ws)', () => {
  it('sends timeline:init on connect and answers ping/sync', async () => {
    const { ws, next } = await connect();
    const init = await next('timeline:init');
    expect(init.payload).toMatchObject({ nodes: [], version: 1 });

    ws.send(JSON.stringify({ type: 'ping' }));
    expect((await next('pong')).timestamp).toBeTruthy();

    ws.send(JSON.stringify({ type: 'timeline:sync' }));
    expect((await next('timeline:init')).payload.nodes).toEqual([]);
  });

  it('broadcasts node and branch mutations to every client, via /api prefix too', async () => {
    const a = await connect();
    const b = await connect();
    await a.next('timeline:init');
    await b.next('timeline:init');

    const created = await post('/api/timeline/nodes', { name: 'Tariff Post', info: 'Autos slid', message: 'hi' });
    expect(created.status).toBe(201);
    const { node, version } = await created.json();
    expect(node).toMatchObject({ name: 'Tariff Post', platform: 'Backend API', branches: [] });
    expect(version).toBe(2);

    for (const c of [a, b]) {
      const f = await c.next('node:created');
      expect(f).toMatchObject({ message: 'hi', payload: { node: { id: node.id }, version: 2 } });
    }

    const br = await post(`/timeline/nodes/${node.id}/branches`, { name: 'Reuters', growthSide: 'top' });
    expect(br.status).toBe(201);
    const { branch } = await br.json();
    const bf = await a.next('branch:created');
    expect(bf.payload).toMatchObject({ nodeId: node.id, branch: { id: branch.id, growthSide: 'top', sourceType: 'news' }, version: 3 });

    const del = await fetch(`${base}/timeline/nodes/${node.id}/branches/${branch.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect((await a.next('branch:deleted')).payload).toMatchObject({ nodeId: node.id, branchId: branch.id });

    const snap = await (await fetch(`${base}/api/timeline`)).json();
    expect(snap.nodes).toHaveLength(1);
    expect(snap.version).toBe(4);
  });

  it('ingests webhook events and returns contract errors', async () => {
    const a = await connect();
    await a.next('timeline:init');

    const msg = await post('/timeline/events', { type: 'system:message', message: 'Worker finished' });
    expect(msg.status).toBe(200);
    expect((await a.next('system:message')).message).toBe('Worker finished');

    const bad = await post('/timeline/events', { type: 'nope' });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/Unsupported event payload/);

    const missing = await post('/timeline/nodes/nope', { name: 'x' }, 'PATCH');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'Node "nope" not found.' });

    const noName = await post('/timeline/nodes', { name: '  ' });
    expect(noName.status).toBe(400);

    const scrape = await post('/api/scrape-event', { query: 'x' });
    expect(scrape.status).toBe(501);
  });

  it('reports ws client count in /status', async () => {
    const a = await connect();
    await a.next('timeline:init');
    const status = await (await fetch(`${base}/api/status`)).json();
    expect(status).toMatchObject({ wsClients: 1, timelineVersion: 1 });
  });
});
