# Local development

The frontend runs at `http://localhost:5173`; Vite proxies `/api` and `/ws` to the backend at `http://localhost:3000`.

1. Copy `.env.example` to `.env` in the repository root and configure `MONGODB_URI`, `LLM_API_KEY`, and `CONTEXT_DEV_API_KEY`. `LLM_BASE_URL` and `LLM_MODEL` must point to a supported OpenAI-compatible chat model. Semantic search (vector index) uses OpenAI embeddings: set `OPENAI_API_KEY` (model `EMBEDDING_MODEL`, default `text-embedding-3-small`, `EMBEDDING_DIM=1536`).
2. Run `cd backend && npm install && npm run dev`.
3. In another terminal run `cd frontend && npm install && npm run dev`.

Research needs valid model and Context.dev credentials; without them the UI can load, but new graph research and chat cannot return live results. MongoDB is required for saved investigations. Never commit `.env` or paste credentials into source files.

Public graphs are addressable at `/<investigation-id>`; the Vite dev server provides SPA fallback for these routes.
