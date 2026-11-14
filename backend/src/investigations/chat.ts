/**
 * Research chat over an investigation's evidence graph (RAG).
 *
 * answer_question:
 *   1. Retrieve: load the investigation graph from the DB and rank its evidence against the
 *      question (lexical scoring over title, excerpt, publisher and the parent event). Top
 *      MAX_SOURCES become numbered sources S1..Sn.
 *   2. Generate: the chat model answers ONLY from those sources, cites with [[source:Sn]]
 *      (the format ResearchChat renders), and ends with a cited "Conclusions" section.
 *   3. Highlight: while tokens stream, every newly cited source is broadcast on /ws as
 *      `investigation:highlight` (evidence + event ids) so the graph lights up the cited
 *      branches and dims the rest; a final frame carries exactly the cited set (e.g. 5 of 10).
 *   4. Persist the user and assistant messages (citations carry evidenceId/eventId).
 *
 * extend_graph: runs a research run on the investigation, emits `graph_updated`, and
 * highlights the newly added evidence.
 */
import { randomUUID } from 'node:crypto';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import { createChatModel } from '../agent/model.js';
import type { Scraper } from '../proof/articles.js';
import { selectArticles } from '../proof/articles.js';
import type { JsonLlm } from '../proof/agents.js';
import { runProof } from '../proof/engine.js';
import { buildClaims, pickEvidence } from '../claims/builder.js';
import { queryTerms } from '../research/articles.js';
import { logger } from '../utils/logger.js';
import { InvestigationError, toGraphDto, type InvestigationService } from './service.js';
import type { InvestigationStore } from './store.js';
import type {
  ChatMessageDto,
  InvestigationEventDto,
  InvestigationEvidenceDto,
  InvestigationHighlightEvent,
  InvestigationRecord,
  ProofReportDto,
  ProofRoleDto,
  ResearchActionDto,
  ResearchStreamEventDto,
  SourceCitationDto,
} from './types.js';

export const MAX_SOURCES = 10;
const HISTORY_MESSAGES = 6;
const MAX_QUESTION = 2000;
const CITATION = /\[\[source:(S\d{1,2})\]\]/g;

export const ANSWER_PROMPT = `You are Ghostline's research analyst. You answer questions about one investigation using ONLY the numbered sources provided (articles collected into the investigation's evidence graph).

Rules:
- Every factual sentence must cite its source(s) inline with the exact format [[source:S1]] (one marker per source, e.g. "... [[source:S2]] [[source:S5]]"). Never cite a source that does not support the sentence.
- Use only the sources. If they do not answer the question, say so plainly and state what is missing.
- Be neutral: report what sources say, attribute claims ("According to ..."), do not infer anyone's intent or motives.
- Do not claim one thing caused another unless a source explicitly says so; otherwise describe sequence ("followed", "was later").
- Where sources disagree, present both sides with citations.
- For markets or companies: no trading advice, never imply a story moved a price, and end with "Not financial advice."

Format (Markdown):
1. A direct answer in 1-3 short paragraphs.
2. "### Conclusions" with 2-4 bullet points: what the evidence supports, each cited, plus one bullet on uncertainty or gaps if relevant.
Keep it concise. Do not list sources at the end; the citations are enough.`;

export interface RetrievedSource {
  label: string; // S1..Sn
  evidence: InvestigationEvidenceDto;
  event: InvestigationEventDto;
  score: number;
}

