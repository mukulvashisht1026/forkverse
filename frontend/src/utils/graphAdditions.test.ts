import test from 'node:test';
import assert from 'node:assert/strict';
import type { SpineNode } from '../types/tree';
import { findGraphAdditions, isNewerGraphRevision } from './graphAdditions';

test('only a strictly newer backend revision is eligible for What changed', () => {
  assert.equal(isNewerGraphRevision(4, 4), false);
  assert.equal(isNewerGraphRevision(4, 3), false);
  assert.equal(isNewerGraphRevision(4, 5), true);
});

const event = (id: string, name = id, branches: { id: string; name: string }[] = []): SpineNode => ({
  id, name, declaration: name, info: '', platform: '', stockImpact: { summary: '', tickers: [] },
  publicAppeal: { sentimentLabel: '', positivePct: 0, neutralPct: 0, negativePct: 0, narrative: '' },
  scrapeEngine: 'manual', branches: branches.map((branch, index) => ({ ...branch, info: '', sourceType: 'news', seed: index + 1 })),
});

test('graph additions ignore rerenders and edits to already known stable IDs', () => {
  const before = [event('event-a', 'Old title', [{ id: 'evidence-a', name: 'Old source' }])];
  const renderedAgain = [event('event-a', 'Updated title', [{ id: 'evidence-a', name: 'Updated source' }])];
  assert.deepEqual(findGraphAdditions(before, renderedAgain), { events: [], evidence: [] });
});

test('graph additions list only new event and evidence IDs and associate evidence to its event', () => {
  const before = [event('event-a', 'Existing', [{ id: 'evidence-a', name: 'Known source' }])];
  const after = [
    event('event-a', 'Existing', [{ id: 'evidence-a', name: 'Known source' }, { id: 'evidence-b', name: 'New source' }]),
    event('event-b', 'New event', [{ id: 'evidence-c', name: 'Source in new event' }]),
  ];
  assert.deepEqual(findGraphAdditions(before, after), {
    events: [{ id: 'event-b', title: 'New event' }],
    evidence: [
      { id: 'evidence-b', title: 'New source', eventId: 'event-a' },
      { id: 'evidence-c', title: 'Source in new event', eventId: 'event-b' },
    ],
  });
});
