/**
 * Chat model used by the agent.
 *
 * Contains: a LangChain `ChatOpenAI` pointed at the Hostinger AI Router (OpenAI-compatible),
 * configured from LLM_BASE_URL / LLM_API_KEY / LLM_MODEL. Same backend as clients/llm.ts, but
 * wrapped in LangChain so it supports `.bindTools()`.
 *
 * TODO:
 *   - Confirm the router model supports tool calling; if not, pick one that does.
 *   - Tune temperature/maxTokens for chat (completeJson uses temperature 0 for extraction).
 */
import { ChatOpenAI } from '@langchain/openai';
import { config } from '../config.js';

export function createChatModel() {
  return new ChatOpenAI({
    model: config.LLM_MODEL,
    apiKey: config.LLM_API_KEY || 'missing',
    configuration: { baseURL: config.LLM_BASE_URL || undefined },
    temperature: 0.2,
  });
}
