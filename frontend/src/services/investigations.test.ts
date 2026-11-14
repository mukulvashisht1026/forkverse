import test from 'node:test';
import assert from 'node:assert/strict';
import { mapInvestigationGraphDto, investigationRepository } from './investigations';
import type { SpineNode } from '../types/tree';

const sampleNode = (id: string, name: string): SpineNode => ({
  id, name, declaration: name, info: 'Summary', platform: 'X',
  stockImpact: { summary: '', tickers: [] },
  publicAppeal: { sentimentLabel: '', positivePct: 0, neutralPct: 0, negativePct: 0, narrative: '' },
  scrapeEngine: 'manual', branches: [],
});

test('investigation graph adapter preserves event and evidence for canvas', () => {
  const graph = mapInvestigationGraphDto({
    investigationId: 'inv-1', revision: 2, updatedAt: '2026-01-01T00:00:00Z',
    events: [{ id: 'event-1', title: 'Policy announced', summary: 'Summary', evidence: [{ id: 'source-1', title: 'Source headline', sourceUrl: 'https://example.com', excerpt: 'Evidence excerpt' }] }],
  });
  assert.equal(graph.investigationId, 'inv-1');
  assert.equal(graph.nodes[0].name, 'Policy announced');
  assert.equal(graph.nodes[0].branches[0].name, 'Source headline');
  assert.equal(graph.nodes[0].branches[0].sourceUrl, 'https://example.com');
});

test('timeline-backed repository requests /api/timeline and reports missing investigation', async (t) => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    requests.push(String(input));
    return new Response(JSON.stringify({ nodes: [sampleNode('present', 'Found')] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  assert.deepEqual(await investigationRepository.listPublicInvestigations(), [
    { id: 'present', title: 'Found', description: 'Summary', createdAt: undefined },
  ]);
  await assert.rejects(investigationRepository.getInvestigation('missing'), /Investigation not found\./);
  await assert.rejects(investigationRepository.getInvestigationGraph('missing'), /Investigation not found\./);
  assert.deepEqual(requests, ['/api/timeline', '/api/timeline', '/api/timeline']);
});

test('timeline-backed repository propagates HTTP error bodies', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'Timeline unavailable' }), {
    status: 503, headers: { 'Content-Type': 'application/json' },
  })) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  await assert.rejects(investigationRepository.listPublicInvestigations(), /Timeline unavailable/);
});
