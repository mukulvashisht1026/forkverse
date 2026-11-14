/**
 * Proof engine input: pick an event's articles and fetch their full text.
 *
 * - selectArticles: one article per publisher (diverse outlets), up to MAX_ARTICLES, labelled S1..Sn.
 * - scrapeArticles: full text via Context.dev (`context_web-scrape`, markdown, main content only),
 *   PROOF_CONCURRENCY at a time. Pages that cannot be read are kept as unreadable with the error
 *   (principle: fail visibly) and are never analysed from guesses.
 * - toPlainText: markdown -> plain text so verbatim quotes can be checked with verifyQuote.
 */
import type { StructuredToolInterface } from '@langchain/core/tools';
import { getTools } from '../agent/tools/index.js';
import type { InvestigationEventDto, InvestigationEvidenceDto } from '../investigations/types.js';

export const MAX_ARTICLES = 8;
export const MAX_TEXT_CHARS = 7000;
const PROOF_CONCURRENCY = 4;
const MIN_READABLE_CHARS = 400;

export interface ProofArticle {
  label: string; // S1..Sn
  evidence: InvestigationEvidenceDto;
  publisher: string;
  readable: boolean;
  text: string; // plain text, truncated
  error?: string;
}

export type Scraper = (url: string) => Promise<{ ok: true; markdown: string } | { ok: false; error: string }>;

const publisherOf = (e: InvestigationEvidenceDto) => {
  if (e.sourceName) return e.sourceName;
  try {
    return new URL(e.sourceUrl ?? '').host.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
};

/** Diverse sample: first article per publisher (in graph order), only http(s) URLs. */
export function selectArticles(event: InvestigationEventDto, max = MAX_ARTICLES): Omit<ProofArticle, 'readable' | 'text' | 'error'>[] {
  const seen = new Set<string>();
  const picked: Omit<ProofArticle, 'readable' | 'text' | 'error'>[] = [];
  for (const evidence of event.evidence) {
    if (!evidence.sourceUrl || !/^https?:\/\//i.test(evidence.sourceUrl)) continue;
    const publisher = publisherOf(evidence);
    const key = publisher.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push({ label: `S${picked.length + 1}`, evidence, publisher });
    if (picked.length >= max) break;
  }
  return picked;
}

/** Markdown -> readable plain text (links/images/emphasis/headings removed, whitespace collapsed). */
export function toPlainText(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // images
    .replace(/\[([^\]]*)\]\((?:[^()]|\([^)]*\))*\)/g, '$1') // links -> text
    .replace(/<[^>]+>/g, ' ') // stray html
    .replace(/^#{1,6}\s+/gm, '') // headings
    .replace(/(\*\*|__|\*|_|`)/g, '') // emphasis/code markers
    .replace(/^\s*[-*+]\s+/gm, '') // bullets
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Default scraper: Context.dev MCP tool loaded at startup. */
export const contextDevScraper: Scraper = async (url) => {
  const tool: StructuredToolInterface | undefined = getTools().find((t) => t.name === 'context_web-scrape');
  if (!tool) return { ok: false, error: 'Scrape tool unavailable (Context.dev MCP not loaded).' };
  try {
    const raw = await tool.invoke({
      url,
      formats: { markdown: true },
      sharedParams: { mainContentOnly: true },
      timeoutOpts: { milliseconds: 20000, behavior: 'return-partial' },
    } as never);
    const json = JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw)) as {
      markdown?: { success?: boolean | null; data?: string | null; error_code?: string; message?: string };
    };
    const md = json.markdown;
    if (md?.success && md.data) return { ok: true, markdown: md.data };
    return { ok: false, error: md?.message || md?.error_code || 'Page could not be read.' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 200) : 'Scrape failed.' };
  }
};

export async function scrapeArticles(
  picked: Omit<ProofArticle, 'readable' | 'text' | 'error'>[],
  scrape: Scraper = contextDevScraper,
  onDone?: (article: ProofArticle) => void,
): Promise<ProofArticle[]> {
  const out: ProofArticle[] = new Array(picked.length);
  let next = 0;
  const worker = async () => {
    while (next < picked.length) {
      const i = next++;
      const p = picked[i]!;
      const res = await scrape(p.evidence.sourceUrl!);
      const text = res.ok ? toPlainText(res.markdown).slice(0, MAX_TEXT_CHARS) : '';
      const readable = res.ok && text.length >= MIN_READABLE_CHARS;
      const article: ProofArticle = {
        ...p,
        readable,
        text: readable ? text : '',
        ...(!readable && { error: res.ok ? 'Too little article text on the page.' : res.error }),
      };
      out[i] = article;
      onDone?.(article);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PROOF_CONCURRENCY, picked.length) }, worker));
  return out;
}
