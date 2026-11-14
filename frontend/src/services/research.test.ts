import test from 'node:test';
import assert from 'node:assert/strict';
import { getConversation, renderSafeMarkdown, runResearchAction, safeSourceUrl } from './research';

const sseResponse = (body: ReadableStream<Uint8Array>, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/event-stream' } });
const streamFrom = (chunks: string[]) => new ReadableStream<Uint8Array>({ start(controller) { for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk)); controller.close(); } });
const complete = 'data: {"type":"message_complete","message":{"id":"m1","role":"assistant","content":"done","createdAt":"2026-01-01T00:00:00Z"}}\n\n';

test('SSE parser handles chunk splits inside frame boundaries and JSON payload', async () => {
  const payload = JSON.stringify({ type: 'token', text: 'hello' });
  const chunks = [`data: ${payload.slice(0, 12)}`, `${payload.slice(12)}\r`, `\ndata: {"type":"token","text":" world"}\r\n\r\n${complete}`];
  const original = globalThis.fetch; globalThis.fetch = async () => sseResponse(streamFrom(chunks));
  const events: unknown[] = [];
  try { await runResearchAction({ investigationId: 'inv/1', action: 'answer_question', message: 'q' }, new AbortController().signal, (event) => events.push(event)); }
  finally { globalThis.fetch = original; }
  assert.deepEqual(events, [{ type: 'token', text: 'hello' }, { type: 'token', text: ' world' }, { type: 'message_complete', message: { id: 'm1', role: 'assistant', content: 'done', createdAt: '2026-01-01T00:00:00Z' } }]);
});

test('SSE stream without message_complete rejects as truncated', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => sseResponse(streamFrom(['data: {"type":"token","text":"partial"}\n\n']));
  try { await assert.rejects(runResearchAction({ investigationId: 'i', action: 'answer_question', message: 'q' }, new AbortController().signal, () => undefined), /ended before completion/); }
  finally { globalThis.fetch = original; }
});

test('non-JSON HTML API response becomes concise service error', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('<!doctype html><html>fallback</html>', { status: 404, headers: { 'content-type': 'text/html' } });
  try { await assert.rejects(getConversation('inv-1'), /Research service is temporarily unavailable/); }
  finally { globalThis.fetch = original; }
});

test('SSE server error surfaces failure without fake completion', async () => {
  const original = globalThis.fetch; globalThis.fetch = async () => sseResponse(streamFrom(['data: {"type":"error","error":{"code":"unsupported","message":"Not available"}}\n\n']));
  const events: string[] = [];
  try { await assert.rejects(runResearchAction({ investigationId: 'i', action: 'extend_graph', message: 'x' }, new AbortController().signal, (event) => events.push(event.type)), /Not available/); }
  finally { globalThis.fetch = original; }
  assert.deepEqual(events, ['error']);
});

test('history request scopes encoded ID and pagination cursor; preserves HTTP errors', async () => {
  const original = globalThis.fetch; let requested = '';
  globalThis.fetch = async (input) => { requested = String(input); return new Response(JSON.stringify({ investigationId: 'a/b', items: [], nextCursor: 'next' }), { status: 200 }); };
  try { assert.equal((await getConversation('a/b', 'c d')).investigationId, 'a/b'); }
  finally { globalThis.fetch = original; }
  assert.match(requested, /a%2Fb\/messages\?cursor=c%20d$/);
  globalThis.fetch = async () => new Response(JSON.stringify({ code: 'missing', message: 'not found' }), { status: 404, headers: { 'content-type': 'application/json' } });
  try { await assert.rejects(getConversation('missing'), /not found/); } finally { globalThis.fetch = original; }
});

test('aborting active stream cancels reader and rejects', async () => {
  const controller = new AbortController(); let canceled = false; const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(new ReadableStream<Uint8Array>({ start() {}, cancel() { canceled = true; } }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  const pending = runResearchAction({ investigationId: 'i', action: 'answer_question', message: 'q' }, controller.signal, () => undefined);
  await new Promise((resolve) => setTimeout(resolve, 0)); controller.abort();
  try { await assert.rejects(pending); } finally { globalThis.fetch = original; }
  assert.equal(canceled, true);
});

test('safe markdown supports headings, emphasis, links, lists, quotes, fenced code, and inert HTML', () => {
  const blocks = renderSafeMarkdown('# Title\n\nA **bold** and *italic* [link](https://example.com) [[source:s1]].\n\n- item\n> quote\n\n```js\nalert(1)\n```\n\n<img src=x onerror=alert(1)>');
  assert.equal(blocks[0].type, 'heading');
  assert.equal(blocks[1].type, 'paragraph');
  if (blocks[1].type !== 'paragraph') throw Error('expected paragraph');
  assert.deepEqual(blocks[1].inline.map((token) => token.type), ['text', 'strong', 'text', 'emphasis', 'text', 'link', 'text', 'citation', 'text']);
  assert.equal(blocks[2].type, 'list-item'); assert.equal(blocks[3].type, 'quote'); assert.equal(blocks[4].type, 'code');
  assert.equal(blocks[5].type, 'paragraph');
  assert.equal(safeSourceUrl('javascript:alert(1)'), undefined);
  assert.equal(safeSourceUrl('https://safe.example'), 'https://safe.example/');
});
