/** Shared API contract proposal. Types describe payloads, not currently live endpoints. */
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

/** Transport model; frontend adapter maps events/evidence into Canvas SpineNode values. */
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

export type ChatMessageRole = 'user' | 'assistant';
export type ResearchActionDto = 'answer_question' | 'extend_graph';

export interface SourceCitationDto {
  id: string;
  title: string;
  url: string;
  publisher?: string;
  publishedAt?: IsoDateTime;
  excerpt?: string;
  /** Graph evidence this citation points to (InvestigationEvidenceDto.id), for highlighting. */
  evidenceId?: string;
  /** Event the evidence belongs to (InvestigationEventDto.id). */
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

/** GET /api/investigations/{investigationId}/messages?cursor={opaqueCursor}; items ordered oldest-first within page. */
export interface ChatPageDto {
  investigationId: InvestigationId;
  items: ChatMessageDto[];
  nextCursor?: string;
}

/** POST /api/investigations/{investigationId}/research; accepts text/event-stream. */
export interface ResearchRequestDto {
  investigationId: InvestigationId;
  action: ResearchActionDto;
  message: string;
  conversationId?: string;
}

/** SSE data JSON frames. Emit message_start, token* / sources?, then message_complete; errors use error frame. */
export type ResearchStreamEventDto =
  | { type: 'message_start'; messageId: string; investigationId: InvestigationId }
  | { type: 'token'; text: string }
  | { type: 'sources'; sources: SourceCitationDto[] }
  | { type: 'graph_updated'; graph: InvestigationGraphDto }
  | { type: 'message_complete'; message: ChatMessageDto }
  | { type: 'error'; error: ApiErrorDto };

export interface ApiErrorDto {
  code: string;
  message: string;
  requestId?: string;
  details?: Record<string, unknown>;
}

/**
 * WebSocket frame on /ws: the graph items an answer is citing. Clients viewing this investigation
 * highlight these evidence branches/events and dim the rest. Empty arrays clear the highlight.
 */
export interface InvestigationHighlightEventDto {
  type: 'investigation:highlight';
  payload: {
    investigationId: InvestigationId;
    messageId: string;
    evidenceIds: string[];
    eventIds: string[];
    /** True for the final set once the answer is complete. */
    final: boolean;
  };
  timestamp: IsoDateTime;
}
