/**
 * Source index: every screened source is stored in the `sources` collection with an embedding,
 * so propaganda findings are searchable by meaning ("sources using fear about migrants",
 * "state media coverage of the summit") and reusable across investigations.
 *
 * Document: { _id: src-<hash of normalized url>, url, domain, title, fetched_at, readable,
 *   fetch_error, vet_verdict, vet_risk (= propagandaScore / 100), vet_coverage, vet_flagged,
 *   vet_detail (the full SourceVettingDto), investigation_ids[], embedding_text, embedding }.
 * The embedding is computed from `embedding_text` (title, verdict, score, reasons, technique
 * quotes) with the same OpenAI embeddings as the rest of the vector store (db/vectorStore.ts).
 */
import { createHash } from 'node:crypto';
import type { Collection } from 'mongodb';
import type { SourceDoc } from '../db/schema.js';
import { PROPAGANDA_FLAG_THRESHOLD, type SourceVettingDto } from '../investigations/types.js';
import { normalizeUrl } from '../research/articles.js';
import { logger } from '../utils/logger.js';
import { hostOf } from './ratings.js';
import { VECTOR_MAX, VECTOR_RESULTS } from '../limits.js';


export type Embed = (text: string) => Promise<number[]>;

export interface IndexedSource {
  url: string;
  title: string;
  domain: string;
  verdict: SourceVettingDto['verdict'];
  propagandaScore?: number;
  flagged: boolean;
  reasons: string[];
  score: number; // similarity
}

export const sourceDocId = (url: string) => `src-${createHash('sha1').update(normalizeUrl(url)).digest('hex').slice(0, 20)}`;

export const isFlagged = (v: Pick<SourceVettingDto, 'propagandaScore'>) => (v.propagandaScore ?? 0) > PROPAGANDA_FLAG_THRESHOLD;

/** Text that is embedded: what the source is and what screening found (verbatim quotes included). */
export function vettingEmbeddingText(v: SourceVettingDto, title: string): string {
  const lines = [
    `Source: ${title || v.url}`,
    `URL: ${v.url}`,
    `Domain: ${v.rating?.domain ?? hostOf(v.url) ?? ''}`,
    `Vetting verdict: ${v.verdict}${v.propagandaScore !== undefined ? `; propaganda score ${v.propagandaScore}/100${isFlagged(v) ? ' (red flag)' : ''}` : ''}`,
    ...(v.rating ? [`Listing: ${v.rating.kind.replace('_', ' ')}${v.rating.actorCountry ? `, ${v.rating.actorCountry}` : ''}`] : []),
    ...v.reasons.map((r) => `Reason: ${r}`),
    ...(v.rhetoric ? [`Genre: ${v.rhetoric.genre}. ${v.rhetoric.rationale}`] : []),
    ...(v.rhetoric?.techniques ?? []).map((t) => `Technique ${t.technique.replace(/_/g, ' ')} (${t.voice}): "${t.quote}"`),
  ];
  return lines.join('\n').slice(0, 6000);
}

export class SourceIndex {
  constructor(
    private collection: Collection<SourceDoc>,
    private embed: Embed,
  ) {}

  /** Upsert one screened source (idempotent per URL); the investigation id is accumulated. */
  async upsert(v: SourceVettingDto, ctx: { title?: string; investigationId?: string } = {}): Promise<void> {
    const text = vettingEmbeddingText(v, ctx.title ?? '');
    const embedding = await this.embed(text);
    const domain = v.rating?.domain ?? hostOf(v.url) ?? 'unknown';
    await this.collection.updateOne(
      { _id: sourceDocId(v.url) },
      {
        $set: {
          url: v.url,
          domain,
          title: ctx.title || null,
          fetched_at: new Date(v.checkedAt || Date.now()),
          readable: !v.error,
          fetch_error: v.error ?? null,
          vet_verdict: v.verdict,
          vet_risk: v.propagandaScore !== undefined ? v.propagandaScore / 100 : null,
          vet_coverage: v.coverage,
          vet_flagged: isFlagged(v),
          vet_detail: v as unknown as Record<string, unknown>,
          embedding_text: text,
          embedding,
        },
        $setOnInsert: { published_at: null, text: null },
        ...(ctx.investigationId && { $addToSet: { investigation_ids: ctx.investigationId } }),
      },
      { upsert: true },
    );
  }

  /** Semantic search over screened sources (Atlas $vectorSearch on `vector_index`). */
  async search(query: string, opts: { limit?: number; flaggedOnly?: boolean; investigationId?: string } = {}): Promise<IndexedSource[]> {
    const limit = Math.min(Math.max(opts.limit ?? VECTOR_RESULTS, 1), VECTOR_MAX);
    const filter: Record<string, unknown> = {};
    if (opts.flaggedOnly) filter.vet_flagged = true;
    if (opts.investigationId) filter.investigation_ids = opts.investigationId;
    const docs = await this.collection
      .aggregate<SourceDoc & { score: number }>([
        {
          $vectorSearch: {
            index: 'vector_index',
            path: 'embedding',
            queryVector: await this.embed(query),
            numCandidates: limit * 20,
            limit,
            ...(Object.keys(filter).length && { filter }),
          },
        },
        { $set: { score: { $meta: 'vectorSearchScore' } } },
        { $project: { embedding: 0 } },
      ])
      .toArray();
    return docs.map((d) => {
      const v = d.vet_detail as unknown as SourceVettingDto | null;
      return {
        url: d.url,
        title: d.title ?? d.url,
        domain: d.domain,
        verdict: (d.vet_verdict ?? 'uncertain') as SourceVettingDto['verdict'],
        ...(typeof d.vet_risk === 'number' && { propagandaScore: Math.round(d.vet_risk * 100) }),
        flagged: Boolean(d.vet_flagged),
        reasons: v?.reasons ?? [],
        score: d.score,
      };
    });
  }
}

/** Fire-and-forget wrapper: indexing must never break screening. */
export function indexInBackground(index: SourceIndex | undefined, v: SourceVettingDto, ctx: { title?: string; investigationId?: string }): void {
  if (!index) return;
  index.upsert(v, ctx).catch((err) => logger.warn({ err, url: v.url }, 'source vetting not indexed (embedding/store failed)'));
}
