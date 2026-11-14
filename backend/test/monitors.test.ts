import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { MonitorChange, MonitorsClient } from '../src/clients/contextdev.js';
import type { InvestigationRecord } from '../src/investigations/types.js';
import { MemoryInvestigationStore } from '../src/investigations/store.js';
import { changeToEvidence, newItems, newsFeedUrl, parseLinks, titleFromUrl } from '../src/monitors/ingest.js';
import { MonitorService, verifySignature } from '../src/monitors/service.js';

const FEED_BEFORE = `# "tariffs" \\- Google News
- [Old story about tariffs and steel - Reuters](https://news.google.com/rss/articles/OLD?oc=5)
  Published: Thu, 12 Nov 2026 16:18:20 GMT`;

const FEED_DIFF = `--- before
+++ after
+- [EU announces retaliatory tariffs on US goods - BBC News](https://news.google.com/rss/articles/NEW1?oc=5)
+  Published: Fri, 14 Nov 2026 09:00:00 GMT
 - [Old story about tariffs and steel - Reuters](https://news.google.com/rss/articles/OLD?oc=5)
-- [Removed headline that left the feed - AP](https://news.google.com/rss/articles/GONE?oc=5)`;

const change = (over: Partial<MonitorChange> = {}): MonitorChange => ({
  id: 'chg_1',
  monitor_id: 'mon_1',
  title: 'Feed changed',
  summary: 'The visible text on the page changed.',
  detected_at: '2026-11-14T10:00:00.000Z',
  url: 'https://news.google.com/rss/search?q=tariffs',
  diff: FEED_DIFF,
  ...over,
});

// Real Context.dev diff format for a Google News RSS page monitor (visible text, `+ `/`- ` prefixes).
const REAL_ITEM = (title: string, pub: string, id: string, date: string) => [
  `- ${title} \\- ${pub}`,
  `Published: ${date}`,
  `Description: <a href="https://news\\.google\\.com/rss/articles/${id}?oc=5" target="\\_blank"\\>${title}</a\\>&nbsp;&nbsp;<font color="\\#6f6f6f"\\>${pub}</font\\>`,
];
const realDiff = (removed: string[], added: string[]) => [...removed.map((l) => `- ${l}`), ...added.map((l) => `+ ${l}`)].join('\n');

describe('monitor ingest (real Context.dev feed format)', () => {
  const loadstar = REAL_ITEM('News Democrat success may mean more trade stability, but alongside tariffs', 'The Loadstar', 'CBMimAF', 'Fri, 13 Nov 2026 11:45:19 GMT');

  it('a moved item (removed + re-added) is not new', () => {
    expect(newItems(change({ diff: realDiff(loadstar, loadstar) }))).toEqual([]);
  });

  it('an added item becomes evidence with real URL, publisher and date', () => {
    const fresh = REAL_ITEM('Canada & Mexico respond to new US tariff threat', 'Reuters', 'CBMnew1', 'Sat, 14 Nov 2026 08:00:00 GMT');
    const ev = changeToEvidence('news_feed', 'u', change({ diff: realDiff(loadstar, [...fresh, ...loadstar]) }), 'evt', new Set());
    expect(ev).toEqual([
      expect.objectContaining({
        title: 'Canada & Mexico respond to new US tariff threat',
        sourceName: 'Reuters',
        sourceUrl: 'https://news.google.com/rss/articles/CBMnew1?oc=5',
        publishedAt: '2026-11-14T08:00:00.000Z',
      }),
    ]);
  });
});

