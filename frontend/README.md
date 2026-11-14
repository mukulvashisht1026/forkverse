# Signal Spine — API & WebSocket Contracts

Signal Spine is a real-time 2D Living Tree Map frontend powered exclusively by backend REST APIs and WebSocket push events. There is **no hardcoded timeline data in the client**; all main declaration nodes, bi-directional evidence branches (growing both above and below the spine), stock/market impacts, public appeal sentiment splits, and live status messages originate from the backend server.

---

## 1. Pointing the Frontend to a Separate Backend

By default, the React app connects to same-origin `/api/...` and `ws(s)://<host>/ws`. To run your own standalone backend on a different origin or port, set these Vite environment variables:

```bash
VITE_API_BASE_URL=https://api.your-backend.com
VITE_WS_URL=wss://api.your-backend.com/ws
```

Local development against the TRACEWIRE backend (`backend/`):

```bash
# terminal 1 (repo root): backend on :3000 (HTTP + WebSocket /ws)
make dev
# terminal 2: frontend on :5173, proxies /api/* and /ws to BACKEND_URL (default http://localhost:3000)
cd frontend && npm install && npm run dev
```

To run the bundled in-memory mock server (Express + WebSocket + Vite) instead, without the backend:

```bash
npm run dev:mock
```

Optional environment variables for live search scraping on the bundled server:
- `EXA_API_KEY`: Enables Exa Search API (`/search`, `/contents`, `/answer`)
- `CONTEXT_DEV_API_KEY`: Enables Context.dev live web/social scraping (`/v1/web/search`, `/v1/web/scrape`, `/v1/web/answers`)
- `GEMINI_API_KEY`: Enables Google Search grounding fallback when neither Exa nor Context.dev key is set

### Production configuration (non-secret)

Tracked in `frontend/.env.production` and embedded in the client bundle at build time:

```bash
# Production API origin (backend running frontend/server.ts)
# Do NOT include /api or /api/status suffix — the client resolves paths
VITE_API_BASE_URL=https://tracewire-backend.orangebeach-cf28400b.germanywestcentral.azurecontainerapps.io

# Production WebSocket URL (same origin, /ws path per frontend/server.ts)
VITE_WS_URL=wss://tracewire-backend.orangebeach-cf28400b.germanywestcentral.azurecontainerapps.io/ws
```

Local overrides (not committed): use `frontend/.env.local` for development and `frontend/.env.production.local` to override production builds. Priority, highest first: existing process environment, `.env.[mode].local`, `.env.[mode]`, `.env.local`, `.env`. Only the selected mode's files are loaded; production builds do not load `.env.development`. Restart development server or rebuild after changing configuration.

---

## 2. Core Data Models (JSON / TypeScript)

### `SpineNode`
```ts
export interface SpineNode {
  id: string;
  name: string;               // Short main node label on the spine (max 60 chars)
  declaration: string;        // Exact post/statement text shown in the Center Focus Box
  info: string;               // Concise contextual overview
  platform: string;           // e.g. "X (@realDonaldTrump)"
  timestamp?: string;         // Human-readable time label, e.g. "12m ago"
  sourceUrl?: string;
  stockImpact: {
    summary: string;
    tickers: Array<{
      ticker: string;         // e.g. "GM", "NVDA", "SPY"
      company: string;
      change: string;         // e.g. "-3.8%", "+2.4%"
      direction: 'up' | 'down' | 'mixed';
      note: string;
    }>;
  };
  publicAppeal: {
    sentimentLabel: string;   // e.g. "Polarized", "Broadly Supportive"
    positivePct: number;      // Integer 0–100 (positive + neutral + negative = 100)
    neutralPct: number;
    negativePct: number;
    narrative: string;
  };
  scrapeEngine: 'exa' | 'context.dev' | 'gemini-search' | 'seed' | 'manual';
  branches: BranchNode[];
}
```

