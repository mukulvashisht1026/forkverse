import type { BranchNode, ClaimSourceRef, GroupedBranchSource, SpineNode } from '../types/tree';
import type { ClaimDto, InvestigationEventDto, InvestigationEvidenceDto, SourceVettingDto, TimelinePeriodDto } from '../../../contracts/investigations';

function stableSeed(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return hash >>> 0;
}

function evidenceToBranch(evidence: InvestigationEvidenceDto): BranchNode {
  let sourceDomain: string | undefined;
  try { sourceDomain = evidence.sourceUrl ? new URL(evidence.sourceUrl).hostname.replace(/^www\./i, '') : undefined; } catch { /* Preserve the URL without inventing a domain. */ }
  return {
    id: evidence.id,
    name: evidence.title,
    info: evidence.excerpt ?? '',
    sourceType: 'news',
    sourceTypeIsInferred: true,
    ...(sourceDomain ? { sourceDomain } : {}),
    ...(evidence.sourceName ? { sourceName: evidence.sourceName } : {}),
    ...(evidence.sourceUrl ? { sourceUrl: evidence.sourceUrl } : {}),
    ...(evidence.publishedAt ? { publishedAt: evidence.publishedAt } : {}),
    ...(evidence.relationship ? { impactAngle: evidence.relationship } : {}),
    ...(evidence.vetting ? { vetting: evidence.vetting } : {}),
    seed: stableSeed(evidence.id),
  };
}

/** Converts agreed transport DTO to existing Canvas model; does not alter graph renderer. */
export function investigationEventsToSpineNodes(events: InvestigationEventDto[]): SpineNode[] {
  return events.map((event) => ({
    id: event.id,
    name: event.title,
    declaration: event.title,
    info: event.summary ?? '',
    platform: 'Investigation',
    ...(event.occurredAt ? { timestamp: event.occurredAt } : {}),
    stockImpact: { summary: '', tickers: [] },
    publicAppeal: { sentimentLabel: '', positivePct: 0, neutralPct: 0, negativePct: 0, narrative: '' },
    scrapeEngine: 'manual',
    branches: event.evidence.map(evidenceToBranch),
  }));
}

const KIND_LABEL: Record<ClaimDto['kind'], string> = { statement: 'Statement', position: 'Position', development: 'Development' };

/**
 * Claim view: each claim becomes a timeline node (chronological), its evidence becomes branches
 * that keep their stance (supports / contradicts / context), quote and source link.
 * Pending claims keep status 'pending' so the canvas puts them on the separate unverified lane.
 */
const OUTCOME_LABEL: Record<NonNullable<ClaimDto['outcome']>, string> = {
  fulfilled: 'Fulfilled', not_fulfilled: 'Not fulfilled', in_progress: 'In progress', no_update: 'No follow-up reported yet',
};

export function evidenceLabel(e: ClaimDto['evidence'][number], politician: boolean): string {
  if (politician && e.role !== 'outcome') return e.stance === 'contradicts' ? 'Disputes the claim was made' : 'Reports the claim';
  if (politician) return e.stance === 'supports' ? 'Fulfilled' : e.stance === 'contradicts' ? 'Not fulfilled' : 'In progress';
  return e.stance === 'supports' ? 'Supports' : e.stance === 'contradicts' ? 'Contradicts' : 'Context';
}

/** Vetting per evidence id, from the investigation's events (claim evidence only carries the id). */
export function vettingByEvidence(events: InvestigationEventDto[]): Map<string, SourceVettingDto> {
  const map = new Map<string, SourceVettingDto>();
  for (const e of events) for (const ev of e.evidence) if (ev.vetting) map.set(ev.id, ev.vetting);
  return map;
}