describe('monitor ingest', () => {
  it('parses Google News items with publisher and date', () => {
    const [item] = parseLinks(FEED_BEFORE.split('\n').slice(1).join('\n'));
    expect(item).toEqual({
      url: 'https://news.google.com/rss/articles/OLD?oc=5',
      title: 'Old story about tariffs and steel',
      publisher: 'Reuters',
      publishedAt: '2026-11-12T16:18:20.000Z',
    });
  });

  it('only treats links added by the diff as new', () => {
    expect(newItems(change()).map((i) => i.title)).toEqual(['EU announces retaliatory tariffs on US goods']);
  });

  it('ignores items that were only re-ordered', () => {
    const diff = `-- [Same headline moved around here - AP](https://x.com/a/b)\n+- [Same headline moved around here - AP](https://x.com/a/b)`;
    expect(newItems(change({ diff }))).toEqual([]);
  });

  it('news feed change -> one evidence item per new headline, never duplicating graph evidence', () => {
    const ev = changeToEvidence('news_feed', 'https://news.google.com/rss/search?q=tariffs', change(), 'evt-x', new Set());
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({
      title: 'EU announces retaliatory tariffs on US goods',
      sourceName: 'BBC News',
      sourceUrl: 'https://news.google.com/rss/articles/NEW1?oc=5',
      publishedAt: '2026-11-14T09:00:00.000Z',
      eventId: 'evt-x',
    });
    expect(changeToEvidence('news_feed', 'u', change(), 'evt-x', new Set([ev[0]!.id]))).toEqual([]);
  });

  it('page change without article links -> the page itself, with the changed text', () => {
    const ev = changeToEvidence(
      'page',
      'https://gov.example/statement',
      change({ diff: undefined, url: 'https://gov.example/statement', title: 'Statement updated', after_text_excerpt: 'The ministry now says talks are suspended.' }),
      'evt-y',
      new Set(),
    );
    expect(ev).toEqual([
      expect.objectContaining({ id: 'mon-chg_1', title: 'Statement updated', excerpt: 'The ministry now says talks are suspended.', sourceUrl: 'https://gov.example/statement' }),
    ]);
  });

  it('sitemap change -> added URLs with titles from the slug', () => {
    const ev = changeToEvidence('sitemap', 'https://site.example/sitemap.xml', change({ diff: undefined, added_urls: ['https://site.example/2026/11/14/eu-hits-back-with-tariffs.html'] }), 'e', new Set());
    expect(ev[0]?.title).toBe('Eu hits back with tariffs');
    expect(titleFromUrl('https://a.example/')).toBe('a.example');
  });

  it('builds the default news feed URL from the topic', () => {
    expect(newsFeedUrl('US tariffs')).toBe('https://news.google.com/rss/search?q=US+tariffs&hl=en-US&gl=US&ceid=US%3Aen');
  });
});

describe('webhook signature', () => {
  const secret = 'whsec_test';
  const body = Buffer.from('{"event":"change.detected"}');
  const sign = (t: number) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;

  it('accepts a valid, fresh signature', () => {
    expect(verifySignature(sign(1000), body, secret, 1010)).toBe(true);
  });
  it('rejects stale, tampered or missing signatures', () => {
    expect(verifySignature(sign(1000), body, secret, 2000)).toBe(false);
    expect(verifySignature(sign(1000), Buffer.from('{}'), secret, 1000)).toBe(false);
    expect(verifySignature(sign(1000), body, 'whsec_other', 1000)).toBe(false);
    expect(verifySignature(undefined, body, secret, 1000)).toBe(false);
  });
});

function record(): InvestigationRecord {
  const now = '2026-11-14T09:00:00.000Z';
  return {
    id: 'inv1',
    title: 'US tariffs',
    topic: 'US tariffs',
    visibility: 'public',
    status: 'active',
    createdAt: now,
    updatedAt: now,
    revision: 1,
    events: [],
    claims: [{ id: 'clm-old', statement: 'Old claim', kind: 'development', status: 'pending', statusReason: '', disputed: false, evidence: [] }],
  };
}

function fakeClient(over: Partial<MonitorsClient> = {}): MonitorsClient {
  return {
    create: vi.fn(async () => ({ id: 'mon_1', status: 'active', secret: 'whsec_abc' })),
    remove: vi.fn(async () => {}),
    runNow: vi.fn(async () => ({ runId: 'run_1' })),
    getRun: vi.fn(async () => ({ id: 'run_1', status: 'completed', change_id: 'chg_1' })),
    getChange: vi.fn(async () => change()),
    listChanges: vi.fn(async () => []),
    ...over,
  };
}