/** Rank evidence by lexical relevance to the question; if nothing matches (broad question), cover events instead. */
export function retrieveSources(record: InvestigationRecord, question: string, k = MAX_SOURCES): RetrievedSource[] {
  const items = record.events.flatMap((event) => event.evidence.map((evidence) => ({ event, evidence })));
  if (!items.length) return [];
  const terms = queryTerms(question);
  const text = (s?: string) => (s ?? '').toLowerCase().normalize('NFKD');
  const count = (hay: string, t: string) => (t ? hay.split(t).length - 1 : 0);
  const df = new Map(
    terms.map((t) => [
      t,
      items.filter(({ evidence, event }) => text(`${evidence.title} ${evidence.excerpt} ${event.title}`).includes(t)).length,
    ]),
  );
  const scored = items.map(({ event, evidence }, idx) => {
    const title = text(evidence.title);
    const body = text(`${evidence.excerpt ?? ''} ${evidence.sourceName ?? ''}`);
    const ctx = text(`${event.title} ${event.summary ?? ''}`);
    let score = 0;
    for (const t of terms) {
      const idf = Math.log(1 + items.length / (1 + (df.get(t) ?? 0)));
      score += (3 * count(title, t) + count(body, t) + 0.5 * count(ctx, t)) * idf;
    }
    return { event, evidence, score, idx };
  });

  const matched = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score || a.idx - b.idx);
  let picked = matched.slice(0, k);
  if (picked.length === 0) {
    // Broad question ("summarize", "what are the conclusions"): cover events round-robin, newest first.
    const byEvent = [...record.events].reverse().map((e) => scored.filter((s) => s.event.id === e.id));
    const fill: typeof scored = [];
    for (let round = 0; fill.length < Math.min(k, 8) && byEvent.some((list) => list[round]); round++) {
      for (const list of byEvent) if (list[round] && fill.length < Math.min(k, 8)) fill.push(list[round]!);
    }
    const seen = new Set(picked.map((p) => p.evidence.id));
    picked = [...picked, ...fill.filter((f) => !seen.has(f.evidence.id))].slice(0, k);
  }
  return picked.map((p, i) => ({ label: `S${i + 1}`, evidence: p.evidence, event: p.event, score: p.score }));
}

export function buildContext(record: InvestigationRecord, sources: RetrievedSource[]): string {
  const events = record.events
    .map((e) => `- ${e.title}${e.summary ? `: ${e.summary.slice(0, 300)}` : ''} (${e.evidence.length} articles)`)
    .join('\n');
  const list = sources
    .map(({ label, evidence: ev, event }) =>
      [
        `[${label}] ${ev.title}`,
        `Publisher: ${ev.sourceName ?? 'unknown'}${ev.publishedAt ? ` | Published: ${ev.publishedAt.slice(0, 10)}` : ''} | Graph event: ${event.title}`,
        ev.excerpt ? `Excerpt: ${ev.excerpt.slice(0, 600)}` : 'Excerpt: (none; title only)',
      ].join('\n'),
    )
    .join('\n\n');
  return `Investigation: ${record.title}\nTopic: ${record.topic}\n\nEvents in the evidence graph:\n${events}\n\nSources:\n${list}`;
}

export function toCitation(s: RetrievedSource): SourceCitationDto {
  return {
    id: s.label,
    title: s.evidence.title,
    url: s.evidence.sourceUrl ?? '',
    ...(s.evidence.sourceName && { publisher: s.evidence.sourceName }),
    ...(s.evidence.publishedAt && { publishedAt: s.evidence.publishedAt }),
    ...(s.evidence.excerpt && { excerpt: s.evidence.excerpt }),
    evidenceId: s.evidence.id,
    eventId: s.event.id,
  };
}

/** Labels cited in text, in order of first appearance, restricted to known labels. */
export function citedLabels(text: string, known: Set<string>): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(CITATION)) if (known.has(m[1]!) && !out.includes(m[1]!)) out.push(m[1]!);
  return out;
}

/** Remove citation markers that do not refer to a provided source. */
export function stripUnknownCitations(text: string, known: Set<string>): string {
  // Also drop the whitespace before a removed marker, so "fines [[source:S12]]." becomes "fines.".
  return text.replace(/[ \t]*\[\[source:(S\d{1,2})\]\]/g, (m, label: string) => (known.has(label) ? m : ''));
}

export interface ChatServiceDeps {
  store: InvestigationStore;
  investigations: InvestigationService;
  publish: (event: InvestigationHighlightEvent) => void;
  /** Chat model; defaults to the configured LLM. Injected in tests. */
  model?: BaseChatModel;
  /** Proof engine overrides (tests): article scraper and JSON agent LLM. */
  proof?: { scrape?: Scraper; json?: JsonLlm };
}

interface TurnResult {
  content: string;
  sources: RetrievedSource[];
  runId?: string;
  proof?: ProofReportDto;
  /** evidenceId -> role, for verify_sources highlights. */
  roles?: Record<string, ProofRoleDto>;
  /** Do not highlight the cited sources in the graph (e.g. after rebuilding claims). */
  noHighlight?: boolean;
}

