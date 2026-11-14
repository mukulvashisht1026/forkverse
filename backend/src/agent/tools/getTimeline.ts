/**
 * Tool: get_timeline
 *
 * Contains: graph traversal from a node (branch point) to what followed it: timelines,
 * divergences (contradicts edges) and their basis. Lets the agent answer
 * "what happened after X said Y?" with edge-level evidence.
 *
 * Reads: `edges` via $graphLookup (from_id -> to_id), then `nodes` for the reached ids.
 */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { notImplemented } from './result.js';

export const getTimelineTool = tool(
  async ({ node_id, depth }) => {
    // TODO: move the traversal into graph/tree.ts and call it here, e.g.
    //   col.nodes.aggregate([
    //     { $match: { _id: node_id } },
    //     { $graphLookup: { from: 'edges', startWith: '$_id', connectFromField: 'to_id',
    //                       connectToField: 'from_id', as: 'edges', maxDepth: depth - 1, depthField: 'hop' } },
    //   ])
    //   Then load the nodes and return { root, edges: [{ from, to, type, basis, confidence, description, evidence_quote }], nodes }.
    //   Keep `basis` in the output: the prompt relies on it to avoid causal wording.
    return notImplemented('get_timeline', { node_id, depth });
  },
  {
    name: 'get_timeline',
    description:
      'Get what followed or contradicted a node: connected events with edge type, basis (stated/sequence_only/inferred) and evidence.',
    schema: z.object({
      node_id: z.string().describe('Starting node id, from search_nodes'),
      depth: z.number().int().min(1).max(4).default(2).describe('How many hops to follow'),
    }),
  },
);
