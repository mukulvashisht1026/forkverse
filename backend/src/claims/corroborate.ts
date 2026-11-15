/**
 * Corroboration: give every claim on the timeline more than one independent source.
 *
 * For each claim with fewer than `target` outlets, search Context.dev news for the claim itself,
 * keep one new article per outlet, and ask the LLM which of them report the same claim (or, for a
 * politician, report what happened to it). Every match needs a quote that verifies VERBATIM
 * against that article's title/description; anything else is discarded. Status and outcome are
 * then recomputed from the enlarged evidence.
 */
import { z } from 'zod';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { getTools } from '../agent/tools/index.js';
import type { JsonLlm } from '../proof/agents.js';
import { defaultJsonLlm } from '../proof/agents.js';
import { type Article, articleBranchId, extractArticles, normalizeUrl } from '../research/articles.js';
import type { ClaimDto, ClaimEvidenceDto, InvestigationRecord } from '../investigations/types.js';
import { verifyQuote } from '../utils/quotes.js';
import { logger } from '../utils/logger.js';
import { decideStatus, mapLimit } from './builder.js';
import { LINKS_PER_NODE, SEARCH_RESULTS } from '../limits.js';

/** Claims that get a corroboration search (one Context.dev call each), weakest first. */
const MAX_CORROBORATED_CLAIMS = 12;


export type NewsSearch = (query: string) => Promise<Article[]>;

export const contextDevNewsSearch: NewsSearch = async (query) => {
  const tool: StructuredToolInterface | undefined = getTools().find((t) => t.name === 'context_get-news-search');
  if (!tool) return [];
  try {
    const raw = await tool.invoke({ query, limit: SEARCH_RESULTS } as never);
    return extractArticles(typeof raw === 'string' ? safeJson(raw) : raw, tool.name);
  } catch (err) {
    logger.warn({ err, query }, 'corroboration search failed');
    return [];
  }
};

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export const CORROBORATE_PROMPT = `You check whether news articles independently report a given claim.
You get ONE claim and candidate articles (A1, A2, ...) with title and description.

For each candidate that is about the SAME claim, return:
- "ref": the article label
- "stance": "supports" (reports the same claim/fact), "contradicts" (reports the opposite or disputes it), "context" (relevant background only)
- "role": "source" (reports the claim being made) or "outcome" (reports what later happened to it: data, completion, delay, reversal)
- "quote": 5-30 words copied VERBATIM from that article's title or description (machine-checked; paraphrases are discarded)
- "summary": one neutral sentence saying what the article reports
Skip unrelated articles. Never infer intent or causation. Return JSON {"matches":[...]} only.`;

export const CorroborateOutput = z.object({
  matches: z
    .array(
      z.object({
        ref: z.string(),
        stance: z.enum(['supports', 'contradicts', 'context']).catch('supports'),
        role: z.enum(['source', 'outcome']).catch('source'),
        quote: z.string(),
        summary: z.string().default(''),
      }),
    )
    .default([]),
});

export interface CorroborateDeps {
  search?: NewsSearch;
  json?: JsonLlm;
  /** Outlets wanted per claim. */
  target?: number;
  /** Most claims to corroborate per run (search + LLM cost). */
  maxClaims?: number;
}

export interface CorroborateResult {
  claims: ClaimDto[];
  /** New articles attached to claims (add them to the investigation graph). */
  added: Article[];
}

const outletOf = (e: { publisher?: string; url?: string }) =>
  (e.publisher || (e.url ? hostOf(e.url) : '') || 'unknown').toLowerCase();
function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function outcomeOf(claim: ClaimDto, evidence: ClaimEvidenceDto[]): ClaimDto['outcome'] {
  const outcomes = evidence.filter((e) => e.role === 'outcome');
  if (!outcomes.length) return 'no_update';
  if (claim.outcome && claim.outcome !== 'no_update') return claim.outcome;
  if (outcomes.some((e) => e.stance === 'contradicts')) return 'not_fulfilled';
  if (outcomes.some((e) => e.stance === 'supports')) return 'fulfilled';
  return 'in_progress';
}

