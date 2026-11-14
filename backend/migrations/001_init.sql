CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE node_status AS ENUM ('unverified', 'confirmed', 'disputed');
CREATE TYPE edge_type   AS ENUM ('followed', 'contradicts', 'fulfills', 'escalated', 'reversed', 'affected');
CREATE TYPE edge_basis  AS ENUM ('stated', 'sequence_only', 'inferred');
CREATE TYPE verdict     AS ENUM ('credible', 'uncertain', 'manipulative');

-- Anything we track: person, organization, event, asset (stock/commodity/crypto), topic
CREATE TABLE entities (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type     TEXT NOT NULL CHECK (entity_type IN ('person','organization','event','asset','topic')),
  name            TEXT NOT NULL,
  description     TEXT,
  aliases         TEXT[] NOT NULL DEFAULT '{}',
  search_terms    TEXT[] NOT NULL DEFAULT '{}',
  metadata        JSONB NOT NULL DEFAULT '{}',   -- e.g. {"ticker":"XOM"} or {"country":"US"}
  refresh_minutes INT NOT NULL DEFAULT 60,
  last_refreshed_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entity_type, name)
);

CREATE TABLE sources (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url           TEXT NOT NULL UNIQUE,
  domain        TEXT NOT NULL,
  title         TEXT,
  published_at  TIMESTAMPTZ,
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  readable      BOOLEAN NOT NULL DEFAULT TRUE,
  fetch_error   TEXT,
  text          TEXT,
  vet_verdict   verdict,
  vet_risk      REAL CHECK (vet_risk BETWEEN 0 AND 1),
  vet_coverage  REAL CHECK (vet_coverage BETWEEN 0 AND 1),
  vet_detail    JSONB            -- per-signal breakdown, techniques with quotes, explanation
);
CREATE INDEX sources_domain_idx ON sources(domain);

-- Graph nodes. "Home" entity is the tree the node belongs to.
CREATE TABLE nodes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id     UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('statement','event','effect','metric_change')),
  summary       TEXT NOT NULL,
  quote         TEXT,                          -- verbatim, verified against a source
  occurred_at   TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status        node_status NOT NULL DEFAULT 'unverified',
  embedding     vector(${EMBEDDING_DIM})
);
CREATE INDEX nodes_entity_idx ON nodes(entity_id, occurred_at);
CREATE INDEX nodes_embedding_idx ON nodes USING hnsw (embedding vector_cosine_ops);

-- A node can involve several entities (person + company + stock)
CREATE TABLE node_entities (
  node_id    UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  entity_id  UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'involved',   -- actor, target, affected, mentioned
  PRIMARY KEY (node_id, entity_id)
);

CREATE TABLE node_sources (
  node_id    UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  source_id  UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  quote      TEXT NOT NULL,
  PRIMARY KEY (node_id, source_id)
);

CREATE TABLE edges (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_id        UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  to_id          UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  type           edge_type NOT NULL,
  basis          edge_basis NOT NULL,
  confidence     REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  description    TEXT NOT NULL,                -- one natural-language sentence, embedded
  evidence_quote TEXT,
  embedding      vector(${EMBEDDING_DIM}),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (from_id, to_id, type),
  CHECK (from_id <> to_id)
);
CREATE INDEX edges_from_idx ON edges(from_id);
CREATE INDEX edges_to_idx   ON edges(to_id);
CREATE INDEX edges_embedding_idx ON edges USING hnsw (embedding vector_cosine_ops);

-- Numeric time series, e.g. prices for asset entities
CREATE TABLE metrics (
  id           BIGSERIAL PRIMARY KEY,
  entity_id    UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,                 -- e.g. 'price_usd'
  value        DOUBLE PRECISION NOT NULL,
  observed_at  TIMESTAMPTZ NOT NULL,
  source_id    UUID REFERENCES sources(id),
  UNIQUE (entity_id, name, observed_at)
);
CREATE INDEX metrics_lookup_idx ON metrics(entity_id, name, observed_at DESC);

CREATE TABLE alerts (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id  UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  channel  TEXT NOT NULL,
  sent_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE monitors (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id   UUID REFERENCES entities(id) ON DELETE CASCADE,
  target_url  TEXT NOT NULL,
  external_id TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE eval_runs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  thresholds JSONB NOT NULL,
  metrics    JSONB NOT NULL,       -- precision, recall, fpr, abstain rate, confusion matrix
  failures   JSONB                 -- documented failure cases
);