### `BranchNode`
```ts
export interface BranchNode {
  id: string;
  name: string;               // Short branch title (max 48 chars)
  info: string;               // Excerpt shown in Focus Box on hover/pin
  sourceType: 'social' | 'news' | 'market' | 'policy' | 'manual';
  growthSide?: 'top' | 'bottom'; // 'top' grows above spine; 'bottom' grows below spine
  sourceDomain?: string;      // e.g. "reuters.com", "x.com"
  sourceUrl?: string;
  publishedAt?: string;
  impactAngle?: string;       // e.g. "Market Reaction", "X Sentiment"
  seed: number;               // Deterministic integer for organic particle geometry
}
```

### `TimelineSnapshot`
```ts
export interface TimelineSnapshot {
  nodes: SpineNode[];
  version: number;
  updatedAt: string;          // ISO-8601 timestamp
}
```

---

## 3. REST API Contracts

### `GET /api/timeline`
Returns the authoritative initial timeline snapshot loaded on app startup. The server starts **empty** (`"nodes": []`) with zero pre-populated mock data until your backend pushes events or a live scrape runs.

**Response `200 OK`**
```json
{
  "nodes": [
    {
      "id": "node-tariff-1",
      "name": "Tariff Post",
      "declaration": "Proposed 25% tariffs on imported autos and semiconductors...",
      "info": "Triggered immediate automaker sell-offs and supplier hedging.",
      "platform": "X (@realDonaldTrump)",
      "timestamp": "18m ago",
      "stockImpact": {
        "summary": "Legacy automakers slid while domestic steel equities rallied.",
        "tickers": [
          { "ticker": "GM", "company": "General Motors", "change": "-3.8%", "direction": "down", "note": "Cross-border assembly exposure" }
        ]
      },
      "publicAppeal": {
        "sentimentLabel": "Sharply Divided",
        "positivePct": 41,
        "neutralPct": 16,
        "negativePct": 43,
        "narrative": "Domestic manufacturing unions praised protectionism while consumer groups warned of higher vehicle prices."
      },
      "scrapeEngine": "exa",
      "branches": [
        {
          "id": "br-reuters-1",
          "name": "Reuters · Auto Selloff",
          "info": "Detroit automakers dropped in early trading following tariff warning.",
          "sourceType": "market",
          "growthSide": "top",
          "sourceDomain": "reuters.com",
          "sourceUrl": "https://www.reuters.com/...",
          "impactAngle": "Market Reaction",
          "seed": 10421
        }
      ]
    }
  ],
  "version": 1,
  "updatedAt": "2026-11-13T18:00:00.000Z"
}
```

---

### `POST /api/timeline/nodes`
Creates (or upserts by `id`) a main spine node and broadcasts `node:created` over WebSocket.

**Request Body**
```json
{
  "id": "optional-custom-id",
  "name": "Fed Rate Post",
  "declaration": "Full declaration quote...",
  "info": "Summary of impact...",
  "platform": "X (@realDonaldTrump)",
  "timestamp": "Just now",
  "sourceUrl": "https://x.com/...",
  "scrapeEngine": "manual",
  "stockImpact": {
    "summary": "Treasury yields dipped as rate-sensitive tech rallied.",
    "tickers": [
      { "ticker": "QQQ", "company": "Invesco QQQ", "change": "+1.4%", "direction": "up", "note": "Growth bid" }
    ]
  },
  "publicAppeal": {
    "sentimentLabel": "Constructive",
    "positivePct": 52,
    "neutralPct": 22,
    "negativePct": 26,
    "narrative": "Borrowers welcomed lower rate pressure."
  },
  "branches": [],
  "message": "Optional message shown in the live frontend banner"
}
```

**Response `201 Created`**
```json
{
  "node": { "...": "SpineNode" },
  "version": 2
}
```

---

### `PATCH /api/timeline/nodes/:nodeId`
Updates fields on an existing spine node (e.g., updating live stock prices or sentiment splits) and broadcasts `node:updated` over WebSocket.

