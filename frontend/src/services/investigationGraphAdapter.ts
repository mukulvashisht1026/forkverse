import type { BranchNode, SpineNode } from '../types/tree';
import type { ClaimDto, InvestigationEventDto, InvestigationEvidenceDto } from '../../../contracts/investigations';

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
export function claimsToSpineNodes(claims: ClaimDto[]): SpineNode[] {
  return claims.map((claim) => ({
    id: claim.id,
    name: claim.statement,
    declaration: claim.statement,
    info: `${claim.status === 'established' ? 'Established' : 'Unverified (pending)'} ${KIND_LABEL[claim.kind].toLowerCase()}${claim.disputed ? ' · disputed' : ''}. ${claim.statusReason}`,
    platform: 'Claim',
    ...(claim.occurredAt ? { timestamp: claim.occurredAt } : {}),
    stockImpact: { summary: '', tickers: [] },
    publicAppeal: { sentimentLabel: '', positivePct: 0, neutralPct: 0, negativePct: 0, narrative: '' },
    scrapeEngine: 'manual',
    claimStatus: claim.status,
    disputed: claim.disputed,
    branches: claim.evidence.map((e) => ({
      id: e.evidenceId,
      name: e.title,
      info: `${e.stance === 'supports' ? 'Supports' : e.stance === 'contradicts' ? 'Contradicts' : 'Context'}: “${e.quote}”`,
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
