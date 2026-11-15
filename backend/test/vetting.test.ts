import { describe, expect, it, vi } from 'vitest';
import { pickEvidence } from '../src/claims/builder.js';
import { MemoryInvestigationStore } from '../src/investigations/store.js';
import type { InvestigationRecord, SourceVettingDto } from '../src/investigations/types.js';
import { lookupRating } from '../src/vetting/ratings.js';
import { groundRhetoric, type RhetoricOutputT } from '../src/vetting/rhetoric.js';
import { VettingService, withSourceRatings } from '../src/vetting/service.js';
import { combineVetting, domainVetting, vetUrl } from '../src/vetting/vet.js';

const ARTICLE = (`The traitors in the capital have betrayed every honest citizen once again. ` +
  `Only a fool would believe their lies about the economy. These parasites will stop at nothing. ` +
  `Minister Smith said "we expect growth of two percent next year". `).repeat(4);

const raw = (over: Partial<RhetoricOutputT> = {}): RhetoricOutputT => ({
  verdict: 'likely_propaganda',
  score: 75,
  genre: 'opinion',
  language: 'en',
  rationale: 'Repeated name calling and dehumanising language in the author voice.',
  techniques: [
    { technique: 'name_calling', quote: 'The traitors in the capital have betrayed every honest citizen', explanation: '', voice: 'author' },
    { technique: 'dehumanization', quote: 'These parasites will stop at nothing.', explanation: '', voice: 'author' },
  ],
  counterevidence: [],
  ...over,
});

describe('domain listings (real data)', () => {
  it('distinguishes covert influence operations, state media, contested ratings and reliable outlets', () => {
    expect(lookupRating('https://049122.com/x')).toMatchObject({ kind: 'influence_operation', actorCountry: 'Russia', listedBy: ['meta_cib'] });
    expect(lookupRating('https://www.rt.com/news/1')).toMatchObject({ kind: 'state_media', actorCountry: 'Russia' });
    expect(lookupRating('https://edition.foxnews.com/a')).toMatchObject({ domain: 'foxnews.com', kind: 'unreliable' });
    expect(lookupRating('https://www.reuters.com/world/')).toMatchObject({ kind: 'reliable' });
    expect(lookupRating('https://my-own-blog.example/post')).toBeUndefined();
  });

  it('domain-only verdicts: only influence operations are manipulative', () => {
    expect(domainVetting('https://049122.com/x')).toMatchObject({ verdict: 'manipulative', depth: 'domain', coverage: 0.5 });
    expect(domainVetting('https://rt.com/a')?.verdict).toBe('uncertain');
    expect(domainVetting('https://foxnews.com/a')?.verdict).toBe('uncertain');
    expect(domainVetting('https://apnews.com/a')?.verdict).toBe('credible');
    expect(domainVetting('https://unlisted.example/a')).toBeUndefined();
  });
});

describe('rhetoric grounding', () => {
  it('keeps a positive finding with two verified author passages', () => {
    const r = groundRhetoric(raw(), ARTICLE);
    expect(r.verdict).toBe('likely_propaganda');
    expect(r.techniques).toHaveLength(2);
  });
  it('drops invented quotes and abstains', () => {
    const r = groundRhetoric(raw({ techniques: [...raw().techniques, { technique: 'slogans', quote: 'Make the nation great forever and ever', explanation: '', voice: 'author' }] }), ARTICLE);
    expect(r.verdict).toBe('uncertain');
    expect(r.modelVerdict).toBe('likely_propaganda');
    expect(r.techniques).toHaveLength(2);
  });
  it('quoted speakers do not count towards the author verdict', () => {
    const r = groundRhetoric(raw({ techniques: raw().techniques.map((t) => ({ ...t, voice: 'quoted_speaker' as const })) }), ARTICLE);
    expect(r.verdict).toBe('uncertain');
  });
  it('satire / non-article genres and partial text are uncertain', () => {
    expect(groundRhetoric(raw({ genre: 'satire' }), ARTICLE).verdict).toBe('uncertain');
    expect(groundRhetoric(raw({ verdict: 'no_clear_evidence', techniques: [] }), ARTICLE, true).verdict).toBe('uncertain');
    expect(groundRhetoric(raw({ verdict: 'no_clear_evidence', techniques: [], genre: 'reporting' }), ARTICLE).verdict).toBe('no_clear_evidence');
  });
});

