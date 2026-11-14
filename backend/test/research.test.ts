import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import { tool } from '@langchain/core/tools';
import { MemorySaver } from '@langchain/langgraph';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createAgentGraph } from '../src/agent/graph.js';
import type { RealtimeHub } from '../src/realtime/hub.js';
import { articleToBranch, classifySource, extractArticles, isRelevant, queryTerms } from '../src/research/articles.js';
import { runResearch } from '../src/research/run.js';
import { MemoryTimelineStore } from '../src/timeline/store.js';
import type { WebSocketServerEvent } from '../src/timeline/types.js';

const NEWS = JSON.stringify({
  data: [
    {
      url: 'https://theguardian.com/us-news/project-2025',
      title: 'Project 2025: inside Trump’s ties to the policy playbook',
      description: 'Trump has disavowed the manifesto.',
      published_at: '2024-07-09T11:00:14.000Z',
      source: { name: 'the Guardian', domain: 'theguardian.com' },
    },
    { url: 'https://abcnews.go.com/x', title: 'Text of statement', description: null, source: { domain: 'abcnews.go.com' } },
  ],
});
const WEB = JSON.stringify({
  results: [
    { url: 'https://en.wikipedia.org/wiki/Agenda_47', title: 'Agenda 47 - Wikipedia', description: 'Campaign manifesto of Donald Trump.' },
    { url: 'https://www.theguardian.com/us-news/project-2025/', title: 'dup with trailing slash + www' },
    { url: 'not-a-url', title: 'ignored' },
  ],
});

describe('extractArticles', () => {
  it('reads news and web search shapes, dedupes by normalized URL', () => {
    const a = [...extractArticles(NEWS, 'context_get-news-search')];
    expect(a).toHaveLength(2);
    expect(a[0]).toMatchObject({ domain: 'theguardian.com', sourceName: 'the Guardian', publishedAt: '2024-07-09T11:00:14.000Z' });
    const w = extractArticles(WEB, 'context_web-search');
    expect(w.map((x) => x.domain)).toEqual(['en.wikipedia.org', 'theguardian.com']);
    expect(extractArticles('not json')).toEqual([]);
  });

  it('builds branches with real URLs and classified source types', () => {
    const b = articleToBranch(extractArticles(NEWS, 'context_get-news-search')[0]!);
    expect(b).toMatchObject({ sourceUrl: 'https://theguardian.com/us-news/project-2025', sourceType: 'news', impactAngle: 'News · the Guardian' });
    expect(classifySource('x.com')).toBe('social');
    expect(classifySource('www.bloomberg.com')).toBe('market');
    expect(classifySource('whitehouse.gov')).toBe('policy');
  });

  it('keeps only articles mentioning every key query word', () => {
    const terms = queryTerms('Find all articles about the Trump manifesto');
    expect(terms).toEqual(['trump', 'manifesto']);
    const mk = (title: string, description: string | null = null) =>
      ({ url: 'https://a.test', title, description, domain: 'a.test', sourceName: null, publishedAt: null, tool: 't' });
    expect(isRelevant(mk('Agenda 47 - Wikipedia', 'campaign manifesto of President Donald Trump'), terms)).toBe(true);
    expect(isRelevant(mk("'Bharat' trumps 'India' in BJP's poll manifesto"), terms)).toBe(true); // "trumps" contains "trump"
    expect(isRelevant(mk('Sunak urges voters', 'Tory manifesto tax cuts'), terms)).toBe(false);
  });
});

class ScriptedChatModel extends BaseChatModel {
  constructor(private responses: AIMessage[]) {
    super({});
  }
  _llmType() {
    return 'scripted';
  }
  override bindTools() {
    return this as never;
  }
  async _generate(_m: BaseMessage[]): Promise<ChatResult> {
    const message = this.responses.shift()!;
    return { generations: [{ message, text: String(message.content) }] };
  }
}

describe('runResearch', () => {
  it('creates a node, streams one branch per article, then the summary', async () => {
    const newsTool = tool(async () => NEWS, { name: 'context_get-news-search', description: 'news', schema: z.object({ query: z.string() }) });
    const webTool = tool(async () => WEB, { name: 'context_web-search', description: 'web', schema: z.object({ query: z.string() }) });
    const graph = createAgentGraph({
      model: new ScriptedChatModel([
        new AIMessage({ content: '', tool_calls: [{ id: '1', name: 'context_get-news-search', args: { query: 'Trump manifesto' } }] }),
        new AIMessage({ content: '', tool_calls: [{ id: '2', name: 'context_web-search', args: { query: 'Agenda47' } }] }),
        new AIMessage('Coverage centres on Agenda 47 and Project 2025.'),
      ]),
      checkpointer: new MemorySaver(),
      tools: [newsTool, webTool],
    });
    const store = new MemoryTimelineStore();
    const events: WebSocketServerEvent[] = [];
    const hub = { broadcast: (e: WebSocketServerEvent) => events.push(e) } as unknown as RealtimeHub;

    const result = await runResearch({ query: 'Trump manifesto' }, { store, hub, graph });

    expect(events.map((e) => e.type)).toEqual([
      'node:created',
      'branch:created', // guardian
      'branch:created', // wikipedia; abc ("Text of statement") is off-topic, guardian duplicate skipped
      'node:updated',
      'system:message',
    ]);
    expect(result.articles).toBe(2);
    const node = (await store.getNode(result.nodeId))!;
    expect(node.name).toBe('Trump manifesto');
    expect(node.info).toBe('Coverage centres on Agenda 47 and Project 2025.');
    expect(node.branches.map((b) => b.sourceUrl)).toEqual([
      'https://theguardian.com/us-news/project-2025',
      'https://en.wikipedia.org/wiki/Agenda_47',
    ]);
    expect((events.at(-1) as { message: string }).message).toBe('Found 2 articles for "Trump manifesto".');
  });
});
