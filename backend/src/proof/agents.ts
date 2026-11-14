/**
 * Proof engine agents. Both read the same scraped articles but from opposite perspectives:
 *
 * - Corroborator: which facts do at least two outlets independently confirm?
 * - Skeptic: how does each outlet frame the story, what does only one outlet report, where do
 *   they contradict each other?
 *
 * Both return JSON (validated by zod). Every quote is then checked verbatim against the article
 * text it is attributed to (utils/quotes.ts verifyQuote); failing quotes are dropped, and a
 * "consensus" fact must keep verified support from >= 2 distinct outlets.
 */
import { z } from 'zod';
import { completeJson, type ChatMessage } from '../clients/llm.js';
import { verifyQuote } from '../utils/quotes.js';
import type { ProofArticle } from './articles.js';
import type { ProofReportDto, ProofRoleDto } from '../investigations/types.js';

export type JsonLlm = <T>(schema: z.ZodType<T>, messages: ChatMessage[]) => Promise<T>;
export const defaultJsonLlm: JsonLlm = (schema, messages) => completeJson(schema, messages);

const Quote = z.object({ source: z.string(), quote: z.string() });

export const CorroboratorOutput = z.object({
  consensus: z
    .array(z.object({ fact: z.string(), support: z.array(Quote) }))
    .default([]),
});

export const SkepticOutput = z.object({
  angles: z.array(z.object({ source: z.string(), angle: z.string(), quote: z.string().optional() })).default([]),
  unique: z.array(z.object({ source: z.string(), detail: z.string(), quote: z.string() })).default([]),
  disputes: z
    .array(z.object({ point: z.string(), positions: z.array(z.object({ source: z.string(), position: z.string(), quote: z.string() })) }))
    .default([]),
});

const COMMON_RULES = `Rules:
- Use ONLY the article texts below. Refer to articles by their label (S1, S2, ...).
- Every quote must be copied VERBATIM from that article's text (exact words, 5-35 words). Quotes are machine-checked; paraphrased quotes are discarded.
- Be neutral. Describe what outlets say and how they word it. Never infer an outlet's or a person's intent or motives.
- Do not claim causation unless an article states it.
- Respond with JSON only.`;

export const CORROBORATOR_PROMPT = `You are the CORROBORATOR in a two-agent source-verification process.
Your perspective: find the facts that MULTIPLE outlets independently report, so readers know what is well supported.

Return {"consensus":[{"fact":"<one neutral sentence>","support":[{"source":"S1","quote":"<verbatim>"},{"source":"S3","quote":"<verbatim>"}]}]}
- Each fact needs support from at least TWO different articles, each with its own verbatim quote.
- Prefer concrete facts (who, what, when, amounts, decisions) over opinions.
- 3 to 8 facts. If fewer facts are shared, return fewer.
${COMMON_RULES}`;

export const SKEPTIC_PROMPT = `You are the SKEPTIC in a two-agent source-verification process.
Your perspective: find where outlets DIFFER - their angle and framing, details only one outlet reports, and outright contradictions.

Return {"angles":[{"source":"S1","angle":"<how this outlet frames the story, neutrally described>","quote":"<verbatim, optional>"}],
"unique":[{"source":"S2","detail":"<a fact only this outlet reports>","quote":"<verbatim>"}],
"disputes":[{"point":"<what they disagree on>","positions":[{"source":"S1","position":"<its claim>","quote":"<verbatim>"},{"source":"S4","position":"<conflicting claim>","quote":"<verbatim>"}]}]}
- angles: one per readable article, describing focus/emphasis/tone (e.g. "focuses on fines for startups", "frames it as a compliance burden").
- unique: up to 6 notable details reported by one outlet only.
- disputes: only real contradictions between outlets (different numbers, dates, claims). Empty if none.
${COMMON_RULES}`;

export function articlesBlock(articles: ProofArticle[], eventTitle: string, focus?: string): string {
  const readable = articles.filter((a) => a.readable);
  return [
    `Story: ${eventTitle}${focus ? `\nUser focus: ${focus}` : ''}`,
    ...readable.map((a) => `=== ${a.label} | ${a.publisher} | ${a.evidence.title}\n${a.text}`),
  ].join('\n\n');
}

export interface AgentFindings {
  consensus: ProofReportDto['consensus'];
  angles: ProofReportDto['angles'];
  unique: ProofReportDto['unique'];
  disputes: ProofReportDto['disputes'];
  quotesVerified: number;
  quotesRejected: number;
}

/** Keep only quotes found verbatim in the attributed article; enforce cross-outlet support. */
export function verifyFindings(
  corroborator: z.infer<typeof CorroboratorOutput>,
  skeptic: z.infer<typeof SkepticOutput>,
  articles: ProofArticle[],
): AgentFindings {
  const text = new Map(articles.filter((a) => a.readable).map((a) => [a.label, a.text]));
  let verified = 0;
  let rejected = 0;
  const ok = (source: string, quote: string | undefined) => {
    const good = Boolean(quote && text.has(source) && verifyQuote(quote, text.get(source)));
    if (quote) good ? verified++ : rejected++;
    return good;
  };

  const consensus = corroborator.consensus
    .map((c) => {
      const support = c.support.filter((s) => ok(s.source, s.quote));
      const distinct = [...new Map(support.map((s) => [s.source, s])).values()];
      return { fact: c.fact.trim(), support: distinct };
    })
    .filter((c) => c.fact && c.support.length >= 2);

  const angles = skeptic.angles
    .filter((a) => text.has(a.source) && a.angle.trim())
    .map((a) => (a.quote && ok(a.source, a.quote) ? { source: a.source, angle: a.angle.trim(), quote: a.quote } : { source: a.source, angle: a.angle.trim() }));
  const unique = skeptic.unique.filter((u) => u.detail.trim() && ok(u.source, u.quote));
  const disputes = skeptic.disputes
    .map((d) => ({ point: d.point.trim(), positions: d.positions.filter((p) => ok(p.source, p.quote)) }))
    .filter((d) => d.point && new Set(d.positions.map((p) => p.source)).size >= 2);

  return { consensus, angles, unique, disputes, quotesVerified: verified, quotesRejected: rejected };
}

/** Role per article for graph colouring: dispute > consensus > angle; unreadable when not analysed. */
export function assignRoles(articles: ProofArticle[], f: AgentFindings): Map<string, ProofRoleDto> {
  const inDispute = new Set(f.disputes.flatMap((d) => d.positions.map((p) => p.source)));
  const inConsensus = new Set(f.consensus.flatMap((c) => c.support.map((s) => s.source)));
  return new Map(
    articles.map((a) => [
      a.label,
      !a.readable ? 'unreadable' : inDispute.has(a.label) ? 'dispute' : inConsensus.has(a.label) ? 'consensus' : 'angle',
    ]),
  );
}
