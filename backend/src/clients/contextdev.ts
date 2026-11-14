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

async function request(method: 'GET' | 'POST' | 'DELETE', endpoint: string, body?: unknown): Promise<unknown> {
  return limit(() =>
    withRetry(async () => {
      const res = await fetch(`${config.CONTEXT_DEV_BASE_URL}${endpoint}`, {
        method,
        headers: {
          Authorization: `Bearer ${config.CONTEXT_DEV_API_KEY}`,
          ...(body !== undefined && { 'Content-Type': 'application/json' }),
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        if (res.status === 402) logger.error({ endpoint }, 'context.dev: payment required / out of credits');
        throw new HttpError(res.status, `context.dev ${endpoint} ${res.status}: ${text.slice(0, 300)}`, parseRetryAfter(res.headers.get('retry-after')));
      }
      if (res.status === 204) return null;
      const json = await res.json();
      await logRawSample(`${method}_${endpoint.split('?')[0]!.replace(/\/(mon|run|chg)_[\w-]+/g, '/$1')}`, json);
      return json;
    }),
  );
}

const post = (endpoint: string, body: unknown) => request('POST', endpoint, body);

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
  // Current /web/scrape shape: one object per requested format, e.g.
  // { markdown: { requested: true, success: true, data: "..." }, metadata: {...} }.
  if (isObj(raw) && isObj(raw.markdown)) {
    const md = raw.markdown;
    const meta = isObj(raw.metadata) ? raw.metadata : {};
    if (md.success !== false && typeof md.data === 'string' && md.data.trim()) {
      return {
        success: true,
        url,
        markdown: md.data,
        title: str(meta, 'title', 'ogTitle'),
        publishedAt: str(meta, 'publishedTime', 'publishedAt', 'modifiedTime', 'date'),
      };
    }
    return { success: false, url, error: str(md, 'error_code', 'message', 'error') ?? str(raw, 'error_code', 'message') ?? 'markdown output failed' };
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
  return normalizeSearchResults(await post('/news/search', { searchBy: { type: 'natural_language', query: searchBy } }));
}

export async function webSearch(query: string): Promise<SearchResult[]> {
  return normalizeSearchResults(await post('/web/search', { query }));
}

// ---------- Monitors API (https://docs.context.dev, OpenAPI "Context.dev Monitors API") ----------

export type MonitorTarget =
  | { type: 'page'; url: string; instructions?: string }
  | { type: 'sitemap'; url: string; include?: string[]; exclude?: string[]; max_urls?: number };

export interface CreateMonitorInput {
  name: string;
  target: MonitorTarget;
  changeDetection: 'exact' | 'semantic';
  intervalMinutes: number;
  /** Public HTTPS URL for `change.detected` pushes; omitted = we poll instead. */
  webhookUrl?: string;
  tags?: string[];
}

export interface CreatedMonitor {
  id: string;
  status: string;
  /** Webhook signing secret (whsec_…), present when a webhook was configured. */
  secret?: string;
}

/** Context.dev MonitorsChange (fields we use; all optional beyond id/monitor_id). */
export interface MonitorChange {
  id: string;
  monitor_id: string;
  run_id?: string;
  target_type?: string;
  change_detection_type?: string;
  title?: string;
  summary?: string;
  detected_at?: string;
  url?: string;
  importance?: 'low' | 'medium' | 'high';
  confidence?: number;
  diff?: string;
  before_text_excerpt?: string;
  after_text_excerpt?: string;
  added_urls?: string[];
  removed_urls?: string[];
  evidence?: { url?: string; before: string; after: string }[];
}

export interface MonitorRun {
  id: string;
  status: string; // queued | running | completed | failed | skipped
  /** Why a skipped run never executed (insufficient credits, paused, superseded). */
  skip_reason?: string | null;
  change_detected?: boolean;
  change_id?: string | null;
  error?: { code?: string; message?: string } | null;
}

/** Monitors API surface used by the monitor service (injectable for tests). */
export interface MonitorsClient {
  create(input: CreateMonitorInput): Promise<CreatedMonitor>;
  remove(monitorId: string): Promise<void>;
  runNow(monitorId: string): Promise<{ runId: string }>;
  getRun(monitorId: string, runId: string): Promise<MonitorRun>;
  getChange(changeId: string): Promise<MonitorChange>;
  listChanges(monitorId: string, since?: string): Promise<MonitorChange[]>;
}

/** Unwrap `{data: …}` if present (list endpoints wrap, single-object endpoints do not). */
const unwrap = (raw: unknown): unknown => (isObj(raw) && isObj(raw.data) ? raw.data : raw);

export function parseChange(raw: unknown): MonitorChange | null {
  const o = unwrap(raw);
  if (!isObj(o)) return null;
  const id = str(o, 'id');
  const monitorId = str(o, 'monitor_id');
  if (!id || !monitorId) return null;
  return o as unknown as MonitorChange;
}

export const contextDevMonitors: MonitorsClient = {
  async create({ name, target, changeDetection, intervalMinutes, webhookUrl, tags }) {
    const raw = await post('/monitors', {
      name: name.slice(0, 200),
      target,
      change_detection: { type: changeDetection },
      schedule: { type: 'interval', frequency: intervalMinutes, unit: 'minutes' },
      ...(webhookUrl && { webhook: { url: webhookUrl, events: ['change.detected'] } }),
      ...(tags?.length && { tags }),
    });
    const o = unwrap(raw);
    const id = isObj(o) ? str(o, 'id') : null;
    if (!id || !isObj(o)) throw new Error('context.dev: create monitor returned no id');
    const webhook = isObj(o.webhook) ? o.webhook : {};
    return { id, status: str(o, 'status') ?? 'active', ...(str(webhook, 'secret') && { secret: str(webhook, 'secret')! }) };
  },
  async remove(monitorId) {
    try {
      await request('DELETE', `/monitors/${encodeURIComponent(monitorId)}`);
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) return; // already gone
      throw err;
    }
  },
  async runNow(monitorId) {
    const raw = await post(`/monitors/${encodeURIComponent(monitorId)}/run`, {});
    const runId = isObj(raw) ? str(raw, 'run_id') : null;
    if (!runId) throw new Error('context.dev: run monitor returned no run_id');
    return { runId };
  },
  async getRun(monitorId, runId) {
    const o = unwrap(await request('GET', `/monitors/${encodeURIComponent(monitorId)}/runs/${encodeURIComponent(runId)}`));
    if (!isObj(o)) throw new Error('context.dev: unexpected run response');
    return o as unknown as MonitorRun;
  },
  async getChange(changeId) {
    const change = parseChange(await request('GET', `/monitors/changes/${encodeURIComponent(changeId)}`));
    if (!change) throw new Error('context.dev: unexpected change response');
    return change;
  },
  async listChanges(monitorId, since) {
    const q = new URLSearchParams({ limit: '20', ...(since && { since }) });
    const raw = await request('GET', `/monitors/${encodeURIComponent(monitorId)}/changes?${q}`);
    const items = isObj(raw) && Array.isArray(raw.data) ? raw.data : [];
    return items.map(parseChange).filter((c): c is MonitorChange => c !== null);
  },
};

export async function brand(domain: string): Promise<unknown> {
  return post('/brand/retrieve', { type: 'by_domain', domain });
}
