import type { SpineNode } from '../types/tree';
import type {
  ApiErrorDto,
  CreateInvestigationRequestDto,
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
import { investigationEventsToSpineNodes } from './investigationGraphAdapter';

/** View model consumed by Home and Workspace; isolated from wire DTOs. */
export interface Investigation {
  id: string;
  title: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface InvestigationGraph {
  investigationId: string;
  /** Monotonic graph revision from the backend; newer graphs have higher numbers. */
  revision: number;
  nodes: SpineNode[];
}

export type CreateInvestigationInput = CreateInvestigationRequestDto;
export type InvestigationRepository = Pick<InvestigationApi,
  'listPublicInvestigations' | 'getInvestigation' | 'getInvestigationGraph' | 'createInvestigation' | 'extendInvestigation'>;

/** Decoupled frontend data boundary consumed by the UI. */
export interface InvestigationApi {
  listPublicInvestigations(): Promise<Investigation[]>;
  getInvestigation(id: string): Promise<Investigation>;
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
  return { investigationId: dto.investigationId, revision: dto.revision, nodes: investigationEventsToSpineNodes(dto.events) };
}

// ---- HTTP adapter (backend: backend/src/routes/investigations.ts) ------------------------

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';
const WS_BASE = import.meta.env.VITE_WS_URL ?? '';
const RUN_POLL_MS = 1500;
const RUN_TIMEOUT_MS = 5 * 60_000;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(resolveApiUrl(path, API_BASE), {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    throw new InvestigationApiError('The research backend could not be reached.', 'network_error', 0);
  }
  const body = (await res.json().catch(() => null)) as (T & Partial<ApiErrorDto>) | null;
  if (!res.ok) {
    throw new InvestigationApiError(
      body?.message || `Backend request failed (${res.status}).`,
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

// ---- live updates over /ws ------------------------------------------------------------

export interface InvestigationUpdate {
  revision: number;
  runStatus: ResearchRunStatus;
  /** True when this update added an evidence item. */
  addedEvidence: boolean;
}

/**
 * Subscribe to `investigation:updated` frames for ONE investigation. Frames for other
 * investigations and stale revisions are dropped. After a reconnect `onResync` fires so the
 * caller can re-fetch the graph (frames sent while disconnected are not replayed).
 * Returns an unsubscribe function.
 */
export function watchInvestigation(
  investigationId: string,
  handlers: { onUpdate: (update: InvestigationUpdate) => void; onResync?: () => void },
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
      let frame: { type?: string; payload?: { investigationId?: string; revision?: number; run?: ResearchRunDto; evidence?: unknown } };
      try {
        frame = JSON.parse(String(evt.data));
      } catch {
        return;
      }
      const p = frame.payload;
      if (frame.type !== 'investigation:updated' || !p || p.investigationId !== investigationId) return;
      if (typeof p.revision !== 'number' || p.revision < lastRevision || !p.run) return;
      lastRevision = p.revision;
      handlers.onUpdate({ revision: p.revision, runStatus: p.run.status, addedEvidence: Boolean(p.evidence) });
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
