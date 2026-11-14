/**
 * Research chat - graph first. The graph on the right is the answer; the chat stays short and
 * points at it.
 *
 * answer_question: the question is checked against what is CURRENTLY in the investigation graph
 *   (graphQa.ts: claims with status + articles). The model returns JSON naming the claims/articles
 *   that answer it; those are highlighted (SSE `highlight` for the asking client + /ws
 *   `investigation:highlight` for every viewer) and the chat shows a one-or-two sentence pointer.
 *   If the graph does not cover it, the chat just says so.
 * extend_graph: research run; new evidence is added and highlighted; one-line chat result.
 * verify_sources: proof engine; graph colours articles by role; chat shows the verdict only
 *   (the full comparison lives in the proof card).
 * build_claims: claim timeline; one-line chat result.
 */
import { randomUUID } from 'node:crypto';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { createChatModel } from '../agent/model.js';
import { pickEvidence } from '../claims/builder.js';
import { buildClaimGraph } from '../claims/pipeline.js';
import type { VettingService } from '../vetting/service.js';
import type { Scraper } from '../proof/articles.js';
import { selectArticles } from '../proof/articles.js';
import { defaultJsonLlm, type JsonLlm } from '../proof/agents.js';
import { runProof } from '../proof/engine.js';
import { logger } from '../utils/logger.js';
import { buildGraphListing, GRAPH_QA_PROMPT, GraphAnswer, resolveAnswer } from './graphQa.js';
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

const HISTORY_MESSAGES = 4;
const MAX_QUESTION = 2000;
const SEE_GRAPH = 'See the graph on the right.';

export interface RetrievedSource {
  label: string; // S1..Sn
  evidence: InvestigationEvidenceDto;
  event: InvestigationEventDto;
  score: number;
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

/** Remove citation markers that do not refer to a provided source. */
export function stripUnknownCitations(text: string, known: Set<string>): string {
  // Also drop the whitespace before a removed marker, so "fines [[source:S12]]." becomes "fines.".
  return text.replace(/[ \t]*\[\[source:(S\d{1,2})\]\]/g, (m, label: string) => (known.has(label) ? m : ''));
}

/** The "### Verdict" section of a proof synthesis (first paragraph as fallback). */
export function verdictOf(markdown: string): string {
  const m = /###\s*Verdict\s*\n+([\s\S]*?)(?=\n###|\n\n_Coverage|$)/i.exec(markdown);
  const text = (m?.[1] ?? markdown.split(/\n\n/)[0] ?? '').trim();
  return text.replace(/\s*\[\[source:S\d{1,2}\]\]/g, '').trim();
}

export interface ChatServiceDeps {
  store: InvestigationStore;
  investigations: InvestigationService;
  publish: (event: InvestigationHighlightEvent) => void;
  /** Chat model (proof synthesis); defaults to the configured LLM. Injected in tests. */
  model?: BaseChatModel;
  /** Overrides (tests): article scraper and JSON LLM (graph Q&A, proof agents, claims). */
  proof?: { scrape?: Scraper; json?: JsonLlm };
  /** Screens sources for propaganda before claims are built (claims/pipeline.ts). */
  vetting?: VettingService;
}

interface TurnResult {
  content: string;
  sources: RetrievedSource[];
  runId?: string;
  proof?: ProofReportDto;
  /** evidenceId -> role, for verify_sources highlights. */
  roles?: Record<string, ProofRoleDto>;
  /** Graph node ids (claims or events) to highlight in addition to the sources' events. */
  nodeIds?: string[];
  /** Do not highlight anything (e.g. after rebuilding claims, or nothing found). */
  noHighlight?: boolean;
}

type Emit = (event: ResearchStreamEventDto) => void;

export class ResearchChatService {
  private model?: BaseChatModel;

  constructor(private deps: ChatServiceDeps) {
    this.model = deps.model;
  }

