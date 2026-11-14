import test from 'node:test';
import assert from 'node:assert/strict';
import { clampWorkspacePosition, snapChatPosition } from './chatPanelGeometry';
import { positionFromPointer } from './cardGeometry';

const workspace = { width: 1200, height: 800 };
const panel = { width: 352, height: 680 };

test('chat panel moves from left toward the center with no first-move jump', () => {
  const origin = { x: 12, y: 12 }, start = { x: 80, y: 90 };
  assert.deepEqual(positionFromPointer(origin, start, start), origin);
  const moved = positionFromPointer(origin, start, { x: 280, y: 180 });
  assert.deepEqual(moved, { x: 212, y: 102 });
  assert.deepEqual(snapChatPosition(moved, panel, workspace), moved);
});

test('chat panel moves from center toward right and snaps with 2px safe inset', () => {
  const moved = positionFromPointer({ x: 400, y: 20 }, { x: 600, y: 100 }, { x: 1370, y: 160 });
  assert.deepEqual(moved, { x: 1170, y: 80 });
  assert.deepEqual(snapChatPosition(moved, panel, workspace), { x: 846, y: 80 });
});

test('chat snaps left and right with exact internal inset', () => {
  assert.deepEqual(snapChatPosition({ x: 30, y: 55 }, panel, workspace), { x: 2, y: 55 });
  assert.deepEqual(snapChatPosition({ x: 820, y: 55 }, panel, workspace), { x: 846, y: 55 });
});

test('chat remains freely movable outside snap threshold and can move away from a dock', () => {
  const awayFromLeft = positionFromPointer({ x: 2, y: 12 }, { x: 20, y: 100 }, { x: 110, y: 120 });
  assert.deepEqual(snapChatPosition(awayFromLeft, panel, workspace), { x: 92, y: 32 });
  const center = { x: 430, y: 120 };
  assert.deepEqual(snapChatPosition(center, panel, workspace), center);
});

test('chat clamps inside workspace when resized or dragged beyond bounds', () => {
  assert.deepEqual(clampWorkspacePosition({ x: -50, y: -80 }, panel, workspace), { x: 0, y: 0 });
  assert.deepEqual(clampWorkspacePosition({ x: 2000, y: 900 }, panel, workspace), { x: 848, y: 120 });
});
