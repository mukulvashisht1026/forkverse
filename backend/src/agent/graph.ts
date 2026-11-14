/**
 * Agent graph (LangGraph).
 *
 * Contains: the ReAct-style loop
 *
 *     START -> agent --(tool calls?)--> tools -> agent ... --(no tool calls)--> END
 *
 * - `agent` node: calls the chat model (with tools bound) on system prompt + thread messages.
 * - `tools` node: LangGraph ToolNode, runs whatever tools the model asked for and appends
 *   ToolMessages, which the model reads on the next `agent` step.
 * Compiled with the Mongo checkpointer, so state is saved per thread_id after every step.
 *
 * TODO:
 *   - Add a `retrieve` node before `agent` that always pre-fetches context (search_nodes on the
 *     user question) instead of relying on the model to call tools.
 *   - Add a `verify` node after `agent` that checks cited quotes with utils/quotes.ts verifyQuote
 *     and strips/flags claims whose quote does not appear in the cited source.
 *   - Trim long histories (trimMessages) before calling the model.
 */
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { SystemMessage } from '@langchain/core/messages';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { type BaseCheckpointSaver, END, START, StateGraph } from '@langchain/langgraph';
import { ToolNode, toolsCondition } from '@langchain/langgraph/prebuilt';
import { checkpointer } from './checkpointer.js';
import { createChatModel } from './model.js';
import { buildSystemPrompt } from './prompts/system.js';
import { AgentState, type AgentStateType } from './state.js';
import { getTools } from './tools/index.js';
export interface AgentGraphDeps {
  model: BaseChatModel;
  checkpointer: BaseCheckpointSaver;
  /** Defaults to the tools loaded by initTools() (local + Context.dev MCP). */
  tools?: StructuredToolInterface[];
  /** Overrides the default chat system prompt (e.g. for research runs). */
  systemPrompt?: string;
}

/** Deps are injectable so tests can use a fake model and an in-memory checkpointer. */
export function createAgentGraph(deps: AgentGraphDeps) {
  const tools = deps.tools ?? getTools(); // must be called here, not at module top level
  const model = deps.model.bindTools!(tools);

  async function agentNode(state: AgentStateType) {
    const response = await model.invoke([new SystemMessage(deps.systemPrompt ?? buildSystemPrompt(state.entityId)), ...state.messages]);
    return { messages: [response] };
  }

  return new StateGraph(AgentState)
    .addNode('agent', agentNode)
    .addNode('tools', new ToolNode(tools))
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', toolsCondition, ['tools', END])
    .addEdge('tools', 'agent')
    .compile({ checkpointer: deps.checkpointer });
}

let graph: ReturnType<typeof createAgentGraph> | undefined;

/** Built lazily so importing this module (e.g. in tests) does not need LLM config. */
export function getAgentGraph() {
  graph ??= createAgentGraph({ model: createChatModel(), checkpointer });
  return graph;
}
