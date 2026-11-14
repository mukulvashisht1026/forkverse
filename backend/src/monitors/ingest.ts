/**
 * Live monitor ingest: turn a Context.dev change (MonitorsChange) into graph evidence.
 *
 * Everything comes from the change record itself (titles, URLs and dates in the monitored
 * source), never from LLM text:
 * - news_feed (Google News RSS rendered as markdown): each NEW `- [Headline - Publisher](url)`
 *   item in the diff becomes one evidence item, with its `Published:` date.
 * - sitemap: each added URL becomes one evidence item (title from the URL slug; the claim
 *   builder reads the full article afterwards).
 * - page: new links in the diff are treated like a feed when they look like articles;
 *   otherwise the page itself is the evidence, with the changed text as its excerpt.
 */
import type { MonitorChange } from '../clients/contextdev.js';
import type { InvestigationEvidenceDto, MonitorKindDto } from '../investigations/types.js';
import { articleBranchId, normalizeUrl } from '../research/articles.js';

export const MAX_ITEMS_PER_CHANGE = 6;
const EXCERPT_CHARS = 600;

export interface FeedItem {
  url: string;
  title: string;
  publisher?: string;
  publishedAt?: string;
}

/** Lines the change added (unified diff `+` lines; falls back to after-snapshots). */
export function addedText(change: MonitorChange): { added: string; removed: string } {
  const added: string[] = [];
  const removed: string[] = [];
  if (change.diff) {
    for (const line of change.diff.split('\n')) {
      if (line.startsWith('+++') || line.startsWith('---')) continue;
      if (line.startsWith('+')) added.push(line.slice(line.startsWith('+ ') ? 2 : 1));
      else if (line.startsWith('-')) removed.push(line.slice(line.startsWith('- ') ? 2 : 1));
    }
  }
  if (!added.length) {
    for (const e of change.evidence ?? []) {
      added.push(e.after);
      removed.push(e.before);
    }
    if (change.after_text_excerpt) added.push(change.after_text_excerpt);
    if (change.before_text_excerpt) removed.push(change.before_text_excerpt);
  }
  return { added: added.join('\n'), removed: removed.join('\n') };
}

const MD_LINK = /\[([^\]\n]{8,300})\]\((https?:\/\/[^\s)]+)\)/g;
// Feeds rendered as visible text keep each item's link only inside an HTML description:
//   Description: <a href="https://…" target="_blank">Headline</a>&nbsp;<font …>Publisher</font>
const HTML_LINK = /<a\s[^>]*?href="(https?:\/\/[^"]+)"[^>]*>([^<]{8,300})<\/a/gi;
const FONT = /<font[^>]*>([^<]{2,80})<\/font/i;
const PUBLISHED = /^\s*Published:\s*(.+?)\s*$/i;

