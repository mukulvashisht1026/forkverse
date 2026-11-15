/**
 * Timeline periods: the spine of the timeline view.
 *
 *   spine node  = a period (year / month / day, picked from the span of the claims)
 *   branch node = a claim in that period. Claims that state the same information were already
 *                 merged across outlets by the builder, so a claim with more sources is better
 *                 supported; partial overlaps stay separate claims.
 *
 * Grouping is deterministic. An editor LLM only writes each period's headline + summary from the
 * period's own claims; every summary sentence must cite one of those claims (C1..) or it is dropped,
 * and a failed/empty answer falls back to a summary composed from the claim statements.
 */
import { z } from 'zod';
import { logger } from '../utils/logger.js';
import type { ClaimDto, TimelinePeriodDto, TimelineSourceDto } from '../investigations/types.js';
import { defaultJsonLlm, type JsonLlm } from '../proof/agents.js';
import { claimDate } from './builder.js';

export type Granularity = TimelinePeriodDto['granularity'];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** Summary sentences kept per period (the model is asked for at most 3). */
const MAX_SENTENCES = 3;
/** More spine nodes than this at a fine granularity -> use the next coarser one. */
const MAX_PERIODS = 16;

/** "2010", "2010-06" or "2010-06-12" from a claim (stated date first, then first report). */
export function claimDay(c: Pick<ClaimDto, 'happenedAt' | 'occurredAt'>): string | undefined {
  const d = claimDate(c);
  const m = d?.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
  return m ? [m[1], m[2], m[3]].filter(Boolean).join('-') : undefined;
}

function keyAt(day: string, g: Granularity): string {
  return g === 'year' ? day.slice(0, 4) : g === 'month' ? day.slice(0, 7) : day.slice(0, 10);
}

/** Finest granularity that keeps the timeline readable: year for multi-year stories, then month, then day. */
export function chooseGranularity(claims: readonly Pick<ClaimDto, 'happenedAt' | 'occurredAt'>[]): Exclude<Granularity, 'undated'> {
  const days = claims.map(claimDay).filter((d): d is string => Boolean(d)).sort();
  if (!days.length) return 'year';
  // Span (first to last), not the number of distinct values: 2016 and 2026 are ten years apart.
  const yearSpan = Number(days.at(-1)!.slice(0, 4)) - Number(days[0]!.slice(0, 4));
  if (yearSpan >= 2) return 'year';
  const monthIndex = (d: string) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7) || 1) - 1;
  const monthSpan = monthIndex(days.at(-1)!) - monthIndex(days[0]!);
  if (monthSpan >= MAX_PERIODS) return 'year';
  const dayKeys = new Set(days.filter((d) => d.length >= 10));
  if (monthSpan <= 1 && dayKeys.size > 1 && dayKeys.size <= MAX_PERIODS) return 'day';
  return monthSpan >= 1 || yearSpan >= 1 ? 'month' : 'day';
}

export function periodLabel(key: string, now = new Date()): string {
  if (isLiveKey(key)) return `Live · ${periodLabel(baseKey(key))}`;
  if (key === SNAPSHOT_KEY) return `Now · ${periodLabel(now.toISOString().slice(0, 10))}`;
  const [y, m, d] = key.split('-');
  if (!y) return 'Undated';
  if (!m) return y;
  const mi = Number(m) - 1;
  return d ? `${Number(d)} ${MONTHS[mi]} ${y}` : `${MONTHS_LONG[mi]} ${y}`;
}

function granularityOf(rawKey: string): Granularity {
  const key = baseKey(rawKey);
  if (key === SNAPSHOT_KEY) return 'day';
  return key === 'undated' ? 'undated' : key.length === 4 ? 'year' : key.length === 7 ? 'month' : 'day';
}

export interface PeriodGroup {
  key: string;
  claims: ClaimDto[];
}

/**
 * Bucket claims into periods, chronologically; undated claims go last. A claim whose date is
 * coarser than the chosen granularity (only "2010" in a monthly timeline) gets its own coarser
 * period, placed before that year's months.
 */
export function groupClaims(claims: readonly ClaimDto[], liveIds: ReadonlySet<string> = new Set(), scope: 'timeline' | 'snapshot' = 'timeline'): PeriodGroup[] {
  const g = chooseGranularity(claims.filter((c) => !liveDay(c, liveIds)));
  const map = new Map<string, ClaimDto[]>();
  for (const c of claims) {
    const day = claimDay(c);
    const live = liveDay(c, liveIds);
    // Snapshot (point-in-time question, e.g. today's weather): one spine node for everything;
    // live updates still get their own node, since they are new readings.
    const key = live ? `${live}${LIVE_SUFFIX}` : scope === 'snapshot' ? SNAPSHOT_KEY : day ? keyAt(day, day.length < keyLength(g) ? (day.length === 4 ? 'year' : 'month') : g) : 'undated';
    (map.get(key) ?? map.set(key, []).get(key)!).push(c);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a === 'undated' ? 1 : b === 'undated' ? -1 : a === SNAPSHOT_KEY ? -1 : b === SNAPSHOT_KEY ? 1 : a.localeCompare(b)))
    .map(([key, list]) => ({ key, claims: list }));
}

