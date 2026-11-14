/**
 * Claim builder: Sources -> Evidence -> Claims -> chronological Topic timeline.
 *
 * 1. Read: up to MAX_ARTICLES articles of the investigation (round-robin across outlets), full
 *    text via Context.dev; if a page cannot be read, its stored title + excerpt are used.
 * 2. Candidates (one small JSON call PER ARTICLE, in parallel): 1-4 specific claims the article
 *    reports, each with a verbatim quote, verified immediately against that article (small context
 *    = accurate quoting). Failing quotes are dropped.
 * 3. Merge (one JSON call over the verified candidates): group equivalent candidates from different
 *    outlets into canonical claims with each member's stance (supports / contradicts / context),
 *    link claims (evolution / follow_up / potential_inconsistency + basis), name the main entity.
 *    Unassigned candidates stay as their own (usually pending) claims - nothing is silently lost.
 * 4. Status (evidence, not a fixed count): `established` when verified support comes from >= 2
 *    independent outlets, or from >= 1 primary/official source; hedged wording ("reportedly",
 *    "sources say", ...) does not count. Otherwise `pending` - never presented as fact.
 *    Contradicting evidence marks the claim `disputed` (perspectives preserved, not averaged).
 * 5. Chronology: claim date = earliest publication date among its verified evidence.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type {
  ClaimDto,
  ClaimEvidenceDto,
  ClaimLinkDto,
  InvestigationEvidenceDto,
  InvestigationRecord,
} from '../investigations/types.js';
import { type ProofArticle, type Scraper, scrapeArticles } from '../proof/articles.js';
import { defaultJsonLlm, type JsonLlm } from '../proof/agents.js';
import { normalizeForMatch } from '../utils/text.js';
import { verifyQuote } from '../utils/quotes.js';

export const MAX_ARTICLES = 24;
const ARTICLE_CHARS = 5000;
const CANDIDATE_CONCURRENCY = 6;

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

const HEDGED = /\b(reportedly|allegedly|rumou?red|rumou?rs?|unconfirmed|sources (say|said|claim)|people familiar|according to (a )?(source|insider)s?|could|might|may be|is said to|speculat\w*)\b/i;
const PRIMARY_HOST = /(\.gov(\.[a-z]{2})?|\.int|europa\.eu|whitehouse\.gov|parliament\.[a-z.]+|\.mil)$/i;

export const CandidateOutput = z.object({
  /** One sentence: what this article reports (shown on its graph branch). */
  summary: z.string().default(''),
  claims: z
    .array(
      z.object({
        statement: z.string(),
        kind: z.enum(['statement', 'position', 'development']).catch('development'),
        /** politician mode: 'claim' = something the politician said/promised; 'outcome' = report of what happened to an earlier claim. */
        type: z.enum(['claim', 'outcome']).catch('claim').optional(),
        quote: z.string(),
      }),
    )
    .default([]),
});

export const MergeOutput = z.object({
  entity: z.string().nullable().optional(),
  claims: z
    .array(
      z.object({
        key: z.string(),
        statement: z.string(),
        kind: z.enum(['statement', 'position', 'development']).catch('development'),
        /** politician mode: what later reports say happened to this claim. */
        outcome: z.enum(['fulfilled', 'not_fulfilled', 'in_progress', 'no_update']).catch('no_update').optional(),
        members: z.array(
          z.object({
            candidate: z.string(),
            stance: z.enum(['supports', 'contradicts', 'context']).catch('supports'),
            role: z.enum(['source', 'outcome']).catch('source').optional(),
          }),
        ),
      }),
    )
    .default([]),
  links: z
    .array(
      z.object({
        from: z.string(),
        to: z.string(),
        type: z.enum(['evolution', 'follow_up', 'potential_inconsistency']).catch('follow_up'),
        basis: z.enum(['stated', 'sequence_only', 'inferred']).catch('inferred'),
        description: z.string(),
      }),
    )
    .default([]),
});

