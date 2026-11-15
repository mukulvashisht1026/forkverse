/**
 * Shared page cache: source screening and claim building read the same articles back to back,
 * so each page is fetched once (Context.dev credits + latency). Failures are not cached.
 */
import type { Scraper } from '../proof/articles.js';

export function cachedScraper(scrape: Scraper, opts: { ttlMs?: number; max?: number; now?: () => number } = {}): Scraper {
  const ttl = opts.ttlMs ?? 20 * 60_000;
  const max = opts.max ?? 300;
  const now = opts.now ?? Date.now;
  const cache = new Map<string, { at: number; value: Promise<Awaited<ReturnType<Scraper>>> }>();
  return (url) => {
    const hit = cache.get(url);
    if (hit && now() - hit.at < ttl) return hit.value;
    const value = scrape(url).then((r) => {
      if (!r.ok) cache.delete(url); // retry failures next time
      return r;
    });
    cache.set(url, { at: now(), value });
    // Map keeps insertion order: drop the oldest entries beyond the cap.
    while (cache.size > max) cache.delete(cache.keys().next().value!);
    return value;
  };
}
