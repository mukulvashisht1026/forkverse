import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyTimelineEvent,
  resolveApiUrl,
  resolveWsUrl,
  type TimelineClientState,
} from './timelineReducer';
import type { SpineNode } from '../types/tree';

const sampleNode = (id = 'node-1', name = 'Sample Event'): SpineNode => ({
  id,
  name,
  declaration: 'Declaration text',
  info: 'Summary',
  platform: 'X',
  stockImpact: { summary: 'Mixed', tickers: [] },
  publicAppeal: {
    sentimentLabel: 'Balanced',
    positivePct: 40,
    neutralPct: 20,
    negativePct: 40,
    narrative: 'Debate ongoing',
  },
  scrapeEngine: 'exa',
  branches: [],
});

const emptyState: TimelineClientState = {
  nodes: [],
  version: 0,
  updatedAt: null,
  lastMessage: null,
};

test('resolveApiUrl and resolveWsUrl support same-origin and external backend bases', () => {
  assert.equal(resolveApiUrl('/api/timeline', ''), '/api/timeline');
  assert.equal(
    resolveApiUrl('/api/timeline', 'https://backend.example.com/api/'),
    'https://backend.example.com/api/timeline'
  );
  assert.equal(
    resolveApiUrl('/api/timeline', 'https://backend.example.com'),
    'https://backend.example.com/api/timeline'
  );
  assert.equal(
    resolveWsUrl('', { protocol: 'https:', host: 'app.example.com' }),
    'wss://app.example.com/ws'
  );
  assert.equal(
    resolveWsUrl('wss://ws.example.com/live', {
      protocol: 'http:',
      host: 'localhost:3000',
    }),
    'wss://ws.example.com/live'
  );
});

test('older init snapshot cannot roll back newer websocket state', () => {
  const current = applyTimelineEvent(emptyState, { type: 'timeline:init', payload: { nodes: [sampleNode('n', 'new')], version: 3, updatedAt: 'new' }, timestamp: 'new' });
  const stale = applyTimelineEvent(current, { type: 'timeline:init', payload: { nodes: [], version: 2, updatedAt: 'old' }, timestamp: 'old' });
  assert.equal(stale, current);
});

test('applyTimelineEvent handles init and idempotent node:created / branch:created', () => {
  const s1 = applyTimelineEvent(emptyState, {
    type: 'timeline:init',
    payload: {
      nodes: [sampleNode('n-1', 'Initial Node')],
      version: 1,
      updatedAt: '2026-11-13T18:00:00Z',
    },
    timestamp: '2026-11-13T18:00:00Z',
  });
  assert.equal(s1.nodes.length, 1);
  assert.equal(s1.version, 1);

  const createEvt = {
    type: 'node:created' as const,
    payload: { node: sampleNode('n-2', 'Live Tweet'), version: 2 },
    message: 'New X declaration received from backend',
    timestamp: '2026-11-13T18:01:00Z',
  };

  const s2 = applyTimelineEvent(s1, createEvt);
  assert.equal(s2.nodes.length, 2);
  assert.equal(s2.lastMessage?.text, 'New X declaration received from backend');

  // Re-applying identical node:created must remain idempotent
  const s2Dup = applyTimelineEvent(s2, createEvt);
  assert.equal(s2Dup.nodes.length, 2);

  const branchEvt = {
    type: 'branch:created' as const,
    payload: {
      nodeId: 'n-2',
      branch: {
        id: 'br-1',
        name: 'Reuters · Reaction',
        info: 'Markets moved 2%',
        sourceType: 'market' as const,
        growthSide: 'top' as const,
        seed: 42,
      },
      version: 3,
    },
    message: 'Branch added to Live Tweet',
    timestamp: '2026-11-13T18:02:00Z',
  };

  const s3 = applyTimelineEvent(s2Dup, branchEvt);
  assert.equal(s3.nodes[1].branches.length, 1);
  assert.equal(s3.nodes[1].branches[0]._prog, 0);
  assert.equal(s3.lastMessage?.text, 'Branch added to Live Tweet');

  // Duplicate branch:created must remain idempotent
  const s3Dup = applyTimelineEvent(s3, branchEvt);
  assert.equal(s3Dup.nodes[1].branches.length, 1);
});

test('applyTimelineEvent handles node:updated, node:deleted, branch:deleted, and system:message', () => {
  const base = applyTimelineEvent(emptyState, {
    type: 'timeline:init',
    payload: {
      nodes: [
        {
          ...sampleNode('n-1', 'Tariffs'),
          branches: [
            {
              id: 'b-1',
              name: 'WSJ',
              info: 'Note',
              sourceType: 'news',
              seed: 11,
            },
          ],
        },
      ],
      version: 1,
      updatedAt: '2026-11-13T18:00:00Z',
    },
    timestamp: '2026-11-13T18:00:00Z',
  });

  const sUpdated = applyTimelineEvent(base, {
    type: 'node:updated',
    payload: {
      node: {
        ...sampleNode('n-1', 'Tariffs Updated'),
        branches: [
          {
            id: 'b-1',
            name: 'WSJ',
            info: 'Note',
            sourceType: 'news',
            seed: 11,
          },
        ],
      },
      version: 2,
    },
    message: 'Stock impact updated',
    timestamp: '2026-11-13T18:03:00Z',
  });
  assert.equal(sUpdated.nodes[0].name, 'Tariffs Updated');
  assert.equal(sUpdated.lastMessage?.text, 'Stock impact updated');

  const sBranchDel = applyTimelineEvent(sUpdated, {
    type: 'branch:deleted',
    payload: { nodeId: 'n-1', branchId: 'b-1', version: 3 },
    timestamp: '2026-11-13T18:04:00Z',
  });
  assert.equal(sBranchDel.nodes[0].branches.length, 0);

  const sMsg = applyTimelineEvent(sBranchDel, {
    type: 'system:message',
    message: 'Backend worker synced 4 new filings',
    timestamp: '2026-11-13T18:05:00Z',
  });
  assert.equal(sMsg.lastMessage?.text, 'Backend worker synced 4 new filings');

  const sNodeDel = applyTimelineEvent(sMsg, {
    type: 'node:deleted',
    payload: { nodeId: 'n-1', version: 4 },
    timestamp: '2026-11-13T18:06:00Z',
  });
  assert.equal(sNodeDel.nodes.length, 0);
});
