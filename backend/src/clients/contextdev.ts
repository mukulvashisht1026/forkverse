import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { HttpError, createLimiter, parseRetryAfter, withRetry } from '../utils/retry.js';

export interface SearchResult {
  url: string;
  title: string | null;
  snippet: string | null;
  publishedAt: string | null;
  domain: string | null;
}

export type ScrapeResult =
  | { success: true; url: string; markdown: string; title: string | null; publishedAt: string | null }
  | { success: false; url: string; error: string };

const limit = createLimiter(config.CONTEXT_DEV_CONCURRENCY);
const loggedSamples = new Set<string>();

/** Persist the first raw response per endpoint so undocumented shapes can be inspected. */
async function logRawSample(endpoint: string, body: unknown): Promise<void> {
  if (loggedSamples.has(endpoint)) return;
  loggedSamples.add(endpoint);
  try {
    await mkdir(config.DEBUG_RAW_DIR, { recursive: true });
    const file = path.join(config.DEBUG_RAW_DIR, `contextdev_${endpoint.replace(/\W+/g, '_')}.json`);
    await writeFile(file, JSON.stringify(body, null, 2));
  } catch (err) {
    logger.warn({ err }, 'failed to write raw sample');
  }
}

async function post(endpoint: string, body: unknown): Promise<unknown> {
  return limit(() =>
    withRetry(async () => {
      const res = await fetch(`${config.CONTEXT_DEV_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.CONTEXT_DEV_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        if (res.status === 402) logger.error({ endpoint }, 'context.dev: payment required / out of credits');
        throw new HttpError(res.status, `context.dev ${endpoint} ${res.status}: ${text.slice(0, 300)}`, parseRetryAfter(res.headers.get('retry-after')));
      }
      const json = await res.json();
      await logRawSample(endpoint, json);
      return json;
    }),
  );
}

// ---------- defensive normalization ----------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function str(o: Obj, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

/** Find the first array of objects at common container keys, searching one level of nesting. */
function findItems(raw: unknown): Obj[] {
  if (Array.isArray(raw)) return raw.filter(isObj);
  if (!isObj(raw)) return [];
  const keys = ['results', 'articles', 'items', 'data', 'news', 'hits', 'documents', 'outputs'];
  for (const k of keys) {
    const v = raw[k];
    if (Array.isArray(v)) return v.filter(isObj);
    if (isObj(v)) {
      const nested = findItems(v);
      if (nested.length) return nested;
    }
  }
  return [];
}

export function normalizeSearchResults(raw: unknown): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const item of findItems(raw)) {
    const url = str(item, 'url', 'link', 'href', 'sourceUrl');
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const sourceObj = isObj(item.source) ? item.source : {};
    let domain = str(item, 'domain') ?? str(sourceObj, 'domain', 'name');
    if (!domain) {
      try {
        domain = new URL(url).hostname.replace(/^www\./, '');
      } catch {
        continue;
      }
    }
    out.push({
      url,
      title: str(item, 'title', 'headline', 'name'),
      snippet: str(item, 'snippet', 'description', 'summary', 'excerpt', 'content'),
      publishedAt: str(item, 'publishedAt', 'published_at', 'date', 'publishedDate', 'pubDate'),
      domain,
    });
  }
  return out;
}

export function normalizeScrape(url: string, raw: unknown): ScrapeResult {
  const candidates: Obj[] = [];
  if (isObj(raw)) {
    candidates.push(raw);
    for (const k of ['data', 'result', 'output']) if (isObj(raw[k])) candidates.push(raw[k] as Obj);
    for (const k of ['outputs', 'results', 'data']) {
      const v = raw[k];
      if (Array.isArray(v)) candidates.push(...v.filter(isObj));
    }
  }
  // A 200 can still contain failed outputs: honour explicit success flags.
  for (const c of candidates) {
    if (c.success === false) continue;
    const markdown = str(c, 'markdown', 'content', 'text');
    if (markdown) {
      const meta = isObj(c.metadata) ? c.metadata : {};
      return {
        success: true,
        url,
        markdown,
        title: str(c, 'title') ?? str(meta, 'title', 'ogTitle'),
        publishedAt: str(c, 'publishedAt', 'published_at') ?? str(meta, 'publishedAt', 'publishedTime', 'articlePublishedTime', 'date'),
      };
    }
  }
  const failed = candidates.find((c) => c.success === false);
  const error = (failed && str(failed, 'error', 'message', 'reason')) ?? 'no readable content in response';
  return { success: false, url, error };
}

// ---------- API ----------

export async function scrape(url: string): Promise<ScrapeResult> {
  try {
    const raw = await post('/web/scrape', {
      url,
      formats: { markdown: true },
      sharedParams: { mainContentOnly: true },
      maxAgeMs: 0,
    });
    return normalizeScrape(url, raw);
  } catch (err) {
    return { success: false, url, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function newsSearch(searchBy: string): Promise<SearchResult[]> {
  return normalizeSearchResults(await post('/news/search', { searchBy }));
}

export async function webSearch(query: string): Promise<SearchResult[]> {
  return normalizeSearchResults(await post('/web/search', { query }));
}

export async function createMonitor(name: string, target: string): Promise<{ id: string | null; raw: unknown }> {
  const raw = await post('/monitors', {
    name,
    target,
    webhookUrl: `${config.PUBLIC_BASE_URL}/webhook/monitor`,
  });
  const id = isObj(raw) ? (str(raw, 'id', 'monitorId') ?? (isObj(raw.data) ? str(raw.data, 'id') : null)) : null;
  return { id, raw };
}

export async function brand(domain: string): Promise<unknown> {
  return post('/brand/retrieve', { type: 'by_domain', domain });
}
