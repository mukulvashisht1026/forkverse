import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { RealtimeHub } from '../src/realtime/hub.js';
import { createHttpServer } from '../src/server.js';
import { MemoryTimelineStore } from '../src/timeline/store.js';

async function withServer(corsOrigins: string[], fn: (base: string) => Promise<void>) {
  const store = new MemoryTimelineStore();
  const server = createHttpServer({ store, hub: new RealtimeHub(store), corsOrigins });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

const WEB = 'https://tracewire-web.azurestaticapps.net';

describe('CORS', () => {
  it('allows configured origins, including preflight for JSON POSTs', async () => {
    await withServer([WEB], async (base) => {
      const get = await fetch(`${base}/api/timeline`, { headers: { Origin: WEB } });
      expect(get.headers.get('access-control-allow-origin')).toBe(WEB);

      const pre = await fetch(`${base}/api/prompt`, {
        method: 'OPTIONS',
        headers: { Origin: WEB, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
      });
      expect(pre.status).toBe(204);
      expect(pre.headers.get('access-control-allow-origin')).toBe(WEB);
      expect(pre.headers.get('access-control-allow-methods')).toContain('POST');
    });
  });

  it('sends no CORS headers to other origins, or when unconfigured', async () => {
    await withServer([WEB], async (base) => {
      const res = await fetch(`${base}/api/timeline`, { headers: { Origin: 'https://evil.example' } });
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });
    await withServer([], async (base) => {
      const res = await fetch(`${base}/api/timeline`, { headers: { Origin: WEB } });
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });
  });
});
