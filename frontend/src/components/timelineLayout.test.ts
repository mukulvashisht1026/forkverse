import test from 'node:test';
import assert from 'node:assert/strict';
import { branchOrder, computeSpineLayout, generateBranchGeometry, ORIGIN_STEP, SEGMENT_PAD, SPINE_GAP, tickLabel } from './investigationTree/utils/treeMath';

test('articles are ranked by publish date, undated ones last in original order', () => {
  assert.deepEqual(branchOrder(['2026-03-01', undefined, '2025-12-24', 'not a date', '2026-01-05']), [2, 3, 0, 4, 1]);
});

test('event segments widen to fit their articles along the line', () => {
  const layout = computeSpineLayout([2, 12, 0]);
  assert.equal(layout.nodeX[0], 0);
  assert.equal(layout.nodeX[1], SPINE_GAP); // 2 articles fit in the default gap
  assert.ok(layout.nodeX[2]! - layout.nodeX[1]! >= SEGMENT_PAD + 11 * ORIGIN_STEP); // 12 articles need more room
  assert.equal(layout.originStart[1], layout.nodeX[1]! + SEGMENT_PAD);
});

test('a timeline branch starts on the line at its origin, not at the node', () => {
  const g = generateBranchGeometry(0, -1, 0, 42, '#fff', 300);
  assert.equal(g.points[0]!.x, 300);
  assert.ok(Math.abs(g.points[0]!.y) <= 4);
  assert.ok(g.tip.x > 300); // grows forward
});

test('tick labels are short dates; invalid dates have none', () => {
  assert.equal(tickLabel('2025-02-03T10:00:00Z'), '3 Feb 25');
  assert.equal(tickLabel(undefined), null);
  assert.equal(tickLabel('nope'), null);
});
