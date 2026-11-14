import test from 'node:test';
import assert from 'node:assert/strict';
import { temporaryWorkspaceFromTimelineNode } from './createWorkspace';
import type { SpineNode } from '../types/tree';

test('live scrape workspace keeps graph usable while identifying timeline ID as temporary', () => {
  const node: SpineNode = { id: 'global-node-1', name: 'Topic', declaration: 'Topic', info: 'Summary', platform: 'API', stockImpact: { summary: '', tickers: [] }, publicAppeal: { sentimentLabel: '', positivePct: 0, neutralPct: 0, negativePct: 0, narrative: '' }, scrapeEngine: 'manual', branches: [] };
  const workspace = temporaryWorkspaceFromTimelineNode(node);
  assert.equal(workspace.investigation.id, node.id);
  assert.equal(workspace.temporary, true);
  assert.deepEqual(workspace.nodes, [node]);
});
