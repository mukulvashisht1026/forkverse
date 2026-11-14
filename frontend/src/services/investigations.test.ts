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

test('investigation repository persists an edited title', async (t) => {
  const originalFetch = globalThis.fetch;
  let request: { url: string; init?: RequestInit } | undefined;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    request = { url: String(input), init };
    return new Response(JSON.stringify({ id: 'graph-1', title: 'Renamed', topic: 'Original prompt', visibility: 'public', status: 'active', createdAt: '2026-01-01', updatedAt: '2026-01-02' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const renamed = await investigationRepository.renameInvestigation('graph-1', 'Renamed');
  assert.equal(renamed.title, 'Renamed');
  assert.equal(request?.url, '/api/investigations/graph-1');
  assert.equal(request?.init?.method, 'PATCH');
  assert.equal(request?.init?.body, JSON.stringify({ title: 'Renamed' }));
});

test('investigations repository reports request timeout rather than leaving request hanging', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new DOMException('timed out', 'TimeoutError'); }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  await assert.rejects(investigationRepository.listPublicInvestigations(), /request timed out/i);
});

test('investigations repository surfaces backend errors', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ code: 'unavailable', message: 'Backend unavailable' }), {
    status: 503, headers: { 'Content-Type': 'application/json' },
  })) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  await assert.rejects(investigationRepository.listPublicInvestigations(), /Backend unavailable/);
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
