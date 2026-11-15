import { describe, expect, it, vi } from 'vitest';
import type { ClaimDto, InvestigationRecord } from '../src/investigations/types.js';
import { MemoryInvestigationStore } from '../src/investigations/store.js';
import { buildEdition, editionStateKey, pickClaims, type EditorOutputT } from '../src/newspaper/edition.js';
import { renderNewspaperHtml } from '../src/newspaper/render.js';
import { NewspaperService } from '../src/newspaper/service.js';

const ev = (id: string, publisher: string, extra: Record<string, unknown> = {}) => ({
  evidenceId: id, stance: 'supports' as const, quote: `quote ${id}`, summary: `${publisher} summary`, title: `Title ${id}`, publisher, url: `https://${publisher}/${id}`, publishedAt: '2026-11-10T00:00:00Z', ...extra,
});
const claim = (id: string, status: 'established' | 'pending', date: string, evidence = [ev(`${id}a`, 'one.example'), ev(`${id}b`, 'two.example')]): ClaimDto => ({
  id, statement: `Statement ${id}`, kind: 'development', status, statusReason: `reason ${id}`, disputed: false, occurredAt: date, evidence,
});

function record(): InvestigationRecord {
  const now = '2026-11-14T00:00:00Z';
  const claims = [
    claim('c1', 'established', '2026-11-12T00:00:00Z'),
    claim('c2', 'established', '2026-11-13T00:00:00Z'),
    claim('c3', 'pending', '2026-11-14T00:00:00Z', [ev('c3a', 'spoof.example')]),
    claim('c4', 'established', '2026-11-01T00:00:00Z'),
  ];
  return {
    id: 'inv', title: 'Ceasefire talks', topic: 'Ceasefire talks', visibility: 'public', status: 'active', createdAt: now, updatedAt: now, revision: 3,
    claimsUpdatedAt: now, claims,
    events: [{
      id: 'e1', title: 'E', evidence: [
        { id: 'c2a', title: 'Title c2a', sourceUrl: 'https://one.example/c2a', sourceName: 'One', imageUrl: 'https://img.example/c2a.jpg' },
        { id: 'c2b', title: 'Title c2b', sourceUrl: 'https://two.example/c2b', sourceName: 'Two' },
        { id: 'c1a', title: 'Title c1a', sourceUrl: 'https://one.example/c1a', sourceName: 'One' },
        { id: 'c3a', title: 'Spoof', sourceUrl: 'https://spoof.example/c3a', sourceName: 'Spoof', imageUrl: 'https://img.example/spoof.jpg',
          vetting: { url: 'https://spoof.example/c3a', verdict: 'manipulative', coverage: 1, propagandaScore: 88, reasons: [], depth: 'content', checkedAt: '' } },
      ],
    }],
  };
}

const editor = (over: Partial<EditorOutputT> = {}): EditorOutputT => ({
  crux: 'Talks resumed after a pause.',
  lead: { kicker: 'Diplomacy', headline: 'Talks resume in the capital', dek: 'Two outlets report a new round.', paragraphs: [{ text: 'Envoys met again.', claims: ['C1'] }, { text: 'Invented detail.', claims: ['C9'] }, { text: 'Uncited.', claims: [] }] },
  stories: [{ ref: 'C2', kicker: 'Background', headline: 'Earlier round ended', dek: 'Short.' }],
  briefs: [{ ref: 'C4', kicker: 'Report', headline: 'Claim reportedly made', dek: 'One outlet says so.' }],
  ...over,
});

