import type { Document, IndexDescription } from 'mongodb';
import type { TimelineMetaDoc, TimelineNodeDoc } from '../timeline/store.js';

/**
 * Collection shapes, validators and indexes. Applied idempotently by db/migrate.ts.
 * All _id values are UUID strings (newId()) so they serialise cleanly to the frontend.
 */

export const ENTITY_TYPES = ['person', 'organization', 'event', 'asset', 'topic'] as const;
export const NODE_KINDS = ['statement', 'event', 'effect', 'metric_change'] as const;
export const NODE_STATUSES = ['unverified', 'confirmed', 'disputed'] as const;
export const EDGE_TYPES = ['followed', 'contradicts', 'fulfills', 'escalated', 'reversed', 'affected'] as const;
export const EDGE_BASES = ['stated', 'sequence_only', 'inferred'] as const;
export const VERDICTS = ['credible', 'uncertain', 'manipulative'] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];
export type NodeKind = (typeof NODE_KINDS)[number];
export type NodeStatus = (typeof NODE_STATUSES)[number];
export type EdgeType = (typeof EDGE_TYPES)[number];
export type EdgeBasis = (typeof EDGE_BASES)[number];
export type Verdict = (typeof VERDICTS)[number];

/** Anything we track: person, organization, event, asset (stock/commodity/crypto), topic. */
export interface EntityDoc {
  _id: string;
  entity_type: EntityType;
  name: string;
  description: string | null;
  aliases: string[];
  search_terms: string[];
  metadata: Record<string, unknown>; // e.g. {"ticker":"XOM"} or {"country":"US"}
  refresh_minutes: number;
  last_refreshed_at: Date | null;
  created_at: Date;
}

export interface SourceDoc {
  _id: string;
  url: string;
  domain: string;
  title: string | null;
  published_at: Date | null;
  fetched_at: Date;
  readable: boolean;
  fetch_error: string | null;
  text: string | null;
  vet_verdict: Verdict | null;
  vet_risk: number | null; // 0..1
  vet_coverage: number | null; // 0..1
  vet_detail: Record<string, unknown> | null; // per-signal breakdown, techniques with quotes, explanation
}

/** Graph node. entity_id is the "home" entity whose tree the node belongs to. */
export interface NodeDoc {
  _id: string;
  entity_id: string;
  kind: NodeKind;
  summary: string;
  quote: string | null; // verbatim, verified against a source
  occurred_at: Date | null;
  first_seen_at: Date;
  status: NodeStatus;
  embedding: number[] | null;
  embedding_text?: string; // text that was embedded (vector store textKey)
  /** A node can involve several entities (person + company + stock). */
  entities: { entity_id: string; role: string }[]; // role: actor, target, affected, mentioned, involved
  sources: { source_id: string; quote: string }[];
}

export interface EdgeDoc {
  _id: string;
  from_id: string;
  to_id: string;
  type: EdgeType;
  basis: EdgeBasis;
  confidence: number; // 0..1
  description: string; // one natural-language sentence, embedded
  evidence_quote: string | null;
  embedding: number[] | null;
  embedding_text?: string; // text that was embedded (vector store textKey)
  created_at: Date;
}

/** Numeric time series, e.g. prices for asset entities. */
export interface MetricDoc {
  _id: string;
  entity_id: string;
  name: string; // e.g. 'price_usd'
  value: number;
  observed_at: Date;
  source_id: string | null;
}

export interface AlertDoc {
  _id: string;
  node_id: string;
  channel: string;
  sent_at: Date;
}

export interface MonitorDoc {
  _id: string;
  entity_id: string | null;
  target_url: string;
  external_id: string | null;
  created_at: Date;
}

export interface EvalRunDoc {
  _id: string;
  ran_at: Date;
  thresholds: Record<string, unknown>;
  metrics: Record<string, unknown>; // precision, recall, fpr, abstain rate, confusion matrix
  failures: unknown[] | null; // documented failure cases
}

/** Lease used by withEntityLock. _id is the entity id. */
export interface LockDoc {
  _id: string;
  owner: string;
  expires_at: Date;
}

export interface Collections {
  entities: EntityDoc;
  sources: SourceDoc;
  nodes: NodeDoc;
  edges: EdgeDoc;
  metrics: MetricDoc;
  alerts: AlertDoc;
  monitors: MonitorDoc;
  eval_runs: EvalRunDoc;
  locks: LockDoc;
  /** Frontend "Signal Spine" timeline: one doc per spine node, branches embedded. */
  timeline_nodes: TimelineNodeDoc;
  timeline_meta: TimelineMetaDoc;
}

// ---- validators -------------------------------------------------------------

const str = { bsonType: 'string' };
const strN = { bsonType: ['string', 'null'] };
const date = { bsonType: 'date' };
const dateN = { bsonType: ['date', 'null'] };
const num = { bsonType: ['double', 'int', 'long', 'decimal'] };
const unit = { ...num, minimum: 0, maximum: 1 };
const unitN = { bsonType: ['double', 'int', 'long', 'decimal', 'null'], minimum: 0, maximum: 1 };
const vecN = { bsonType: ['array', 'null'], items: num };
const enumOf = (values: readonly string[]) => ({ bsonType: 'string', enum: [...values] });
const enumOfN = (values: readonly string[]) => ({ bsonType: ['string', 'null'], enum: [...values, null] });

function schema(required: string[], properties: Record<string, Document>): Document {
  return { $jsonSchema: { bsonType: 'object', required: ['_id', ...required], properties: { _id: str, ...properties } } };
}

export interface CollectionSpec {
  validator: Document;
  indexes: IndexDescription[];
  /** Atlas Vector Search indexes. */
  vectorFields?: { path: string; filters: string[] };
}

