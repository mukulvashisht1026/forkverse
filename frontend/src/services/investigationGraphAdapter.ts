import type { BranchNode, SpineNode } from '../types/tree';
import type { InvestigationEventDto, InvestigationEvidenceDto } from '../../../contracts/investigations';

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
