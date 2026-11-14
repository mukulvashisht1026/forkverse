import test from 'node:test';
import assert from 'node:assert/strict';
import { mapInvestigationGraphDto, investigationRepository } from './investigations';
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

test('public investigations repository maps stable API records', async (t) => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    requests.push(String(input));
    return new Response(JSON.stringify({ items: [{ id: 'saved-id', title: 'Saved', topic: 'Saved', visibility: 'public', status: 'active', createdAt: '2026-01-01', updatedAt: '2026-01-01' }] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  assert.equal((await investigationRepository.listPublicInvestigations())[0]?.id, 'saved-id');
  assert.equal(requests[0], '/api/investigations?visibility=public');
});

test('investigations repository surfaces backend errors', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ code: 'unavailable', message: 'Backend unavailable' }), {
    status: 503, headers: { 'Content-Type': 'application/json' },
  })) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  await assert.rejects(investigationRepository.listPublicInvestigations(), /Backend unavailable/);
});
