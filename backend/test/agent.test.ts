import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, HumanMessage, type BaseMessage, type ToolMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { MemorySaver } from '@langchain/langgraph';
import { describe, expect, it } from 'vitest';
import { createAgentGraph } from '../src/agent/graph.js';

/** Returns scripted responses in order; records what it was called with. */
class ScriptedChatModel extends BaseChatModel {
  calls: BaseMessage[][] = [];
  constructor(private responses: AIMessage[]) {
    super({});
  }
  _llmType() {
    return 'scripted';
  }
  override bindTools() {
    return this as never;
  }
  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    this.calls.push(messages);
    const message = this.responses.shift();
    if (!message) throw new Error('no scripted response left');
    return { generations: [{ message, text: String(message.content) }] };
  }
}

const stubTool = tool(async ({ url }) => JSON.stringify({ error: 'not_implemented', url }), {
  name: 'get_source',
  description: 'stub',
  schema: z.object({ url: z.string() }),
});

describe('agent graph', () => {
  it('runs a tool call, then answers, and keeps history per thread_id', async () => {
    const model = new ScriptedChatModel([
      new AIMessage({ content: '', tool_calls: [{ id: 'c1', name: 'get_source', args: { url: 'https://example.com' } }] }),
      new AIMessage('No evidence available yet.'),
      new AIMessage('Second turn reply.'),
      new AIMessage('Hello.'),
    ]);
    const graph = createAgentGraph({ model, checkpointer: new MemorySaver(), tools: [stubTool] });
    const config = { configurable: { thread_id: 't1' } };

    const first = await graph.invoke({ messages: [new HumanMessage('What about the merger?')] }, config);
    const types = first.messages.map((m) => m.getType());
    expect(types).toEqual(['human', 'ai', 'tool', 'ai']);
    const toolMsg = first.messages[2] as ToolMessage;
    expect(JSON.parse(String(toolMsg.content)).error).toBe('not_implemented');
    expect(first.messages.at(-1)!.content).toBe('No evidence available yet.');

    const second = await graph.invoke({ messages: [new HumanMessage('And then?')] }, config);
    expect(second.messages).toHaveLength(6);
    // Model saw system prompt + full prior thread on the second turn.
    expect(model.calls[2]![0]!.getType()).toBe('system');
    expect(model.calls[2]).toHaveLength(6);

    const other = await graph.invoke({ messages: [new HumanMessage('hi')] }, { configurable: { thread_id: 't2' } });
    expect(other.messages.map((m) => m.content)).toEqual(['hi', 'Hello.']);
  });
});
