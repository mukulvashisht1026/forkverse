import test from 'node:test';
import assert from 'node:assert/strict';
import { mapTreeModels } from './investigationTree/TreeCanvasAdapter';
import type { SpineNode } from '../types/tree';

test('tree canvas adapter keeps IDs, names, information and growth state while mapping graph models', () => {
  const spine = [{ id: 'event-1', name: 'Event', info: 'event details', declaration: '', platform: '', stockImpact: { summary: '', tickers: [] }, publicAppeal: { sentimentLabel: '', positivePct: 0, neutralPct: 0, negativePct: 0, narrative: '' }, scrapeEngine: 'manual', branches: [{ id: 'evidence-1', name: 'Evidence', info: 'source details', sourceType: 'news', sourceUrl: 'https://example.test/story', sourceDomain: 'example.test', publishedAt: '2026-01-01', impactAngle: 'market', seed: 17, _prog: 0.4 }] }] as SpineNode[];
  const mapped = mapTreeModels(spine);
  assert.deepEqual(mapped[0], { id: 'event-1', name: 'Event', info: 'event details', branches: [{ id: 'evidence-1', name: 'Evidence', info: 'source details', seed: 17, isNew: true, publishedAt: '2026-01-01' }] });
  assert.equal(spine[0].branches[0].sourceUrl, 'https://example.test/story');
  spine[0].branches[0]._prog = 1;
  assert.equal(mapTreeModels(spine)[0].branches[0].isNew, false);
});

test('tree canvas adapter marks items added by live tracking (fresh regrows, node inherits from its sources)', () => {
  const spine = [
    { id: 'clm-1', name: 'Claim', info: '', branches: [{ id: 'art-new', name: 'New source', info: '', seed: 1, _prog: 1 }, { id: 'art-old', name: 'Old', info: '', seed: 2, _prog: 1 }] },
    { id: 'clm-2', name: 'Other', info: '', branches: [] },
  ] as unknown as SpineNode[];
  const mapped = mapTreeModels(spine, new Map([['art-new', 'fresh' as const], ['clm-2', 'recent' as const]]));
  assert.equal(mapped[0].live, 'fresh');
  assert.deepEqual(mapped[0].branches.map((b) => [b.live, b.isNew]), [['fresh', true], [undefined, false]]);
  assert.equal(mapped[1].live, 'recent');
  assert.equal(mapTreeModels(spine)[0].live, undefined);
});

test('tree canvas adapter carries source vetting: verdict class and warning tag', async () => {
  const { vetTag } = await import('./investigationTree/TreeCanvasAdapter');
  const base = { url: 'u', coverage: 1, reasons: [], depth: 'domain' as const, checkedAt: '' };
  const spine = [{ id: 'e', name: 'E', info: '', branches: [
    { id: 'a', name: 'A', info: '', seed: 1, vetting: { ...base, verdict: 'manipulative' as const } },
    { id: 'b', name: 'B', info: '', seed: 2, vetting: { ...base, verdict: 'uncertain' as const, rating: { domain: 'rt.com', label: 'propaganda' as const, kind: 'state_media' as const, confidence: 'high' as const, subtypes: [], listedBy: [] } } },
    { id: 'c', name: 'C', info: '', seed: 3, vetting: { ...base, verdict: 'credible' as const } },
    { id: 'd', name: 'D', info: '', seed: 4 },
  ] }] as unknown as SpineNode[];
  const b = mapTreeModels(spine)[0].branches;
  assert.deepEqual(b.map((x) => [x.vet, x.vetTag]), [['manipulative', 'MANIPULATIVE'], ['uncertain', 'STATE MEDIA'], ['credible', undefined], [undefined, undefined]]);
  assert.equal(vetTag(undefined), undefined);
});