describe('propaganda score', () => {
  it('agrees with the grounded verdict: > 74 only with a verified finding', () => {
    expect(groundRhetoric(raw({ score: 75 }), ARTICLE)).toMatchObject({ verdict: 'likely_propaganda', score: 75 });
    // A finding with a score at or below 74 is not enough: uncertain, capped at 74, never flagged.
    const weak = groundRhetoric(raw({ score: 65 }), ARTICLE);
    expect(weak).toMatchObject({ verdict: 'uncertain', score: 65 });
    expect(weak.warnings.join(' ')).toMatch(/above 74%/);
    // Downgraded (quoted speakers only): capped at 74, never flagged.
    expect(groundRhetoric(raw({ score: 95, techniques: raw().techniques.map((t) => ({ ...t, voice: 'quoted_speaker' as const })) }), ARTICLE).score).toBe(74);
    expect(groundRhetoric(raw({ verdict: 'no_clear_evidence', score: 70, techniques: [], genre: 'reporting' }), ARTICLE).score).toBe(40);
  });
  it('data pages (weather, prices, scores) are never assessed: uncertain, score 0', () => {
    const r = groundRhetoric(raw({ genre: 'data', score: 90 }), ARTICLE);
    expect(r).toMatchObject({ verdict: 'uncertain', score: 0 });
    expect(r.warnings.join(' ')).toMatch(/Data page/);
    expect(combineVetting('https://weather.example/today', undefined, r).verdict).toBe('uncertain');
  });
  it('documented influence operations score at least 90; unknown without any signal', () => {
    expect(domainVetting('https://049122.com/x')?.propagandaScore).toBe(90);
    expect(domainVetting('https://apnews.com/x')?.propagandaScore).toBeUndefined();
    expect(combineVetting('u', undefined, groundRhetoric(raw({ score: 20, verdict: 'no_clear_evidence', techniques: [], genre: 'reporting' }), ARTICLE)).propagandaScore).toBe(20);
  });
});

describe('combineVetting', () => {
  const rating = (kind: 'reliable' | 'unreliable' | 'state_media' | 'influence_operation') => ({
    domain: 'x.com', label: 'reliable' as const, kind, confidence: 'high' as const, subtypes: [], listedBy: ['lin2023'],
  });
  const rh = (verdict: 'likely_propaganda' | 'no_clear_evidence' | 'uncertain') => groundRhetoric(raw({ verdict, genre: 'reporting', techniques: verdict === 'likely_propaganda' ? raw().techniques : [] }), ARTICLE);

  it('abstains: unknown domain + no content = uncertain with zero coverage', () => {
    expect(combineVetting('u', undefined, undefined)).toMatchObject({ verdict: 'uncertain', coverage: 0 });
  });
  it('rhetoric finding makes even a reliable domain manipulative', () => {
    expect(combineVetting('u', rating('reliable'), rh('likely_propaganda'))).toMatchObject({ verdict: 'manipulative', coverage: 1 });
  });
  it('caution listings keep clean text at uncertain; a failed scrape never counts as safe or risky', () => {
    expect(combineVetting('u', rating('unreliable'), rh('no_clear_evidence')).verdict).toBe('uncertain');
    expect(combineVetting('u', rating('state_media'), rh('no_clear_evidence')).verdict).toBe('uncertain');
    expect(combineVetting('u', undefined, rh('no_clear_evidence'))).toMatchObject({ verdict: 'credible', coverage: 0.5 });
    expect(combineVetting('u', undefined, undefined, 'WEBSITE_BLOCKED')).toMatchObject({ verdict: 'uncertain', coverage: 0, depth: 'content', error: 'WEBSITE_BLOCKED' });
  });
});

