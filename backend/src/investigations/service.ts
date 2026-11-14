/**
 * Investigation service: durable research resources built on the research agent.
 *
 * - create(topic): persists an investigation + a queued ResearchRun, returns at once, and runs
 *   research in the background.
 * - extend(id, topic): another run on the same investigation; never removes earlier events or
 *   evidence. Only one active run per investigation (409 otherwise).
 * - A run adds ONE event (title = run topic) and attaches each article found as evidence,
 *   bumping the graph revision each time and publishing `investigation:updated` over /ws.
 *   The agent's closing summary becomes the event summary.
 *
 * Evidence title/URL/source/date come only from search tool output (research/articles.ts).
 */
import { randomUUID } from 'node:crypto';
import type { Article } from '../research/articles.js';
import { articleBranchId } from '../research/articles.js';
import { collectArticles, type CollectRequest } from '../research/run.js';
import { logger } from '../utils/logger.js';
import type { InvestigationStore } from './store.js';
import type {
  ApiErrorDto,
  CreateInvestigationRequestDto,
  CreateInvestigationResponseDto,
  ExtendInvestigationRequestDto,
  ExtendInvestigationResponseDto,
  InvestigationDto,
  InvestigationEvidenceDto,
  InvestigationGraphDto,
  InvestigationRecord,
  InvestigationUpdatedEvent,
  PublicInvestigationsResponseDto,
  ResearchRunDto,
} from './types.js';

export class InvestigationError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
  toDto(requestId?: string): ApiErrorDto {
    return { code: this.code, message: this.message, ...(requestId && { requestId }), ...(this.details && { details: this.details }) };
  }
}

export type Collect = (
  req: CollectRequest,
  onArticle: (article: Article, n: number) => Promise<void>,
) => Promise<{ articles: number; summary: string }>;

export interface InvestigationServiceDeps {
  store: InvestigationStore;
  publish: (event: InvestigationUpdatedEvent) => void;
  /** Research implementation; defaults to the real agent. Injected in tests. */
  collect?: Collect;
}

const MAX_TITLE = 120;
const MAX_CONTEXT = 1000;
const nowIso = () => new Date().toISOString();

export function toInvestigationDto({ revision: _r, events: _e, claims: _c, claimLinks: _l, claimsUpdatedAt: _u, ...dto }: InvestigationRecord): InvestigationDto {
  return dto;
}

export function toGraphDto(r: InvestigationRecord): InvestigationGraphDto {
  return {
    investigationId: r.id,
    revision: r.revision,
    updatedAt: r.updatedAt,
    events: r.events,
    ...(r.claims && { claims: r.claims, claimLinks: r.claimLinks ?? [], ...(r.claimsUpdatedAt && { claimsUpdatedAt: r.claimsUpdatedAt }) }),
    ...(r.entity && { entity: r.entity }),
  };
}

function cleanRequest(input: CreateInvestigationRequestDto | ExtendInvestigationRequestDto) {
  const topic = (input.topic ?? '').trim();
  if (!topic) throw new InvestigationError(400, 'invalid_topic', 'Topic is required.');
  if (topic.length > 500) throw new InvestigationError(400, 'invalid_topic', 'Topic must be at most 500 characters.');
  const context = input.context?.trim().slice(0, MAX_CONTEXT) || undefined;
  return { topic, context };
}

function articleToEvidence(a: Article, eventId: string): InvestigationEvidenceDto {
  return {
    id: articleBranchId(a.url),
    title: a.title,
    ...(a.description && { excerpt: a.description }),
    sourceName: a.sourceName ?? a.domain,
    sourceUrl: a.url,
    ...(a.publishedAt && { publishedAt: a.publishedAt }),
    relationship: a.tool.includes('news') ? 'News coverage' : 'Web result',
    eventId,
  };
}

export class InvestigationService {
  private collect: Collect;
  /** In-flight runs, so tests (and shutdown) can await them. */
  readonly running = new Map<string, Promise<void>>();

  constructor(private deps: InvestigationServiceDeps) {
    this.collect = deps.collect ?? collectArticles;
  }

  async listPublic(limit = 20, cursor?: string): Promise<PublicInvestigationsResponseDto> {
    const page = await this.deps.store.listPublic({ limit: Math.min(Math.max(limit, 1), 50), cursor });
    return { items: page.items.map(toInvestigationDto), ...(page.nextCursor && { nextCursor: page.nextCursor }) };
  }

