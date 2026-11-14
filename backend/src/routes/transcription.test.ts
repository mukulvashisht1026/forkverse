import express from 'express';
import { createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { transcriptionRouter } from './transcription.js';

const servers: ReturnType<typeof createServer>[] = [];
async function requestWith(router: express.Router, body: Uint8Array, type = 'audio/webm') {
  const app = express().use(router);
  const server = createServer(app); servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
  return fetch(`http://127.0.0.1:${address.port}/transcriptions`, { method: 'POST', headers: { 'content-type': type }, body: Buffer.from(body) });
}
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())))); });

describe('Gemini transcription route', () => {
  it('submits audio to Gemini server-side and returns transcript text', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('x-goog-api-key')).toBe('private-test-key');
      const body = JSON.parse(String(init?.body));
      expect(body.contents[0].parts[1].inlineData).toEqual({ mimeType: 'audio/webm', data: Buffer.from('spoken audio').toString('base64') });
      return Response.json({ candidates: [{ content: { parts: [{ text: 'A useful transcript.' }] } }] });
    });
    const response = await requestWith(transcriptionRouter({ apiKey: 'private-test-key', fetcher }), Buffer.from('spoken audio'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ transcript: 'A useful transcript.' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects unsupported and empty recordings without calling Gemini', async () => {
    const fetcher = vi.fn();
    const router = transcriptionRouter({ apiKey: 'private-test-key', fetcher: fetcher as typeof fetch });
    expect((await requestWith(router, Buffer.from('x'), 'text/plain')).status).toBe(415);
    expect((await requestWith(router, new Uint8Array())).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reports unavailable when no Gemini secret is configured', async () => {
    const response = await requestWith(transcriptionRouter({ apiKey: '' }), Buffer.from('spoken audio'));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: 'transcription_unavailable' });
  });
});