export const CANDIDATE_PROMPT = `Extract the specific claims this ONE news article reports about the topic.
A claim is one concrete statement, position, or documented development (who did/said/decided what, when, numbers) - e.g. "Trump promised to reduce taxes." Not opinions or vague themes.
For each claim give a quote copied VERBATIM from the article (exact words, 5-35 words) that shows it. Quotes are machine-checked; paraphrases are discarded.
Report claims exactly as the article does: if the article hedges ("reportedly", "sources say"), keep that hedge in the statement.
Also give "summary": ONE neutral sentence saying what the article reports.
Return JSON {"summary":"...","claims":[{"statement":"...","kind":"statement|position|development","quote":"..."}]} with the 1-3 MOST important claims, or "claims":[] if none. Neutral wording. JSON only.`;

export const POLITICIAN_CANDIDATE_PROMPT = `This ONE news article is about a politician (named in the topic). Extract two kinds of items:
- "claim": something THE POLITICIAN HIMSELF/HERSELF said, promised or took a position on (e.g. "Modi promised 2 crore jobs a year."), with the date if the article gives it.
  Only the politician's own words or announced policies. NOT what opponents, allies, journalists or others say about them.
  Write the statement starting with the politician's name.
- "outcome": an INDEPENDENT report of what actually happened to something the politician promised or claimed: official data/statistics, audits, court or parliament records, fact-checks, project completions, delays, cancellations or reversals (e.g. "Unemployment data shows job creation fell short of the 2 crore target.", "Only 30% of the smart cities projects were completed by 2023.").
  A politician's or government's OWN statement that it delivered ("we fulfilled 90% of our promises") is a "claim", not an outcome.
For each item give a quote copied VERBATIM from the article (exact words, 5-35 words). Quotes are machine-checked; paraphrases are discarded.
Report exactly as the article does; keep hedges ("reportedly"). Never judge intent.
Also give "summary": ONE neutral sentence saying what the article reports.
Return JSON {"summary":"...","claims":[{"statement":"...","kind":"statement|position|development","type":"claim|outcome","quote":"..."}]} with up to 3 items, or "claims":[] if none. JSON only.`;

export const MERGE_PROMPT = `You merge candidate claims extracted from different news articles about one topic into a traceable claim timeline.

1. Group candidates that state the SAME claim (same fact/statement/development, even if worded differently) into one canonical claim.
   Different outlets usually report the same core facts: merge them aggressively when they share the same numbers, dates, institutions, decisions or quotes (e.g. "fines up to 35 million euros or 7% of turnover" from several outlets is ONE claim).
   Aim for about 6-12 canonical claims in total. Every candidate key must appear in exactly one claim.
   For each member set its stance toward the canonical claim: "supports", "contradicts" (it reports the opposite or disputes it), or "context".
   Keep claims specific; do not merge different developments just because they share a theme. Put every candidate in exactly one claim (singleton claims are fine).
   Write the canonical statement neutrally and keep any hedging if all members hedge.
2. LINKS between claims about the same matter over time:
   "evolution" (a later claim changes/updates an earlier position), "follow_up" (a later development follows an earlier claim, e.g. a promise then a bill), "potential_inconsistency" (a later claim may conflict with an earlier one).
   basis: "stated" only if a candidate itself says so; "sequence_only" if only the order is known; "inferred" otherwise.
   description: one neutral sentence. Never claim intent, motive, or causation unless a candidate states it.
3. entity: the main person/organization the topic is about, or null.

Return JSON {"entity":"...","claims":[{"key":"C1","statement":"...","kind":"statement|position|development","members":[{"candidate":"K1","stance":"supports"}]}],"links":[{"from":"C1","to":"C2","type":"follow_up","basis":"sequence_only","description":"..."}]}. JSON only.`;

