import type { BranchNode, GroupedBranchSource, SpineNode } from '../types/tree';
import type { ClaimDto, InvestigationEventDto, InvestigationEvidenceDto } from '../../../contracts/investigations';

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

export function claimsToSpineNodes(claims: ClaimDto[], mode: 'news' | 'politician' = 'news'): SpineNode[] {
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
    branches: claim.evidence.map((e) => ({
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
      seed: stableSeed(`${claim.id}:${e.evidenceId}`),
    })),
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
