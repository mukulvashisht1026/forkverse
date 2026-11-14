import type { SpineNode } from '../types/tree';
import type {
  ApiErrorDto,
  CreateInvestigationRequestDto,
  CreateMonitorRequestDto,
  LiveSourceDto,
  MonitorDto,
  MonitorPhaseDto,
  CreateInvestigationResponseDto,
  ExtendInvestigationRequestDto,
  ExtendInvestigationResponseDto,
  InvestigationDto,
  InvestigationGraphDto,
  PublicInvestigationsResponseDto,
  ResearchRunDto,
  ResearchRunStatus,
} from '../../../contracts/investigations';
import { resolveApiUrl, resolveWsUrl } from '../utils/timelineReducer';
import { claimsToSpineNodes, investigationEventsToSpineNodes } from './investigationGraphAdapter';

/** View model consumed by Home and Workspace; isolated from wire DTOs. */
export interface Investigation {
  id: string;
  title: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ClaimLink {
  from: string;
  to: string;
  type: 'evolution' | 'follow_up' | 'potential_inconsistency';
  basis: 'stated' | 'sequence_only' | 'inferred';
  description: string;
}

export interface InvestigationGraph {
  investigationId: string;
  /** Monotonic graph revision from the backend; newer graphs have higher numbers. */
  revision: number;
  nodes: SpineNode[];
  /** Claim timeline (present once claims were built): chronological claims as spine nodes. */
  claimNodes?: SpineNode[];
  claimLinks?: ClaimLink[];
  /** Broader entity the topic belongs to (Entity -> Topic). */
  entity?: string;
  mode?: 'news' | 'politician';
}

export type CreateInvestigationInput = CreateInvestigationRequestDto;
export type InvestigationRepository = Pick<InvestigationApi,
  'listPublicInvestigations' | 'getInvestigation' | 'renameInvestigation' | 'getInvestigationGraph' | 'createInvestigation' | 'extendInvestigation'>;

/** Decoupled frontend data boundary consumed by the UI. */
export interface InvestigationApi {
  listPublicInvestigations(): Promise<Investigation[]>;
  getInvestigation(id: string): Promise<Investigation>;
  renameInvestigation(id: string, title: string): Promise<Investigation>;
  getInvestigationGraph(id: string): Promise<InvestigationGraph>;
  /** Persists the investigation and starts research; returns before research finishes. */
  createInvestigation(input: CreateInvestigationInput): Promise<Investigation>;
  /** Starts another research run and resolves with the graph once that run has finished. */
  extendInvestigation(id: string, input: CreateInvestigationInput): Promise<InvestigationGraph>;
}

export class CapabilityUnavailableError extends Error {
  constructor(capability: string) {
    super(`${capability} is not available from the current backend.`);
    this.name = 'CapabilityUnavailableError';
  }
}

/** Backend error with the contract's machine-readable code (ApiErrorDto). */
export class InvestigationApiError extends Error {
  constructor(message: string, public code: string, public status: number, public requestId?: string) {
    super(message);
    this.name = 'InvestigationApiError';
  }
}

export function mapInvestigationDto(dto: InvestigationDto): Investigation {
  return { id: dto.id, title: dto.title, description: dto.description, createdAt: dto.createdAt, updatedAt: dto.updatedAt };
}

/** Events -> main spine nodes, evidence -> branches (see investigationGraphAdapter). */
export function mapInvestigationGraphDto(dto: InvestigationGraphDto): InvestigationGraph {
  return {
    investigationId: dto.investigationId,
    revision: dto.revision,
    nodes: investigationEventsToSpineNodes(dto.events),
    ...(dto.claims?.length ? { claimNodes: claimsToSpineNodes(dto.claims, dto.mode), claimLinks: dto.claimLinks ?? [] } : {}),
    ...(dto.entity ? { entity: dto.entity } : {}),
    ...(dto.mode ? { mode: dto.mode } : {}),
  };
}

// ---- HTTP adapter (backend: backend/src/routes/investigations.ts) ------------------------

// Optional chaining: import.meta.env only exists under Vite (not in node:test).
const API_BASE = import.meta.env?.VITE_API_BASE_URL ?? '';
const WS_BASE = import.meta.env?.VITE_WS_URL ?? '';
const RUN_POLL_MS = 1500;
const RUN_TIMEOUT_MS = 5 * 60_000;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(resolveApiUrl(path, API_BASE), {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(15_000),
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new InvestigationApiError('The backend request timed out. Research may still be running; retry or open investigation list.', 'request_timeout', 0);
    }
    throw new InvestigationApiError('The research backend could not be reached.', 'network_error', 0);
  }
  const body = (await res.json().catch(() => null)) as (T & Partial<ApiErrorDto>) | null;
  if (!res.ok) {
    const message = res.status === 408
      ? 'Research request timed out. Backend did not respond in time. Try again; if this repeats, check backend logs and provider status.'
      : body?.message || `Backend request failed (${res.status}).`;
    throw new InvestigationApiError(
      message,
      body?.code || 'http_error',
      res.status,
      body?.requestId,
    );
  }
  return body as T;
}