export const POLITICIAN_MERGE_PROMPT = `You build a promise/claim tracker for a politician from candidate items extracted from news articles.
Candidates are marked [claim] (something the politician said/promised/positioned) or [outcome] (a report of what happened later).

1. Each canonical claim = one thing the politician said or promised (merge the same claim reported by different outlets).
   Its "source" members are the [claim] candidates reporting it (stance "supports"; "contradicts" if an outlet disputes that it was ever said).
2. Attach each [outcome] candidate to the claim it is about as a member with role "outcome" and stance:
   "supports" = it shows the claim was fulfilled, "contradicts" = it shows it was not fulfilled / reversed, "context" = in progress or partial.
3. outcome for each claim: "fulfilled", "not_fulfilled", "in_progress" (from its outcome members), or "no_update" if it has no outcome members.
   Base this ONLY on the outcome reports; never assume a promise was kept or broken without one.
4. LINKS between claims over time: "evolution" (a later statement changes an earlier position), "follow_up", "potential_inconsistency" (a later claim may conflict with an earlier one); basis "stated" | "sequence_only" | "inferred"; one neutral sentence; never infer intent or causation.
5. entity: the politician's full name.
Put every candidate in exactly one claim. Aim for 5-12 claims.
Return JSON {"entity":"...","claims":[{"key":"C1","statement":"...","kind":"statement|position|development","outcome":"no_update","members":[{"candidate":"K1","stance":"supports","role":"source"}]}],"links":[...]}. JSON only.`;

export interface BuildResult {
  claims: ClaimDto[];
  links: ClaimLinkDto[];
  entity?: string;
  stats: { articles: number; fullText: number; claims: number; established: number; pending: number; quotesVerified: number; quotesRejected: number };
}

const hostOf = (url?: string) => {
  try {
    return new URL(url ?? '').host.replace(/^www\./, '');
  } catch {
    return '';
  }
};
const publisherOf = (e: InvestigationEvidenceDto) => (e.sourceName || hostOf(e.sourceUrl) || 'unknown').toLowerCase();

/** Round-robin across outlets so no single publisher dominates the sample. */
export function pickEvidence(record: InvestigationRecord, max = MAX_ARTICLES): InvestigationEvidenceDto[] {
  const seenUrl = new Set<string>();
  const byPublisher = new Map<string, InvestigationEvidenceDto[]>();
  for (const e of record.events.flatMap((ev) => ev.evidence)) {
    if (!e.sourceUrl || seenUrl.has(e.sourceUrl)) continue;
    seenUrl.add(e.sourceUrl);
    const key = publisherOf(e);
    byPublisher.set(key, [...(byPublisher.get(key) ?? []), e]);
  }
  const lists = [...byPublisher.values()];
  const out: InvestigationEvidenceDto[] = [];
  for (let round = 0; out.length < max && lists.some((l) => l[round]); round++) {
    for (const l of lists) if (l[round] && out.length < max) out.push(l[round]!);
  }
  return out;
}

