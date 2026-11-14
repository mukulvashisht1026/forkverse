# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Forkverse is a branching-timeline tracker. For a tracked entity (person, organization, event, asset, topic), it builds a tree where statements are **branch points**, later events are **timelines**, contradicting events are **divergences**, and stories rejected by vetting are **pruned branches**, shown faded with the reason. Data comes from live web sources via Context.dev, and every source is vetted for manipulation. Everything is stored in Postgres + pgvector, and a chat assistant answers questions using graph-aware retrieval. It is a hackathon project (Context.dev and Hostinger tracks) deployed on a Hostinger VPS.

## Non-negotiable principles (enforce in code)

1. **Evidence:** every node and edge stores a verbatim quote and a source URL. Run it through `verifyQuote` (`backend/src/utils/quotes.ts`, substring match after normalization) and discard the item if it fails.
2. **Never overclaim:** edge `basis` is `stated` | `sequence_only` | `inferred`. Wording like "caused by" is allowed only when basis is `stated`. Otherwise use neutral wording such as "followed" or "was later contradicted by".
3. **Abstain:** verdicts are `credible` | `uncertain` | `manipulative`. Missing signals (e.g. a failed RDAP lookup) lower coverage/confidence and never count as risky or safe.
4. **Neutral:** no intent inference. For assets, show no trading advice, include a "not financial advice" note, and never imply that a story caused a price move.
5. **Fail visibly:** sources that can't be scraped are stored with `readable=false` and `fetch_error`.

## Commands

From the repo root (see `Makefile`):
- `make db` starts Postgres (`pgvector/pgvector:pg16`) via Docker. `make up` starts the full stack, and `make prod` adds Caddy (HTTPS, uses `DOMAIN`).
- `make migrate`, `make dev` (tsx watch), `make test`, `make typecheck`.

In `backend/`:
- Run a single test file with `npx vitest run test/quotes.test.ts`, or a single test with `npx vitest run -t "rejects paraphrase"`.
- Tests use mocked external APIs. `vitest.config.ts` injects a dummy `DATABASE_URL`, because `config.ts` validates the env at import time.

Config is parsed with zod in `backend/src/config.ts`. See `.env.example` for the available variables.

## Architecture

- **Backend** (`backend/`): Node 20, TypeScript (ESM/NodeNext, so imports use `.js` extensions), Fastify, `pg`, and `zod`.
  - `db/migrate.ts` applies `migrations/*.sql` in order, tracks them in `schema_migrations`, and substitutes `${EMBEDDING_DIM}` from env. `EMBEDDING_DIM` must match the embedding model, and changing models means re-embedding everything.
  - `db/pool.ts` provides `withTransaction` (wrap each article's writes in one transaction) and `withEntityLock` (a per-entity advisory lock, so cron, webhook and manual refreshes never overlap).
  - Writes are idempotent through `ON CONFLICT` on `sources.url`, `edges(from_id,to_id,type)` and `metrics(entity_id,name,observed_at)`.
  - `clients/contextdev.ts`: Context.dev response shapes are under-documented, so all parsing goes through `normalizeSearchResults` / `normalizeScrape`. The first raw response per endpoint is dumped to `DEBUG_RAW_DIR`. A 200 response can still contain `success:false` outputs. Requests are queued under a concurrency limiter (`CONTEXT_DEV_CONCURRENCY`, API max 50) and retry on 408/429/5xx while honoring `Retry-After`. A 402 is not retried.
  - `clients/llm.ts`: an OpenAI SDK client pointed at the Hostinger AI Router. `completeJson` uses temperature 0 and JSON mode, validates the output with zod, and retries once on invalid output.
  - `clients/embeddings.ts`: the `EmbeddingProvider` is either `router` or `python_service` (`POST /embed {texts} -> {vectors, model, dim}`), selected by `EMBEDDING_PROVIDER`. Postgres only stores and compares vectors, using cosine distance (`<=>`) and HNSW indexes.
  - Planned modules (not yet built): `ingest/` (discover → scrape → vet → extract per entity type → dedupe → link), `vetting/`, `graph/tree.ts` (recursive CTE, depth 4, cycle protection through a visited-path array), `graph/ragContext.ts`, routes, `jobs/scheduler.ts` (node-cron), and `eval/`.
- **Frontend** (`frontend/`, not yet built): React + Vite + TypeScript, React Flow for the tree, TanStack Query, Tailwind, and Recharts.
- **Prod:** in `Caddyfile`, `/api/*` goes to the backend (prefix stripped), `/webhook/*` goes to the backend, and everything else goes to the frontend.
