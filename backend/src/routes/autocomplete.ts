import { Router } from 'express';
import { z } from 'zod';
import { webSearch, type SearchResult } from '../clients/contextdev.js';
import { config } from '../config.js';

const querySchema = z.string().trim().min(2).max(240);
const cache = new Map<string, { at: number; value: unknown }>();
const hits = new Map<string, { at: number; count: number }>();
const CACHE_TTL_MS = 60_000;
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 30;

const inflight = new Map<string, Promise<unknown>>();
function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const entry = cache.get(key);
  if (entry && now - entry.at < CACHE_TTL_MS) return Promise.resolve(entry.value as T);
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;
  const request = load().then((value) => {
    cache.set(key, { at: Date.now(), value });
    if (cache.size > 500) {
      for (const [candidate, item] of cache) if (Date.now() - item.at >= CACHE_TTL_MS) cache.delete(candidate);
      while (cache.size > 500) cache.delete(cache.keys().next().value!);
    }
    return value;
  }).finally(() => inflight.delete(key));
  inflight.set(key, request);
  return request;
}

function limited(ip: string): boolean {
  const now = Date.now();
  const current = hits.get(ip);
  if (!current || now - current.at >= WINDOW_MS) {
    hits.set(ip, { at: now, count: 1 });
    return false;
  }
  current.count += 1;
  if (hits.size > 2000) for (const [key, value] of hits) if (now - value.at >= WINDOW_MS) hits.delete(key);
  return current.count > MAX_REQUESTS;
}

function safeResults(results: SearchResult[]) {
  return results.flatMap((item) => {
    try {
      const url = new URL(item.url);
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.')) return [];
      const domain = url.hostname.replace(/^www\./, '');
      return [{
        title: item.title ?? domain,
        url: url.toString(),
        domain,
        description: item.snippet,
        favicon: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`,
        candidate: true as const,
        verified: false as const,
      }];
    } catch { return []; }
  }).slice(0, 5);
}

export function autocompleteRouter(search: (query: string) => Promise<SearchResult[]> = webSearch) {
  const router = Router();
  router.get('/research/suggestions', async (req, res) => {
    const parsed = querySchema.safeParse(req.query.q);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_query', message: 'Query must contain 2–240 characters.' });
    if (limited(req.ip || 'unknown')) return res.status(429).json({ error: 'rate_limited' });
    const query = parsed.data;
    if (!config.CONTEXT_DEV_API_KEY && search === webSearch) return res.json({ suggestions: [], provider: 'unavailable' });
    try {
      const suggestions = await cached(`suggestions:${query.toLowerCase()}`, async () => {
        const results = await cached(`provider:${query.toLowerCase()}`, () => search(query));
        const seen = new Set<string>();
        return results.flatMap((result) => {
          const title = result.title?.trim();
          if (!title || seen.has(title.toLowerCase())) return [];
          let url: URL;
          try { url = new URL(result.url); } catch { return []; }
          if (!['http:', 'https:'].includes(url.protocol)) return [];
          seen.add(title.toLowerCase());
          return [{ text: title, description: result.snippet, url: url.toString() }];
        }).slice(0, 5);
      });
      return res.json({ suggestions });
    } catch {
      return res.json({ suggestions: [], provider: 'unavailable' });
    }
  });
  router.get('/research/source-previews', async (req, res) => {
    const parsed = querySchema.safeParse(req.query.q);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_query', message: 'Query must contain 2–240 characters.' });
    if (limited(req.ip || 'unknown')) return res.status(429).json({ error: 'rate_limited' });
    const query = parsed.data;
    if (!config.CONTEXT_DEV_API_KEY && search === webSearch) return res.json({ sources: [], provider: 'unavailable' });
    try {
      const sources = await cached(`sources:${query.toLowerCase()}`, async () => safeResults(await cached(`provider:${query.toLowerCase()}`, () => search(query))));
      return res.json({ sources });
    } catch {
      return res.json({ sources: [], provider: 'unavailable' });
    }
  });
  return router;
}

export const autocompleteCacheForTests = { clear: () => { cache.clear(); hits.clear(); inflight.clear(); } };