/**
 * Evidence added by live tracking: in-place page changes have `mon-` ids (monitors/ingest.ts);
 * new articles from feeds/sitemaps keep article ids, so callers pass the ids stored under
 * live-update events (`evt-mon-…`, see liveEvidenceIds).
 */
const isLiveEvidence = (evidenceId: string, liveIds: ReadonlySet<string>) => evidenceId.startsWith('mon-') || liveIds.has(evidenceId);

/** Ids of evidence stored under live-update events (created by MonitorService.ingest). */
export function liveEvidenceIds(events: readonly { id: string; evidence: readonly { id: string }[] }[]): Set<string> {
  return new Set(events.filter((e) => e.id.startsWith('evt-mon-')).flatMap((e) => e.evidence.map((x) => x.id)));
}
const LIVE_SUFFIX = '~live';

/**
 * Day of the live update a claim came from, or undefined. A claim is "live" when a monitor change
 * is its first report (no stated or reported date before the change), so live updates get their
 * own "Live · <day>" spine node; a live source that only re-confirms an older fact does not.
 */
export function liveDay(c: Pick<ClaimDto, 'evidence' | 'happenedAt' | 'occurredAt'>, liveIds: ReadonlySet<string> = new Set()): string | undefined {
  const liveDays = c.evidence.filter((e) => isLiveEvidence(e.evidenceId, liveIds) && e.publishedAt).map((e) => e.publishedAt!.slice(0, 10)).sort();
  const first = liveDays[0];
  if (!first) return undefined;
  const day = claimDay(c);
  return !day || day >= first.slice(0, day.length) ? first : undefined;
}

const baseKey = (key: string) => key.replace(LIVE_SUFFIX, '');
/** Single group of a snapshot investigation (sorted first; live days after it, undated last). */
const SNAPSHOT_KEY = 'snapshot';
export const isLiveKey = (key: string) => key.endsWith(LIVE_SUFFIX);

function keyLength(g: Granularity): number {
  return g === 'year' ? 4 : g === 'month' ? 7 : 10;
}

export function periodSources(claims: readonly ClaimDto[]): TimelineSourceDto[] {
  const seen = new Set<string>();
  const out: TimelineSourceDto[] = [];
  for (const c of claims) {
    for (const e of c.evidence) {
      const id = e.url ?? e.evidenceId;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ title: e.title, ...(e.url && { url: e.url }), ...(e.publisher && { publisher: e.publisher }), ...(e.publishedAt && { publishedAt: e.publishedAt }) });
    }
  }
  return out;
}

/** Best-supported claim first: established, then more independent sources, then earlier. */
function strongest(claims: readonly ClaimDto[]): ClaimDto {
  return [...claims].sort((a, b) => Number(b.status === 'established') - Number(a.status === 'established') || b.evidence.length - a.evidence.length)[0]!;
}

function fallbackText(claims: readonly ClaimDto[]): { headline: string; summary: string } {
  const lead = strongest(claims);
  const established = claims.filter((c) => c.status === 'established');
  const pending = claims.filter((c) => c.status !== 'established');
  const parts = [
    ...established.slice(0, 3).map((c) => c.statement.replace(/\.?$/, '.')),
    ...(pending.length ? [`Unverified so far: ${pending.slice(0, 2).map((c) => c.statement.replace(/\.$/, '')).join('; ')}.`] : []),
  ];
  return { headline: lead.statement.replace(/\.$/, ''), summary: parts.join(' ') };
}

const Sentence = z.union([
  z.object({ text: z.string(), claims: z.array(z.string()).catch([]) }),
  // Tolerate "text [C1][C2]" strings.
  z.string().transform((s) => ({ text: s.replace(/\s*\[(C\d+)\]/g, '').trim(), claims: [...s.matchAll(/\[(C\d+)\]/g)].map((m) => m[1]!) })),
]);
export const PeriodsOutput = z.object({
  periods: z
    .array(z.object({ key: z.string(), headline: z.string().catch(''), summary: z.array(Sentence).catch([]) }))
    .catch([]),
});

