# Investigation API contract (proposal)

Audience: frontend/backend developers and coding assistants working on Ghostline. Read this before changing investigation data flow.

## Status and scope

This is a versioned-in-repository TypeScript contract. The backend implements it and the frontend adapter uses it (see "Implemented backend API"). DTOs live in `contracts/investigations.ts`; frontend ports and view models live in `frontend/src/services/investigations.ts`; the Canvas adapter lives in `frontend/src/services/investigationGraphAdapter.ts`.

The frontend server currently exposes one process-local global timeline. It is not durable and has no investigation ID, public library, investigation-specific graph, creation, extension, or scoped WebSocket events. Do not wire the global timeline or `/api/scrape-event` / `/api/prompt` as persistent investigation operations. Do not add fake records or claim these flows work end-to-end.

## Domain terms

- **Investigation**: stable, durable research resource with `id`, `topic`, title, visibility, status, timestamps.
- **ResearchRun**: one execution associated with an investigation; an investigation can have many runs.
- **Event**: chronological item within an investigation.
- **Evidence**: source-backed item, optionally associated with an event.
- **Chat message**: conversational UI data, not evidence unless a research operation returns a persisted evidence DTO.

## Implemented backend API (main)

The backend now implements this contract (`backend/src/investigations/`, `backend/src/routes/investigations.ts`). Routes are served under `/api` (and without the prefix):

| Method and path | Response |
|---|---|
| `GET /api/investigations?visibility=public&limit=20&cursor=…` | `PublicInvestigationsResponseDto`, newest first, with an opaque `nextCursor` |
| `POST /api/investigations` `{topic, context?}` | `202 CreateInvestigationResponseDto`. The run starts `queued` and executes in the background |
| `GET /api/investigations/:id` | `InvestigationDto` |
| `GET /api/investigations/:id/graph` | `InvestigationGraphDto` |
| `POST /api/investigations/:id/runs` `{topic, context?}` | `202 ExtendInvestigationResponseDto` (graph = snapshot at request time). `409 run_in_progress` while a run is active |
| `GET /api/investigations/:id/runs` | `{ items: ResearchRunDto[] }`, newest first |
| `GET /api/investigations/:id/runs/:runId` | `ResearchRunDto` (poll until `succeeded` / `failed`) |

Errors are `ApiErrorDto`: `invalid_topic` / `invalid_request` (400), `investigation_not_found` / `run_not_found` (404), `run_in_progress` (409), and `requestId` is set.

Research chat (RAG over the graph), implemented in `backend/src/investigations/chat.ts`:

| Method and path | Response |
|---|---|
| `GET /api/investigations/:id/messages?cursor=…` | `ChatPageDto`: the newest 30 messages, oldest-first. `nextCursor` pages to older messages |
| `POST /api/investigations/:id/research` `ResearchRequestDto` | `text/event-stream` of `ResearchStreamEventDto`: `message_start`, `token`*, `graph_updated` (extend only), `sources`, `message_complete`, or `error`. Validation failures (404, 400, 409) return plain JSON before the stream starts |

- `answer_question`: the backend loads the investigation graph from the DB and ranks its evidence against the question (lexical scoring over title, excerpt, publisher and the parent event; broad questions with no match get coverage across events). The top 10 become sources `S1..S10`. The model answers only from them, cites with `[[source:Sn]]`, and ends with a cited `### Conclusions` section. Citations to unknown labels are stripped. `sources` and the stored message contain only the cited subset, each with `evidenceId` and `eventId`.
- `extend_graph`: starts a research run (409 if one is active), streams progress, emits `graph_updated` with the new graph, and cites the newly added evidence.
- Highlight: the backend broadcasts `InvestigationHighlightEventDto` (`investigation:highlight` with `{investigationId, messageId, evidenceIds, eventIds, final}`) on `/ws`. An empty frame at `message_start` clears the previous highlight. A frame is sent each time the answer cites a new source, and a final frame carries exactly the cited set. The Workspace lights those branches and events and dims the rest. Each answer has a "Show N cited in graph" button that re-applies its highlight from the stored citations.

Behaviour:
- Each run appends one event (title = run topic) and attaches every article found as evidence. Title, URL, source and date come only from search tool output. The agent's closing summary becomes `event.summary`. Earlier events and evidence are never removed, and articles already present are skipped.
- Every graph change increments `revision` and `updatedAt`.
- Realtime: `/ws` sends `{ type: "investigation:updated", payload: { investigationId, revision, run, evidence? }, timestamp }` for each change. It is broadcast to all clients, so filter by `investigationId` and ignore revisions older than the current one. After reconnecting, re-fetch the graph.
- No authentication yet: every investigation is created `public`, and only `visibility=public` can be listed.
- Runs in flight when the server restarts are marked `failed` (`run_interrupted`).
- Storage: MongoDB `investigations` (graph embedded) and `research_runs`, or in memory when `TIMELINE_MOCK=true`.

Frontend: `frontend/src/services/investigations.ts` implements `InvestigationApi` over these routes (honouring `VITE_API_BASE_URL`). `createInvestigation` returns as soon as the investigation exists. `extendInvestigation` waits for its run (polling `GET …/runs/:runId`) and then returns the graph. `watchInvestigation(id, {onUpdate, onResync})` subscribes to `/ws`, drops other IDs and stale revisions, and signals resync after reconnects. The Workspace uses it to re-fetch the graph while research runs. Errors surface the backend `ApiErrorDto.message`.