type Emit = (event: ResearchStreamEventDto) => void;

export class ResearchChatService {
  private model?: BaseChatModel;

  constructor(private deps: ChatServiceDeps) {
    this.model = deps.model;
  }

  async history(investigationId: string, cursor?: string) {
    await this.deps.investigations.get(investigationId);
    const page = await this.deps.store.listMessages(investigationId, { limit: 30, cursor });
    return { investigationId, ...page };
  }

  /** Validate before the SSE response starts, so errors can be plain JSON with a status. */
  async prepare(
    investigationId: string,
    action: ResearchActionDto,
    message: string,
    eventId?: string,
  ): Promise<{ record: InvestigationRecord; message: string; event?: InvestigationEventDto }> {
    const record = await this.deps.investigations.get(investigationId);
    if (action === 'verify_sources') {
      const event = eventId
        ? record.events.find((e) => e.id === eventId)
        : [...record.events].sort((a, b) => b.evidence.length - a.evidence.length)[0];
      if (!event) throw new InvestigationError(eventId ? 404 : 400, eventId ? 'event_not_found' : 'no_events', eventId ? `Event "${eventId}" was not found in this investigation.` : 'This investigation has no events to verify yet.');
      if (selectArticles(event).length < 2) {
        throw new InvestigationError(400, 'not_enough_sources', 'Verification needs articles from at least two different outlets in this event.');
      }
      const focus = (message ?? '').trim().slice(0, MAX_QUESTION);
      return { record, message: focus || `Verify the sources for “${event.title}”.`, event };
    }
    if (action === 'build_claims') {
      if (pickEvidence(record).length < 2) {
        throw new InvestigationError(400, 'not_enough_sources', 'Building claims needs at least two articles in this investigation.');
      }
      return { record, message: (message ?? '').trim() || `Build the claim timeline for “${record.title}”.` };
    }
    const clean = (message ?? '').trim();
    if (!clean) throw new InvestigationError(400, 'invalid_message', 'Message is required.');
    if (clean.length > MAX_QUESTION) throw new InvestigationError(400, 'invalid_message', `Message must be at most ${MAX_QUESTION} characters.`);
    if (action === 'extend_graph') {
      const active = await this.deps.store.activeRun(investigationId);
      if (active) throw new InvestigationError(409, 'run_in_progress', 'A research run is already in progress for this investigation.', { runId: active.id });
    }
    return { record, message: clean };
  }

  private highlight(investigationId: string, messageId: string, sources: RetrievedSource[], final: boolean, roles?: Record<string, ProofRoleDto>) {
    this.deps.publish({
      type: 'investigation:highlight',
      payload: {
        investigationId,
        messageId,
        evidenceIds: sources.map((s) => s.evidence.id),
        eventIds: [...new Set(sources.map((s) => s.event.id))],
        final,
        ...(roles && { roles }),
      },
      timestamp: new Date().toISOString(),
    });
  }

  async run(
    record: InvestigationRecord,
    action: ResearchActionDto,
    message: string,
    emit: Emit,
    signal?: AbortSignal,
    event?: InvestigationEventDto,
  ): Promise<void> {
    const now = () => new Date().toISOString();
    await this.deps.store.addMessage({ id: randomUUID(), investigationId: record.id, role: 'user', content: message, sources: [], createdAt: now() });
    const messageId = randomUUID();
    emit({ type: 'message_start', messageId, investigationId: record.id });
    this.highlight(record.id, messageId, [], false); // clear any previous highlight

    const result: TurnResult =
      action === 'extend_graph'
        ? await this.extend(record, message, emit)
        : action === 'verify_sources'
          ? await this.verify(record, event!, message, messageId, emit, signal)
          : action === 'build_claims'
            ? await this.claims(record, emit)
            : await this.answer(record, message, messageId, emit, signal);

    const assistant: ChatMessageDto = {
      id: messageId,
      investigationId: record.id,
      role: 'assistant',
      content: result.content,
      sources: result.sources.map(toCitation),
      createdAt: now(),
      ...(result.runId && { runId: result.runId }),
      ...(result.proof && { proof: result.proof }),
    };
    if (result.proof) emit({ type: 'proof', report: result.proof });
    emit({ type: 'sources', sources: assistant.sources });
    await this.deps.store.addMessage(assistant);
    emit({ type: 'message_complete', message: assistant });
    this.highlight(record.id, messageId, result.noHighlight ? [] : result.sources, true, result.roles);
  }

