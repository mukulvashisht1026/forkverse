/**
 * Demo timeline for showing the frontend graph without live data (TIMELINE_MOCK=true).
 *
 * Content comes from the frontend's own examples (frontend/README.md contract samples and the
 * fixtures in frontend/src/utils/*.test.ts). It is DEMO DATA: platform says so, no source URLs
 * point at real articles, and scrapeEngine is 'seed'.
 *
 * - seedMockTimeline(): loads MOCK_NODES into a store before the server starts, so the first
 *   `timeline:init` frame over /ws already contains the graph.
 * - startMockFeed(): replays MOCK_LIVE_STEPS one by one through the store + WebSocket hub
 *   (`branch:created` / `node:created` frames), so the tree visibly grows.
 */
import type { RealtimeHub } from '../realtime/hub.js';
import { logger } from '../utils/logger.js';
import type { TimelineStore } from './store.js';
import type { CreateBranchPayload, CreateNodePayload } from './types.js';

const DEMO_PLATFORM = 'Demo data · X';

export const MOCK_NODES: CreateNodePayload[] = [
  {
    id: 'demo-tariff',
    name: 'Tariff Post',
    declaration: 'Proposed 25% tariffs on imported autos and semiconductors...',
    info: 'Followed by automaker sell-offs and supplier hedging.',
    platform: DEMO_PLATFORM,
    timestamp: '18m ago',
    scrapeEngine: 'seed',
    stockImpact: {
      summary: 'Legacy automakers slid while domestic steel equities rallied.',
      tickers: [{ ticker: 'GM', company: 'General Motors', change: '-3.8%', direction: 'down', note: 'Cross-border assembly exposure' }],
    },
    publicAppeal: {
      sentimentLabel: 'Sharply Divided',
      positivePct: 41,
      neutralPct: 16,
      negativePct: 43,
      narrative: 'Domestic manufacturing unions praised protectionism while consumer groups warned of higher vehicle prices.',
    },
    branches: [
      { id: 'demo-br-reuters-auto', name: 'Reuters · Auto Selloff', info: 'Detroit automakers dropped in early trading following tariff warning.', sourceType: 'market', growthSide: 'top', sourceDomain: 'reuters.com', impactAngle: 'Market Reaction' },
      { id: 'demo-br-x-thread', name: 'X · Public Thread', info: 'Social sentiment response.', sourceType: 'social', growthSide: 'bottom', sourceDomain: 'x.com', impactAngle: 'X Sentiment' },
      { id: 'demo-br-wsj-supply', name: 'WSJ · Supply Chain', info: 'Suppliers flagged Q2 margin pressure from import duties.', sourceType: 'news', growthSide: 'top', sourceDomain: 'wsj.com', impactAngle: 'Industry Analysis' },
    ],
  },
  {
    id: 'demo-chips',
    name: 'Chip Tariff Warning',
    declaration: 'Post warning of semiconductor import duties.',
    info: 'Chipmakers dipped while domestic foundries rallied.',
    platform: DEMO_PLATFORM,
    timestamp: '42m ago',
    scrapeEngine: 'seed',
    stockImpact: {
      summary: 'SOXX slipped 2.1% intraday.',
      tickers: [
        { ticker: 'NVDA', company: 'NVIDIA', change: '-2.4%', direction: 'down', note: 'Export pressure' },
        { ticker: 'INTC', company: 'Intel', change: '+3.0%', direction: 'up', note: 'US fab tailwind' },
      ],
    },
    publicAppeal: {
      sentimentLabel: 'Polarized',
      positivePct: 40,
      neutralPct: 20,
      negativePct: 40,
      narrative: 'High-volume debate between semiconductor analysts and domestic manufacturing advocates.',
    },
    branches: [
      { id: 'demo-br-reuters-semi', name: 'Reuters · Semiconductor Impact', info: 'Chip equipment makers fell in afternoon trading.', sourceType: 'news', growthSide: 'top', sourceDomain: 'reuters.com', impactAngle: 'Sector Impact' },
      { id: 'demo-br-x-traders', name: 'X · Trader Reactions', info: 'High volume debate across semiconductor analysts.', sourceType: 'social', growthSide: 'bottom', sourceDomain: 'x.com', impactAngle: 'Trader Sentiment' },
    ],
  },
  {
    id: 'demo-fed',
    name: 'Fed Rate Post',
    declaration: 'Called for lower interest rates to support borrowers.',
    info: 'Treasury yields dipped as rate-sensitive tech rallied.',
    platform: DEMO_PLATFORM,
    timestamp: '1h ago',
    scrapeEngine: 'seed',
    stockImpact: {
      summary: 'Treasury yields dipped as rate-sensitive tech rallied.',
      tickers: [{ ticker: 'QQQ', company: 'Invesco QQQ', change: '+1.4%', direction: 'up', note: 'Growth bid' }],
    },
    publicAppeal: {
      sentimentLabel: 'Constructive',
      positivePct: 52,
      neutralPct: 22,
      negativePct: 26,
      narrative: 'Borrowers welcomed lower rate pressure.',
    },
    branches: [
      { id: 'demo-br-treasury', name: 'Treasury Yields', info: '10Y jumped 8bps', sourceType: 'market', growthSide: 'top', impactAngle: 'Rates' },
    ],
  },
];

