/**
 * Topic planner: turn whatever the user typed ("LEST DO A NALAYS OF NARDNER MODI") into a clean,
 * searchable research plan before any scraping happens.
 *
 * Output (JSON, validated):
 * - title: clean topic, e.g. "Narendra Modi"
 * - mode: "politician" when the topic is a politician/political figure (track their claims and
 *   whether they were kept), otherwise "news" (track how a story develops)
 * - entity: main person/organisation, if any
 * - queries: 2-4 web/news search queries
 * - keyTerms: 1-4 short distinctive terms/phrases; an article is relevant if it mentions ANY of
 *   them (typos and filler words in the raw text no longer filter everything out)
 * - scope: "timeline" (how something developed over time -> one spine node per period) or
 *   "snapshot" (point-in-time information such as today's weather -> one spine node)
 */
import { z } from 'zod';
import type { JsonLlm } from '../proof/agents.js';

export const TopicPlan = z.object({
  title: z.string(),
  mode: z.enum(['news', 'politician']).catch('news'),
  entity: z.string().nullable().optional(),
  queries: z.array(z.string()).default([]),
  keyTerms: z.array(z.string()).default([]),
  scope: z.enum(['timeline', 'snapshot']).catch('timeline').default('timeline'),
});
export type TopicPlanT = z.infer<typeof TopicPlan>;

export const PLANNER_PROMPT = `You turn a user's research request (it may contain typos, filler words or shouting) into a clean research plan.

Return JSON only:
{"title":"<clean topic, max 80 chars, fix typos. For a politician use just their full name, e.g. 'Narendra Modi'; otherwise the subject, e.g. 'EU AI Act enforcement'. No words like 'analysis of'>",
 "mode":"politician" | "news",
 "entity":"<main person/organisation or null>",
 "queries":["<2-4 precise web/news search queries>"],
 "keyTerms":["<1-4 short distinctive words/phrases an on-topic article must mention at least one of, lowercase, e.g. 'modi'>"],
 "scope":"timeline" | "snapshot"}

mode = "politician" when the request is about a politician or political leader (their promises, statements, record); otherwise "news".
For mode "politician", make the queries cover BOTH what they promised/announced (e.g. "<name> promises", "<name> pledged") AND whether it was delivered (e.g. "<name> promise fulfilled", "<name> government record <topic>").
keyTerms: names/proper nouns or the core subject only (no generic words like "news", "new", "rules", "analysis").
scope = "snapshot" when the request asks for information at ONE point in time, usually now: today's weather, the current price
or rate, the latest score or result, what is happening right now, a status as of today. Then make the queries target current
information (e.g. include "today" / "latest").
scope = "timeline" when it asks how something developed or changed over a period: history, evolution, "since 2010", "over the
years", controversies, a record, tracking a story, a person's statements over time. If unsure, use "timeline".`;

/** Fallback when the LLM is unavailable: keep the user's words. */
function fallbackPlan(raw: string): TopicPlanT {
  const title = raw.trim().replace(/\s+/g, ' ').slice(0, 80);
  const words = title.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4);
  const snapshot = /\b(today|tonight|right now|currently|current|latest|live)\b/i.test(raw) && !/\b(history|over the years|since|timeline|evolution|controvers)/i.test(raw);
  return { title, mode: 'news', entity: null, queries: [title], keyTerms: words.slice(-2), scope: snapshot ? 'snapshot' : 'timeline' };
}

export async function planTopic(raw: string, json: JsonLlm): Promise<TopicPlanT> {
  try {
    const plan = await json(TopicPlan, [
      { role: 'system', content: PLANNER_PROMPT },
      { role: 'user', content: raw.slice(0, 500) },
    ]);
    const title = plan.title.trim().slice(0, 80) || fallbackPlan(raw).title;
    const keyTerms = [...new Set(plan.keyTerms.map((t) => t.trim().toLowerCase()).filter((t) => t.length >= 2))].slice(0, 4);
    const queries = [...new Set(plan.queries.map((q) => q.trim()).filter(Boolean))].slice(0, 4);
    return {
      title,
      mode: plan.mode,
      entity: plan.entity?.trim() || null,
      queries: queries.length ? queries : [title],
      keyTerms: keyTerms.length ? keyTerms : fallbackPlan(title).keyTerms,
      scope: plan.scope,
    };
  } catch {
    return fallbackPlan(raw);
  }
}
