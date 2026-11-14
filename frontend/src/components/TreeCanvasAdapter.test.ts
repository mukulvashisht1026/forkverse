import test from 'node:test';
import assert from 'node:assert/strict';
import { mapTreeModels } from './investigationTree/TreeCanvasAdapter';
import type { SpineNode } from '../types/tree';

test('tree canvas adapter keeps IDs, names, information and growth state while mapping graph models', () => {
  const spine = [{ id: 'event-1', name: 'Event', info: 'event details', declaration: '', platform: '', stockImpact: { summary: '', tickers: [] }, publicAppeal: { sentimentLabel: '', positivePct: 0, neutralPct: 0, negativePct: 0, narrative: '' }, scrapeEngine: 'manual', branches: [{ id: 'evidence-1', name: 'Evidence', info: 'source details', sourceType: 'news', sourceUrl: 'https://example.test/story', sourceDomain: 'example.test', publishedAt: '2026-01-01', impactAngle: 'market', seed: 17, _prog: 0.4 }] }] as SpineNode[];
  const mapped = mapTreeModels(spine);
  assert.deepEqual(mapped[0], { id: 'event-1', name: 'Event', info: 'event details', branches: [{ id: 'evidence-1', name: 'Evidence', info: 'source details', seed: 17, isNew: true }] });
  assert.equal(spine[0].branches[0].sourceUrl, 'https://example.test/story');
  spine[0].branches[0]._prog = 1;
  assert.equal(mapTreeModels(spine)[0].branches[0].isNew, false);
});
