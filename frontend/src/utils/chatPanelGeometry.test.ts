import test from 'node:test';
import assert from 'node:assert/strict';
import { chatDockAt, clampWorkspacePosition, getChatDockLayout, getChatPanelSize, snapChatPosition } from './chatPanelGeometry';
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

test('chat panel moves from center toward right and snaps with the 2px safe inset', () => {
  const moved = positionFromPointer({ x: 400, y: 20 }, { x: 600, y: 100 }, { x: 1370, y: 160 });
  assert.deepEqual(moved, { x: 1170, y: 80 });
  assert.deepEqual(snapChatPosition(moved, panel, workspace), { x: 846, y: 2 });
});

test('chat snaps left and right with a 2px inset and expands from the top edge', () => {
  assert.deepEqual(snapChatPosition({ x: 30, y: 55 }, panel, workspace), { x: 2, y: 2 });
  assert.deepEqual(snapChatPosition({ x: 820, y: 55 }, panel, workspace), { x: 846, y: 2 });
});

test('chat remains freely movable outside snap threshold and can move away from a dock', () => {
  const awayFromLeft = positionFromPointer({ x: 12, y: 12 }, { x: 20, y: 100 }, { x: 110, y: 120 });
  assert.deepEqual(snapChatPosition(awayFromLeft, panel, workspace), { x: 102, y: 32 });
  const center = { x: 430, y: 120 };
  assert.deepEqual(snapChatPosition(center, panel, workspace), center);
});

test('chat clamps inside workspace when resized or dragged beyond bounds', () => {
  assert.deepEqual(clampWorkspacePosition({ x: -50, y: -80 }, panel, workspace), { x: 0, y: 0 });
  assert.deepEqual(clampWorkspacePosition({ x: 2000, y: 900 }, panel, workspace), { x: 848, y: 120 });
});

test('top and bottom edges show landscape dock candidates, with vertical docks winning corners', () => {
  const size = getChatPanelSize(workspace, null);
  assert.equal(chatDockAt({ x: 20, y: 30 }, size, workspace), 'top');
  assert.equal(chatDockAt({ x: 20, y: 100 }, size, workspace), 'bottom');
  assert.equal(chatDockAt({ x: 20, y: 60 }, size, workspace), 'left');
  assert.equal(chatDockAt({ x: 72, y: 60 }, size, workspace), 'left');
  assert.equal(chatDockAt({ x: 73, y: 60 }, size, workspace), null);
});

test('side docks nearly fill workspace height; top/bottom keep their landscape layout', () => {
  assert.deepEqual(getChatDockLayout('left', workspace), { position: { x: 2, y: 2 }, size: { width: 352, height: 796 } });
  assert.deepEqual(getChatDockLayout('right', workspace), { position: { x: 846, y: 2 }, size: { width: 352, height: 796 } });
  const top = getChatDockLayout('top', workspace);
  assert.deepEqual(top, { position: { x: 240, y: 12 }, size: { width: 720, height: 100 } });
  const bottom = getChatDockLayout('bottom', workspace);
  assert.deepEqual(bottom, { position: { x: 240, y: 688 }, size: { width: 720, height: 100 } });
  assert.deepEqual(getChatPanelSize({ width: 600, height: 500 }, 'top'), { width: 360, height: 100 });
});