export function claimsToSpineNodes(claims: ClaimDto[], mode: 'news' | 'politician' = 'news', vetting: ReadonlyMap<string, SourceVettingDto> = new Map()): SpineNode[] {
  const politician = mode === 'politician';
  return claims.map((claim) => ({
    id: claim.id,
    name: claim.statement,
    declaration: claim.statement,
    info: `${politician && claim.outcome ? `Outcome: ${OUTCOME_LABEL[claim.outcome]}. ` : ''}${claim.status === 'established' ? 'Established' : 'Unverified (pending)'} ${KIND_LABEL[claim.kind].toLowerCase()}${claim.disputed ? ' · disputed' : ''}. ${claim.statusReason}`,
    platform: 'Claim',
    ...(claim.occurredAt ? { timestamp: claim.occurredAt } : {}),
    stockImpact: { summary: '', tickers: [] },
    publicAppeal: { sentimentLabel: '', positivePct: 0, neutralPct: 0, negativePct: 0, narrative: '' },
    scrapeEngine: 'manual',
    claimStatus: claim.status,
    disputed: claim.disputed,
    ...(politician && claim.outcome ? { outcome: claim.outcome } : {}),
    // Every article that proves the claim grows as a child branch. Politician view: articles that
    // report the claim itself are neutral; later outcome reports are coloured fulfilled / not / in progress.
    branches: claim.evidence.map((e): BranchNode => ({
      id: e.evidenceId,
      name: e.title,
      info: `${evidenceLabel(e, politician)}: ${e.summary ? `${e.summary} ` : ''}“${e.quote}”`,
      relation: evidenceLabel(e, politician),
      ...(politician && e.role === 'outcome' ? { outcomeReport: true } : {}),
      ...(politician && e.role !== 'outcome' ? { sourceReport: true } : {}),
      sourceType: 'news' as const,
      ...(e.publisher ? { sourceDomain: e.publisher } : {}),
      ...(e.url ? { sourceUrl: e.url } : {}),
      ...(e.publishedAt ? { publishedAt: e.publishedAt } : {}),
      impactAngle: e.stance,
      stance: e.stance,
      ...(vetting.get(e.evidenceId) ? { vetting: vetting.get(e.evidenceId)! } : {}),
      seed: stableSeed(`${claim.id}:${e.evidenceId}`),
    })).concat((claim.prunedEvidence ?? []).map((e): BranchNode => ({
      // Screened as manipulative: drawn red-flagged and faded, never counted for the claim's status.
      id: e.evidenceId,
      name: e.title,
      info: `Pruned (manipulative source), not counted: “${e.quote}”`,
      relation: 'Pruned · red flag',
      sourceType: 'news' as const,
      ...(e.publisher ? { sourceDomain: e.publisher } : {}),
      ...(e.url ? { sourceUrl: e.url } : {}),
      ...(e.publishedAt ? { publishedAt: e.publishedAt } : {}),
      impactAngle: 'pruned',
      stance: 'context' as const,
      vetting: vetting.get(e.evidenceId) ?? { url: e.url ?? '', verdict: 'manipulative' as const, coverage: 0, reasons: ['Screened as manipulative.'], depth: 'content' as const, checkedAt: '' },
      seed: stableSeed(`${claim.id}:pruned:${e.evidenceId}`),
    }))),
  }));
}

/**
 * Research runs keeps event nodes on the timeline, but groups its source branches by the
 * claim/insight they support. Evidence with no extracted claim stays visible as an article.
 */
export function groupResearchRunInsights(events: SpineNode[], claims: SpineNode[]): SpineNode[] {
  if (!claims.length) return events;
  return events.map((event) => {
    if (!event.branches.length) return event;
    const evidenceById = new Map(event.branches.map((source) => [source.id, source]));
    const grouped: BranchNode[] = [];
    const assigned = new Set<string>();

    for (const claim of claims) {
      const matched = claim.branches
        .map((source) => evidenceById.get(source.id))
        .filter((source): source is BranchNode => Boolean(source));
      if (!matched.length) continue;

      const sources: GroupedBranchSource[] = matched.map((source) => ({
        id: source.id,
        name: source.name,
        info: source.info,
        ...(source.sourceDomain && { sourceDomain: source.sourceDomain }),
        ...(source.sourceName && { sourceName: source.sourceName }),
        ...(source.sourceUrl && { sourceUrl: source.sourceUrl }),
        ...(source.publishedAt && { publishedAt: source.publishedAt }),
      }));
      matched.forEach((source) => assigned.add(source.id));
      const dates = matched.map((source) => source.publishedAt).filter((date): date is string => Boolean(date)).sort();
      grouped.push({
        id: `insight:${event.id}:${claim.id}`,
        name: claim.name,
        info: claim.info,
        sourceType: 'news',
        sourceTypeIsInferred: true,
        ...(dates[0] && { publishedAt: dates[0] }),
        relation: `${sources.length} source${sources.length === 1 ? '' : 's'}`,
        groupedSources: sources,
        seed: stableSeed(`${event.id}:${claim.id}`),
      });
    }

    const ungrouped = event.branches.filter((source) => !assigned.has(source.id));
    return grouped.length ? { ...event, branches: [...grouped, ...ungrouped] } : event;
  });
}

