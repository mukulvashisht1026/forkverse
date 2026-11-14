/**
 * Proof engine: two agents verify one graph event's coverage from opposite perspectives,
 * then a synthesis combines them.
 *
 *   select (one article per outlet) -> scrape full text (Context.dev)
 *   -> Corroborator || Skeptic (parallel, JSON)
 *   -> verify every quote verbatim against its article; consensus needs >= 2 outlets
 *   -> roles per article (consensus / angle / dispute / unreadable)
 *   -> synthesis (streamed Markdown from VERIFIED findings only, cited [[source:Sn]])
 *
 * Progress is streamed as tokens; graph roles are published through `onRoles`.
 */
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { ChatMessage } from '../clients/llm.js';
import type { InvestigationEventDto, ProofReportDto, ProofRoleDto } from '../investigations/types.js';
import { logger } from '../utils/logger.js';
import { type ProofArticle, type Scraper, scrapeArticles, selectArticles } from './articles.js';
import {
  articlesBlock,
  assignRoles,
  CORROBORATOR_PROMPT,
  CorroboratorOutput,
  defaultJsonLlm,
  type JsonLlm,
  SKEPTIC_PROMPT,
  SkepticOutput,
  verifyFindings,
} from './agents.js';

export const SYNTHESIS_PROMPT = `You combine the findings of two verification agents into a short, neutral source comparison for readers.
The CORROBORATOR found facts confirmed by several outlets; the SKEPTIC found each outlet's angle, details only one outlet reports, and contradictions.
All quotes in the findings were machine-verified against the articles.

Write Markdown with exactly these sections:
### Verdict
2-3 sentences: do the outlets tell the same core story? What do they share, and where do they differ (emphasis, extra details, disagreements)?
### Common ground
Bullets of the shared facts, each citing every supporting outlet like [[source:S1]] [[source:S3]].
### How each outlet frames it
One bullet per outlet: "**Publisher** - angle" with its citation.
### Different elements
Bullets for details only one outlet reports, each cited.
### Disputed or uncertain
Contradictions with both sides cited; if none, say no direct contradictions were found among the readable articles.

Rules: use only the findings provided; cite with the exact [[source:Sn]] format; neutral wording; never infer intent; no causal claims unless a finding states them; keep it concise.`;

export interface ProofDeps {
  model: BaseChatModel;
  scrape?: Scraper;
  json?: JsonLlm;
}

export interface ProofRun {
  content: string;
  articles: ProofArticle[];
  report: ProofReportDto;
  roles: Map<string, ProofRoleDto>; // by S label
}

export async function runProof(
  args: {
    investigationId: string;
    event: InvestigationEventDto;
    focus?: string;
    token: (text: string) => void;
    onArticles?: (articles: ProofArticle[], roles?: Map<string, ProofRoleDto>) => void;
    signal?: AbortSignal;
  },
  deps: ProofDeps,
): Promise<ProofRun> {
  const { event, token } = args;
  const json = deps.json ?? defaultJsonLlm;
  const picked = selectArticles(event);
  if (picked.length < 2) throw new Error('This event needs at least two articles from different outlets to compare.');

  // 1. Read
  token(`**Reading ${picked.length} articles** from ${picked.length} outlets about “${event.title}”…\n\n`);
  const articles = await scrapeArticles(picked, deps.scrape);
  const readable = articles.filter((a) => a.readable);
  const unreadable = articles.filter((a) => !a.readable);
  token(`- ${readable.length} readable${unreadable.length ? `, ${unreadable.length} unavailable (${unreadable.map((a) => a.publisher).join(', ')})` : ''}\n`);
  args.onArticles?.(articles);
  if (readable.length < 2) throw new Error('Fewer than two articles could be read, so there is nothing to compare.');
  if (args.signal?.aborted) throw new Error('aborted');

  // 2. Two perspectives in parallel
  token(`- **Corroborator** is checking which facts several outlets confirm\n- **Skeptic** is looking for different angles, unique details and contradictions\n`);
  const material = articlesBlock(articles, event.title, args.focus);
  const ask = (system: string): ChatMessage[] => [
    { role: 'system', content: system },
    { role: 'user', content: material },
  ];
  const [corroborator, skeptic] = await Promise.all([
    json(CorroboratorOutput, ask(CORROBORATOR_PROMPT)),
    json(SkepticOutput, ask(SKEPTIC_PROMPT)),
  ]);

  // 3. Verify quotes, assign roles
  const findings = verifyFindings(corroborator, skeptic, articles);
  const roles = assignRoles(articles, findings);
  args.onArticles?.(articles, roles);
  token(
    `- Corroborator: ${findings.consensus.length} shared fact${findings.consensus.length === 1 ? '' : 's'} · Skeptic: ${findings.angles.length} angles, ${findings.unique.length} unique details, ${findings.disputes.length} dispute${findings.disputes.length === 1 ? '' : 's'}\n` +
      `- Quotes checked against the articles: ${findings.quotesVerified} verified, ${findings.quotesRejected} rejected\n\n`,
  );

  const report: ProofReportDto = {
    investigationId: args.investigationId,
    eventId: event.id,
    eventTitle: event.title,
    sources: articles.map((a) => ({
      id: a.label,
      evidenceId: a.evidence.id,
      title: a.evidence.title,
      url: a.evidence.sourceUrl ?? '',
      publisher: a.publisher,
      readable: a.readable,
      ...(a.error && { error: a.error }),
      role: roles.get(a.label) ?? 'angle',
    })),
    consensus: findings.consensus,
    angles: findings.angles,
    unique: findings.unique,
    disputes: findings.disputes,
    stats: { articles: articles.length, readable: readable.length, quotesVerified: findings.quotesVerified, quotesRejected: findings.quotesRejected },
  };

  // 4. Synthesis from verified findings only (streamed)
  const outlets = readable.map((a) => `${a.label} = ${a.publisher}: ${a.evidence.title}`).join('\n');
  const stream = await deps.model.stream(
    [
      new SystemMessage(SYNTHESIS_PROMPT),
      new HumanMessage(
        `Story: ${event.title}${args.focus ? `\nUser focus: ${args.focus}` : ''}\n\nOutlets:\n${outlets}\n\nVerified findings (JSON):\n${JSON.stringify(
          { consensus: report.consensus, angles: report.angles, unique: report.unique, disputes: report.disputes },
          null,
          1,
        )}`,
      ),
    ],
    { signal: args.signal },
  );
  let synthesis = '';
  for await (const chunk of stream) {
    const piece = typeof chunk.content === 'string' ? chunk.content : '';
    if (!piece) continue;
    synthesis += piece;
    token(piece);
  }

  const coverage = `\n\n_Coverage: ${readable.length} of ${articles.length} articles read in full; ${findings.quotesVerified} quotes verified verbatim${findings.quotesRejected ? `, ${findings.quotesRejected} unverifiable quotes discarded` : ''}._`;
  logger.info({ eventId: event.id, ...report.stats, consensus: report.consensus.length, disputes: report.disputes.length }, 'proof run finished');
  return { content: synthesis.trim() + coverage, articles, report, roles };
}