describe('newspaper edition', () => {
  it('leads with the newest established claim; verified stories first, unverified fill the rest', () => {
    const p = pickClaims(record().claims!);
    expect(p.lead?.id).toBe('c2');
    expect(p.stories.map((c) => c.id)).toEqual(['c1', 'c4', 'c3']);
    expect(p.briefs).toEqual([]);
  });

  it('keeps only paragraphs citing known claims; labels unverified; excludes red-flagged sources', async () => {
    const json = vi.fn(async () => editor()) as never;
    const pageImage = vi.fn(async (url: string) => (url.includes('one.example/c1a') ? 'https://img.example/og-c1a.jpg' : undefined));
    const e = await buildEdition(record(), { json, pageImage, now: () => new Date('2026-11-14T12:00:00Z') });

    expect(e.writer).toBe('llm');
    expect(e.lead).toMatchObject({ claimId: 'c2', headline: 'Talks resume in the capital', paragraphs: ['Envoys met again.'], imageUrl: 'https://img.example/c2a.jpg', imageCredit: 'One', status: 'established' });
    expect(e.stories[0]).toMatchObject({ claimId: 'c1', imageUrl: 'https://img.example/og-c1a.jpg' }); // og:image fallback
    const unverified = [...e.stories, ...e.briefs].find((s) => s.claimId === 'c3');
    expect(unverified?.kicker.startsWith('Unverified')).toBe(true);
    expect(unverified?.sources).toEqual([]); // spoof source never cited
    expect(unverified?.imageUrl).toBeUndefined(); // ...nor its image
    expect(e.propagandaWatch).toEqual([{ title: 'Spoof', publisher: 'Spoof', score: 88 }]);
    expect(e.stats).toMatchObject({ established: 3, unverified: 1, flagged: 1 });
    expect(e.timeline.map((t) => t.text)).toEqual(['Statement c4', 'Statement c1', 'Statement c2', 'Statement c3']);
  });

  it('falls back to the claim statements when the editor fails', async () => {
    const e = await buildEdition(record(), { json: vi.fn(async () => { throw new Error('down'); }) as never });
    expect(e.writer).toBe('fallback');
    expect(e.lead.headline).toBe('Statement c2');
    expect(e.lead.paragraphs[0]).toBe('Statement c2');
  });

  it('renders escaped HTML with real images, unsafe URLs dropped, height reporting for embedding', async () => {
    const r = record();
    r.claims![1]!.statement = '<script>alert(1)</script> Talks';
    const e = await buildEdition(r, { json: vi.fn(async () => { throw new Error('x'); }) as never });
    e.lead.sources.push({ title: 'bad', url: 'javascript:alert(1)' });
    const html = renderNewspaperHtml(e);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('javascript:alert');
    expect(html).toContain('src="https://img.example/c2a.jpg"');
    expect(html).toContain('tracewire:newspaper-height');
    expect(html).toContain('Propaganda watch');
  });

  it('service caches per graph state and rebuilds when it changes', async () => {
    const store = new MemoryInvestigationStore();
    await store.create(record());
    const json = vi.fn(async () => editor());
    const service = new NewspaperService({ store, json: json as never });
    await Promise.all([service.edition('inv'), service.edition('inv')]);
    expect(json).toHaveBeenCalledTimes(1);
    const before = editionStateKey((await store.get('inv'))!);
    await store.addEvidence('inv', 'e1', { id: 'new', title: 'New', sourceUrl: 'https://three.example/n' });
    expect(editionStateKey((await store.get('inv'))!)).not.toBe(before);
    await service.edition('inv');
    expect(json).toHaveBeenCalledTimes(2);
    await expect(service.edition('missing')).rejects.toMatchObject({ status: 404 });
  });
});

describe('newspaper routes', () => {
  it('serves the edition as JSON and as a standalone page with a strict CSP', async () => {
    const { createHttpServer } = await import('../src/server.js');
    const { RealtimeHub } = await import('../src/realtime/hub.js');
    const { MemoryTimelineStore } = await import('../src/timeline/store.js');
    const { InvestigationService } = await import('../src/investigations/service.js');
    const store = new MemoryInvestigationStore();
    await store.create(record());
    const timeline = new MemoryTimelineStore();
    const hub = new RealtimeHub(timeline);
    const investigations = new InvestigationService({ store, publish: () => {}, collect: async () => ({ articles: 0, summary: '' }) });
    const newspaper = new NewspaperService({ store, json: vi.fn(async () => editor()) as never });
    const server = createHttpServer({ store: timeline, hub, investigations, newspaper });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/api/investigations/inv`;
    try {
      const json = await (await fetch(`${base}/newspaper`)).json();
      expect(json).toMatchObject({ investigationId: 'inv', lead: { headline: 'Talks resume in the capital' } });
      const page = await fetch(`${base}/newspaper.html`);
      expect(page.headers.get('content-type')).toContain('text/html');
      expect(page.headers.get('content-security-policy')).toContain("default-src 'none'");
      expect(await page.text()).toContain('The Daily Trace');
      expect((await fetch(`${base.replace('/inv', '/nope')}/newspaper.html`)).status).toBe(404);
    } finally {
      hub.close();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
