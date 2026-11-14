import test from 'node:test';
import assert from 'node:assert/strict';
import { zoomViewAtWheel } from '../components/investigationTree/utils/wheelZoom';

test('wheel zoom keeps the world point under the pointer stationary', () => {
  const view = { x: 30, y: -10, k: 1 };
  const pointer = { x: 250, y: 180 };
  const bounds = { left: 50, top: 20 };
  const before = { x: (pointer.x - bounds.left - view.x) / view.k, y: (pointer.y - bounds.top - view.y) / view.k };
  const next = zoomViewAtWheel(view, -120, pointer, bounds);
  const after = { x: (pointer.x - bounds.left - next.x) / next.k, y: (pointer.y - bounds.top - next.y) / next.k };

  assert.ok(next.k > view.k);
  assert.ok(Math.abs(after.x - before.x) < 1e-9);
  assert.ok(Math.abs(after.y - before.y) < 1e-9);
});

test('wheel zoom clamps at supported minimum and maximum scales', () => {
  assert.equal(zoomViewAtWheel({ x: 0, y: 0, k: 0.2 }, 10_000, { x: 0, y: 0 }, { left: 0, top: 0 }).k, 0.14);
  assert.equal(zoomViewAtWheel({ x: 0, y: 0, k: 2 }, -10_000, { x: 0, y: 0 }, { left: 0, top: 0 }).k, 3);
});