/** Undo markdown escaping (`news\.google\.com`, `\_blank`, `\>`) without touching whitespace. */
const unescapeMd = (s: string) => s.replace(/\\([\\`*_{}[\]()#+\-.!|<>&"])/g, '$1');
const decodeEntities = (s: string) =>
  s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const clean = (s: string) => decodeEntities(unescapeMd(s)).replace(/\s+/g, ' ').trim();

function isoOrUndefined(value: string): string | undefined {
  const t = Date.parse(value);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

/** "Headline - Publisher" (Google News style) -> parts; only when the tail looks like a name. */
function splitPublisher(title: string): { title: string; publisher?: string } {
  const dash = title.lastIndexOf(' - ');
  if (dash > 10 && title.length - dash < 60) return { title: title.slice(0, dash).trim(), publisher: title.slice(dash + 3).trim() };
  return { title };
}

/**
 * Article links in feed/page text: markdown links (`[title](url)`) and HTML anchors (RSS
 * descriptions), each with the nearest `Published:` date and `<font>` publisher if present.
 */
export function parseLinks(text: string): FeedItem[] {
  const items: FeedItem[] = [];
  const lines = text.split('\n').map(unescapeMd);
  const publishedNear = (i: number) => {
    for (const j of [i + 1, i - 1, i + 2, i - 2]) {
      const m = lines[j] !== undefined ? PUBLISHED.exec(lines[j]!) : null;
      const iso = m && isoOrUndefined(m[1]!);
      if (iso) return iso;
    }
    return undefined;
  };
  lines.forEach((line, i) => {
    for (const m of line.matchAll(MD_LINK)) {
      const { title, publisher } = splitPublisher(clean(m[1]!));
      const publishedAt = publishedNear(i);
      items.push({ url: m[2]!, title, ...(publisher && { publisher }), ...(publishedAt && { publishedAt }) });
    }
    for (const m of line.matchAll(HTML_LINK)) {
      const font = FONT.exec(line.slice((m.index ?? 0) + m[0].length));
      const split = splitPublisher(clean(m[2]!));
      const publisher = font ? clean(font[1]!) : split.publisher;
      const publishedAt = publishedNear(i);
      items.push({ url: decodeEntities(m[1]!), title: split.title, ...(publisher && { publisher }), ...(publishedAt && { publishedAt }) });
    }
  });
  return items;
}

/** Links present in the added text but not in the removed text (re-ordering is not news). */
export function newItems(change: MonitorChange): FeedItem[] {
  const { added, removed } = addedText(change);
  const before = new Set(parseLinks(removed).map((l) => normalizeUrl(l.url)));
  const seen = new Set<string>();
  return parseLinks(added).filter((l) => {
    const key = normalizeUrl(l.url);
    if (before.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

/** "/2026/11/14/trump-raises-tariffs-on-steel.html" -> "Trump raises tariffs on steel". */
export function titleFromUrl(url: string): string {
  try {
    const seg = new URL(url).pathname.split('/').filter(Boolean).reverse().find((s) => /[a-z]{3,}/i.test(s) && s.includes('-')) ?? '';
    const words = decodeURIComponent(seg).replace(/\.\w{2,5}$/, '').split(/[-_]+/).filter((w) => w && !/^\d+$/.test(w) && !/^[a-z0-9]{12,}$/i.test(w));
    const text = words.join(' ').trim();
    return text ? text[0]!.toUpperCase() + text.slice(1) : hostOf(url);
  } catch {
    return url;
  }
}

/** Article-like link: not the page's own navigation (same host, short path) or a feed/index. */
const looksLikeArticle = (item: FeedItem, pageUrl: string) => {
  try {
    const u = new URL(item.url);
    const sameHost = u.hostname === new URL(pageUrl).hostname;
    return item.title.split(' ').length >= 4 && (!sameHost || u.pathname.split('/').filter(Boolean).length >= 2);
  } catch {
    return false;
  }
};

/**
 * Evidence for one change. `existing` = evidence ids already in the graph (never duplicated).
 * Every item carries the source URL; excerpts are verbatim text from the change record.
 */
export function changeToEvidence(
  kind: MonitorKindDto,
  monitorUrl: string,
  change: MonitorChange,
  eventId: string,
  existing: ReadonlySet<string>,
): InvestigationEvidenceDto[] {
  const detectedAt = change.detected_at && isoOrUndefined(change.detected_at);
  const relationship = 'Live monitor update';
  const fresh = (e: InvestigationEvidenceDto) => !existing.has(e.id);

  if (kind === 'sitemap') {
    return (change.added_urls ?? [])
      .map((url): InvestigationEvidenceDto => ({
        id: articleBranchId(url),
        title: titleFromUrl(url),
        sourceName: hostOf(url),
        sourceUrl: url,
        ...(detectedAt && { publishedAt: detectedAt }),
        relationship,
        eventId,
      }))
      .filter(fresh)
      .slice(0, MAX_ITEMS_PER_CHANGE);
  }

  const items = newItems(change).filter((i) => kind === 'news_feed' || looksLikeArticle(i, monitorUrl));
  if (items.length) {
    return items
      .map((i): InvestigationEvidenceDto => ({
        id: articleBranchId(i.url),
        title: i.title,
        sourceName: i.publisher ?? hostOf(i.url),
        sourceUrl: i.url,
        ...((i.publishedAt ?? detectedAt) && { publishedAt: (i.publishedAt ?? detectedAt)! }),
        relationship,
        eventId,
      }))
      .filter(fresh)
      .slice(0, MAX_ITEMS_PER_CHANGE);
  }
  if (kind === 'news_feed') return []; // feed changed without new headlines (re-ordering, timestamps)

  // A watched page changed in place: the page itself is the new evidence.
  const { added } = addedText(change);
  const excerpt = (change.after_text_excerpt || added || change.summary || '').replace(/\s+/g, ' ').trim().slice(0, EXCERPT_CHARS);
  const url = change.url || monitorUrl;
  const evidence: InvestigationEvidenceDto = {
    id: `mon-${change.id}`,
    title: change.title || `${hostOf(url)} changed`,
    ...(excerpt && { excerpt }),
    sourceName: hostOf(url),
    sourceUrl: url,
    ...(detectedAt && { publishedAt: detectedAt }),
    relationship,
    eventId,
  };
  return fresh(evidence) ? [evidence] : [];
}

/** Default news feed for a topic: Google News RSS search (readable by Context.dev as markdown). */
export function newsFeedUrl(topic: string): string {
  const q = new URLSearchParams({ q: topic, hl: 'en-US', gl: 'US', ceid: 'US:en' });
  return `https://news.google.com/rss/search?${q}`;
}