export async function corroborateClaims(record: InvestigationRecord, claims: ClaimDto[], deps: CorroborateDeps = {}): Promise<CorroborateResult> {
  const search = deps.search ?? contextDevNewsSearch;
  const json = deps.json ?? defaultJsonLlm;
  const target = deps.target ?? 3;
  const politician = record.mode === 'politician';
  const seenUrls = new Set(record.events.flatMap((e) => e.evidence.map((ev) => normalizeUrl(ev.sourceUrl ?? ''))));
  const added = new Map<string, Article>();

  const needy = claims
    .map((c, i) => ({ c, i, outlets: new Set(c.evidence.map(outletOf)).size }))
    .filter((x) => x.outlets < target)
    .sort((a, b) => a.outlets - b.outlets || a.i - b.i)
    .slice(0, deps.maxClaims ?? MAX_CORROBORATED_CLAIMS);

  const updated = [...claims];
  await mapLimit(needy, 6, async ({ c, i }) => {
    const query = [record.entity, c.statement].filter(Boolean).join(' ').slice(0, 160);
    const have = new Set(c.evidence.map(outletOf));
    const haveUrls = new Set(c.evidence.map((e) => normalizeUrl(e.url ?? '')));
    const candidates: Article[] = [];
    for (const a of await search(query)) {
      const outlet = (a.sourceName || a.domain).toLowerCase();
      if (have.has(outlet) || haveUrls.has(normalizeUrl(a.url)) || candidates.some((x) => (x.sourceName || x.domain).toLowerCase() === outlet)) continue;
      candidates.push(a);
      if (candidates.length >= SEARCH_RESULTS) break;
    }
    if (!candidates.length) return;

    const listing = candidates.map((a, k) => `A${k + 1} | ${a.sourceName ?? a.domain} | ${a.publishedAt?.slice(0, 10) ?? 'undated'} | ${a.title}${a.description ? ` - ${a.description}` : ''}`).join('\n');
    const out = await json(CorroborateOutput, [
      { role: 'system', content: CORROBORATE_PROMPT },
      { role: 'user', content: `Claim: ${c.statement}${record.entity ? `\nAbout: ${record.entity}` : ''}\n\nCandidates:\n${listing}` },
    ]).catch(() => ({ matches: [] }));

    const evidence = [...c.evidence];
    for (const m of out.matches) {
      if (evidence.length >= LINKS_PER_NODE) break; // a claim (node) keeps at most LINKS_PER_NODE sources
      const a = candidates[Number(m.ref.replace(/\D/g, '')) - 1];
      if (!a) continue;
      if (!verifyQuote(m.quote, `${a.title}. ${a.description ?? ''}`)) continue;
      const id = articleBranchId(a.url);
      if (evidence.some((e) => e.evidenceId === id)) continue;
      // New pages are stored on one "Corroborating sources" node: at most LINKS_PER_NODE per build.
      const isNew = !seenUrls.has(normalizeUrl(a.url)) && !added.has(id);
      if (isNew && added.size >= LINKS_PER_NODE) continue;
      evidence.push({
        evidenceId: id,
        stance: m.stance,
        quote: m.quote.trim(),
        ...(m.summary.trim() && { summary: m.summary.trim().slice(0, 300) }),
        ...(politician && { role: m.role }),
        title: a.title,
        publisher: a.sourceName ?? a.domain,
        url: a.url,
        ...(a.publishedAt && { publishedAt: a.publishedAt }),
      });
      if (!seenUrls.has(normalizeUrl(a.url))) added.set(id, a);
    }
    if (evidence.length === c.evidence.length) return;
    const sourceEvidence = politician ? evidence.filter((e) => e.role !== 'outcome') : evidence;
    updated[i] = {
      ...c,
      evidence,
      ...decideStatus(sourceEvidence.length ? sourceEvidence : evidence),
      ...(politician && { outcome: outcomeOf(c, evidence) }),
    };
  });

  logger.info({ investigationId: record.id, claims: needy.length, added: added.size }, 'claims corroborated');
  return { claims: updated, added: [...added.values()] };
}

/** Store new corroborating articles as their own graph event so chat/highlight can find them. */
export async function storeCorroboration(
  store: Pick<import('../investigations/store.js').InvestigationStore, 'addEvent' | 'addEvidence'>,
  investigationId: string,
  added: Article[],
  /** Screening results by article URL (attached to the stored evidence). */
  vetting: ReadonlyMap<string, import('../investigations/types.js').SourceVettingDto> = new Map(),
): Promise<void> {
  if (!added.length) return;
  const eventId = `evt-corr-${Date.now().toString(36)}`;
  await store.addEvent(investigationId, { id: eventId, title: 'Corroborating sources', occurredAt: new Date().toISOString(), evidence: [] });
  for (const a of added) {
    await store.addEvidence(investigationId, eventId, {
      id: articleBranchId(a.url),
      title: a.title,
      ...(a.description && { excerpt: a.description }),
      sourceName: a.sourceName ?? a.domain,
      sourceUrl: a.url,
      ...(a.publishedAt && { publishedAt: a.publishedAt }),
      relationship: 'Corroborating source',
      eventId,
      ...(a.imageUrl && { imageUrl: a.imageUrl }),
      ...(vetting.get(a.url) && { vetting: vetting.get(a.url) }),
    });
  }
}