const path = (id: string, rest = '') => `/api/investigations/${encodeURIComponent(id)}${rest}`;
const isActive = (status: ResearchRunStatus) => status === 'queued' || status === 'running';

async function waitForRun(investigationId: string, runId: string): Promise<ResearchRunDto> {
  const deadline = Date.now() + RUN_TIMEOUT_MS;
  for (;;) {
    const run = await request<ResearchRunDto>(path(investigationId, `/runs/${encodeURIComponent(runId)}`));
    if (!isActive(run.status)) {
      if (run.status === 'failed') {
        throw new InvestigationApiError(run.error?.message || 'Research run failed.', run.error?.code || 'research_failed', 200);
      }
      return run;
    }
    if (Date.now() > deadline) throw new InvestigationApiError('Research is taking longer than expected.', 'run_timeout', 0);
    await new Promise((r) => setTimeout(r, RUN_POLL_MS));
  }
}

export const investigationRepository: InvestigationApi = {
  async listPublicInvestigations(): Promise<Investigation[]> {
    const res = await request<PublicInvestigationsResponseDto>('/api/investigations?visibility=public');
    return res.items.map(mapInvestigationDto);
  },
  async getInvestigation(id: string): Promise<Investigation> {
    return mapInvestigationDto(await request<InvestigationDto>(path(id)));
  },
  async renameInvestigation(id: string, title: string): Promise<Investigation> {
    return mapInvestigationDto(await request<InvestigationDto>(path(id), { method: 'PATCH', body: JSON.stringify({ title }) }));
  },
  async getInvestigationGraph(id: string): Promise<InvestigationGraph> {
    return mapInvestigationGraphDto(await request<InvestigationGraphDto>(path(id, '/graph')));
  },
  async createInvestigation(input: CreateInvestigationRequestDto): Promise<Investigation> {
    const res = await request<CreateInvestigationResponseDto>('/api/investigations', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return mapInvestigationDto(res.investigation);
  },
  async extendInvestigation(id: string, input: ExtendInvestigationRequestDto): Promise<InvestigationGraph> {
    const res = await request<ExtendInvestigationResponseDto>(path(id, '/runs'), {
      method: 'POST',
      body: JSON.stringify(input),
    });
    await waitForRun(id, res.run.id);
    return this.getInvestigationGraph(id);
  },
};

// ---- live monitors (Context.dev Monitors API) -------------------------------------------

export type Monitor = MonitorDto;
export type LiveSource = LiveSourceDto;

/** Same default feed the backend uses for kind "news_feed" (shown before the monitor is created). */
export function newsFeedUrl(topic: string): string {
  return `https://news.google.com/rss/search?${new URLSearchParams({ q: topic, hl: 'en-US', gl: 'US', ceid: 'US:en' })}`;
}
export type CreateMonitorInput = CreateMonitorRequestDto;

export const monitorRepository = {
  async list(investigationId: string): Promise<Monitor[]> {
    return (await request<{ items: MonitorDto[] }>(path(investigationId, '/monitors'))).items;
  },
  async create(investigationId: string, input: CreateMonitorRequestDto): Promise<Monitor> {
    return request<MonitorDto>(path(investigationId, '/monitors'), { method: 'POST', body: JSON.stringify(input), signal: AbortSignal.timeout(45_000) });
  },
  /** Pages updating right now about the topic, best first (reads the top candidates live). */
  async suggest(investigationId: string): Promise<LiveSource[]> {
    return (await request<{ items: LiveSourceDto[] }>(path(investigationId, '/monitors/suggestions'), { signal: AbortSignal.timeout(90_000) })).items;
  },
  async remove(investigationId: string, monitorId: string): Promise<void> {
    await request<null>(path(investigationId, `/monitors/${encodeURIComponent(monitorId)}`), { method: 'DELETE' });
  },
  async checkNow(investigationId: string, monitorId: string): Promise<void> {
    await request<{ runId: string }>(path(investigationId, `/monitors/${encodeURIComponent(monitorId)}/check`), { method: 'POST', body: '{}' });
  },
};

/** What a live monitor just did (`investigation:monitor` frame). */
export interface MonitorActivity {
  monitorId: string;
  phase: MonitorPhaseDto;
  message: string;
  title?: string;
  added?: number;
  newClaimIds?: string[];
  /** The monitored website. */
  url?: string;
  timestamp: string;
}

// ---- live updates over /ws ------------------------------------------------------------

/** Graph items cited by the current research answer (from `investigation:highlight`). */
export interface InvestigationHighlight {
  messageId: string;
  evidenceIds: ReadonlySet<string>;
  eventIds: ReadonlySet<string>;
  /** True once the answer is complete (final cited set). Empty sets clear the highlight. */
  final: boolean;
  /** Proof engine (verify_sources): role per evidenceId, used to colour the graph. */
  roles?: ReadonlyMap<string, ProofRole>;
}

export type ProofRole = 'consensus' | 'angle' | 'dispute' | 'unreadable';
const PROOF_ROLES: ReadonlySet<string> = new Set(['consensus', 'angle', 'dispute', 'unreadable']);

export function rolesFrom(value: unknown): ReadonlyMap<string, ProofRole> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const entries = Object.entries(value as Record<string, unknown>).filter((e): e is [string, ProofRole] => typeof e[1] === 'string' && PROOF_ROLES.has(e[1]));
  return entries.length ? new Map(entries) : undefined;
}

