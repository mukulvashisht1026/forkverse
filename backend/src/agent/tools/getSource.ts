/**
 * Tool: get_source
 *
 * Contains: details for one source: URL, title, domain, published date, readability and the
 * vetting result (verdict, risk, coverage, per-signal detail). Lets the agent explain why a
 * branch was pruned or how trustworthy a claim is.
 *
 * Reads: `sources` by _id or url. Never returns the full `text` (too large for context).
 */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { notImplemented } from './result.js';

export const getSourceTool = tool(
  async ({ source_id, url }) => {
    // TODO:
    //   col.sources.findOne(source_id ? { _id: source_id } : { url }, { projection: { text: 0 } })
    //   Return { source_id, url, domain, title, published_at, readable, fetch_error,
    //            vet: { verdict, risk, coverage, detail } }.
    //   If readable=false, surface fetch_error (principle: fail visibly).
    return notImplemented('get_source', { source_id, url });
  },
  {
    name: 'get_source',
    description: 'Get a source with its vetting verdict (credible/uncertain/manipulative), risk and coverage.',
    schema: z
      .object({
        source_id: z.string().optional(),
        url: z.string().optional(),
      })
      .refine((v) => v.source_id || v.url, 'Provide source_id or url'),
  },
);
