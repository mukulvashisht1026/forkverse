import test from 'node:test';
import assert from 'node:assert/strict';
import { closeNodeCard, keepExistingNodeCards, nodeCardId, openNodeCard } from './nodeCardState';

test('opening an already open event/evidence card is idempotent and IDs are stable', () => {
  const first = { eventId: 'event-a', evidenceId: 'evidence-1' };
  const once = openNodeCard(new Map(), first);
  const twice = openNodeCard(once, first);
  assert.equal(nodeCardId(first), 'evidence:evidence-1');
  assert.equal(twice, once);
  assert.equal(twice.size, 1);
});

test('opening another item preserves existing cards; closing removes only the requested card', () => {
  const first = { eventId: 'event-a' };
  const second = { eventId: 'event-b', evidenceId: 'evidence-2' };
  const cards = openNodeCard(openNodeCard(new Map(), first), second);
  const remaining = closeNodeCard(cards, nodeCardId(first));
  assert.equal(remaining.size, 1);
  assert.equal(remaining.has(nodeCardId(second)), true);
  assert.equal(closeNodeCard(remaining, nodeCardId(first)), remaining);
  const afterGraphUpdate = keepExistingNodeCards(remaining, new Set(['event-a', 'event-b']), new Set(['evidence-2']));
  assert.equal(afterGraphUpdate.has(nodeCardId(first)), false, 'graph updates do not reopen explicitly closed cards');
  assert.equal(openNodeCard(remaining, first).size, 2, 'explicit user action reopens the card');
});

test('graph updates remove only cards whose stable item IDs no longer exist', () => {
  const cards = openNodeCard(openNodeCard(new Map(), { eventId: 'event-a' }), { eventId: 'event-b', evidenceId: 'evidence-b' });
  const retained = keepExistingNodeCards(cards, new Set(['event-a', 'event-b']), new Set(['evidence-b']));
  assert.equal(retained, cards, 'same graph identity does not churn open-card state');
  const cleaned = keepExistingNodeCards(cards, new Set(['event-a']), new Set());
  assert.deepEqual([...cleaned.keys()], ['event:event-a']);
});