describe('vetUrl', () => {
  it('scrapes, analyses and grounds against the page text', async () => {
    const json = vi.fn(async () => raw()) as never;
    const v = await vetUrl('https://unlisted.example/a', { scrape: async () => ({ ok: true, markdown: ARTICLE }), json });
    expect(v).toMatchObject({ verdict: 'manipulative', depth: 'content', coverage: 0.5 });
    expect(v.rhetoric?.techniques[0]?.quote).toContain('traitors');
  });
  it('unreadable pages are kept with their error', async () => {
    const v = await vetUrl('https://apnews.com/x', { scrape: async () => ({ ok: false, error: 'blocked' }), json: vi.fn() as never });
    expect(v).toMatchObject({ verdict: 'credible', error: 'blocked', coverage: 0.5 });
  });
});

function record(): InvestigationRecord {
  const now = '2026-11-14T00:00:00Z';
  return { id: 'inv', title: 't', topic: 't', visibility: 'public', status: 'active', createdAt: now, updatedAt: now, revision: 1, events: [{ id: 'e1', title: 'E', evidence: [] }] };
}

describe('investigation integration', () => {
  it('new evidence gets its domain listing automatically', async () => {
    const store = withSourceRatings(new MemoryInvestigationStore());
    await store.create(record());
    await store.addEvidence('inv', 'e1', { id: 'a', title: 'A', sourceUrl: 'https://049122.com/story' });
    await store.addEvidence('inv', 'e1', { id: 'b', title: 'B', sourceUrl: 'https://unlisted.example/s' });
    const ev = (await store.get('inv'))!.events[0]!.evidence;
    expect(ev[0]!.vetting).toMatchObject({ verdict: 'manipulative', depth: 'domain' });
    expect(ev[1]!.vetting).toBeUndefined();
  });

  it('vetting run stores results, narrates progress and rebuilds claims when it flags a source', async () => {
    const store = new MemoryInvestigationStore();
    await store.create(record());
    await store.addEvidence('inv', 'e1', { id: 'a', title: 'A', sourceUrl: 'https://a.example/1', sourceName: 'A' });
    await store.addEvidence('inv', 'e1', { id: 'b', title: 'B', sourceUrl: 'https://b.example/2', sourceName: 'B' });
    const frames: { type: string; payload: Record<string, unknown> }[] = [];
    const rebuildClaims = vi.fn(async () => {});
    const indexed = vi.fn(async () => {});
    const verdicts: Record<string, SourceVettingDto['verdict']> = { 'https://a.example/1': 'manipulative', 'https://b.example/2': 'credible' };
    const service = new VettingService({
      store,
      publish: (f) => frames.push(f as never),
      scrape: vi.fn() as never,
      json: vi.fn() as never,
      rebuildClaims,
      vet: async (url) => ({ url, verdict: verdicts[url]!, coverage: 1, reasons: ['r'], depth: 'content', checkedAt: '' }),
      index: { upsert: indexed } as never,
    });
    expect(await service.start('inv')).toEqual({ queued: 2, total: 2 });
    await expect(service.start('inv')).rejects.toMatchObject({ status: 409 });
    await service.running.get('inv');
    const ev = (await store.get('inv'))!.events[0]!.evidence;
    expect(ev.map((e) => e.vetting?.verdict)).toEqual(['manipulative', 'credible']);
    expect(rebuildClaims).toHaveBeenCalledWith('inv');
    // Every screened source is embedded into the sources index with its investigation.
    expect(indexed).toHaveBeenCalledTimes(2);
    expect(indexed).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://a.example/1' }), { title: 'A', investigationId: 'inv' });
    expect(frames.filter((f) => f.type === 'investigation:vetting').map((f) => f.payload.phase)).toEqual(['started', 'checked', 'checked', 'checked', 'done']);
    // Already screened at content depth: nothing left to queue.
    expect(await service.start('inv')).toEqual({ queued: 0, total: 2 });
  });

  it('claim building never uses manipulative sources', () => {
    const r = record();
    r.events[0]!.evidence = [
      { id: 'a', title: 'A', sourceUrl: 'https://a.example/1', vetting: { url: '', verdict: 'manipulative', coverage: 1, reasons: [], depth: 'content', checkedAt: '' } },
      { id: 'b', title: 'B', sourceUrl: 'https://b.example/2' },
    ];
    expect(pickEvidence(r).map((e) => e.id)).toEqual(['b']);
    expect(pickEvidence(r, 24, ['a']).map((e) => e.id)).toEqual(['b']);
  });
});