## DTOs

See TypeScript definitions for exact shapes and optionality.

- `InvestigationDto`: public metadata; `visibility` is explicit.
- `ResearchRunDto`: lifecycle and investigation association.
- `InvestigationGraphDto`: investigation ID, monotonic revision, update time, events.
- `InvestigationEventDto`: event ID/title, optional time/summary, evidence array.
- `InvestigationEvidenceDto`: ID/title and optional excerpt/source/date/relationship/event ID. Never invent absent source metadata.
- Create/extend request and response DTOs.
- `ApiErrorDto`: stable machine code, user-safe message, optional request ID/details.

Times use ISO-8601 UTC strings. IDs are opaque strings; clients must not infer semantics. List responses may paginate by opaque cursor. Backend must validate public visibility and authorization policy before exposing records (authentication is outside current frontend scope).

## Frontend boundary

`InvestigationApi` is a port consumed by UI. Its method names describe desired capabilities, **not existing URLs**. Implement an adapter only after backend team agrees routes, HTTP methods, payloads, status codes, and auth/access policy. Keep DTOs separate from view models and adapt DTO graphs to `SpineNode[]` at service boundary; do not change `TreeMapCanvas` or let API DTOs leak into its renderer.

Graph adapter maps event → main spine node and evidence → branch. Required legacy-only Canvas fields are structural defaults, not research claims; do not render them as factual metadata. Extend mapping deliberately if new source types or event/evidence relationships are agreed.

The current `investigationRepository` intentionally throws `CapabilityUnavailableError` for every operation. Keep that behavior until real backend support exists. Never silently fall back to global `/api/timeline` after an investigation-specific request fails.

## User flows

### A — Explore public research

1. Home calls `listPublicInvestigations`.
2. Render returned public DTO metadata only; show loading, empty, retryable error states without fixtures.
3. Selecting a row captures stable `investigation.id` and opens Workspace.
4. Fetch investigation metadata and graph for that same ID; verify response `investigationId` matches.
5. Render only returned graph nodes; on failure show recoverable error and preserve Home navigation. Do not trigger a research run while opening.
6. Canvas selection and source links use existing model and actual evidence URLs.

### B — Create

1. Require non-empty trimmed topic; context optional.
2. Call persistent create operation; show indeterminate processing state.
3. Creation response includes investigation identity and run. Load that investigation's graph, verify IDs, then show Workspace.
4. On failure preserve topic and show error. Do not call global scrape endpoint as a persistence substitute.

### C — Continue/update

1. Submit additional topic/context against active investigation ID.
2. Backend creates a ResearchRun and associates newly discovered events/evidence with same investigation.
3. Return complete or revisioned graph; preserve prior valid records. Client verifies ID and applies graph update.
4. Scoped push updates must carry investigation ID and revision; discard unrelated IDs and stale revisions. Current WebSocket has no scope; no migration is included in this frontend task.
5. Chat text alone is not persisted evidence. Do not claim continuous monitoring unless backend supplies it.

## Backend capability matrix (repository audit)

| Capability | Current status | Required implementation |
|---|---|---|
| Public investigation list | Not implemented | Durable query filtered by `visibility=public`; pagination; empty/error handling |
| Retrieve investigation by ID | Not implemented | Stable ID lookup; not found/forbidden distinction |
| Retrieve graph | Not implemented | Fetch investigation-associated events/evidence and revision atomically/consistently |
| Create from topic | Not implemented as investigation | Persist investigation and ResearchRun; return stable ID; define queued/running/error behavior |
| Research run history | Not implemented | Persist run lifecycle linked to investigation; idempotency/retry policy |
| Extend without loss | Not implemented per investigation | Append/merge evidence and advance revision; preserve existing records unless explicit deletion/update |
| Scoped realtime events | Not implemented | Include investigation ID + revision; subscription/filtering and reconnect snapshot behavior |
| Current timeline API | Implemented, in-memory/global | Keep separate; not an implementation of above capabilities |
| Backend DB entity schema | Partial, different concepts | Existing graph entities are not Investigation resources or ownership relations |

## Backend contract decisions still needed

Before adding HTTP client routes, backend/frontend owners must agree: route paths and verbs; list pagination; create response timing (synchronous vs run accepted); graph snapshot vs incremental updates; revision concurrency; visibility/access policy; validation/error codes; idempotency; source URL validation; websocket subscription handshake and replay semantics.

No endpoint URLs are proposed here intentionally. Once agreed, update this document and add an API adapter plus contract tests. Keep DTO changes backward-compatible where practical; coordinate breaking changes across both teams.

## Instructions for AI coding assistants

1. Read this document and `contracts/investigations.ts` before changing investigation flows.
2. Treat DTOs as a proposal unless implementation evidence proves an operation exists.
3. Inspect current routes/types before claiming capability. Do not invent route paths or silently call global timeline endpoints.
4. Preserve `TreeMapCanvas`, `SpineNode`, and two-screen UX; adapt at service boundary.
5. Keep missing capabilities explicit; never generate fixture investigations in production UI.
6. Add/update DTO and adapter tests when contract changes. Report implemented vs blocked behavior distinctly.
