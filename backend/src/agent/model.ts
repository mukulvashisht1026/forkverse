
/**
 * Chat model used by the agent.
 *
 * Uses the configured OpenAI-compatible LLM provider.
 * Supports LangChain tool calling through .bindTools().
 */
import { ChatOpenAI } from '@langchain/openai';
import { config } from '../config.js';

export function createChatModel() {
  return new ChatOpenAI({
    model: config.LLM_MODEL,
    apiKey: config.LLM_API_KEY,
    configuration: {
      baseURL: config.LLM_BASE_URL,
    },
  
  });
}
