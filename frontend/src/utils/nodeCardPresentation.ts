import type { BranchNode, SpineNode } from '../types/tree';

export interface NodeCardPresentation {
  sourceType?: string;
  sourceName?: string;
  sourceDomain?: string;
  sourceUrl?: string;
  publishedAt?: string;
  relationship?: string;
  description?: string;
}

export function hasCardSourceMetadata(presentation: NodeCardPresentation): boolean {
  return Boolean(presentation.sourceType || presentation.sourceName || presentation.sourceDomain);
}

function hostname(url?: string): string | undefined {
  if (!url) return undefined;
  try { return new URL(url).hostname.replace(/^www\./i, ''); } catch { return undefined; }
}

export function getNodeCardPresentation(node: SpineNode | BranchNode, isBranch: boolean): NodeCardPresentation {
  if (isBranch) {
    const evidence = node as BranchNode;
    return {
      ...(evidence.sourceTypeIsInferred ? {} : { sourceType: evidence.sourceType }),
      ...(evidence.sourceName ? { sourceName: evidence.sourceName } : {}),
      ...(evidence.sourceDomain || hostname(evidence.sourceUrl) ? { sourceDomain: evidence.sourceDomain ?? hostname(evidence.sourceUrl) } : {}),
      ...(evidence.sourceUrl ? { sourceUrl: evidence.sourceUrl } : {}),
      ...(evidence.publishedAt ? { publishedAt: evidence.publishedAt } : {}),
      ...(evidence.impactAngle ? { relationship: evidence.impactAngle } : {}),
      ...(evidence.info ? { description: evidence.info } : {}),
    };
  }
  const event = node as SpineNode;
  const sourceTypes: Partial<Record<SpineNode['scrapeEngine'], string>> = {
    exa: 'Exa AI Search', 'context.dev': 'Context.dev live', 'gemini-search': 'Live search grounding',
  };
  return {
    ...(sourceTypes[event.scrapeEngine] ? { sourceType: sourceTypes[event.scrapeEngine] } : {}),
    ...(hostname(event.sourceUrl) ? { sourceDomain: hostname(event.sourceUrl) } : {}),
    ...(event.sourceUrl ? { sourceUrl: event.sourceUrl } : {}),
    ...(event.timestamp && event.timestamp !== 'Live update' && event.timestamp !== 'Live scrape' ? { publishedAt: event.timestamp } : {}),
    ...(event.info ? { description: event.info } : {}),
  };
}

export function formatCardDate(value?: string): string | undefined {
  if (!value || value === 'Live update' || value === 'Live scrape') return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toLocaleDateString();
}
