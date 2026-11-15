/**
 * Tool: search_nodes
 *
 * Contains: semantic search over graph nodes (statements, events, effects, metric changes),
 * same as Agentic-GitPayBit's github_contribution_lookup: MongoDBAtlasVectorSearch
 * similaritySearchWithScore on the `nodes` collection, results returned as JSON.
 */
import { tool } from '@langchain/core/tools';
import type { Collection, Document } from 'mongodb';
import { z } from 'zod';
import { col } from '../../db/client.js';
import { getVectorStore } from '../../db/vectorStore.js';
import { VECTOR_MAX, VECTOR_RESULTS } from '../../limits.js';

export const searchNodesTool = tool(
  async ({ query, n = 10 }) => {
    const vectorStore = getVectorStore(col.nodes as unknown as Collection<Document>);
    const result = await vectorStore.similaritySearchWithScore(query, Math.min(n, VECTOR_MAX));
    return JSON.stringify(result);
  },
  {
    name: 'search_nodes',
    description: 'Gathers timeline nodes (statements, events, effects) from the nodes database by semantic search.',
    schema: z.object({
      query: z.string().describe('The search query'),
      n: z.number().int().min(1).max(VECTOR_MAX).optional().default(VECTOR_RESULTS).describe(`Number of results to return (at most ${VECTOR_MAX})`),
    }),
  },
);
