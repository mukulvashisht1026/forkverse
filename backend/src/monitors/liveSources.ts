/**
 * Live source finder: which web pages are updating RIGHT NOW about a topic (live blogs,
 * "live updates" pages, rolling coverage), ranked by how fresh and how frequently updated
 * they are, so the best one can be monitored.
 *
 * 1. Candidates: Context.dev news search for "<topic> live updates" / "<topic> live" /
 *    "<topic> latest" (URL, title, outlet, date come from the raw tool output).
 * 2. Pre-score: live signal in URL/title (+3), recency of the last publication (+0..3).
 * 3. Verify the top few: scrape fresh (maxAgeMs 0) and count update entries on the page
 *    (clock times like "14:32 GMT", "5 min ago"), the strongest sign of a frequently updated
 *    page. Unreadable pages are kept but ranked down, with their error (fail visibly).
 */
import type { Article } from '../research/articles.js';
import { normalizeUrl } from '../research/articles.js';
import type { LiveSourceDto } from '../investigations/types.js';

export type LiveSearch = (query: string) => Promise<Article[]>;
export type FreshScrape = (url: string) => Promise<{ ok: true; markdown: string; updatedAt?: string | null } | { ok: false; error: string }>;

const MAX_VERIFY = 3;
const MAX_RESULTS = 5;

const LIVE_URL = /\/live(?:[/-]|blog|$)|liveblog|live-updates|live-news|as-it-happen|\/live\?|minute-by-minute/i;
const LIVE_TITLE = /\blive\b|live updates|latest updates|as it happen|minute[- ]by[- ]minute|rolling coverage|breaking/i;
// "14:32", "2:05 pm", "10.45 GMT", "5 min ago", "2 hours ago", "Updated 3 minutes ago"
const CLOCK = /\b(?:[01]?\d|2[0-3])[:.][0-5]\d\s?(?:am|pm|a\.m\.|p\.m\.|gmt|bst|utc|et|est|edt|cet|cest|ist|jst|aest)?\b/gi;
const AGO = /\b\d{1,3}\s?(?:s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?)\s+ago\b/gi;

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

export function minutesSince(iso: string | null | undefined, now: Date): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? undefined : Math.max(0, Math.round((now.getTime() - t) / 60_000));
}

function recencyScore(mins: number | undefined): number {
  if (mins === undefined) return 0;
  if (mins <= 60) return 3;
  if (mins <= 6 * 60) return 2;
  if (mins <= 24 * 60) return 1;
  return 0;
}

/** Update entries visible on a page: distinct clock times + "x min ago" stamps. */
export function countUpdateStamps(markdown: string): number {
  const text = markdown.slice(0, 40_000);
  const clocks = new Set((text.match(CLOCK) ?? []).map((s) => s.toLowerCase().replace(/\s+/g, '')));
  const agos = text.match(AGO)?.length ?? 0;
  return clocks.size + agos;
}

export async function findLiveSources(
  topic: string,
  deps: { search: LiveSearch; scrape: FreshScrape; now?: () => Date },
): Promise<LiveSourceDto[]> {
  const now = deps.now?.() ?? new Date();
  const queries = [`${topic} live updates`, `${topic} live`, `${topic} latest`];
  const results = (await Promise.all(queries.map((q) => deps.search(q).catch(() => [] as Article[])))).flat();

  const seen = new Set<string>();
  const candidates: LiveSourceDto[] = [];
  for (const a of results) {
    const key = normalizeUrl(a.url);
    if (seen.has(key) || !/^https?:\/\//i.test(a.url)) continue;
    seen.add(key);
    const mins = minutesSince(a.publishedAt, now);
    const live = LIVE_URL.test(a.url) || LIVE_TITLE.test(a.title);
    const signals: string[] = [];
    if (live) signals.push('live page');
    if (mins !== undefined) signals.push(mins < 60 ? `published ${mins} min ago` : `published ${Math.round(mins / 60)} h ago`);
    candidates.push({
      url: a.url,
      title: a.title,
      publisher: a.sourceName ?? hostOf(a.url),
      ...(a.publishedAt && { publishedAt: a.publishedAt }),
      ...(mins !== undefined && { minutesSinceUpdate: mins }),
      score: (live ? 3 : 0) + recencyScore(mins),
      signals,
      readable: true,
    });
  }

  candidates.sort((a, b) => b.score - a.score || (a.minutesSinceUpdate ?? 1e9) - (b.minutesSinceUpdate ?? 1e9));
  const top = candidates.slice(0, MAX_VERIFY);

  // Verify the best candidates by reading them now: frequent updates show as many timestamps.
  await Promise.all(
    top.map(async (c) => {
      const page = await deps.scrape(c.url).catch((err) => ({ ok: false as const, error: String(err) }));
      if (!page.ok) {
        c.readable = false;
        c.error = page.error;
        c.score -= 2;
        c.signals.push('could not be read');
        return;
      }
      // Page metadata can be fresher than the search index (live pages are re-published often).
      const pageMins = minutesSince(page.updatedAt, now);
      if (pageMins !== undefined && (c.minutesSinceUpdate === undefined || pageMins < c.minutesSinceUpdate)) {
        c.score += recencyScore(pageMins) - recencyScore(c.minutesSinceUpdate);
        c.minutesSinceUpdate = pageMins;
        c.signals = c.signals.filter((x) => !x.startsWith('published '));
        c.signals.push(pageMins < 60 ? `page updated ${pageMins} min ago` : `page updated ${Math.round(pageMins / 60)} h ago`);
      }
      const stamps = countUpdateStamps(page.markdown);
      c.updateStamps = stamps;
      if (stamps >= 3) c.signals.push(`${stamps} timestamped updates on the page`);
      c.score += Math.min(stamps / 5, 3);
    }),
  );

  return [...top.sort((a, b) => b.score - a.score), ...candidates.slice(MAX_VERIFY)]
    .slice(0, MAX_RESULTS)
    .map((c) => ({ ...c, score: Math.round(c.score * 10) / 10 }));
}
