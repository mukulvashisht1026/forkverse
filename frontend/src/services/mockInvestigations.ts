import type { InvestigationGraph, InvestigationRepository, Investigation } from './investigations';
import type { BranchNode, SpineNode } from '../types/tree';

const STORAGE_KEY = 'tracewire.mock-investigations.v1';
type StoredGraph = Investigation & { nodes: SpineNode[] };

const branch = (id: string, name: string, info: string, sourceDomain: string, seed: number): BranchNode => ({
  id, name, info, sourceType: 'news', sourceDomain, sourceUrl: `https://${sourceDomain}`, seed,
});
const node = (id: string, name: string, info: string, index: number): SpineNode => ({
  id, name, declaration: name, info, platform: 'Demo source', timestamp: new Date(Date.now() - index * 86_400_000).toISOString(),
  stockImpact: { summary: 'No simulated market impact', tickers: [] },
  publicAppeal: { sentimentLabel: 'Mixed', positivePct: 35, neutralPct: 45, negativePct: 20, narrative: 'Demo data for interface preview.' },
  scrapeEngine: 'seed',
  branches: [
    branch(`${id}-a`, 'Background and context', 'A sample evidence item to preview the graph and its detail card.', 'example.org', index * 17 + 1),
    branch(`${id}-b`, 'Public response and reporting', 'A second sample source connected to this event.', 'news.example.org', index * 17 + 2),
  ],
});

const seedGraphs: StoredGraph[] = [
  { id: 'demo-ai-regulation', title: 'European AI regulation', description: 'Policy decisions and technology developments in AI governance.', createdAt: '2026-05-12T10:00:00.000Z', updatedAt: '2026-05-14T10:00:00.000Z', nodes: [
    node('ai-1', 'AI Act proposal introduced', 'The European Commission proposed a risk-based framework for artificial intelligence.', 0),
    node('ai-2', 'Parliament adopts negotiating position', 'Lawmakers refined obligations for high-risk systems and foundation models.', 1),
    node('ai-3', 'AI Act enters into force', 'The final regulation established a phased implementation timeline.', 2),
  ] },
  { id: 'demo-lithium-supply', title: 'Global lithium supply chains', description: 'Climate policy, resources, and market developments in the global lithium supply chain.', createdAt: '2026-05-10T10:00:00.000Z', updatedAt: '2026-05-13T10:00:00.000Z', nodes: [
    node('li-1', 'Demand accelerates', 'Battery manufacturing growth reshaped demand forecasts.', 0),
    node('li-2', 'Export policy shifts', 'Resource-rich states considered new rules for domestic processing.', 1),
    node('li-3', 'New refining capacity announced', 'Investment expanded refining capacity across several regions.', 2),
  ] },
  { id: 'demo-arctic-routes', title: 'Arctic shipping routes', description: 'Climate impacts and policy decisions around Arctic shipping routes.', createdAt: '2026-05-08T10:00:00.000Z', updatedAt: '2026-05-11T10:00:00.000Z', nodes: [
    node('ar-1', 'Seasonal access expands', 'Changing conditions prompted new seasonal route assessments.', 0),
    node('ar-2', 'Safety standards debated', 'Officials discussed infrastructure and emergency-response readiness.', 1),
    node('ar-3', 'Environmental safeguards proposed', 'New measures focused on monitoring and spill prevention.', 2),
  ] },
  { id: 'demo-inflation-response', title: 'Central banks and inflation', description: 'Market and policy responses by central banks to inflation.', createdAt: '2026-05-06T10:00:00.000Z', updatedAt: '2026-05-09T10:00:00.000Z', nodes: [
    node('cb-1', 'Inflation peaks', 'Price pressures triggered a series of policy responses.', 0),
    node('cb-2', 'Rates rise across major economies', 'Central banks adjusted rates as inflation outlooks evolved.', 1),
    node('cb-3', 'Policy paths diverge', 'Different economic conditions led to varied approaches.', 2),
  ] },
];

function read(): StoredGraph[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored) as StoredGraph[];
  } catch { /* use in-memory seed if storage is unavailable */ }
  return structuredClone(seedGraphs);
}

let graphs = read();
function persist() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(graphs)); } catch { /* demo remains usable in memory */ } }
function metadata({ nodes: _nodes, ...item }: StoredGraph): Investigation { return item; }
function graph(item: StoredGraph): InvestigationGraph { return { investigationId: item.id, revision: 1, nodes: structuredClone(item.nodes) }; }

export const mockInvestigationRepository: InvestigationRepository = {
  async listPublicInvestigations() { return graphs.map(metadata).sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')); },
  async getInvestigation(id) {
    const item = graphs.find((entry) => entry.id === id);
    if (!item) throw new Error(`Demo graph "${id}" was not found.`);
    return metadata(item);
  },
  async renameInvestigation(id, title) {
    const item = graphs.find((entry) => entry.id === id);
    if (!item) throw new Error(`Demo graph "${id}" was not found.`);
    item.title = title.trim().slice(0, 120);
    item.updatedAt = new Date().toISOString();
    persist();
    return metadata(item);
  },
  async getInvestigationGraph(id) {
    const item = graphs.find((entry) => entry.id === id);
    if (!item) throw new Error(`Demo graph "${id}" was not found.`);
    return graph(item);
  },
  async createInvestigation({ topic }) {
    const clean = topic.trim();
    const id = `demo-${crypto.randomUUID()}`;
    const createdAt = new Date().toISOString();
    const item: StoredGraph = { id, title: clean.slice(0, 120), description: 'Created in local demo mode', createdAt, updatedAt: createdAt, nodes: [node(`${id}-event-1`, clean, 'This is a locally generated preview graph. Live research is disabled in mock mode.', 0)] };
    graphs = [item, ...graphs];
    persist();
    return metadata(item);
  },
  async extendInvestigation(id, { topic }) {
    const item = graphs.find((entry) => entry.id === id);
    if (!item) throw new Error(`Demo graph "${id}" was not found.`);
    item.nodes.push(node(`${id}-event-${item.nodes.length + 1}`, topic.trim(), 'A locally generated demo event. No API request was made.', item.nodes.length));
    item.updatedAt = new Date().toISOString();
    persist();
    return graph(item);
  },
};

export function isMockInvestigationMode() { return import.meta.env.VITE_MOCK_DATA === 'true'; }
