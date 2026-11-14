/**
 * Tool registry.
 *
 * Contains: the list of tools bound to the model and given to the ToolNode. Add a tool by
 * creating a file in this folder and appending it here.
 *
 * TODO: possible next tools
 *   - get_entity_tree: whole tree for an entity (graph/tree.ts), for overview questions.
 *   - list_pruned: pruned branches with rejection reasons.
 */
import type { StructuredToolInterface } from '@langchain/core/tools';

import { getContextTools } from './contextMcp.js';

const localTools = [];

let allTools: StructuredToolInterface[] | null = null;

/** Call once at startup, before the graph is built. */
export async function initTools() {
  let mcpTools: StructuredToolInterface[] = [];
  try {
    mcpTools = await getContextTools();
  } catch (err) {
    console.error('Failed to load MCP tools, continuing with local tools only:', err);
  }
  allTools = [ ...mcpTools];
  console.log('Loaded tools:', allTools.map((t) => t.name));
}

export function getTools(): StructuredToolInterface[] {
  if (!allTools) throw new Error('initTools() must be awaited before using tools');
  return allTools;
}