/**
 * Agent service: the only module routes should import.
 *
 * Contains:
 * - `runAgent()`: run one user turn on a thread (creates a thread_id if none given) and return
 *   the final assistant reply.
 * - `getThreadMessages()`: load a thread's message history from the checkpointer.
 *
 * TODO:
 *   - `streamAgent()`: stream tokens/tool events (graph.streamEvents) for an SSE endpoint.
 *   - Return citations collected from tool results alongside the reply.
 *   - Enforce thread ownership once there are users (thread_id is currently a bearer secret).
 */
import { randomUUID } from 'node:crypto';
import { HumanMessage, type BaseMessage } from '@langchain/core/messages';
import { getAgentGraph } from './graph.js';

/** Max graph steps per turn; stops runaway tool loops. */
const RECURSION_LIMIT = 12;

export interface AgentTurnInput {
  message: string;
  threadId?: string;
  entityId?: string;
}

export interface ChatMessageView {
  role: string; // human | ai | tool | system
  content: string;
  tool_calls?: { name: string; args: unknown }[];
  tool_name?: string;
}

export interface AgentTurnResult {
  threadId: string;
  reply: string;
  messages: ChatMessageView[]; // messages added during this turn (tool calls, tool results, reply)
}

export async function runAgent({ message, threadId, entityId }: AgentTurnInput): Promise<AgentTurnResult> {
  const id = threadId ?? randomUUID();
  const graph = getAgentGraph();
  const config = { configurable: { thread_id: id }, recursionLimit: RECURSION_LIMIT };

  const before = (await graph.getState(config)).values.messages?.length ?? 0;
  const state = await graph.invoke(
    { messages: [new HumanMessage(message)], ...(entityId !== undefined && { entityId }) },
    config,
  );

  const added = state.messages.slice(before);
  const last = added.at(-1);
  return { threadId: id, reply: last ? textOf(last) : '', messages: added.map(toView) };
}

/** Returns null when the thread does not exist. */
export async function getThreadMessages(threadId: string): Promise<ChatMessageView[] | null> {
  const snapshot = await getAgentGraph().getState({ configurable: { thread_id: threadId } });
  const messages = snapshot.values.messages as BaseMessage[] | undefined;
  return messages ? messages.map(toView) : null;
}

function textOf(m: BaseMessage): string {
  return typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
}

function toView(m: BaseMessage): ChatMessageView {
  const view: ChatMessageView = { role: m.getType(), content: textOf(m) };
  if ('tool_calls' in m && Array.isArray(m.tool_calls) && m.tool_calls.length) {
    view.tool_calls = m.tool_calls.map((c: { name: string; args: unknown }) => ({ name: c.name, args: c.args }));
  }
  if (m.getType() === 'tool' && m.name) view.tool_name = m.name;
  return view;
}
