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

test('repository lists public investigations and reports a missing investigation', async (t) => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    requests.push(url);
    if (url.startsWith('/api/investigations?')) {
      return new Response(JSON.stringify({ items: [{ id: 'present', title: 'Found', topic: 'Found', description: 'Summary', visibility: 'public', status: 'active', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' }] }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ code: 'investigation_not_found', message: 'Investigation "missing" was not found.' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  assert.deepEqual(await investigationRepository.listPublicInvestigations(), [
    { id: 'present', title: 'Found', description: 'Summary', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' },
  ]);
  await assert.rejects(investigationRepository.getInvestigation('missing'), /was not found/);
  await assert.rejects(investigationRepository.getInvestigationGraph('missing'), /was not found/);
  assert.deepEqual(requests, ['/api/investigations?visibility=public', '/api/investigations/missing', '/api/investigations/missing/graph']);
});

test('repository propagates ApiErrorDto messages', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ code: 'unavailable', message: 'Investigations unavailable' }), {
    status: 503, headers: { 'Content-Type': 'application/json' },
  })) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  await assert.rejects(investigationRepository.listPublicInvestigations(), /Investigations unavailable/);
});
