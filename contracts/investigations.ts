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

export interface ApiErrorDto {
  code: string;
  message: string;
  requestId?: string;
  details?: Record<string, unknown>;
}