  /** build_claims: turn the investigation's evidence into a chronological, evidence-backed claim timeline. */
  private async claims(record: InvestigationRecord, emit: Emit): Promise<TurnResult> {
    const built = await buildClaims(record, {
      scrape: this.deps.proof?.scrape,
      json: this.deps.proof?.json,
      token: (text) => emit({ type: 'token', text }),
    });
    await this.deps.store.setClaims(record.id, { claims: built.claims, links: built.links, entity: built.entity });
    const updated = await this.deps.investigations.get(record.id);
    emit({ type: 'graph_updated', graph: toGraphDto(updated) });

    // Cite one piece of evidence per claim so the summary links to sources.
    const allEvidence = new Map(record.events.flatMap((e) => e.evidence.map((ev) => [ev.id, { ev, event: e }] as const)));
    const sources: RetrievedSource[] = [];
    const cite = (evidenceId?: string) => {
      const hit = evidenceId ? allEvidence.get(evidenceId) : undefined;
      if (!hit) return '';
      let src = sources.find((s) => s.evidence.id === evidenceId);
      if (!src) {
        src = { label: `S${sources.length + 1}`, evidence: hit.ev, event: hit.event, score: 0 };
        sources.push(src);
      }
      return ` [[source:${src.label}]]`;
    };
    const line = (c: (typeof built.claims)[number]) =>
      `- ${c.occurredAt ? `**first reported ${c.occurredAt.slice(0, 10)}** · ` : ''}${c.statement}${cite(c.evidence.find((e) => e.stance === 'supports')?.evidenceId ?? c.evidence[0]?.evidenceId)}${c.disputed ? ' _(disputed)_' : ''}\n  ${c.statusReason}`;
    const established = built.claims.filter((c) => c.status === 'established');
    const pending = built.claims.filter((c) => c.status === 'pending');
    const { stats } = built;
    const content = [
      `${built.entity ? `**${built.entity}** › ` : ''}**${record.title}**: ${stats.claims} claims from ${stats.articles} articles (${stats.fullText} read in full). ${stats.established} established, ${stats.pending} unverified, ${built.links.length} connections.`,
      established.length ? `### Established claims\n${established.map(line).join('\n')}` : '',
      pending.length ? `### Unverified (pending)\nShown on the separate dashed line; not presented as fact until more evidence arrives.\n${pending.map(line).join('\n')}` : '',
      built.links.length
        ? `### How claims connect\n${built.links
            .map((l) => `- ${l.type.replace('_', ' ')} (${l.basis.replace('_', ' ')}): ${l.description}`)
            .join('\n')}`
        : '',
      `_Quotes checked against the articles: ${stats.quotesVerified} verified, ${stats.quotesRejected} rejected._`,
    ]
      .filter(Boolean)
      .join('\n\n');
    emit({ type: 'token', text: '\n' + content });
    return { content, sources, noHighlight: true };
  }

  /** verify_sources: Corroborator + Skeptic proof run over one event's articles. */
  private async verify(
    record: InvestigationRecord,
    event: InvestigationEventDto,
    message: string,
    messageId: string,
    emit: Emit,
    signal?: AbortSignal,
  ): Promise<TurnResult> {
    const focus = message.startsWith('Verify the sources for “') ? undefined : message;
    const asSources = (labels: { label: string; evidence: InvestigationEvidenceDto }[]) =>
      labels.map((a) => ({ label: a.label, evidence: a.evidence, event, score: 0 }));
    const run = await runProof(
      {
        investigationId: record.id,
        event,
        focus,
        signal,
        token: (text) => emit({ type: 'token', text }),
        onArticles: (articles, roles) =>
          this.highlight(
            record.id,
            messageId,
            asSources(articles),
            false,
            roles && Object.fromEntries(articles.map((a) => [a.evidence.id, roles.get(a.label) ?? 'angle'])),
          ),
      },
      { model: (this.model ??= createChatModel()), scrape: this.deps.proof?.scrape, json: this.deps.proof?.json },
    );
    const sources = asSources(run.articles);
    const known = new Set(sources.map((s) => s.label));
    return {
      content: stripUnknownCitations(run.content, known),
      sources,
      proof: run.report,
      roles: Object.fromEntries(run.articles.map((a) => [a.evidence.id, run.roles.get(a.label) ?? 'angle'])),
    };
  }

