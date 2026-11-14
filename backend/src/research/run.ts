/**
 * Research run: prompt -> agent searches news/web -> articles stream to the frontend graph.
 *
 * 1. Create (or reuse, in branch mode) a spine node for the query and broadcast `node:created`.
 * 2. Run the agent with ONLY the news + web search tools and a research prompt, streaming its
 *    steps. Each time a tool returns, articles are parsed from the raw tool output and
 *    broadcast one by one as `branch:created`, so the graph grows live.
 * 3. Put the agent's closing summary on the node (`node:updated`) and report the count.
 *
 * Article URLs/titles only ever come from tool output (see articles.ts), never from LLM text.
 */
import { randomUUID } from 'node:crypto';
import { HumanMessage, type BaseMessage } from '@langchain/core/messages';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { MemorySaver } from '@langchain/langgraph';
import { createAgentGraph } from '../agent/graph.js';
import { createChatModel } from '../agent/model.js';
import { getTools } from '../agent/tools/index.js';
import type { RealtimeHub } from '../realtime/hub.js';
import type { TimelineStore } from '../timeline/store.js';
import type { SpineNode } from '../timeline/types.js';
import { logger } from '../utils/logger.js';
import { type Article, articleBranchId, articleToBranch, extractArticles, isRelevant, queryTerms } from './articles.js';

export const RESEARCH_TOOL_NAMES = ['context_get-news-search', 'context_web-search'];
export const MAX_ARTICLES = 25;
/** Per tool result, so several searches contribute instead of the first one filling the graph. */
export const MAX_PER_RESULT = 10;
const RECURSION_LIMIT = 16;

export const RESEARCH_PROMPT = `You are a research assistant collecting articles about a topic for a timeline graph.

Use the tools to find as many relevant, distinct articles as you can (aim for 15-25):
- Call context_get-news-search with a clear "query" for news coverage. Use "limit" up to 25.
- Call context_web-search with a "query" (responseMode "compact") for official pages, explainers and background.
- Run 2-4 searches with different angles (the topic itself, key policies or claims, reactions, fact-checks).
- Prefer primary and reputable sources. Do not repeat the same search.

When done, reply with a neutral 2-3 sentence summary of what the coverage is about. Do not invent facts,
do not infer anyone's intent, and do not list URLs (they are collected from the tool results).`;

export interface ResearchDeps {
  store: TimelineStore;
  hub: RealtimeHub;
  /** Test hook: graph to run instead of the real agent. */
  graph?: ReturnType<typeof createAgentGraph>;
}

export interface ResearchRequest {
  query: string;
  /** Attach articles to this existing node instead of creating a new one. */
  nodeId?: string;
}

export interface ResearchResult {
  nodeId: string;
  articles: number;
  summary: string;
}

export function researchTools(all: StructuredToolInterface[] = getTools()): StructuredToolInterface[] {
  const tools = all.filter((t) => RESEARCH_TOOL_NAMES.includes(t.name));
  if (!tools.length) throw new Error('Research tools are not available (Context.dev MCP did not load).');
  return tools;
}

export function createResearchGraph() {
  return createAgentGraph({
    model: createChatModel(),
    checkpointer: new MemorySaver(), // research runs are one-shot
    tools: researchTools(),
    systemPrompt: RESEARCH_PROMPT,
  });
}

const now = () => new Date().toISOString();

export interface CollectRequest {
  query: string;
  /** Extra guidance for the agent; does not affect the relevance filter. */
  context?: string;
  /** Graph to run instead of the real research agent (tests). */
  graph?: ReturnType<typeof createAgentGraph>;
  /** Article ids (articleBranchId) already present, so they are not reported again. */
  skipIds?: Iterable<string>;
  /** From the topic planner: an article is relevant if it mentions ANY of these. */
  keyTerms?: string[];
  /** From the topic planner: suggested search queries for the agent. */
  queries?: string[];
}

/**
 * Run the research agent and report each new, relevant article as it is found.
 * Articles come only from raw tool output; capped per tool result and in total.
 * Returns how many articles were reported and the agent's closing summary.
 */
