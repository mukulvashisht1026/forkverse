import { describe, expect, it, vi } from 'vitest';
import { cachedScraper } from '../src/vetting/scrapeCache.js';

describe('cachedScraper', () => {
  it('reads each page once within the TTL, retries failures', async () => {
    let t = 0;
    const inner = vi.fn(async (url: string) => (url.includes('bad') ? { ok: false as const, error: 'x' } : { ok: true as const, markdown: url }));
    const s = cachedScraper(inner, { ttlMs: 1000, now: () => t });
    await Promise.all([s('https://a'), s('https://a')]);
    await s('https://bad');
    await s('https://bad');
    expect(inner).toHaveBeenCalledTimes(3);
    t = 2000;
    await s('https://a');
    expect(inner).toHaveBeenCalledTimes(4);
  });
});
