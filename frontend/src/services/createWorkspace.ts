import type { SpineNode } from '../types/tree';
import type { Investigation } from './investigations';

/** Maps legacy live scrape output to honest temporary workspace context; ID is not persistent. */
export function temporaryWorkspaceFromTimelineNode(node: SpineNode): { investigation: Investigation; nodes: SpineNode[]; temporary: true } {
  return {
    investigation: { id: node.id, title: node.name, description: node.info, createdAt: node.timestamp },
    nodes: [node],
    temporary: true,
  };
}
