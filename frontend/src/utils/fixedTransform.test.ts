import test from 'node:test';
import assert from 'node:assert/strict';
import { computeFixedTransform, GRAPH_SCALE } from '../components/investigationTree/utils/treeMath';

test('every graph uses the same scale, whatever its size', () => {
  const small = computeFixedTransform({ x: 0, y: -200, width: 600, height: 400 }, 1400, 850);
  const big = computeFixedTransform({ x: 0, y: -200, width: 9000, height: 400 }, 1400, 850);
  assert.equal(small.k, GRAPH_SCALE);
  assert.equal(big.k, GRAPH_SCALE);
});

test('a graph that fits is centred; a long one starts at its beginning, right of the chat panel', () => {
  const fits = computeFixedTransform({ x: 0, y: -100, width: 500, height: 200 }, 1400, 850);
  const left = fits.x, right = 1400 - (fits.x + 500 * GRAPH_SCALE);
  assert.ok(Math.abs(left - right) < 1, 'centred horizontally');
  const long = computeFixedTransform({ x: -100, y: -100, width: 9000, height: 200 }, 1400, 850, { leftInset: 380 });
  assert.equal(long.x, 380 + 56 + 100 * GRAPH_SCALE); // start just right of the inset
});