export async function collectArticles(
  { query, context, graph, skipIds = [], keyTerms, queries }: CollectRequest,
  onArticle: (article: Article, n: number) => Promise<void>,
): Promise<{ articles: number; summary: string }> {
  const known = new Set(skipIds);
  const terms = queryTerms(query);
  const phrases = (keyTerms ?? []).map((t) => t.toLowerCase().normalize('NFKD')).filter(Boolean);
  // Planner key terms: ANY match is enough (typos/filler in the raw text no longer drop everything).
  const relevant = (a: Article) =>
    phrases.length ? phrases.some((p) => `${a.title} ${a.description ?? ''}`.toLowerCase().normalize('NFKD').includes(p)) : isRelevant(a, terms);
  let added = 0;
  let summary = '';
  const prompt = [
    `Find articles about: ${query}`,
    context?.trim() ? `Context: ${context.trim()}` : '',
    queries?.length ? `Suggested searches: ${queries.map((q) => `"${q}"`).join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const stream = await (graph ?? createResearchGraph()).stream(
    { messages: [new HumanMessage(prompt)] },
    { configurable: { thread_id: randomUUID() }, recursionLimit: RECURSION_LIMIT, streamMode: 'updates' },
  );

  for await (const update of stream as AsyncIterable<Record<string, { messages?: BaseMessage[] }>>) {
    for (const [step, value] of Object.entries(update)) {
      for (const msg of value?.messages ?? []) {
        if (step === 'tools') {
          const tool = (msg as { name?: string }).name ?? 'unknown';
          const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
          let fromThisResult = 0;
          for (const article of extractArticles(text, tool)) {
            if (added >= MAX_ARTICLES || fromThisResult >= MAX_PER_RESULT) break;
            if (!relevant(article)) continue;
            const id = articleBranchId(article.url);
            if (known.has(id)) continue;
            known.add(id);
            added += 1;
            fromThisResult += 1;
            await onArticle(article, added);
          }
        } else if (step === 'agent' && msg.getType() === 'ai') {
          const text = typeof msg.content === 'string' ? msg.content : '';
          if (text.trim()) summary = text.trim();
        }
      }
    }
  }
  return { articles: added, summary };
}

export async function runResearch({ query, nodeId }: ResearchRequest, deps: ResearchDeps): Promise<ResearchResult> {
  const { store, hub } = deps;

  // 1. Target node.
  let node: SpineNode;
  const existing = nodeId ? await store.getNode(nodeId) : null;
  if (existing) {
    node = existing;
  } else {
    const created = await store.addNode({
      name: query,
      declaration: query,
      info: 'Researching related articles…',
      platform: 'Forkverse research agent',
      timestamp: 'Just now',
      scrapeEngine: 'context.dev',
      stockImpact: { summary: 'No market data collected for this research query.', tickers: [] },
      publicAppeal: {
        sentimentLabel: 'Not assessed',
        positivePct: 34,
        neutralPct: 33,
        negativePct: 33,
        narrative: 'Sentiment is not measured for research queries; the split shown is a placeholder.',
      },
    });
    node = created.node;
    hub.broadcast({
      type: 'node:created',
      payload: created,
      message: `Researching "${query}"… articles will appear as they are found.`,
      timestamp: now(),
    });
  }

  // 2. Run the agent and stream articles onto the node as they are found.
  const { articles: added, summary } = await collectArticles(
    { query, graph: deps.graph, skipIds: node.branches.map((b) => b.id) },
    async (article, n) => {
      const res = await store.addBranch(node.id, articleToBranch(article));
      hub.broadcast({
        type: 'branch:created',
        payload: { nodeId: node.id, branch: res.branch, version: res.version },
        message: `Article ${n}: ${article.title}`,
        timestamp: now(),
      });
    },
  );

  // 3. Summary on the node + final status.
  if (summary) {
    const updated = await store.updateNode(node.id, { info: summary.slice(0, 600) });
    hub.broadcast({ type: 'node:updated', payload: updated, timestamp: now() });
  }
  hub.broadcast({
    type: 'system:message',
    message: added
      ? `Found ${added} article${added === 1 ? '' : 's'} for "${query}".`
      : `No articles found for "${query}".`,
    timestamp: now(),
  });
  logger.info({ query, nodeId: node.id, articles: added }, 'research run finished');
  return { nodeId: node.id, articles: added, summary };
}
