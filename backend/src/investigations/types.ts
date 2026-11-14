/**
 * Investigation API wire types. Mirrors contracts/investigations.ts at the repo root (the backend
 * Docker build context is backend/, so it cannot import that file): keep both in sync.
 */

export type InvestigationId = string;
export type ResearchRunId = string;
export type IsoDateTime = string;
export type InvestigationVisibility = 'public' | 'private';
export type ResearchRunStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface InvestigationDto {
  id: InvestigationId;
  title: string;
  topic: string;
  description?: string;
  visibility: InvestigationVisibility;
  status: 'active' | 'archived';
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface ResearchRunDto {
  id: ResearchRunId;
  investigationId: InvestigationId;
  status: ResearchRunStatus;
  startedAt: IsoDateTime;
  completedAt?: IsoDateTime;
  error?: ApiErrorDto;
}

export interface InvestigationGraphDto {
  investigationId: InvestigationId;
  revision: number;
  updatedAt: IsoDateTime;
  events: InvestigationEventDto[];
}

export interface InvestigationEventDto {
  id: string;
  title: string;
  occurredAt?: IsoDateTime;
  summary?: string;
  evidence: InvestigationEvidenceDto[];
}

export interface InvestigationEvidenceDto {
  id: string;
  title: string;
  excerpt?: string;
  sourceName?: string;
  sourceUrl?: string;
  publishedAt?: IsoDateTime;
  relationship?: string;
  eventId?: string;
}

export interface CreateInvestigationRequestDto {
  topic: string;
  context?: string;
}

export interface CreateInvestigationResponseDto {
  investigation: InvestigationDto;
  run: ResearchRunDto;
}

export interface ExtendInvestigationRequestDto {
  topic: string;
  context?: string;
}

export interface ExtendInvestigationResponseDto {
  run: ResearchRunDto;
  graph: InvestigationGraphDto;
}

export interface PublicInvestigationsResponseDto {
  items: InvestigationDto[];
  nextCursor?: string;
}

export interface ApiErrorDto {
  code: string;
  message: string;
  requestId?: string;
  details?: Record<string, unknown>;
}

/** Stored form: investigation metadata plus its graph (events with embedded evidence). */
export interface InvestigationRecord extends InvestigationDto {
  revision: number;
  events: InvestigationEventDto[];
}

/** WebSocket frame for investigation-scoped updates; clients filter by investigationId + revision. */
export interface InvestigationUpdatedEvent {
  type: 'investigation:updated';
  payload: {
    investigationId: InvestigationId;
    revision: number;
    run: ResearchRunDto;
    /** Present when an evidence item was just added. */
    evidence?: InvestigationEvidenceDto;
  };
  timestamp: IsoDateTime;
}

// ---- research chat (POST /investigations/:id/research, GET …/messages) ----------------------

export type ChatMessageRole = 'user' | 'assistant';
export type ResearchActionDto = 'answer_question' | 'extend_graph';

export interface SourceCitationDto {
  id: string;
  title: string;
  url: string;
  publisher?: string;
  publishedAt?: IsoDateTime;
  excerpt?: string;
  evidenceId?: string;
  eventId?: string;
}

export interface ChatMessageDto {
  id: string;
  investigationId: InvestigationId;
  role: ChatMessageRole;
  content: string;
  sources: SourceCitationDto[];
  createdAt: IsoDateTime;
  runId?: ResearchRunId;
}

export interface ChatPageDto {
  investigationId: InvestigationId;
  items: ChatMessageDto[];
  nextCursor?: string;
}

export interface ResearchRequestDto {
  investigationId: InvestigationId;
  action: ResearchActionDto;
  message: string;
  conversationId?: string;
}

export type ResearchStreamEventDto =
  | { type: 'message_start'; messageId: string; investigationId: InvestigationId }
  | { type: 'token'; text: string }
  | { type: 'sources'; sources: SourceCitationDto[] }
  | { type: 'graph_updated'; graph: InvestigationGraphDto }
  | { type: 'message_complete'; message: ChatMessageDto }
  | { type: 'error'; error: ApiErrorDto };

export interface InvestigationHighlightEvent {
  type: 'investigation:highlight';
  payload: {
    investigationId: InvestigationId;
    messageId: string;
    evidenceIds: string[];
    eventIds: string[];
    final: boolean;
  };
  timestamp: IsoDateTime;
}