export const PERIODS_PROMPT = `You write the period summaries of a news timeline. Each period (P1, P2, ...) lists its claims (C1, C2, ...), already verified against sources, with their status and number of independent sources.

For EVERY period write:
- "headline": max 12 words, neutral. Base it on the period's BEST-SUPPORTED claim (established first, then the most sources), not on a single-source item.
- "summary": AT MOST 3 sentences that synthesise the period (combine related claims into one sentence; leave minor ones out - they stay visible as branches). Each sentence is {"text":"...","claims":["C3","C4"]} and must cite the claims OF THAT PERIOD it uses; only state what those claims say. Lead with the best-supported claims.

Rules:
- Unverified claims (one source so far) must be hedged: "reportedly", "according to one outlet". Established claims can be stated plainly.
- Neutral wording. Never assert causation, intent or motive ("followed", not "caused"). No opinions, no adjectives of praise or blame.
- If claims disagree, say so; do not resolve the conflict.
- Do not add facts, names, numbers or dates that are not in the claims.

Return JSON {"periods":[{"key":"P1","headline":"...","summary":[{"text":"...","claims":["C1","C2"]}]}]}. JSON only.`;

function listing(groups: readonly PeriodGroup[]): { text: string; labels: Map<string, { period: number; claimId: string }> } {
  const labels = new Map<string, { period: number; claimId: string }>();
  let n = 0;
  const lines: string[] = [];
  groups.forEach((g, i) => {
    lines.push(`P${i + 1} | ${periodLabel(g.key)}`);
    for (const c of g.claims) {
      const label = `C${++n}`;
      labels.set(label, { period: i, claimId: c.id });
      const outlets = new Set(c.evidence.map((e) => e.publisher ?? e.url ?? e.evidenceId)).size;
      lines.push(`  ${label} | ${c.status === 'established' ? 'established' : 'unverified'}${c.disputed ? ', disputed' : ''} | ${outlets} source${outlets === 1 ? '' : 's'} | ${c.statement}`);
    }
  });
  return { text: lines.join('\n'), labels };
}

/** Build the timeline periods for a set of claims (one LLM call; deterministic fallback). */
export async function buildPeriods(
  claims: readonly ClaimDto[],
  deps: { topic: string; json?: JsonLlm; /** Evidence ids added by live tracking (liveEvidenceIds). */ liveEvidenceIds?: ReadonlySet<string>; /** From the planner: snapshot = one spine node. */ scope?: 'timeline' | 'snapshot' },
): Promise<TimelinePeriodDto[]> {
  if (!claims.length) return [];
  const groups = groupClaims(claims, deps.liveEvidenceIds, deps.scope);
  const { text, labels } = listing(groups);
  const json = deps.json ?? defaultJsonLlm;
  let written: z.infer<typeof PeriodsOutput>['periods'] = [];
  try {
    written = PeriodsOutput.parse(await json(PeriodsOutput, [
      { role: 'system', content: PERIODS_PROMPT },
      { role: 'user', content: `Topic: ${deps.topic}\n\n${text}` },
    ])).periods;
  } catch (err) {
    logger.warn({ err }, 'timeline period writer failed; using claim statements');
  }

  return groups.map((g, i): TimelinePeriodDto => {
    const out = written.find((p) => p.key.trim().toUpperCase() === `P${i + 1}`);
    // Keep only sentences citing a claim of THIS period.
    const sentences = (out?.summary ?? [])
      .filter((s) => s.text.trim() && s.claims.some((l) => labels.get(l.trim().toUpperCase())?.period === i))
      .map((s) => s.text.trim().replace(/([^.!?])$/, '$1.'))
      .slice(0, MAX_SENTENCES);
    const fb = fallbackText(g.claims);
    const llm = Boolean(out?.headline.trim() && sentences.length);
    const k = g.key === SNAPSHOT_KEY ? new Date().toISOString().slice(0, 10) : baseKey(g.key);
    const day = k === 'undated' ? undefined : k.length === 4 ? `${k}-01-01` : k.length === 7 ? `${k}-01` : k;
    return {
      id: `period-${baseKey(g.key)}${isLiveKey(g.key) ? '-live' : ''}`,
      ...(isLiveKey(g.key) && { live: true }),
      label: periodLabel(g.key === 'undated' ? '' : g.key),
      granularity: granularityOf(g.key),
      ...(day && { start: day }),
      headline: llm ? out!.headline.trim().replace(/\.$/, '') : fb.headline,
      summary: llm ? sentences.join(' ') : fb.summary,
      claimIds: g.claims.map((c) => c.id),
      sources: periodSources(g.claims),
      established: g.claims.filter((c) => c.status === 'established').length,
      unverified: g.claims.filter((c) => c.status !== 'established').length,
      writer: llm ? 'llm' : 'fallback',
    };
  });
}
