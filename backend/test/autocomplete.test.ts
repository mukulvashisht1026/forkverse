import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import { autocompleteCacheForTests, autocompleteRouter } from '../src/routes/autocomplete.js';

const mockSearch = async () => [
  { title: 'Example climate report', url: 'https://news.example.org/climate', snippet: 'A report about climate policy.', publishedAt: null, domain: 'news.example.org' },
  { title: 'Unsafe URL', url: 'javascript:alert(1)', snippet: null, publishedAt: null, domain: null },
];
async function request(path: string) {
  const app = express().use(autocompleteRouter(mockSearch));
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test server address');
  try { return await fetch(`http://127.0.0.1:${address.port}${path}`); }
  finally { server.close(); }
}
afterEach(() => autocompleteCacheForTests.clear());

describe('research autocomplete routes', () => {
  it('rejects short queries', async () => {
    const response = await request('/research/suggestions?q=x');
    expect(response.status).toBe(400);
  });
  it('caches provider response shared by both endpoints', async () => {
    let calls = 0;
    const app = express().use(autocompleteRouter(async () => { calls += 1; return mockSearch(); }));
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No test server address');
    try {
      await fetch(`http://127.0.0.1:${address.port}/research/suggestions?q=cacheme`);
      await fetch(`http://127.0.0.1:${address.port}/research/source-previews?q=cacheme`);
      expect(calls).toBe(1);
    } finally { server.close(); }
  });
  it('returns topic suggestions from provider results', async () => {
    const response = await request('/research/suggestions?q=climate');
    expect(await response.json()).toMatchObject({ suggestions: [{ text: 'Example climate report', url: 'https://news.example.org/climate' }] });
  });
  it('returns safe source candidates and skips unsafe URLs', async () => {
    const response = await request('/research/source-previews?q=climate');
    expect(await response.json()).toMatchObject({ sources: [{ domain: 'news.example.org', candidate: true, verified: false }] });
  });
});