  private get json(): JsonLlm {
    return this.deps.proof?.json ?? defaultJsonLlm;
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

  private highlight(
    investigationId: string,
    messageId: string,
    sources: RetrievedSource[],
    final: boolean,
    roles?: Record<string, ProofRoleDto>,
    nodeIds: string[] = [],
  ) {
    this.deps.publish({
      type: 'investigation:highlight',
      payload: {
        investigationId,
        messageId,
        evidenceIds: sources.map((s) => s.evidence.id),
        eventIds: [...new Set([...nodeIds, ...sources.map((s) => s.event.id)])],
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
            : await this.answer(record, message, emit);

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
    const lit = result.noHighlight ? [] : result.sources;
    const nodeIds = result.noHighlight ? [] : (result.nodeIds ?? []);
    if (result.proof) emit({ type: 'proof', report: result.proof });
    emit({ type: 'sources', sources: assistant.sources });
    // Tell the asking client exactly what to light up (other viewers get the /ws frame below).
    emit({
      type: 'highlight',
      evidenceIds: lit.map((s) => s.evidence.id),
      nodeIds: [...new Set([...nodeIds, ...lit.map((s) => s.event.id)])],
      ...(result.roles && { roles: result.roles }),
    });
    await this.deps.store.addMessage(assistant);
    emit({ type: 'message_complete', message: assistant });
    this.highlight(record.id, messageId, lit, true, result.roles, nodeIds);
  }

  /** answer_question: point at the graph items that answer the question, or say it is not there. */
  private async answer(record: InvestigationRecord, question: string, emit: Emit): Promise<TurnResult> {
    const listing = buildGraphListing(record);
    if (!listing.hasContent) {
      // Nothing to point at yet: research the investigation's topic now instead of asking the user to.
      const active = await this.deps.store.activeRun(record.id);
      if (active) {
        return { content: 'Research for this topic is still running; the graph will fill in on the right as articles arrive.', sources: [], noHighlight: true };
      }
      const result = await this.extend(record, record.topic, emit);
      const updated = await this.deps.investigations.get(record.id);
      const established = (updated.claims ?? []).filter((c) => c.status === 'established').length;
      const claims = updated.claims?.length ?? 0;
      return {
        ...result,
        content: result.sources.length
          ? `The graph was empty, so I researched “${record.topic}”: ${result.sources.length} articles, ${claims} claims (${established} established). ${SEE_GRAPH}`
          : `I researched “${record.topic}” but found no relevant articles yet. Try rephrasing the topic.`,
      };
    }
    const past = (await this.deps.store.listMessages(record.id, { limit: HISTORY_MESSAGES + 1 })).items.slice(0, -1);
    const conversation = past.length
      ? `Recent conversation:\n${past.slice(-HISTORY_MESSAGES).map((m) => `${m.role}: ${m.content.slice(0, 300)}`).join('\n')}\n\n`
      : '';
    const out = await this.json(GraphAnswer, [
      { role: 'system', content: GRAPH_QA_PROMPT },
      { role: 'user', content: `${listing.text}\n\n${conversation}Question: ${question}` },
    ]);
    const resolved = resolveAnswer(out, listing);
    logger.info({ investigationId: record.id, found: resolved.found, claims: resolved.claimIds.length, evidence: resolved.evidence.length }, 'graph question answered');

    if (!resolved.found) {
      return {
        content: `${resolved.answer || 'That is not in the graph yet.'} Use **Extend evidence graph** to research it.`,
        sources: [],
        noHighlight: true,
      };
    }
    const sources = resolved.evidence.map((e, i) => ({ label: `S${i + 1}`, evidence: e.evidence, event: e.event, score: 0 }));
    const count = resolved.claimIds.length + (resolved.claimIds.length ? 0 : sources.length);
    const what = resolved.claimIds.length ? `${resolved.claimIds.length} claim${resolved.claimIds.length === 1 ? '' : 's'}` : `${count} article${count === 1 ? '' : 's'}`;
    return {
      content: `${resolved.answer}${outcomeCaveat(record, resolved.claimIds)}\n\n→ Highlighted ${what} on the graph.`,
      sources,
      nodeIds: resolved.claimIds,
    };
  }

  /** build_claims: turn the investigation's evidence into a chronological, evidence-backed claim timeline. */
  private async claims(record: InvestigationRecord, emit: Emit): Promise<TurnResult> {
    // Screen sources -> build -> corroborate -> screen corroborating sources -> store.
    const { built, corroborationAdded, pruned } = await buildClaimGraph(record.id, {
      store: this.deps.store,
      ...(this.deps.vetting && { vetting: this.deps.vetting }),
      ...(this.deps.proof?.scrape && { scrape: this.deps.proof.scrape }),
      ...(this.deps.proof?.json && { json: this.deps.proof.json }),
      token: (text) => emit({ type: 'token', text }),
    });
    const corroborated = { added: { length: corroborationAdded } };
    const updated = await this.deps.investigations.get(record.id);
    emit({ type: 'graph_updated', graph: toGraphDto(updated) });
    const { stats } = built;
    const established = built.claims.filter((c) => c.status === 'established').length;
    const multi = built.claims.filter((c) => new Set(c.evidence.map((e) => (e.publisher ?? e.url ?? '').toLowerCase())).size > 1).length;
    const content =
      `Claim timeline ready: **${established} established**, ${built.claims.length - established} unverified, ${multi} with 2+ independent sources (${corroborated.added.length} added by corroboration), ${built.links.length} connection${built.links.length === 1 ? '' : 's'}${pruned ? `, ${pruned} manipulative source${pruned === 1 ? '' : 's'} pruned` : ''} ` +
      `(from ${stats.articles} articles). ${SEE_GRAPH}`;
    return { content, sources: [], noHighlight: true };
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
        streamSynthesis: false,
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
    const full = stripUnknownCitations(run.content, known);
    const report: ProofReportDto = { ...run.report, summary: full };
    return {
      content: `${verdictOf(full)}\n\n→ The graph colours each article: shared facts, own angle, disputed. Full comparison in the proof card.`,
      sources,
      proof: report,
      roles: Object.fromEntries(run.articles.map((a) => [a.evidence.id, run.roles.get(a.label) ?? 'angle'])),
    };
  }

  private async extend(record: InvestigationRecord, topic: string, emit: Emit): Promise<TurnResult> {
    emit({ type: 'token', text: `Researching “${topic}”…` });
    const { run } = await this.deps.investigations.extend(record.id, { topic });
    await this.deps.investigations.running.get(run.id);
    const finished = await this.deps.store.getRun(record.id, run.id);
    if (finished?.status === 'failed') {
      throw new InvestigationError(502, finished.error?.code ?? 'research_failed', finished.error?.message ?? 'Research run failed.');
    }
    const updated = await this.deps.investigations.get(record.id);
    emit({ type: 'graph_updated', graph: toGraphDto(updated) });

    const event = updated.events.find((e) => e.id === `evt-${run.id}`);
    const added = (event?.evidence ?? []).map((evidence, i) => ({ label: `S${i + 1}`, evidence, event: event!, score: 0 }));
    const content = added.length
      ? `Added ${added.length} new article${added.length === 1 ? '' : 's'} about “${topic}” (highlighted) and updated the claim timeline. ${SEE_GRAPH}`
      : `No new relevant articles were found for “${topic}”.`;
    return { content, sources: added, runId: run.id, ...(!added.length && { noHighlight: true }) };
  }
}

/** Politician view: never let a "yes, delivered" stand on the politician's own word alone. */
export function outcomeCaveat(record: InvestigationRecord, claimIds: string[]): string {
  if (record.mode !== 'politician' || !claimIds.length) return '';
  const lit = (record.claims ?? []).filter((c) => claimIds.includes(c.id));
  if (!lit.length || lit.some((c) => c.outcome && c.outcome !== 'no_update')) return '';
  return ' _Note: these are the politician’s/government’s own statements; no independent outcome report is in the graph yet._';
}