**Request Body** (all fields optional)
```json
{
  "name": "Updated Title",
  "declaration": "Updated declaration text",
  "info": "Updated summary",
  "stockImpact": { "summary": "...", "tickers": [] },
  "publicAppeal": { "sentimentLabel": "...", "positivePct": 45, "neutralPct": 20, "negativePct": 35, "narrative": "..." },
  "message": "Updated market impact figures"
}
```

**Response `200 OK`**
```json
{
  "node": { "...": "SpineNode" },
  "version": 3
}
```

**Errors**: `404 Not Found` (`{ "error": "Node \"...\" not found." }`)

---

### `DELETE /api/timeline/nodes/:nodeId`
Removes a main spine node and broadcasts `node:deleted` over WebSocket.

**Response `200 OK`**
```json
{
  "nodeId": "node-tariff-1",
  "version": 4
}
```

---

### `POST /api/timeline/nodes/:nodeId/branches`
Attaches a supporting branch (growing above or below the spine) to an existing main node and broadcasts `branch:created` over WebSocket.

**Request Body**
```json
{
  "id": "optional-branch-id",
  "name": "WSJ · Supply Chain",
  "info": "Suppliers flagged Q2 margin pressure from import duties.",
  "sourceType": "news",
  "growthSide": "top",
  "sourceDomain": "wsj.com",
  "sourceUrl": "https://www.wsj.com/...",
  "impactAngle": "Industry Analysis",
  "message": "Optional live message banner text"
}
```

**Response `201 Created`**
```json
{
  "branch": { "...": "BranchNode" },
  "version": 5
}
```

---

### `DELETE /api/timeline/nodes/:nodeId/branches/:branchId`
Removes a branch from a node and broadcasts `branch:deleted` over WebSocket.

**Response `200 OK`**
```json
{
  "nodeId": "node-tariff-1",
  "branchId": "br-reuters-1",
  "version": 6
}
```

---

### `POST /api/timeline/events`
Generic backend ingestion webhook for pushing live timeline mutations or standalone status messages from external scrapers, cron jobs, or workers. Every accepted event updates server state and broadcasts immediately to all connected `/ws` clients.

**Supported Payloads**
- Push a new main node:
  ```json
  {
    "type": "node:created",
    "message": "Detected new Trump X declaration on tariffs",
    "node": { "name": "Tariff Alert", "declaration": "...", "platform": "X" }
  }
  ```
- Update an existing main node:
  ```json
  {
    "type": "node:updated",
    "nodeId": "node-tariff-1",
    "message": "Refreshed intraday equity reaction",
    "node": { "stockImpact": { "summary": "...", "tickers": [] } }
  }
  ```
- Attach a new branch:
  ```json
  {
    "type": "branch:created",
    "nodeId": "node-tariff-1",
    "message": "X sentiment spike detected",
    "branch": { "name": "X · Viral Thread", "info": "...", "sourceType": "social", "growthSide": "bottom" }
  }
  ```
- Broadcast a live notification message only:
  ```json
  {
    "type": "system:message",
    "message": "Exa worker finished scanning 14 financial outlets"
  }
  ```

---

### `POST /api/prompt`
Receives natural-language prompts sent from the bottom ChatGPT-style prompt bar (`PromptBar`). Backends can either process the prompt synchronously and return the created `node` / `branches`, or return `202 Accepted` with a status `message` and push updates asynchronously via `/ws`.

**Request Body**
```json
{
  "prompt": "Track Trump's latest X tariff post https://x.com/...",
  "mode": "new-node",
  "selectedNodeId": "optional-node-id",
  "selectedNodeName": "optional-node-name",
  "provider": "auto"
}
```
(`mode`: `"auto" | "new-node" | "branch"`, `provider`: `"auto" | "exa" | "context.dev"`)

**Response `201 Created` (Synchronous)**
```json
{
  "ok": true,
  "mode": "new-node",
  "node": { "...": "SpineNode" },
  "version": 7,
  "engine": "exa",
  "message": "Prompt (exa) added: Tariff Post"
}
```

