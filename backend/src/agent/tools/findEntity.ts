/**
 * Tool: find_entity
 *
 * Contains: lookup of tracked entities by name or alias, so the agent can turn
 * "what did Exxon say..." into an entity_id that other tools accept.
 *
 * Reads: `entities` (name, aliases, entity_type).
 */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { ENTITY_TYPES } from '../../db/schema.js';
import { notImplemented } from './result.js';

export const findEntityTool = tool(
  async ({ query, entity_type }) => {
    // TODO: case-insensitive match on name/aliases, e.g.
    //   col.entities.find({
    //     ...(entity_type && { entity_type }),
    //     $or: [{ name: { $regex: escapeRegex(query), $options: 'i' } }, { aliases: { $regex: ..., $options: 'i' } }],
    //   }).limit(5)
    // Return [{ entity_id, entity_type, name, description }].
    return notImplemented('find_entity', { query, entity_type });
  },
  {
    name: 'find_entity',
    description: 'Find tracked entities (person, organization, event, asset, topic) by name or alias. Returns entity ids.',
    schema: z.object({
      query: z.string().describe('Name or alias to search for'),
      entity_type: z.enum(ENTITY_TYPES).optional().describe('Restrict to one entity type'),
    }),
  },
);
