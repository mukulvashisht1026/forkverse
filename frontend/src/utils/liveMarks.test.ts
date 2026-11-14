import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FRESH_MS, RECENT_MS, addLiveIds, liveMarksAt, pruneLiveIds } from './liveMarks';

test('live marks: fresh, then recent, then gone', () => {
  const added = addLiveIds(new Map(), ['clm-1', 'art-2'], 1000);
  assert.equal(liveMarksAt(added, 1000).get('clm-1'), 'fresh');
  assert.equal(liveMarksAt(added, 1000 + FRESH_MS + 1).get('art-2'), 'recent');
  assert.equal(liveMarksAt(added, 1000 + RECENT_MS + 1).size, 0);
  assert.equal(pruneLiveIds(added, 1000 + RECENT_MS + 1).size, 0);
});

test('live marks: re-adding keeps the first time', () => {
  const a = addLiveIds(new Map(), ['x'], 1000);
  assert.equal(addLiveIds(a, ['x', ''], 5000).get('x'), 1000);
  assert.equal(addLiveIds(a, ['x', ''], 5000).size, 1);
});
