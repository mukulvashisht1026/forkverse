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
import { findEntityTool } from './findEntity.js';
import { getMetricsTool } from './getMetrics.js';
import { getSourceTool } from './getSource.js';
import { getTimelineTool } from './getTimeline.js';
import { searchNodesTool } from './searchNodes.js';

export const tools = [findEntityTool, searchNodesTool, getTimelineTool, getSourceTool, getMetricsTool];