  async get(id: string): Promise<InvestigationRecord> {
    const r = await this.deps.store.get(id);
    if (!r) throw new InvestigationError(404, 'investigation_not_found', `Investigation "${id}" was not found.`);
    return r;
  }

  async create(input: CreateInvestigationRequestDto): Promise<CreateInvestigationResponseDto> {
    const { topic, context } = cleanRequest(input);
    const now = nowIso();
    const record: InvestigationRecord = {
      id: randomUUID(),
      title: topic.slice(0, MAX_TITLE),
      topic,
      ...(context && { description: context }),
      visibility: 'public', // no authentication yet: every investigation is public
      status: 'active',
      createdAt: now,
      updatedAt: now,
      revision: 1,
      events: [],
    };
    await this.deps.store.create(record);
    const run = await this.startRun(record.id, topic, context);
    return { investigation: toInvestigationDto(record), run };
  }

  async extend(id: string, input: ExtendInvestigationRequestDto): Promise<ExtendInvestigationResponseDto> {
    const { topic, context } = cleanRequest(input);
    await this.get(id);
    const active = await this.deps.store.activeRun(id);
    if (active) {
      throw new InvestigationError(409, 'run_in_progress', 'A research run is already in progress for this investigation.', {
        runId: active.id,
      });
    }
    const run = await this.startRun(id, topic, context);
    return { run, graph: toGraphDto(await this.get(id)) };
  }

  async getRun(id: string, runId: string): Promise<ResearchRunDto> {
    await this.get(id);
    const run = await this.deps.store.getRun(id, runId);
    if (!run) throw new InvestigationError(404, 'run_not_found', `Research run "${runId}" was not found.`);
    return run;
  }

  async listRuns(id: string): Promise<ResearchRunDto[]> {
    await this.get(id);
    return this.deps.store.listRuns(id);
  }

  private async startRun(investigationId: string, topic: string, context?: string): Promise<ResearchRunDto> {
    const run: ResearchRunDto = { id: randomUUID(), investigationId, status: 'queued', startedAt: nowIso() };
    await this.deps.store.createRun(run);
    const p = this.execute(run, topic, context).finally(() => this.running.delete(run.id));
    this.running.set(run.id, p);
    return run;
  }

  private publish(investigationId: string, revision: number, run: ResearchRunDto, evidence?: InvestigationEvidenceDto) {
    this.deps.publish({
      type: 'investigation:updated',
      payload: { investigationId, revision, run, ...(evidence && { evidence }) },
      timestamp: nowIso(),
    });
  }

  /** Never throws: failures are recorded on the run and published. */
  private async execute(queued: ResearchRunDto, topic: string, context?: string): Promise<void> {
    const { store } = this.deps;
    const id = queued.investigationId;
    let run: ResearchRunDto = { ...queued, status: 'running' };
    let revision = 0;
    try {
      await store.updateRun(run);
      const existing = await this.get(id);
      const eventId = `evt-${run.id}`;
      revision = await store.addEvent(id, { id: eventId, title: topic.slice(0, MAX_TITLE), occurredAt: nowIso(), evidence: [] });
      this.publish(id, revision, run);

      const skipIds = existing.events.flatMap((e) => e.evidence.map((ev) => ev.id));
      const { articles, summary } = await this.collect({ query: topic, context, skipIds }, async (article) => {
        const evidence = articleToEvidence(article, eventId);
        revision = await store.addEvidence(id, eventId, evidence);
        this.publish(id, revision, run, evidence);
      });
      if (summary) revision = await store.setEventSummary(id, eventId, summary.slice(0, 1000));

      run = { ...run, status: 'succeeded', completedAt: nowIso() };
      await store.updateRun(run);
      this.publish(id, revision, run);
      logger.info({ investigationId: id, runId: run.id, articles }, 'investigation run succeeded');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Research failed.';
      run = { ...run, status: 'failed', completedAt: nowIso(), error: { code: 'research_failed', message } };
      logger.error({ err, investigationId: id, runId: run.id }, 'investigation run failed');
      await store.updateRun(run).catch((e) => logger.error({ err: e }, 'could not record failed run'));
      const latest = await store.get(id).catch(() => null);
      this.publish(id, latest?.revision ?? revision, run);
    }
  }
}
