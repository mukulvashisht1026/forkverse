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
  /** Broader entity this topic belongs to (e.g. "Donald Trump"), set by claim building. */
  entity?: string;
  /** news: track how a story develops; politician: track the politician's claims and whether they were kept. */
  mode?: 'news' | 'politician';
  visibility: InvestigationVisibility;
  status: 'active' | 'archived';
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  /** From the first question: timeline = development over time (one spine node per period);
   *  snapshot = point-in-time information such as today's weather (one spine node). */
  scope?: 'timeline' | 'snapshot';
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
  /** Chronological claims built from the evidence (absent until build_claims has run). */
  claims?: ClaimDto[];
  claimLinks?: ClaimLinkDto[];
  /** Timeline view: claims grouped into periods with a written summary (built with the claims). */
  periods?: TimelinePeriodDto[];
  scope?: 'timeline' | 'snapshot';
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
  /** Propaganda / manipulation screening of this source (domain listing, optionally content). */
  vetting?: SourceVettingDto;
  /** Lead image of the article (from the search result), used by the newspaper edition. */
  imageUrl?: string;
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
export type ResearchActionDto = 'answer_question' | 'extend_graph' | 'verify_sources' | 'build_claims';

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
  /** Present on verify_sources answers. */
  proof?: ProofReportDto;
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
  /** verify_sources: the graph event whose articles are compared. */
  eventId?: string;
}

/** SSE data JSON frames. Emit message_start, token* / sources?, then message_complete; errors use error frame. */
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
    /** verify_sources: role per evidenceId (consensus / angle / dispute / unreadable). */
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
  /** Earliest publication date among verified evidence. */
  occurredAt?: string;
  /** When it happened, as the articles state it: YYYY, YYYY-MM or YYYY-MM-DD (orders the timeline; falls back to occurredAt). */
  happenedAt?: string;
  evidence: ClaimEvidenceDto[];
  /** Sources that also report this claim but were screened as manipulative: shown red-flagged,
   *  never counted towards the claim's status. */
  prunedEvidence?: ClaimEvidenceDto[];
}

/** One source behind a timeline period or claim (deduplicated by URL). */
export interface TimelineSourceDto {
  title: string;
  url?: string;
  publisher?: string;
  publishedAt?: string;
}

/**
 * Timeline view: one spine node per period (year / month / day, chosen from the span of the claims).
 * Its branches are the period's claims; claims stating the same information are already merged, so a
 * claim with more sources is better supported. The summary is written from those claims only.
 */
