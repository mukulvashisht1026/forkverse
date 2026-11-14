import test from 'node:test';
import assert from 'node:assert/strict';
import { investigationEventsToSpineNodes } from '../services/investigationGraphAdapter';
import type { BranchNode } from '../types/tree';
import { getNodeCardPresentation, hasCardSourceMetadata } from './nodeCardPresentation';

test('demo evidence preserves its authentic source type and metadata', () => {
  const demo: BranchNode = {
    id: 'evidence-demo', name: 'Reported decision', info: 'A concise source summary.', sourceType: 'policy',
    sourceDomain: 'policy.example.test', sourceUrl: 'https://policy.example.test/report', publishedAt: '2026-02-01',
    impactAngle: 'Regulatory filing', seed: 2,
  };
  assert.deepEqual(getNodeCardPresentation(demo, true), {
    sourceType: 'policy', sourceDomain: 'policy.example.test', sourceUrl: 'https://policy.example.test/report',
    publishedAt: '2026-02-01', relationship: 'Regulatory filing', description: 'A concise source summary.',
  });
});

test('API evidence keeps real publisher, hostname, date, relationship and excerpt without inventing a source type', () => {
  const [event] = investigationEventsToSpineNodes([{
    id: 'event-api', title: 'Policy adopted', summary: 'Event summary', evidence: [{
      id: 'evidence-api', title: 'Original report', sourceName: 'The Daily Ledger', sourceUrl: 'https://www.ledger.example.test/report',
      publishedAt: '2026-03-04T12:00:00Z', relationship: 'News coverage', excerpt: 'The report describes the adoption.',
    }],
  }]);
  assert.ok(event);
  assert.deepEqual(getNodeCardPresentation(event.branches[0]!, true), {
    sourceName: 'The Daily Ledger', sourceDomain: 'ledger.example.test', sourceUrl: 'https://www.ledger.example.test/report',
    publishedAt: '2026-03-04T12:00:00Z', relationship: 'News coverage', description: 'The report describes the adoption.',
  });
});

test('missing or invalid optional fields do not produce invented card metadata', () => {
  const [event] = investigationEventsToSpineNodes([{
    id: 'event-minimal', title: 'Event', evidence: [{ id: 'evidence-minimal', title: 'Evidence', sourceUrl: 'not a url' }],
  }]);
  assert.ok(event);
  assert.deepEqual(getNodeCardPresentation(event.branches[0]!, true), { sourceUrl: 'not a url' });
});

test('events with only descriptive/date fields do not render a metadata header', () => {
  assert.equal(hasCardSourceMetadata({ description: 'An event summary.', publishedAt: '2026-01-02' }), false);
  assert.equal(hasCardSourceMetadata({ sourceDomain: 'publisher.test' }), true);
});