/** Content words (3+ letters, no stopwords) and numbers, for deterministic claim matching. */
const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'will', 'are', 'was', 'were', 'has', 'have', 'its', 'their', 'into', 'under', 'which', 'would', 'could', 'been', 'also', 'more', 'than', 'such', 'they', 'said', 'says']);
function terms(text: string): Set<string> {
  return new Set(
    normalizeForMatch(text)
      .replace(/[^\p{L}\p{N}%.€$ ]/gu, ' ')
      .split(/\s+/)
      .map((w) => w.replace(/^\.+|\.+$/g, ''))
      .filter((w) => (/\d/.test(w) ? w.length >= 1 : w.length >= 3 && !STOP.has(w))),
  );
}
/** Jaccard overlap of content words; shared numbers count double (same amounts/dates = same fact). */
export function similarity(a: string, b: string): number {
  const A = terms(a);
  const B = terms(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared += /\d/.test(w) ? 2 : 1;
  return shared / (A.size + B.size - shared / 2);
}
const SIMILAR = 0.34;

const claimId = (statement: string) => `clm-${createHash('sha1').update(normalizeForMatch(statement)).digest('hex').slice(0, 12)}`;

/** Evidence-based status: independent outlets or a primary source, hedged quotes do not count. */
export function decideStatus(evidence: ClaimEvidenceDto[]): Pick<ClaimDto, 'status' | 'statusReason' | 'disputed'> {
  const supports = evidence.filter((e) => e.stance === 'supports');
  const firm = supports.filter((e) => !HEDGED.test(e.quote));
  const outlets = [...new Set(firm.map((e) => (e.publisher || hostOf(e.url) || 'unknown').toLowerCase()))];
  const primary = firm.filter((e) => PRIMARY_HOST.test(hostOf(e.url)));
  const contradicting = [...new Set(evidence.filter((e) => e.stance === 'contradicts').map((e) => e.publisher || hostOf(e.url)))];
  const disputed = contradicting.length > 0;
  const names = (list: ClaimEvidenceDto[]) => [...new Set(list.map((e) => e.publisher || hostOf(e.url)))].join(', ');
  const disputeNote = disputed ? ` Disputed by ${contradicting.join(', ')}.` : '';

  if (outlets.length >= 2) {
    return { status: 'established', disputed, statusReason: `Supported by ${outlets.length} independent outlets (${names(firm)}).${disputeNote}` };
  }
  if (primary.length >= 1) {
    return { status: 'established', disputed, statusReason: `Supported by a primary/official source (${names(primary)}).${disputeNote}` };
  }
  const hedged = supports.length > firm.length;
  const reason = !supports.length
    ? 'No article directly supports it yet.'
    : hedged && !firm.length
      ? `Only reported with hedged wording (e.g. "reportedly") by ${names(supports)}; awaiting firm corroboration.`
      : `Only one outlet (${names(firm)}) supports it so far; awaiting independent corroboration.`;
  return { status: 'pending', disputed, statusReason: `Unverified: ${reason}${disputeNote}` };
}

export async function buildClaims(
  record: InvestigationRecord,
  deps: { scrape?: Scraper; json?: JsonLlm; token?: (text: string) => void },
): Promise<BuildResult> {
  const token = deps.token ?? (() => {});
  const json = deps.json ?? defaultJsonLlm;
  const picked = pickEvidence(record);
  if (picked.length < 2) throw new Error('Building claims needs at least two articles in the investigation.');

  token(`**Reading ${picked.length} articles** across ${new Set(picked.map(publisherOf)).size} outlets…\n`);
  const scraped = await scrapeArticles(
    picked.map((evidence, i) => ({ label: `A${i + 1}`, evidence, publisher: evidence.sourceName || hostOf(evidence.sourceUrl) })),
    deps.scrape,
  );
  // Unreadable pages fall back to stored title + excerpt (still verifiable, just thinner).
  const articles: ProofArticle[] = scraped.map((a) =>
    a.readable ? a : { ...a, text: [a.evidence.title, a.evidence.excerpt].filter(Boolean).join('. ') },
  );
  const fullText = scraped.filter((a) => a.readable).length;
  token(`- ${fullText} read in full, ${articles.length - fullText} from title/excerpt only\n- Extracting claims, stances and links…\n`);

  // Stage 1: candidates per article (parallel), quotes verified against that article.
  const politician = record.mode === 'politician';
  token(`- Extracting ${politician ? 'the politician\'s claims and outcome reports' : 'candidate claims'} from each article…\n`);
  let verified = 0;
  let rejected = 0;
  interface Candidate { key: string; article: ProofArticle; statement: string; kind: ClaimDto['kind']; type: 'claim' | 'outcome'; quote: string }
  const candidates: Candidate[] = [];
  const articleSummary = new Map<string, string>();
  const perArticle = await mapLimit(articles, CANDIDATE_CONCURRENCY, async (a) => {
    const out = await json(CandidateOutput, [
      { role: 'system', content: politician ? POLITICIAN_CANDIDATE_PROMPT : CANDIDATE_PROMPT },
      { role: 'user', content: `Topic: ${record.topic}${record.entity ? ` (${record.entity})` : ''}\nArticle (${a.publisher}, ${a.evidence.publishedAt?.slice(0, 10) ?? 'undated'}): ${a.evidence.title}\n\n${a.text.slice(0, ARTICLE_CHARS)}` },
    ]).catch(() => ({ summary: '', claims: [] }));
    return { a, summary: out.summary.trim(), claims: out.claims.slice(0, 3) };
  });
  for (const { a, summary, claims: found } of perArticle) {
    if (summary) articleSummary.set(a.evidence.id, summary.slice(0, 300));
    for (const c of found) {
      if (!c.statement.trim() || !verifyQuote(c.quote, a.text)) {
        rejected++;
        continue;
      }
      verified++;
      candidates.push({ key: `K${candidates.length + 1}`, article: a, statement: c.statement.trim(), kind: c.kind, type: politician ? (c.type ?? 'claim') : 'claim', quote: c.quote.trim() });
    }
  }
  token(`- ${candidates.length} items with verified quotes (${rejected} unverifiable quotes discarded)\n- Building the timeline…\n`);
  if (!candidates.length) {
    return { claims: [], links: [], stats: { articles: articles.length, fullText, claims: 0, established: 0, pending: 0, quotesVerified: verified, quotesRejected: rejected } };
  }

  // Stage 2: merge across outlets, stances (and for politicians: attach outcome reports), links.
  const list = candidates
    .map((c) => `${c.key} | ${politician ? `[${c.type}] | ` : ''}${c.article.publisher} | ${c.article.evidence.publishedAt?.slice(0, 10) ?? 'undated'} | ${c.statement}`)
    .join('\n');
  const merged = await json(MergeOutput, [
    { role: 'system', content: politician ? POLITICIAN_MERGE_PROMPT : MERGE_PROMPT },
    { role: 'user', content: `Topic: ${record.topic}\n\nCandidates (key | ${politician ? 'type | ' : ''}outlet | date | statement):\n${list}` },
  ]);

  type Member = { c: Candidate; stance: ClaimEvidenceDto['stance']; role: 'source' | 'outcome' };
  const byKey = new Map(candidates.map((c) => [c.key, c]));
  const used = new Set<string>();
  const groups: { key: string; statement: string; kind: ClaimDto['kind']; outcome?: ClaimDto['outcome']; members: Member[] }[] = [];
  for (const g of merged.claims) {
    const members = g.members
      .map((m) => {
        const c = byKey.get(m.candidate);
        return c ? { c, stance: m.stance, role: politician ? (m.role ?? (c.type === 'outcome' ? 'outcome' : 'source')) : 'source' } : undefined;
      })
      .filter((m): m is Member => Boolean(m) && !used.has(m!.c.key));
    members.forEach((m) => used.add(m.c.key));
    if (members.length && g.statement.trim()) groups.push({ key: g.key, statement: g.statement.trim(), kind: g.kind, ...(politician && { outcome: g.outcome }), members });
  }
  // Candidates the merge step left out: attach to the most similar claim (shared words/numbers),
  // otherwise group them among themselves - nothing silently dropped, no flood of singletons.
  for (const c of candidates) {
    if (used.has(c.key)) continue;
    used.add(c.key);
    let best: (typeof groups)[number] | undefined;
    let bestScore = 0;
    for (const g of groups) {
      const score = Math.max(similarity(c.statement, g.statement), ...g.members.map((m) => similarity(c.statement, m.c.statement)));
      if (score > bestScore) [best, bestScore] = [g, score];
    }
    const role: Member['role'] = c.type === 'outcome' ? 'outcome' : 'source';
    // An unmatched outcome report has no claim to attach to; it is kept only in news mode.
    if (best && bestScore >= SIMILAR) best.members.push({ c, stance: role === 'outcome' ? 'context' : 'supports', role });
    else if (role === 'source') groups.push({ key: c.key, statement: c.statement, kind: c.kind, ...(politician && { outcome: 'no_update' as const }), members: [{ c, stance: 'supports', role }] });
  }

  const keyToId = new Map<string, string>();
  const claims: ClaimDto[] = [];
  for (const g of groups) {
    const evidence: ClaimEvidenceDto[] = [];
    for (const { c, stance, role } of g.members) {
      if (evidence.some((e) => e.evidenceId === c.article.evidence.id)) continue;
      const summary = articleSummary.get(c.article.evidence.id);
      evidence.push({
        evidenceId: c.article.evidence.id,
        stance,
        quote: c.quote,
        ...(summary && { summary }),
        ...(politician && { role }),
        title: c.article.evidence.title,
        ...(c.article.publisher && { publisher: c.article.publisher }),
        ...(c.article.evidence.sourceUrl && { url: c.article.evidence.sourceUrl }),
        ...(c.article.evidence.publishedAt && { publishedAt: c.article.evidence.publishedAt }),
      });
    }
    // Politicians: whether the claim was MADE is judged on source reports; outcome reports only
    // drive `outcome` (they are not a dispute about the claim itself).
    const sourceEvidence = politician ? evidence.filter((e) => e.role !== 'outcome') : evidence;
    if (!sourceEvidence.length) continue;
    const outcomes = evidence.filter((e) => e.role === 'outcome');
    const outcome: ClaimDto['outcome'] | undefined = politician
      ? outcomes.length
        ? g.outcome && g.outcome !== 'no_update'
          ? g.outcome
          : outcomes.some((e) => e.stance === 'contradicts')
            ? 'not_fulfilled'
            : outcomes.some((e) => e.stance === 'supports')
              ? 'fulfilled'
              : 'in_progress'
        : 'no_update'
      : undefined;
    const id = claimId(g.statement);
    if (claims.some((x) => x.id === id)) continue;
    keyToId.set(g.key, id);
    const dates = sourceEvidence.map((e) => e.publishedAt).filter((d): d is string => Boolean(d && !Number.isNaN(Date.parse(d)))).sort();
    claims.push({ id, statement: g.statement, kind: g.kind, ...decideStatus(sourceEvidence), ...(outcome && { outcome }), ...(dates[0] && { occurredAt: dates[0] }), evidence });
  }
  const out = merged;
  claims.sort((a, b) => (a.occurredAt && b.occurredAt ? a.occurredAt.localeCompare(b.occurredAt) : a.occurredAt ? -1 : b.occurredAt ? 1 : 0));

  // Links: only between surviving claims, oriented earlier -> later, deduplicated.
  const order = new Map(claims.map((c, i) => [c.id, i]));
  const links: ClaimLinkDto[] = [];
  for (const l of out.links) {
    let from = keyToId.get(l.from);
    let to = keyToId.get(l.to);
    if (!from || !to || from === to || !order.has(from) || !order.has(to)) continue;
    if (order.get(from)! > order.get(to)!) [from, to] = [to, from];
    const id = `lnk-${from.slice(4, 10)}-${to.slice(4, 10)}-${l.type}`;
    if (links.some((x) => x.id === id) || !l.description.trim()) continue;
    links.push({ id, from, to, type: l.type, basis: l.basis, description: l.description.trim() });
  }

  const established = claims.filter((c) => c.status === 'established').length;
  return {
    claims,
    links,
    ...(out.entity?.trim() && { entity: out.entity.trim() }),
    stats: { articles: articles.length, fullText, claims: claims.length, established, pending: claims.length - established, quotesVerified: verified, quotesRejected: rejected },
  };
}