export interface InvestigationUpdate {
  revision: number;
  runStatus: ResearchRunStatus;
  /** True when this update added an evidence item. */
  addedEvidence: boolean;
  /** Run that produced the update (live monitor runs are "mon-…"). */
  runId?: string;
  /** Evidence just added, and the event (timeline node) it belongs to. */
  evidenceId?: string;
  eventId?: string;
}

/**
 * Subscribe to `investigation:updated` frames for ONE investigation. Frames for other
 * investigations and stale revisions are dropped. After a reconnect `onResync` fires so the
 * caller can re-fetch the graph (frames sent while disconnected are not replayed).
 * Returns an unsubscribe function.
 */
export function watchInvestigation(
  investigationId: string,
  handlers: {
    onUpdate: (update: InvestigationUpdate) => void;
    onResync?: () => void;
    /** Citation highlight for this investigation (answer streaming / complete / cleared). */
    onHighlight?: (highlight: InvestigationHighlight) => void;
    /** Live monitor progress (change detected, sources added, claims updated…). */
    onMonitor?: (activity: MonitorActivity) => void;
  },
): () => void {
  let socket: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let opened = false;
  let lastRevision = 0;
  let retry: number | undefined;

  const connect = () => {
    if (closed) return;
    socket = new WebSocket(resolveWsUrl(WS_BASE));
    socket.onopen = () => {
      if (opened) handlers.onResync?.();
      opened = true;
      attempt = 0;
    };
    socket.onmessage = (evt) => {
      let frame: {
        type?: string;
        timestamp?: string;
        payload?: {
          monitorId?: string;
          phase?: MonitorPhaseDto;
          message?: string;
          title?: string;
          added?: number;
          newClaimIds?: unknown;
          url?: string;
          investigationId?: string;
          revision?: number;
          run?: ResearchRunDto;
          evidence?: unknown;
          messageId?: string;
          evidenceIds?: unknown;
          eventIds?: unknown;
          final?: boolean;
          roles?: unknown;
        };
      };
      try {
        frame = JSON.parse(String(evt.data));
      } catch {
        return;
      }
      const p = frame.payload;
      if (!p || p.investigationId !== investigationId) return;
      if (frame.type === 'investigation:highlight') {
        const ids = (v: unknown) => new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
        const roles = rolesFrom(p.roles);
        handlers.onHighlight?.({ messageId: String(p.messageId ?? ''), evidenceIds: ids(p.evidenceIds), eventIds: ids(p.eventIds), final: Boolean(p.final), ...(roles && { roles }) });
        return;
      }
      if (frame.type === 'investigation:monitor') {
        if (!p.monitorId || !p.phase) return;
        handlers.onMonitor?.({
          monitorId: p.monitorId,
          phase: p.phase,
          message: String(p.message ?? ''),
          ...(p.title && { title: p.title }),
          ...(typeof p.added === 'number' && { added: p.added }),
          ...(Array.isArray(p.newClaimIds) && { newClaimIds: p.newClaimIds.filter((x): x is string => typeof x === 'string') }),
          ...(typeof p.url === 'string' && { url: p.url }),
          timestamp: frame.timestamp ?? new Date().toISOString(),
        });
        return;
      }
      if (frame.type !== 'investigation:updated') return;
      if (typeof p.revision !== 'number' || p.revision < lastRevision || !p.run) return;
      lastRevision = p.revision;
      const ev = p.evidence && typeof p.evidence === 'object' ? (p.evidence as { id?: unknown; eventId?: unknown }) : undefined;
      handlers.onUpdate({
        revision: p.revision,
        runStatus: p.run.status,
        addedEvidence: Boolean(p.evidence),
        ...(typeof p.run.id === 'string' && { runId: p.run.id }),
        ...(typeof ev?.id === 'string' && { evidenceId: ev.id }),
        ...(typeof ev?.eventId === 'string' && { eventId: ev.eventId }),
      });
    };
    socket.onclose = () => {
      if (closed) return;
      retry = window.setTimeout(connect, Math.min(10_000, 1000 * 2 ** attempt++));
    };
    socket.onerror = () => socket?.close();
  };

  connect();
  return () => {
    closed = true;
    window.clearTimeout(retry);
    socket?.close();
  };
}