  private async answer(
    record: InvestigationRecord,
    question: string,
    messageId: string,
    emit: Emit,
    signal?: AbortSignal,
  ): Promise<TurnResult> {
    const retrieved = retrieveSources(record, question);
    if (!retrieved.length) {
      const content =
        "This investigation has no evidence in its graph yet, so I can't answer from it. Use **Extend evidence graph** to collect articles first.";
      emit({ type: 'token', text: content });
      return { content, sources: [] };
    }
    const byLabel = new Map(retrieved.map((s) => [s.label, s]));
    const known = new Set(byLabel.keys());

    const past = (await this.deps.store.listMessages(record.id, { limit: HISTORY_MESSAGES + 1 })).items.slice(0, -1); // drop the question just stored
    const history: BaseMessage[] = past
      .slice(-HISTORY_MESSAGES)
      .map((m) => (m.role === 'user' ? new HumanMessage(m.content.slice(0, 1500)) : new AIMessage(m.content.slice(0, 1500))));

    const model = (this.model ??= createChatModel());
    const stream = await model.stream(
      [
        new SystemMessage(ANSWER_PROMPT),
        new SystemMessage(buildContext(record, retrieved)),
        ...history,
        new HumanMessage(question),
      ],
      { signal },
    );

    let text = '';
    let cited: string[] = [];
    for await (const chunk of stream) {
      const piece = typeof chunk.content === 'string' ? chunk.content : '';
      if (!piece) continue;
      text += piece;
      emit({ type: 'token', text: piece });
      const now = citedLabels(text, known);
      if (now.length > cited.length) {
        cited = now;
        this.highlight(record.id, messageId, cited.map((l) => byLabel.get(l)!), false);
      }
    }
    const content = stripUnknownCitations(text, known).trim();
    const sources = citedLabels(content, known).map((l) => byLabel.get(l)!);
    logger.info({ investigationId: record.id, retrieved: retrieved.length, cited: sources.length }, 'research chat answered');
    return { content, sources };
  }

  private async extend(
    record: InvestigationRecord,
    topic: string,
    emit: Emit,
  ): Promise<TurnResult> {
    emit({ type: 'token', text: `Researching “${topic}” and adding new evidence to the graph…\n\n` });
    const { run } = await this.deps.investigations.extend(record.id, { topic });
    await this.deps.investigations.running.get(run.id);
    const finished = await this.deps.store.getRun(record.id, run.id);
    if (finished?.status === 'failed') {
      throw new InvestigationError(502, finished.error?.code ?? 'research_failed', finished.error?.message ?? 'Research run failed.');
    }
    const updated = await this.deps.investigations.get(record.id);
    emit({ type: 'graph_updated', graph: toGraphDto(updated) });

    const event = updated.events.find((e) => e.id === `evt-${run.id}`);
    const added = (event?.evidence ?? []).slice(0, 8).map((evidence, i) => ({ label: `S${i + 1}`, evidence, event: event!, score: 0 }));
    const total = event?.evidence.length ?? 0;
    const lines = added.map((s) => `- ${s.evidence.title} [[source:${s.label}]]`).join('\n');
    const content = total
      ? `Added ${total} new article${total === 1 ? '' : 's'} under “${topic}” (highlighted in the graph):\n\n${lines}` +
        (event?.summary ? `\n\n**Research agent summary** (not independently verified): ${event.summary}` : '')
      : `No new relevant articles were found for “${topic}”.`;
    emit({ type: 'token', text: content });
    return { content: `Researching “${topic}”…\n\n${content}`, sources: added, runId: run.id };
  }
}
