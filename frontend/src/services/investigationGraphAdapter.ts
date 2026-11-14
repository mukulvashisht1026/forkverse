import type { BranchNode, SpineNode } from '../types/tree';
import type { ClaimDto, InvestigationEventDto, InvestigationEvidenceDto, SourceVettingDto } from '../../../contracts/investigations';

function stableSeed(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return hash >>> 0;
}

function evidenceToBranch(evidence: InvestigationEvidenceDto): BranchNode {
  return {
    id: evidence.id,
    name: evidence.title,
    info: evidence.excerpt ?? '',
    sourceType: 'news',
    ...(evidence.sourceName ? { sourceDomain: evidence.sourceName } : {}),
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
