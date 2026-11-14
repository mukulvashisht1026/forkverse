import test from 'node:test';
import assert from 'node:assert/strict';
import { projectTreePoint, treeDepthScale } from './investigationTree/utils/treeMath';

test('fixed-camera projection gives world depth a deterministic screen displacement', () => {
  const near = projectTreePoint(240, 80, -90);
  const far = projectTreePoint(240, 80, 90);
  assert.notDeepEqual(near, far);
  assert.deepEqual(projectTreePoint(240, 80, 90), far);
});

test('depth scale stays bounded and responds to branch depth', () => {
  assert.ok(treeDepthScale(-90) > treeDepthScale(90));
  for (const depth of [-1000, -90, 0, 90, 1000]) {
    assert.ok(treeDepthScale(depth) >= 0.88);
    assert.ok(treeDepthScale(depth) <= 1.12);
  }
});