export type MockStep =
  | { kind: 'branch'; nodeId: string; branch: CreateBranchPayload; message: string }
  | { kind: 'node'; node: CreateNodePayload; message: string };

export const MOCK_LIVE_STEPS: MockStep[] = [
  {
    kind: 'branch',
    nodeId: 'demo-tariff',
    branch: { id: 'demo-br-bloomberg-yields', name: 'Bloomberg · Bond Yields', info: '10Y Treasury yields climbed 6bps following tariff remarks.', sourceType: 'market', growthSide: 'top', sourceDomain: 'bloomberg.com', impactAngle: 'Rates' },
    message: 'Live update: Bloomberg · Bond Yields attached to Tariff Post',
  },
  {
    kind: 'branch',
    nodeId: 'demo-tariff',
    branch: { id: 'demo-br-reddit', name: 'Reddit · Consumer Pulse', info: 'Price concern threads.', sourceType: 'social', growthSide: 'bottom', sourceDomain: 'reddit.com', impactAngle: 'Public Sentiment' },
    message: 'Reddit consumer threads attached to Tariff Post',
  },
  {
    kind: 'branch',
    nodeId: 'demo-chips',
    branch: { id: 'demo-br-x-viral', name: 'X · Viral Thread', info: 'A long thread on chip supply chains drew wide engagement.', sourceType: 'social', growthSide: 'bottom', sourceDomain: 'x.com', impactAngle: 'X Sentiment' },
    message: 'X sentiment spike detected on Chip Tariff Warning',
  },
  {
    kind: 'node',
    node: {
      id: 'demo-energy',
      name: 'Energy Permits',
      declaration: 'Fast-track LNG approvals.',
      info: 'Energy equities rallied.',
      platform: DEMO_PLATFORM,
      timestamp: 'Just now',
      scrapeEngine: 'seed',
      stockImpact: { summary: 'Energy equities rallied.', tickers: [] },
      publicAppeal: { sentimentLabel: 'Mixed', positivePct: 45, neutralPct: 25, negativePct: 30, narrative: 'Industry groups welcomed faster approvals; environmental groups objected.' },
      branches: [],
    },
    message: 'Detected new declaration: Energy Permits',
  },
  {
    kind: 'branch',
    nodeId: 'demo-energy',
    branch: { id: 'demo-br-energy-policy', name: 'Policy · Permit Timeline', info: 'Agencies outlined a shorter review window for LNG export terminals.', sourceType: 'policy', growthSide: 'top', impactAngle: 'Policy' },
    message: 'Policy branch attached to Energy Permits',
  },
  {
    kind: 'branch',
    nodeId: 'demo-fed',
    branch: { id: 'demo-br-fed-x', name: 'X · Borrower Reactions', info: 'Mortgage holders discussed refinancing plans.', sourceType: 'social', growthSide: 'bottom', sourceDomain: 'x.com', impactAngle: 'X Sentiment' },
    message: 'Borrower reactions attached to Fed Rate Post',
  },
];

export async function seedMockTimeline(store: TimelineStore): Promise<void> {
  for (const node of MOCK_NODES) await store.addNode(node);
}

/** Apply one step through the store and broadcast it exactly like the REST routes do. */
export async function applyMockStep(store: TimelineStore, hub: RealtimeHub, step: MockStep): Promise<void> {
  const timestamp = new Date().toISOString();
  if (step.kind === 'node') {
    const result = await store.addNode(step.node);
    hub.broadcast({ type: 'node:created', payload: result, message: step.message, timestamp });
  } else {
    const result = await store.addBranch(step.nodeId, step.branch);
    hub.broadcast({
      type: 'branch:created',
      payload: { nodeId: result.node.id, branch: result.branch, version: result.version },
      message: step.message,
      timestamp,
    });
  }
}

/** Replay MOCK_LIVE_STEPS every intervalMs; returns a stop function. */
export function startMockFeed(store: TimelineStore, hub: RealtimeHub, intervalMs: number): () => void {
  let i = 0;
  const timer = setInterval(() => {
    const step = MOCK_LIVE_STEPS[i++];
    if (!step) {
      clearInterval(timer);
      logger.info('mock timeline feed finished');
      return;
    }
    applyMockStep(store, hub, step).catch((err) => logger.error({ err }, 'mock step failed'));
  }, intervalMs);
  return () => clearInterval(timer);
}