**Response `202 Accepted` (Async WebSocket Push)**
```json
{
  "ok": true,
  "message": "Prompt queued — streaming branches over WebSocket..."
}
```

---

### `POST /api/scrape-event`
Triggers live web + social scraping via Exa AI or Context.dev (with Gemini search grounding fallback), stores the resulting `SpineNode` + bi-directional `branches`, and broadcasts `node:created` via WebSocket.

**Request Body**
```json
{
  "query": "Trump X tariff declaration market reaction",
  "url": "https://x.com/...",
  "provider": "auto"
}
```
(`provider`: `"auto" | "exa" | "context.dev"`)

**Response `201 Created`**
```json
{
  "node": { "...": "SpineNode" },
  "version": 7,
  "engine": "exa",
  "notice": "Optional provider notice"
}
```

---

### `POST /api/scrape-branch`
Scrapes additional supporting evidence branches onto an existing node, stores them, and broadcasts `branch:created` via WebSocket.

**Request Body**
```json
{
  "nodeId": "node-tariff-1",
  "topic": "Tariff Post",
  "query": "automaker union response",
  "existingCount": 4,
  "provider": "auto"
}
```

**Response `201 Created`**
```json
{
  "branches": [ { "...": "BranchNode" } ],
  "version": 8,
  "engine": "exa",
  "notice": "Optional provider notice"
}
```

---

### `GET /api/status`
Health & capability check.

**Response `200 OK`**
```json
{
  "exaConfigured": true,
  "contextDevConfigured": false,
  "geminiFallbackAvailable": true,
  "wsClients": 2,
  "timelineVersion": 8
}
```

---

## 4. WebSocket Contract (`/ws`)

Connect to `ws://<host>/ws` (or `wss://<host>/ws` in production, or custom `VITE_WS_URL`).

### Server → Client Frames

Every frame is a JSON object with `type`, `timestamp` (ISO-8601), optional `payload`, and optional `message`. Whenever `message` is present (for any event other than silent `timeline:init`), the frontend displays it in the live message banner (`data-testid="live-message-banner"`).

| `type` | `payload` | Description |
| --- | --- | --- |
| `timeline:init` | `TimelineSnapshot` (`{ nodes, version, updatedAt }`) | Sent immediately on socket open and in response to client `timeline:sync`. |
| `node:created` | `{ node: SpineNode, version: number }` | Appends a new main spine node and animates its branches into view. |
| `node:updated` | `{ node: SpineNode, version: number }` | Updates an existing node's stock impact, sentiment, or metadata in-place. |
| `node:deleted` | `{ nodeId: string, version: number }` | Removes the node from the timeline and clears focus if it was selected. |
| `branch:created` | `{ nodeId: string, branch: BranchNode, version: number }` | Attaches a new top or bottom branch onto `nodeId` and animates its growth. |
| `branch:deleted` | `{ nodeId: string, branchId: string, version: number }` | Removes `branchId` from `nodeId`. |
| `system:message` | `Record<string, unknown>` (optional) | Displays a backend message banner without modifying timeline geometry. |
| `pong` | — | Heartbeat response to client `ping`. |

**Example Server → Client Frame**
```json
{
  "type": "branch:created",
  "payload": {
    "nodeId": "node-tariff-1",
    "branch": {
      "id": "br-live-901",
      "name": "Bloomberg · Bond Yields",
      "info": "10Y Treasury yields climbed 6bps following tariff remarks.",
      "sourceType": "market",
      "growthSide": "top",
      "sourceDomain": "bloomberg.com",
      "seed": 88421
    },
    "version": 9
  },
  "message": "Live update: Bloomberg · Bond Yields attached to Tariff Post",
  "timestamp": "2026-11-13T18:10:00.000Z"
}
```

### Client → Server Frames

| `type` | Description |
| --- | --- |
| `ping` | Sent every 25s as heartbeat; server responds with `{ "type": "pong", "timestamp": "..." }`. |
| `timeline:sync` | Requests a fresh `timeline:init` snapshot frame from the server. |
