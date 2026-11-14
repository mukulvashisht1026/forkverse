import test from 'node:test';
import assert from 'node:assert/strict';
import { generateBranchGeometry, SPINE_GAP } from './investigationTree/utils/treeMath';
import { shortLabel } from './investigationTree/TreeCanvasAdapter';

test('node-card branch position uses same deterministic canvas geometry', () => {
  const seed = 7182;
  const branch = generateBranchGeometry(SPINE_GAP, 1, 1, seed, '#75c4c8');
  const sameBranch = generateBranchGeometry(SPINE_GAP, 1, 1, seed, '#75c4c8');
  assert.deepEqual(branch.tip, sameBranch.tip);
  assert.ok(branch.tip.x > SPINE_GAP);
  assert.notEqual(branch.tip.y, 0);
});

test('card canvas label truncation leaves full title available to detail card', () => {
  const title = 'A long research article title with source context and additional details';
  assert.ok(shortLabel(title).length <= 44);
  assert.equal(title.length > shortLabel(title).length, true);
});
