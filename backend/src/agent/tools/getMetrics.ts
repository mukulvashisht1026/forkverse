/**
 * Tool: get_metrics
 *
 * Contains: numeric time series for an entity (e.g. price_usd for an asset) over a date range.
 * The agent may describe values, but must never attribute a move to a story.
 *
 * Reads: `metrics` using the (entity_id, name, observed_at) index.
 */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { notImplemented } from './result.js';

export const getMetricsTool = tool(
  async ({ entity_id, name, from, to }) => {
    // TODO:
    //   col.metrics.find({ entity_id, name, observed_at: { $gte: new Date(from), $lte: new Date(to) } })
    //     .sort({ observed_at: 1 }).limit(500)
    //   Downsample if long; return { entity_id, name, points: [{ t, v }], disclaimer: 'Not financial advice.' }.
    return notImplemented('get_metrics', { entity_id, name, from, to });
  },
  {
    name: 'get_metrics',
    description: 'Get a numeric time series (e.g. price_usd) for an entity between two dates.',
    schema: z.object({
      entity_id: z.string(),
      name: z.string().default('price_usd'),
      from: z.string().describe('ISO date'),
      to: z.string().describe('ISO date'),
    }),
  },
);
