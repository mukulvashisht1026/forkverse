import OpenAI from 'openai';
import type { z } from 'zod';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export const openai = new OpenAI({ baseURL: config.LLM_BASE_URL || undefined, apiKey: config.LLM_API_KEY || 'missing' });

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Strip ```json fences some models add despite json mode. */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse((fenced?.[1] ?? text).trim());
}

/**
 * Deterministic JSON completion validated by a zod schema.
 * Retries once with the validation error appended; throws if still invalid.
 */
export async function completeJson<T>(schema: z.ZodType<T>, messages: ChatMessage[]): Promise<T> {
  let convo = [...messages];
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await openai.chat.completions.create({
      model: config.LLM_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: convo,
    });
    const content = res.choices[0]?.message?.content ?? '';
    let problem: string;
    try {
      const parsed = schema.safeParse(extractJson(content));
      if (parsed.success) return parsed.data;
      problem = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    } catch (err) {
      problem = `not valid JSON: ${(err as Error).message}`;
    }
    logger.warn({ attempt, problem }, 'LLM returned invalid JSON');
    convo = [
      ...convo,
      { role: 'assistant', content },
      { role: 'user', content: `Your previous reply was invalid (${problem}). Reply with only the corrected JSON object.` },
    ];
  }
  throw new Error('LLM failed to return valid JSON after retry');
}

/** Free-text completion for the chat assistant. */
export async function complete(messages: ChatMessage[], temperature = 0.2): Promise<string> {
  const res = await openai.chat.completions.create({ model: config.LLM_MODEL, temperature, messages });
  return res.choices[0]?.message?.content ?? '';
}
