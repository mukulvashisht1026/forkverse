/**
 * Tool: search_nodes
 *
 * Contains: semantic search over graph nodes (statements, events, effects, metric changes).
 * This is the main retrieval entry point for RAG.
 *
 * Reads: `nodes` via $vectorSearch on the `embedding_vector` index; joins `sources` for
 * URL + vetting verdict so every result carries citable evidence.
 */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { notImplemented } from './result.js';

export const searchNodesTool = tool(
  async ({ query, entity_id, limit }) => {
    // TODO:
    //   1. Embed `query` with clients/embeddings.ts.
    //   2. col.nodes.aggregate([
    //        { $vectorSearch: {
    //            index: VECTOR_INDEX_NAME, path: 'embedding', queryVector, numCandidates: limit * 20, limit,
    //            ...(entity_id && { filter: { 'entities.entity_id': entity_id } }),
    //        } },
    //        { $project: { embedding: 0, score: { $meta: 'vectorSearchScore' } } },
    //        { $lookup: { from: 'sources', localField: 'sources.source_id', foreignField: '_id', as: 'source_docs' } },
    //      ])
    //   3. Drop nodes whose only sources are vet_verdict 'manipulative' (or return them flagged as pruned).
    //   4. Return [{ node_id, kind, summary, occurred_at, status, score, evidence: [{ url, quote, verdict }] }].
    return notImplemented('search_nodes', { query, entity_id, limit });
  },
  {
    name: 'search_nodes',
    description:
      'Semantic search over timeline nodes (statements, events, effects). Returns summaries with verbatim quotes and source URLs.',
    schema: z.object({
      query: z.string().describe('What to search for, in natural language'),
      entity_id: z.string().optional().describe('Only return nodes involving this entity'),
      limit: z.number().int().min(1).max(20).default(8),
    }),
  },
);
