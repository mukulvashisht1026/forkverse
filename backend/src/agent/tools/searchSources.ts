/**
 * search_sources tool: semantic search over screened sources (propaganda vetting results),
 * stored with embeddings by vetting/sourceIndex.ts. Lets the agent answer "which sources used
 * fear-based framing?" or "is <site> flagged?" from stored, attributed findings.
 */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { col } from '../../db/client.js';
import { getEmbeddings } from '../../db/vectorStore.js';
import { SourceIndex } from '../../vetting/sourceIndex.js';
import { ok } from './result.js';

export const searchSourcesTool = tool(
  async ({ query, n, flagged_only }) => {
    const index = new SourceIndex(col.sources, (text) => getEmbeddings().embedQuery(text));
    const items = await index.search(query, { limit: n, flaggedOnly: flagged_only });
    return ok({ items, note: 'Vetting is a screening aid: attributed listings and verified quotes, not proof of intent or falsity.' });
  },
  {
    name: 'search_sources',
    description:
      'Semantic search over sources that were screened for propaganda (verdict credible/uncertain/manipulative, ' +
      '0-100 propaganda score, reasons, verified technique quotes). Use for questions about which sources are ' +
      'flagged, how a site was rated, or which sources used a given technique.',
    schema: z.object({
      query: z.string().describe('What to look for, e.g. a site name, topic or technique'),
      n: z.number().int().min(1).max(20).default(5),
      flagged_only: z.boolean().default(false).describe('Only sources with a propaganda score above 60'),
    }),
  },
);