export interface TimelinePeriodDto {
  id: string;
  /** e.g. "2010", "June 2010", "12 Jun 2010", "Undated". */
  label: string;
  granularity: 'year' | 'month' | 'day' | 'undated';
  /** Start of the period (ISO date), absent for "Undated". */
  start?: string;
  headline: string;
  /** Short neutral summary of the period's claims (each sentence cites at least one claim). */
  summary: string;
  claimIds: string[];
  sources: TimelineSourceDto[];
  established: number;
  unverified: number;
  writer: 'llm' | 'fallback';
  /** Claims first reported by a live monitor update on this day ("Live · <day>" spine node). */
  live?: boolean;
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

// ---- live monitors (Context.dev Monitors API): watch a source, grow the graph on change ------

/** news_feed: Google News RSS search for the topic; page: one web page; sitemap: new URLs on a site. */
export type MonitorKindDto = 'news_feed' | 'page' | 'sitemap';
export type MonitorStatusDto = 'active' | 'paused' | 'failed';

export interface MonitorDto {
  id: string; // Context.dev monitor id (mon_…)
  investigationId: InvestigationId;
  kind: MonitorKindDto;
  url: string;
  label: string;
  instructions?: string;
  intervalMinutes: number;
  status: MonitorStatusDto;
  /** True when Context.dev pushes changes to our webhook; otherwise the backend polls. */
  webhook: boolean;
  createdAt: IsoDateTime;
  lastCheckedAt?: IsoDateTime;
  lastChangeAt?: IsoDateTime;
  lastError?: string;
  /** Changes that added evidence to the graph. */
  changesApplied: number;
  /** Fast checking: the backend triggers a check every N seconds (5 | 10 | 30) until fastUntil. */
  fastCheckSeconds?: number;
  fastUntil?: IsoDateTime;
}

/** PATCH /investigations/:id/monitors/:monitorId - 0 switches fast checking off. */
export interface UpdateMonitorRequestDto {
  fastCheckSeconds: 0 | 5 | 10 | 30;
}

export interface CreateMonitorRequestDto {
  kind: MonitorKindDto;
  /** Required for page/sitemap; news_feed defaults to a Google News RSS search for the topic. */
  url?: string;
  /** page only: which changes matter (switches detection to semantic). */
  instructions?: string;
  /** 10..1440, default 15. */
  intervalMinutes?: number;
}

export type MonitorPhaseDto = 'checking' | 'no_change' | 'change_detected' | 'evidence_added' | 'claims_updated' | 'error';

/** WebSocket frame: what a live monitor just did (drives the LIVE activity feed + toast). */
export interface InvestigationMonitorEvent {
  type: 'investigation:monitor';
  payload: {
    investigationId: InvestigationId;
    monitorId: string;
    phase: MonitorPhaseDto;
    message: string;
    /** Headline of the detected change (Context.dev change title). */
    title?: string;
    /** Evidence items added to the graph by this change. */
    added?: number;
    /** Claims that did not exist before this change (highlighted in the graph). */
    newClaimIds?: string[];
    /** The monitored website. */
    url?: string;
  };
  timestamp: IsoDateTime;
}

/** A page that is updating right now about the topic (candidate for a live page monitor). */
export interface LiveSourceDto {
  url: string;
  title: string;
  publisher?: string;
  publishedAt?: IsoDateTime;
  /** Minutes since the source's latest publication/update, when known. */
  minutesSinceUpdate?: number;
  /** Timestamped update entries counted on the page when it was read just now. */
  updateStamps?: number;
  /** Higher = fresher and more frequently updated. */
  score: number;
  /** Human-readable reasons ("live page", "published 4 min ago", "23 timestamped updates"). */
  signals: string[];
  readable: boolean;
  error?: string;
}

// ---- source vetting (propaganda / manipulation screening) -------------------------------------

/** credible: no manipulation signal and at least one positive check; manipulative: documented
 *  influence operation or grounded propaganda rhetoric; uncertain: everything else (abstain). */
export type VettingVerdictDto = 'credible' | 'uncertain' | 'manipulative';

/** Sources scoring above this (0-100) are red-flagged in the graph. */
export const PROPAGANDA_FLAG_THRESHOLD = 74;

// isManipulativeVetting: runtime helper in backend/src/investigations/types.ts and frontend/src/utils/vetting.ts
// (the frontend Docker build only sees frontend/, so this file must stay import-type-only for it).

/** Listing of the source's domain in public research/government lists (backend/data/SOURCE_RATINGS.md). */
export interface SourceRatingDto {
  domain: string;
  /** Dataset label. */
  label: 'propaganda' | 'unreliable' | 'satire' | 'reliable';
  /** How the listing is used: only influence_operation counts as manipulative on its own. */
  kind: 'influence_operation' | 'state_media' | 'unreliable' | 'satire' | 'reliable';
  confidence: 'high' | 'medium' | 'low';
  /** Who runs the operation (documented influence operations / state media). */
  actorCountry?: string;
  subtypes: string[];
  /** Lists that name this domain (e.g. meta_cib, viginum_portal_kombat, lin2023). */
  listedBy: string[];
  /** Lin et al. 2023 ensemble quality score, 0 (worst) .. 1 (best). */
  qualityScore?: number;
  name?: string;
}

export type RhetoricTechniqueNameDto =
  | 'loaded_language' | 'fear_or_prejudice' | 'name_calling' | 'false_dilemma' | 'causal_oversimplification'
  | 'whataboutism' | 'straw_man' | 'repetition' | 'exaggeration_or_minimisation' | 'appeal_to_popularity'
  | 'appeal_to_authority' | 'flag_waving' | 'slogans' | 'doubt' | 'dehumanization' | 'smears' | 'other';

export interface RhetoricTechniqueDto {
  technique: RhetoricTechniqueNameDto;
  /** Verbatim passage, verified against the scraped page text. */
  quote: string;
  explanation: string;
  /** Only the author's own voice counts towards a propaganda verdict. */
  voice: 'author' | 'quoted_speaker' | 'unclear';
}

export interface RhetoricAnalysisDto {
  verdict: 'likely_propaganda' | 'no_clear_evidence' | 'uncertain';
  /** The model's verdict before grounding rules (kept when the rules downgrade it). */
  modelVerdict: 'likely_propaganda' | 'no_clear_evidence' | 'uncertain';
  /** data = pages that mainly show data (weather, prices, scores, schedules): never assessed. */
  genre: 'reporting' | 'opinion' | 'satire' | 'advertising' | 'landing_page' | 'data' | 'other';
  language: string;
  rationale: string;
  techniques: RhetoricTechniqueDto[];
  /** Signs against a propaganda reading (sourcing, balance, attributed quotes...). */
  counterevidence: string[];
  /** 0-100: how strongly the page's own text relies on propaganda techniques, after grounding
   *  (above 60 only with a verified finding; no clear evidence stays at or below 40). */
  score: number;
  /** Why the verdict was downgraded (ungrounded quotes, too few author passages, partial text...). */
  warnings: string[];
}

export interface SourceVettingDto {
  url: string;
  verdict: VettingVerdictDto;
  /** Share of checks that produced a signal (domain listing, content analysis): 0..1. */
  coverage: number;
  /** 0-100 propaganda score (rhetoric score; documented influence operations at least 90).
   *  Absent when neither signal is available. Above PROPAGANDA_FLAG_THRESHOLD = red flag. */
  propagandaScore?: number;
  /** Human-readable, attributed reasons for the verdict. */
  reasons: string[];
  rating?: SourceRatingDto;
  rhetoric?: RhetoricAnalysisDto;
  /** domain = list lookup only; content = page text analysed too. */
  depth: 'domain' | 'content';
  checkedAt: IsoDateTime;
  /** Content analysis failed (page unreadable...): kept visible, never counted as risky or safe. */
  error?: string;
}

/** WebSocket frame: progress of a source vetting run on an investigation. */
export interface InvestigationVettingEvent {
  type: 'investigation:vetting';
  payload: {
    investigationId: InvestigationId;
    phase: 'started' | 'checked' | 'done' | 'error';
    message: string;
    evidenceId?: string;
    verdict?: VettingVerdictDto;
    checked?: number;
    total?: number;
  };
  timestamp: IsoDateTime;
}

// ---- newspaper edition (GET /investigations/:id/newspaper[.html]) ------------------------------

export interface NewspaperSourceDto {
  title: string;
  url: string;
  publisher?: string;
  publishedAt?: IsoDateTime;
}

export interface NewspaperStoryDto {
  /** Claim the story is about (graph node id). */
  claimId?: string;
  kicker: string;
  headline: string;
  /** Short standfirst / summary. */
  dek: string;
  /** Body paragraphs (lead story only), each written from the cited claims. */
  paragraphs: string[];
  /** established / pending (shown as "Unverified") / disputed, from the claim graph. */
  status?: 'established' | 'pending' | 'disputed';
  imageUrl?: string;
  imageCredit?: string;
  sources: NewspaperSourceDto[];
  date?: IsoDateTime;
}

export interface NewspaperEditionDto {
  investigationId: InvestigationId;
  /** Graph state the edition was written from (claimsUpdatedAt + evidence count + flags). */
  stateKey: string;
  title: string;
  entity?: string;
  editionDate: IsoDateTime;
  editionNumber: number;
  /** One-sentence "story so far". */
  crux: string;
  lead: NewspaperStoryDto;
  stories: NewspaperStoryDto[];
  briefs: NewspaperStoryDto[];
  /** Chronology of established developments. */
  timeline: { date?: IsoDateTime; text: string; status: 'established' | 'pending' | 'disputed' }[];
  stats: { sources: number; established: number; unverified: number; flagged: number };
  /** Red-flagged sources left out of the edition (propaganda watch box). */
  propagandaWatch: { title: string; publisher?: string; score?: number }[];
  /** llm = written by the editor model from the claims; fallback = composed directly from claims. */
  writer: 'llm' | 'fallback';
  generatedAt: IsoDateTime;
}
