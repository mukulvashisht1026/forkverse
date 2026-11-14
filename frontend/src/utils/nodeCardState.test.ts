import test from 'node:test';
import assert from 'node:assert/strict';
import { closeNodeCard, keepExistingNodeCard, nodeCardId, openNodeCard, shouldDismissNodeCardPointer } from './nodeCardState';

test('opening an already open event/evidence card is idempotent and IDs are stable', () => {
  const first = { eventId: 'event-a', evidenceId: 'evidence-1' };
  const once = openNodeCard(null, first);
  const twice = openNodeCard(once, first);
  assert.equal(nodeCardId(first), 'evidence:evidence-1');
  assert.equal(twice, once);
});

test('opening another item replaces the active card and closing is idempotent', () => {
  const first = { eventId: 'event-a' };
  const second = { eventId: 'event-b', evidenceId: 'evidence-2' };
  const cardB = openNodeCard(openNodeCard(null, first), second);
  assert.deepEqual(cardB, second);
  assert.equal(closeNodeCard(cardB, nodeCardId(first)), cardB);
  assert.equal(closeNodeCard(cardB, nodeCardId(second)), null);
  assert.deepEqual(openNodeCard(null, second), second, 'explicit user action reopens a closed card');
});

test('graph updates keep an existing active card or close it when its stable ID disappears', () => {
  const card = openNodeCard(null, { eventId: 'event-b', evidenceId: 'evidence-b' });
  assert.equal(keepExistingNodeCard(card, new Set(['event-b']), new Set(['evidence-b'])), card);
  assert.equal(keepExistingNodeCard(card, new Set(['event-b']), new Set()), null);
});

test('outside-pointer dismissal ignores active-card and graph-item interactions', () => {
  assert.equal(shouldDismissNodeCardPointer(false, false), true);
  assert.equal(shouldDismissNodeCardPointer(true, false), false, 'card drag and source links stay open');
  assert.equal(shouldDismissNodeCardPointer(false, true), false, 'node click replaces the card after pointerdown');
});