async function setup(client = fakeClient(), webhookUrl?: string) {
  const store = new MemoryInvestigationStore();
  await store.create(record());
  const frames: { type: string; payload: Record<string, unknown> }[] = [];
  const rebuildClaims = vi.fn(async (id: string) => {
    const r = (await store.get(id))!;
    await store.setClaims(id, { claims: [...(r.claims ?? []), { id: 'clm-new', statement: 'EU retaliates', kind: 'development', status: 'pending', statusReason: '', disputed: false, evidence: [] }], links: [] });
  });
  const service = new MonitorService({
    store,
    client,
    publish: (f) => frames.push(f as never),
    rebuildClaims,
    ...(webhookUrl && { webhookUrl }),
    sleep: async () => {},
  });
  return { store, frames, service, rebuildClaims, client };
}

describe('MonitorService', () => {
  it('creates a Context.dev news feed monitor for the topic and hides the secret', async () => {
    const { service, client, store } = await setup(undefined, 'https://api.example/webhook/monitor');
    const dto = await service.create('inv1', { kind: 'news_feed', intervalMinutes: 15 });
    expect(client.create).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { type: 'page', url: newsFeedUrl('US tariffs') },
        changeDetection: 'exact',
        intervalMinutes: 15,
        webhookUrl: 'https://api.example/webhook/monitor',
      }),
    );
    expect(dto).toMatchObject({ id: 'mon_1', kind: 'news_feed', webhook: true, status: 'active' });
    expect(dto).not.toHaveProperty('secret');
    expect((await store.get('inv1'))!.monitors![0]!.secret).toBe('whsec_abc');
  });

  it('page monitor with instructions uses semantic detection; rejects bad input', async () => {
    const { service, client } = await setup();
    await service.create('inv1', { kind: 'page', url: 'https://gov.example/x', instructions: 'Report new statements' });
    expect(client.create).toHaveBeenCalledWith(expect.objectContaining({ changeDetection: 'semantic', target: { type: 'page', url: 'https://gov.example/x', instructions: 'Report new statements' } }));
    await expect(service.create('inv1', { kind: 'page', url: 'not a url' })).rejects.toMatchObject({ status: 400 });
    await expect(service.create('inv1', { kind: 'news_feed', intervalMinutes: 5 })).rejects.toMatchObject({ status: 400 });
  });

  it('check now -> new event + evidence, claims rebuilt with the new evidence preferred, new claim highlighted', async () => {
    const { service, store, frames, rebuildClaims } = await setup();
    await service.create('inv1', { kind: 'news_feed' });
    await service.checkNow('inv1', 'mon_1');
    await vi.waitFor(() => expect(frames.some((f) => f.type === 'investigation:monitor' && f.payload.phase === 'claims_updated')).toBe(true));

    const r = (await store.get('inv1'))!;
    expect(r.events).toHaveLength(1);
    expect(r.events[0]!.title).toBe('Live update · EU announces retaliatory tariffs on US goods');
    expect(r.events[0]!.evidence.map((e) => e.title)).toEqual(['EU announces retaliatory tariffs on US goods']);
    expect(rebuildClaims).toHaveBeenCalledWith('inv1', [r.events[0]!.evidence[0]!.id]);
    expect(r.monitors![0]).toMatchObject({ changesApplied: 1, seenChangeIds: ['chg_1'] });

    const highlight = frames.find((f) => f.type === 'investigation:highlight');
    expect(highlight?.payload).toMatchObject({ eventIds: ['clm-new'], final: true });
    const updates = frames.filter((f) => f.type === 'investigation:updated');
    expect(updates.at(-1)?.payload).toMatchObject({ run: { status: 'succeeded' } });

    // Same change again (e.g. webhook after the poller): ignored.
    await service.apply('inv1', 'mon_1', change());
    expect((await store.get('inv1'))!.events).toHaveLength(1);
  });

  it('reports no change when the run found none', async () => {
    const { service, frames, store } = await setup(fakeClient({ getRun: vi.fn(async () => ({ id: 'run_1', status: 'completed', change_id: null })) }));
    await service.create('inv1', { kind: 'news_feed' });
    await service.checkNow('inv1', 'mon_1');
    await vi.waitFor(() => expect(frames.some((f) => f.payload.phase === 'no_change')).toBe(true));
    expect((await store.get('inv1'))!.events).toHaveLength(0);
  });

  it('poller applies changes listed since the last check', async () => {
    const listChanges = vi.fn(async () => [change({ id: 'chg_9' })]);
    const { service, store } = await setup(fakeClient({ listChanges }));
    await service.create('inv1', { kind: 'news_feed' });
    await service.pollOnce();
    expect(listChanges).toHaveBeenCalledWith('mon_1', expect.any(String));
    expect((await store.get('inv1'))!.events.map((e) => e.id)).toEqual(['evt-mon-chg_9']);
  });

  it('webhook: applies a correctly signed change, rejects a bad signature', async () => {
    const { service, store } = await setup(undefined, 'https://api.example/webhook/monitor');
    await service.create('inv1', { kind: 'news_feed' });
    const raw = Buffer.from(JSON.stringify({ event: 'change.detected', id: 'evt_1', created_at: '', data: { change: change({ id: 'chg_w' }) } }));
    const t = Math.floor(Date.now() / 1000);
    const good = `t=${t},v1=${createHmac('sha256', 'whsec_abc').update(`${t}.`).update(raw).digest('hex')}`;

    expect(await service.handleWebhook(raw, { signature: 't=1,v1=00' })).toBe(401);
    expect(await service.handleWebhook(raw, { signature: good })).toBe(204);
    await vi.waitFor(async () => expect((await store.get('inv1'))!.events).toHaveLength(1));
  });

  it('remove deletes the Context.dev monitor and the stored one', async () => {
    const { service, client, store } = await setup();
    await service.create('inv1', { kind: 'news_feed' });
    await service.remove('inv1', 'mon_1');
    expect(client.remove).toHaveBeenCalledWith('mon_1');
    expect((await store.get('inv1'))!.monitors).toEqual([]);
  });
});

