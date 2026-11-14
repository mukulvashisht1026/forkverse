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
  /** Broader entity this topic belongs to (e.g. "Donald Trump"), set by claim building. */
  entity?: string;
  /** news: track how a story develops; politician: track the politician's claims and whether they were kept. */
  mode?: 'news' | 'politician';
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
  /** Chronological claims built from the evidence (absent until build_claims has run). */
  claims?: ClaimDto[];
  claimLinks?: ClaimLinkDto[];
  entity?: string;
  /** news | politician: how the claim graph should be read (politician: outcome branches only). */
  mode?: 'news' | 'politician';
  claimsUpdatedAt?: IsoDateTime;
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
  /** Topic planner output used for research relevance. */
  plan?: { queries: string[]; keyTerms: string[] };
  events: InvestigationEventDto[];
  claims?: ClaimDto[];
  claimLinks?: ClaimLinkDto[];
  claimsUpdatedAt?: IsoDateTime;
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
export type ResearchActionDto = 'answer_question' | 'extend_graph' | 'verify_sources' | 'build_claims';

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
  proof?: ProofReportDto;
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
  eventId?: string;
}

export type ResearchStreamEventDto =
  | { type: 'message_start'; messageId: string; investigationId: InvestigationId }
  | { type: 'token'; text: string }
  | { type: 'sources'; sources: SourceCitationDto[] }
  | { type: 'graph_updated'; graph: InvestigationGraphDto }
  | { type: 'proof'; report: ProofReportDto }
  /** What the frontend should light up for this answer (graph node ids = claims or events). */
  | { type: 'highlight'; nodeIds: string[]; evidenceIds: string[]; roles?: Record<string, ProofRoleDto> }
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
    roles?: Record<string, ProofRoleDto>;
  };
  timestamp: IsoDateTime;
}

// ---- proof engine (action verify_sources) ------------------------------------------------

/** How an article relates to the others in a proof run (drives graph colouring). */
export type ProofRoleDto = 'consensus' | 'angle' | 'dispute' | 'unreadable';

export interface ProofSourceDto {
  id: string; // S1..Sn, same labels as the [[source:Sn]] citations
  evidenceId: string;
  title: string;
  url: string;
  publisher?: string;
  readable: boolean;
  error?: string;
  role: ProofRoleDto;
}

export interface ProofQuoteDto {
  source: string; // S label
  quote: string; // verbatim, verified against the scraped article text
}

export interface ProofReportDto {
  investigationId: string;
  eventId: string;
  eventTitle: string;
  sources: ProofSourceDto[];
  /** Corroborator: facts supported by at least two outlets, with verified quotes. */
  consensus: { fact: string; support: ProofQuoteDto[] }[];
  /** Skeptic: how each outlet frames the story. */
  angles: { source: string; angle: string; quote?: string }[];
  /** Skeptic: details only one outlet reports. */
  unique: { source: string; detail: string; quote: string }[];
  /** Skeptic: points where outlets disagree. */
  disputes: { point: string; positions: { source: string; position: string; quote: string }[] }[];
  stats: { articles: number; readable: number; quotesVerified: number; quotesRejected: number };
  /** Full synthesis (Markdown with [[source:Sn]] citations); the chat shows only the verdict. */
  summary?: string;
}

// ---- claims (action build_claims): Entity -> Topic -> Claims -> Evidence --------------------

export type ClaimStatusDto = 'established' | 'pending';
export type ClaimKindDto = 'statement' | 'position' | 'development';
export type EvidenceStanceDto = 'supports' | 'contradicts' | 'context';

export interface ClaimEvidenceDto {
  evidenceId: string; // InvestigationEvidenceDto.id
  stance: EvidenceStanceDto;
  quote: string; // verbatim, verified against the article text
  /** One-sentence summary of what the (scraped) article says. */
  summary?: string;
  /** politician mode: 'source' reports the claim itself, 'outcome' reports whether it happened. */
  role?: 'source' | 'outcome';
  title: string;
  publisher?: string;
  url?: string;
  publishedAt?: string;
}

export interface ClaimDto {
  id: string;
  statement: string; // e.g. "Trump promised to reduce taxes."
  kind: ClaimKindDto;
  /** established: enough reliable, independent evidence; pending: not (yet) - never shown as fact. */
  status: ClaimStatusDto;
  /** Human-readable reason for the status (which/how many independent sources, what is missing). */
  statusReason: string;
  /** Contradicting evidence exists; perspectives are preserved, not averaged. */
  disputed: boolean;
  /** politician mode: what later articles say happened to the claim/promise. */
  outcome?: 'fulfilled' | 'not_fulfilled' | 'in_progress' | 'no_update';
  /** Earliest publication date among verified evidence (chronological order). */
  occurredAt?: string;
  evidence: ClaimEvidenceDto[];
}

export interface ClaimLinkDto {
  id: string;
  from: string; // ClaimDto.id (earlier)
  to: string; // ClaimDto.id (later)
  type: 'evolution' | 'follow_up' | 'potential_inconsistency';
  /** stated: a source draws the connection; sequence_only: only the order is known; inferred: analyst inference. */
  basis: 'stated' | 'sequence_only' | 'inferred';
  description: string; // neutral wording; never asserts intent or causation
}
