/**
 * Turn raw search-tool output into article branches.
 *
 * Articles are read straight from tool results (Context.dev news/web search JSON), never from
 * LLM text, so every URL and title shown on the graph came from a real search result.
 *
 * Known shapes (both handled by the generic walk below):
 *   context_get-news-search -> { data:    [{ url, title, description, published_at, source: { name, domain } }] }
 *   context_web-search      -> { results: [{ url, title, description, relevance }] }
 */
import { hashSeed } from '../timeline/model.js';
import type { BranchSourceType, CreateBranchPayload } from '../timeline/types.js';

export interface Article {
  url: string;
  title: string;
  description: string | null;
  domain: string;
  sourceName: string | null;
  publishedAt: string | null;
  tool: string;
}

const MAX_DEPTH = 6;

/** Find every { url, title } object in a tool result. Non-JSON output yields []. */
export function extractArticles(raw: unknown, tool = 'unknown'): Article[] {
  let data: unknown = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  const out: Article[] = [];
  const seen = new Set<string>();

  const walk = (v: unknown, depth: number) => {
    if (depth > MAX_DEPTH || v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      for (const item of v) walk(item, depth + 1);
      return;
    }
    const o = v as Record<string, unknown>;
    const url = typeof o.url === 'string' ? o.url.trim() : '';
    const title = typeof o.title === 'string' ? o.title.trim() : '';
    if (/^https?:\/\//i.test(url) && title) {
      const key = normalizeUrl(url);
      if (!seen.has(key)) {
        seen.add(key);
        const source = (o.source && typeof o.source === 'object' ? o.source : {}) as Record<string, unknown>;
        out.push({
          url,
          title,
          description: str(o.description) ?? str(o.snippet) ?? str(o.summary),
          domain: str(source.domain) ?? hostOf(url),
          sourceName: str(source.name),
          publishedAt: str(o.published_at) ?? str(o.publishedAt) ?? str(o.publishedTime),
          tool,
        });
      }
      return; // don't descend into an article
    }
    for (const child of Object.values(o)) walk(child, depth + 1);
  };

  walk(data, 0);
  return out;
}

const SOCIAL = ['x.com', 'twitter.com', 'reddit.com', 'facebook.com', 'instagram.com', 'tiktok.com', 'youtube.com', 'truthsocial.com', 'threads.net'];
const MARKET = ['bloomberg.com', 'cnbc.com', 'marketwatch.com', 'ft.com', 'finance.yahoo.com', 'barrons.com', 'investopedia.com', 'seekingalpha.com'];

export function classifySource(domain: string): BranchSourceType {
  const d = domain.toLowerCase().replace(/^www\./, '');
  const is = (list: string[]) => list.some((x) => d === x || d.endsWith(`.${x}`));
  if (is(SOCIAL)) return 'social';
  if (is(MARKET)) return 'market';
  if (d.endsWith('.gov') || d.includes('.gov.') || d.endsWith('.mil')) return 'policy';
  return 'news';
}

/** Stable id per URL, so re-running a query updates branches instead of duplicating them. */
export function articleBranchId(url: string): string {
  return `art-${hashSeed(normalizeUrl(url))}`;
}

export function articleToBranch(a: Article): CreateBranchPayload {
  const source = a.sourceName ?? a.domain;
  return {
    id: articleBranchId(a.url),
    name: a.title, // trimmed to 48 chars by buildBranch
    info: a.description ? `${a.title}: ${a.description}` : a.title,
    sourceType: classifySource(a.domain),
    sourceDomain: a.domain,
    sourceUrl: a.url,
    ...(a.publishedAt && { publishedAt: a.publishedAt }),
    impactAngle: a.tool.includes('news') ? `News · ${source}` : `Web · ${source}`,
  };
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'about', 'from', 'into', 'over', 'what', 'when', 'where', 'which', 'who', 'why', 'how',
  'latest', 'news', 'article', 'articles', 'find', 'show', 'all', 'related', 'his', 'her', 'their', 'its', 'are', 'was', 'were',
]);

/** Significant lower-case words of a query (3+ letters, no stopwords). */
export function queryTerms(query: string): string[] {
  return [...new Set(query.toLowerCase().normalize('NFKD').split(/[^\p{L}\p{N}]+/u))].filter(
    (w) => w.length >= 3 && !STOPWORDS.has(w),
  );
}

/** Keep an article only if its title + description mention every significant query term. */
export function isRelevant(a: Article, terms: string[]): boolean {
  if (!terms.length) return true;
  const text = `${a.title} ${a.description ?? ''}`.toLowerCase().normalize('NFKD');
  return terms.every((t) => text.includes(t));
}

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    return `${u.host.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}${u.search}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}