// ---- Timeline view: spine = period, branch = claim ------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function claimDay(c: ClaimDto): string | undefined {
  const m = (c.happenedAt ?? c.occurredAt)?.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
  return m ? [m[1], m[2], m[3]].filter(Boolean).join('-') : undefined;
}

const LIVE_SUFFIX = '~live';
const SNAPSHOT_SUFFIX = '~now';

/** Same rule as backend claims/periods.ts liveDay: a monitor change is the claim's first report. */
function liveDay(c: ClaimDto, liveIds: ReadonlySet<string>): string | undefined {
  const first = c.evidence.filter((e) => (e.evidenceId.startsWith('mon-') || liveIds.has(e.evidenceId)) && e.publishedAt).map((e) => e.publishedAt!.slice(0, 10)).sort()[0];
  if (!first) return undefined;
  const day = claimDay(c);
  return !day || day >= first.slice(0, day.length) ? first : undefined;
}

function labelOf(key: string): string {
  const [y, m, d] = key.split('-');
  if (!y || key === 'undated') return 'Undated';
  if (!m) return y;
  return d ? `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}` : `${MONTHS_LONG[Number(m) - 1]} ${y}`;
}

function sourcesOf(claims: ClaimDto[]): ClaimSourceRef[] {
  const seen = new Set<string>();
  return claims.flatMap((c) => c.evidence).filter((e) => {
    const k = e.url ?? e.evidenceId;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).map((e) => ({ title: e.title, ...(e.url && { url: e.url }), ...(e.publisher && { publisher: e.publisher }), ...(e.publishedAt && { publishedAt: e.publishedAt }) }));
}

/**
 * Periods for graphs built before the backend wrote them: same bucketing as backend
 * claims/periods.ts (year / month / day by span), summary composed from the claim statements.
 */
/** Evidence stored under live-update events (`evt-mon-…`), same as backend liveEvidenceIds. */
export function liveEvidenceIds(events: readonly InvestigationEventDto[]): Set<string> {
  return new Set(events.filter((e) => e.id.startsWith('evt-mon-')).flatMap((e) => e.evidence.map((x) => x.id)));
}

export function fallbackPeriods(claims: ClaimDto[], liveIds: ReadonlySet<string> = new Set(), scope: 'timeline' | 'snapshot' = 'timeline'): TimelinePeriodDto[] {
  const today = new Date().toISOString().slice(0, 10);
  const days = claims.filter((c) => !liveDay(c, liveIds)).map(claimDay).filter((d): d is string => Boolean(d)).sort();
  const month = (d: string) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7) || 1) - 1;
  const yearSpan = days.length ? Number(days.at(-1)!.slice(0, 4)) - Number(days[0]!.slice(0, 4)) : 0;
  const monthSpan = days.length ? month(days.at(-1)!) - month(days[0]!) : 0;
  const len = yearSpan >= 2 || monthSpan >= 16 ? 4 : monthSpan >= 1 ? 7 : 10;
  const groups = new Map<string, ClaimDto[]>();
  for (const c of claims) {
    const d = claimDay(c);
    const live = liveDay(c, liveIds);
    // Snapshot (point-in-time question): one spine node; live updates keep their own.
    const key = live ? `${live}${LIVE_SUFFIX}` : scope === 'snapshot' ? `${today}${SNAPSHOT_SUFFIX}` : d ? d.slice(0, Math.min(len, d.length)) : 'undated';
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(c);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === 'undated' ? 1 : b === 'undated' ? -1 : a.endsWith(SNAPSHOT_SUFFIX) ? -1 : b.endsWith(SNAPSHOT_SUFFIX) ? 1 : a.localeCompare(b)))
    .map(([rawKey, list]) => {
      const live = rawKey.endsWith(LIVE_SUFFIX);
      const snapshot = rawKey.endsWith(SNAPSHOT_SUFFIX);
      const key = rawKey.replace(LIVE_SUFFIX, '').replace(SNAPSHOT_SUFFIX, '');
      const lead = [...list].sort((a, b) => Number(b.status === 'established') - Number(a.status === 'established') || b.evidence.length - a.evidence.length)[0]!;
      const est = list.filter((c) => c.status === 'established');
      const pend = list.filter((c) => c.status !== 'established');
      return {
        id: snapshot ? 'period-snapshot' : `period-${key}${live ? '-live' : ''}`,
        label: live ? `Live · ${labelOf(key)}` : snapshot ? `Now · ${labelOf(key)}` : labelOf(key),
        ...(live && { live: true }),
        granularity: key === 'undated' ? 'undated' : key.length === 4 ? 'year' : key.length === 7 ? 'month' : 'day',
        ...(key !== 'undated' && { start: key.length === 4 ? `${key}-01-01` : key.length === 7 ? `${key}-01` : key }),
        headline: lead.statement.replace(/\.$/, ''),
        summary: [...est.slice(0, 3).map((c) => c.statement.replace(/\.?$/, '.')), ...(pend.length ? [`Unverified so far: ${pend.slice(0, 2).map((c) => c.statement.replace(/\.$/, '')).join('; ')}.`] : [])].join(' '),
        claimIds: list.map((c) => c.id),
        sources: sourcesOf(list),
        established: est.length,
        unverified: pend.length,
        writer: 'fallback' as const,
      };
    });
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** A claim as a branch: merged articles stating the same information are its sources (more = stronger). */
export function claimToBranch(claim: ClaimDto, vetting: ReadonlyMap<string, SourceVettingDto> = new Map()): BranchNode {
  const outlets = new Set(claim.evidence.map((e) => e.publisher ?? e.url ?? e.evidenceId)).size;
  const pruned = claim.prunedEvidence ?? [];
  const scores = pruned.map((e) => vetting.get(e.evidenceId)?.propagandaScore).filter((n): n is number => n !== undefined);
  const first = claim.evidence[0];
  return {
    id: claim.id,
    name: claim.statement,
    info: claim.statusReason,
    relation: `${claim.status === 'established' ? 'Established' : 'Unverified'} · ${plural(outlets, 'source')}${claim.disputed ? ' · disputed' : ''}`,
    sourceType: 'news',
    ...(outlets === 1 && first?.publisher ? { sourceDomain: first.publisher } : {}),
    ...(claim.happenedAt || claim.occurredAt ? { publishedAt: claim.happenedAt ?? claim.occurredAt } : {}),
    stance: claim.disputed ? 'contradicts' : claim.status === 'established' ? 'supports' : 'context',
    claimStatus: claim.status,
    claimReason: claim.statusReason,
    claimEvidenceIds: claim.evidence.map((e) => e.evidenceId),
    claimSources: claim.evidence.map((e) => ({ title: e.title, ...(e.url && { url: e.url }), ...(e.publisher && { publisher: e.publisher }), ...(e.publishedAt && { publishedAt: e.publishedAt }), quote: e.quote, stance: e.stance })),
    ...(pruned.length ? { redFlag: { ...(scores.length && { score: Math.max(...scores) }), lines: [`⚑ ${plural(pruned.length, 'red-flagged source')} also reported this (not counted)`, ...pruned.slice(0, 3).map((e) => e.publisher ?? e.title)] } } : {}),
    seed: stableSeed(`claim:${claim.id}`),
  };
}

/** Timeline view: each period is a spine node (headline + summary + sources), its claims are branches. */
export function periodsToSpineNodes(periods: TimelinePeriodDto[], claims: ClaimDto[], vetting: ReadonlyMap<string, SourceVettingDto> = new Map()): SpineNode[] {
  const byId = new Map(claims.map((c) => [c.id, c]));
  return periods.map((p) => {
    const list = p.claimIds.map((id) => byId.get(id)).filter((c): c is ClaimDto => Boolean(c));
    return {
      id: p.id,
      name: `${p.label} · ${p.headline}`,
      declaration: p.headline,
      info: p.summary,
      platform: 'Timeline',
      ...(p.start ? { timestamp: p.start } : {}),
      stockImpact: { summary: '', tickers: [] },
      publicAppeal: { sentimentLabel: '', positivePct: 0, neutralPct: 0, negativePct: 0, narrative: '' },
      scrapeEngine: 'manual' as const,
      period: { label: p.label, headline: p.headline, sources: p.sources, established: p.established, unverified: p.unverified, ...(p.live && { live: true }) },
      branches: list.map((c) => claimToBranch(c, vetting)),
    };
  });
}