describe('monitor HTTP routes', () => {
  it('create/list/check/delete and a signed webhook through Express (raw body)', async () => {
    const { createHttpServer } = await import('../src/server.js');
    const { RealtimeHub } = await import('../src/realtime/hub.js');
    const { MemoryTimelineStore } = await import('../src/timeline/store.js');
    const { InvestigationService } = await import('../src/investigations/service.js');
    const timeline = new MemoryTimelineStore();
    const hub = new RealtimeHub(timeline);
    const { store, service: monitors } = await setup(undefined, 'https://api.example/webhook/monitor');
    const investigations = new InvestigationService({ store, publish: () => {}, collect: async () => ({ articles: 0, summary: '' }) });
    const server = createHttpServer({ store: timeline, hub, investigations, monitors });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/api`;
    try {
      const created = await fetch(`${base}/investigations/inv1/monitors`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'news_feed', intervalMinutes: 10 }) });
      expect(created.status).toBe(201);
      expect(await created.json()).not.toHaveProperty('secret');
      const bad = await fetch(`${base}/investigations/inv1/monitors`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'rss' }) });
      expect(bad.status).toBe(400);
      expect((await (await fetch(`${base}/investigations/inv1/monitors`)).json()).items).toHaveLength(1);
      expect((await fetch(`${base}/investigations/inv1/monitors/mon_1/check`, { method: 'POST' })).status).toBe(202);

      // Pretty-printed JSON: the signature only matches the exact bytes, not a re-serialisation.
      const raw = JSON.stringify({ event: 'change.detected', id: 'evt_2', created_at: '', data: { change: change({ id: 'chg_http', diff: '+ - [Japan joins talks on steel tariff relief - NHK](https://x.example/a/b)' }) } }, null, 2);
      const t = Math.floor(Date.now() / 1000);
      const sig = `t=${t},v1=${createHmac('sha256', 'whsec_abc').update(`${t}.${raw}`).digest('hex')}`;
      const hook = await fetch(`${base.replace(/\/api$/, '')}/webhook/monitor`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-context-signature': sig, 'x-context-event': 'change.detected' }, body: raw });
      expect(hook.status).toBe(204);
      await vi.waitFor(async () => expect((await store.get('inv1'))!.events.map((e) => e.id)).toContain('evt-mon-chg_http'));

      expect((await fetch(`${base}/investigations/inv1/monitors/mon_1`, { method: 'DELETE' })).status).toBe(204);
    } finally {
      hub.close();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
