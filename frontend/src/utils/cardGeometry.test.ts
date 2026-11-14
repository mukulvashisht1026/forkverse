import test from 'node:test';
import assert from 'node:assert/strict';
import { clampPosition, positionFromPointer, worldToViewport } from './cardGeometry';

test('node card drag preserves its original viewport position plus pointer delta', () => {
  const origin = { x: 900, y: 300 };
  const start = { x: 950, y: 330 };
  assert.deepEqual(positionFromPointer(origin, start, { x: 960, y: 350 }), { x: 910, y: 320 });
  assert.deepEqual(positionFromPointer(origin, start, start), origin, 'pointerdown without movement never jumps');
});

test('node card drag starts at multiple grab points without changing the pointer offset', () => {
  const origin = { x: 260, y: 180 };
  for (const start of [{ x: 270, y: 190 }, { x: 410, y: 240 }, { x: 315, y: 190 }]) {
    assert.deepEqual(positionFromPointer(origin, start, { x: start.x + 17, y: start.y - 9 }), { x: 277, y: 171 });
  }
});

test('node card position clamps against actual workspace bounds at all edges', () => {
  const bounds = { left: 100, top: 50, right: 900, bottom: 650, width: 800, height: 600 };
  const size = { width: 240, height: 180 };
  assert.deepEqual(clampPosition({ x: -40, y: -20 }, size, bounds), { x: 100, y: 50 });
  assert.deepEqual(clampPosition({ x: 890, y: 640 }, size, bounds), { x: 660, y: 470 });
});

test('world anchor applies graph pan and zoom exactly once, with viewport-pixel saved offset', () => {
  const rect = { left: 100, top: 80 };
  const world = { x: 400, y: 220 };
  for (const k of [.5, 1, 2]) {
    const anchor = worldToViewport(rect, world, { k, x: 30, y: -10 });
    assert.deepEqual(anchor, { x: 130 + 400 * k, y: 70 + 220 * k });
    assert.deepEqual({ x: anchor.x + 54, y: anchor.y - 82 }, { x: 130 + 400 * k + 54, y: 70 + 220 * k - 82 });
  }
});

test('saved card offset restores its user position relative to the current graph anchor', () => {
  const anchor = worldToViewport({ left: 40, top: 20 }, { x: 300, y: 100 }, { k: 2, x: -50, y: 10 });
  const savedOffset = { x: 125, y: 40 };
  assert.deepEqual({ x: anchor.x + savedOffset.x, y: anchor.y + savedOffset.y }, { x: 715, y: 270 });
});