export const COLLECTIONS: Record<keyof Collections, CollectionSpec> = {
  entities: {
    validator: schema(['entity_type', 'name', 'aliases', 'search_terms', 'metadata', 'refresh_minutes', 'created_at'], {
      entity_type: enumOf(ENTITY_TYPES),
      name: str,
      description: strN,
      aliases: { bsonType: 'array', items: str },
      search_terms: { bsonType: 'array', items: str },
      metadata: { bsonType: 'object' },
      refresh_minutes: { bsonType: ['int', 'long'], minimum: 1 },
      last_refreshed_at: dateN,
      created_at: date,
    }),
    indexes: [{ key: { entity_type: 1, name: 1 }, unique: true }],
  },
  sources: {
    validator: schema(['url', 'domain', 'fetched_at', 'readable'], {
      url: str,
      domain: str,
      title: strN,
      published_at: dateN,
      fetched_at: date,
      readable: { bsonType: 'bool' },
      fetch_error: strN,
      text: strN,
      vet_verdict: enumOfN(VERDICTS),
      vet_risk: unitN,
      vet_coverage: unitN,
      vet_detail: { bsonType: ['object', 'null'] },
    }),
    indexes: [{ key: { url: 1 }, unique: true }, { key: { domain: 1 } }, { key: { published_at: -1 } }],
  },
  nodes: {
    validator: schema(['entity_id', 'kind', 'summary', 'first_seen_at', 'status', 'entities', 'sources'], {
      entity_id: str,
      kind: enumOf(NODE_KINDS),
      summary: str,
      quote: strN,
      occurred_at: dateN,
      first_seen_at: date,
      status: enumOf(NODE_STATUSES),
      embedding: vecN,
      embedding_text: str,
      entities: {
        bsonType: 'array',
        items: { bsonType: 'object', required: ['entity_id', 'role'], properties: { entity_id: str, role: str } },
      },
      sources: {
        bsonType: 'array',
        items: { bsonType: 'object', required: ['source_id', 'quote'], properties: { source_id: str, quote: str } },
      },
    }),
    indexes: [
      { key: { entity_id: 1, occurred_at: 1 } },
      { key: { 'entities.entity_id': 1 } },
      { key: { 'sources.source_id': 1 } },
    ],
    vectorFields: { path: 'embedding', filters: ['entity_id', 'entities.entity_id', 'kind', 'status'] },
  },
  edges: {
    validator: {
      ...schema(['from_id', 'to_id', 'type', 'basis', 'confidence', 'description', 'created_at'], {
        from_id: str,
        to_id: str,
        type: enumOf(EDGE_TYPES),
        basis: enumOf(EDGE_BASES),
        confidence: unit,
        description: str,
        evidence_quote: strN,
        embedding: vecN,
        embedding_text: str,
        created_at: date,
      }),
      $expr: { $ne: ['$from_id', '$to_id'] },
    },
    indexes: [{ key: { from_id: 1, to_id: 1, type: 1 }, unique: true }, { key: { to_id: 1 } }],
    vectorFields: { path: 'embedding', filters: ['from_id', 'to_id', 'type', 'basis'] },
  },
  metrics: {
    validator: schema(['entity_id', 'name', 'value', 'observed_at'], {
      entity_id: str,
      name: str,
      value: num,
      observed_at: date,
      source_id: strN,
    }),
    indexes: [{ key: { entity_id: 1, name: 1, observed_at: -1 }, unique: true }],
  },
  alerts: {
    validator: schema(['node_id', 'channel', 'sent_at'], { node_id: str, channel: str, sent_at: date }),
    indexes: [{ key: { node_id: 1 } }],
  },
  monitors: {
    validator: schema(['target_url', 'created_at'], {
      entity_id: strN,
      target_url: str,
      external_id: strN,
      created_at: date,
    }),
    indexes: [{ key: { entity_id: 1 } }],
  },
  eval_runs: {
    validator: schema(['ran_at', 'thresholds', 'metrics'], {
      ran_at: date,
      thresholds: { bsonType: 'object' },
      metrics: { bsonType: 'object' },
      failures: { bsonType: ['array', 'null'] },
    }),
    indexes: [{ key: { ran_at: -1 } }],
  },
  locks: {
    validator: schema(['owner', 'expires_at'], { owner: str, expires_at: date }),
    // Backstop cleanup for crashed holders; withEntityLock also takes over expired leases itself.
    indexes: [{ key: { expires_at: 1 }, expireAfterSeconds: 0 }],
  },
  timeline_nodes: {
    validator: schema(['name', 'declaration', 'info', 'platform', 'stockImpact', 'publicAppeal', 'scrapeEngine', 'branches', 'created_at'], {
      name: str,
      declaration: str,
      info: str,
      platform: str,
      stockImpact: { bsonType: 'object', required: ['summary', 'tickers'] },
      publicAppeal: { bsonType: 'object' },
      scrapeEngine: enumOf(['exa', 'context.dev', 'gemini-search', 'seed', 'manual']),
      branches: {
        bsonType: 'array',
        items: { bsonType: 'object', required: ['id', 'name', 'info', 'sourceType', 'seed'] },
      },
      created_at: date,
    }),
    indexes: [{ key: { created_at: 1 } }],
  },
  timeline_meta: {
    validator: schema(['version', 'updatedAt'], { version: { bsonType: ['int', 'long', 'double'] }, updatedAt: str }),
    indexes: [],
  },
};

export const VECTOR_INDEX_NAME = 'vector_index';

export function vectorIndexDefinition(spec: NonNullable<CollectionSpec['vectorFields']>, dim: number): Document {
  return {
    fields: [
      { type: 'vector', path: spec.path, numDimensions: dim, similarity: 'cosine' },
      ...spec.filters.map((path) => ({ type: 'filter', path })),
    ],
  };
}
