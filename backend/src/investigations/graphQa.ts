/**
 * Graph-first Q&A: the graph is the answer, the chat is a pointer.
 *
 * The question is checked against what is CURRENTLY in the investigation graph (claims with their
 * status + the articles). The model returns JSON naming the claims/articles that answer it and a
 * one-or-two sentence pointer. The backend turns the labels into node/evidence ids for the
 * frontend to highlight; if nothing in the graph answers it, the chat just says so.
 */
import { z } from 'zod';
import type { InvestigationEvidenceDto, InvestigationEventDto, InvestigationRecord } from './types.js';

export const GRAPH_QA_PROMPT = `You are the navigator for an evidence graph shown on screen next to this chat.
The user's question must be answered by POINTING at items in the graph, not by writing an essay.

You get the graph listing: claims (C1, C2, ...) with their status, and articles (E1, E2, ...) with publisher, date and an excerpt or quote.
Decide whether the graph already contains information that answers the question.

Return JSON only:
{"found": true|false, "answer": "<at most 2 short sentences>", "claims": ["C2"], "evidence": ["E5","E9"]}

Rules:
- Use ONLY the listing. Never add outside knowledge.
- found=true only if listed items directly answer the question; then name the most relevant claims and/or articles (at most 6 in total) - these get highlighted.
- answer: a brief pointer such as "Yes - the fine levels are shown in the highlighted claim; three outlets report it." Mention if a highlighted claim is UNVERIFIED or disputed. No lists, no citations, no headings.
- found=false: answer one sentence saying the graph does not cover it yet; claims and evidence empty.
- Be neutral: no intent, no causal claims the items do not state.`;

export const GraphAnswer = z.object({
  found: z.boolean().catch(false),
  answer: z.string().default(''),
  claims: z.array(z.string()).default([]),
  evidence: z.array(z.string()).default([]),
});

export interface GraphListing {
  text: string;
  hasContent: boolean;
  claimByLabel: Map<string, { id: string; evidenceIds: string[] }>;
  evidenceByLabel: Map<string, { evidence: InvestigationEvidenceDto; event: InvestigationEventDto }>;
}

const MAX_LISTED_EVIDENCE = 120;
const clip = (s: string | undefined, n: number) => (s ? (s.length > n ? `${s.slice(0, n - 1)}…` : s) : '');

/** Compact, labelled listing of the graph as it is now (claims first, then articles). */
export function buildGraphListing(record: InvestigationRecord): GraphListing {
  const evidenceByLabel = new Map<string, { evidence: InvestigationEvidenceDto; event: InvestigationEventDto }>();
  const labelOf = new Map<string, string>();
  for (const event of record.events) {
    for (const evidence of event.evidence) {
      if (labelOf.has(evidence.id) || evidenceByLabel.size >= MAX_LISTED_EVIDENCE) continue;
      const label = `E${evidenceByLabel.size + 1}`;
      labelOf.set(evidence.id, label);
      evidenceByLabel.set(label, { evidence, event });
    }
  }

  const claimByLabel = new Map<string, { id: string; evidenceIds: string[] }>();
  const claimLines = (record.claims ?? []).map((c, i) => {
    const label = `C${i + 1}`;
    claimByLabel.set(label, { id: c.id, evidenceIds: c.evidence.map((e) => e.evidenceId) });
    const refs = c.evidence.map((e) => `${labelOf.get(e.evidenceId) ?? '?'}(${e.stance})`).join(', ');
    return `${label} [${c.status.toUpperCase()}${c.disputed ? ', DISPUTED' : ''}${c.occurredAt ? `, first reported ${c.occurredAt.slice(0, 10)}` : ''}] ${c.statement} | evidence: ${refs}`;
  });

  const articleLines = [...evidenceByLabel].map(
    ([label, { evidence, event }]) =>
      `${label} | ${evidence.sourceName ?? 'unknown'} | ${evidence.publishedAt?.slice(0, 10) ?? 'undated'} | ${clip(evidence.title, 140)}${evidence.excerpt ? ` - ${clip(evidence.excerpt, 220)}` : ''} | run: ${clip(event.title, 60)}`,
  );

  const text = [
    `Investigation: ${record.title}${record.entity ? ` (entity: ${record.entity})` : ''}`,
    claimLines.length ? `Claims:\n${claimLines.join('\n')}` : 'Claims: none built yet.',
    `Articles:\n${articleLines.join('\n') || 'none'}`,
  ].join('\n\n');

  return { text, hasContent: evidenceByLabel.size > 0, claimByLabel, evidenceByLabel };
}

export interface ResolvedAnswer {
  found: boolean;
  answer: string;
  claimIds: string[];
  evidence: { evidence: InvestigationEvidenceDto; event: InvestigationEventDto }[];
}

/** Map model labels back to graph ids; unknown labels are ignored. */
export function resolveAnswer(out: z.infer<typeof GraphAnswer>, listing: GraphListing): ResolvedAnswer {
  const claimIds = [...new Set(out.claims.map((l) => listing.claimByLabel.get(l.trim())?.id).filter((x): x is string => Boolean(x)))];
  const evidenceIds = new Set(out.evidence.map((l) => listing.evidenceByLabel.get(l.trim())?.evidence.id).filter(Boolean));
  // A highlighted claim also lights up its own evidence.
  for (const l of out.claims) for (const id of listing.claimByLabel.get(l.trim())?.evidenceIds ?? []) evidenceIds.add(id);
  const evidence = [...listing.evidenceByLabel.values()].filter((e) => evidenceIds.has(e.evidence.id));
  const found = out.found && (claimIds.length > 0 || evidence.length > 0);
  return { found, answer: out.answer.trim(), claimIds, evidence };
}
