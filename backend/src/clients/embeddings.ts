import { z } from 'zod';
import { config } from '../config.js';
import { HttpError, withRetry } from '../utils/retry.js';
import { openai } from './llm.js';

export interface EmbeddingProvider {
  readonly name: string;
  embed(texts: string[]): Promise<number[][]>;
}

function checkDims(vectors: number[][]): number[][] {
  for (const v of vectors) {
    if (v.length !== config.EMBEDDING_DIM) {
      throw new Error(`embedding dim ${v.length} != EMBEDDING_DIM ${config.EMBEDDING_DIM}; re-embed or fix config`);
    }
  }
  return vectors;
}

export class RouterEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'router';
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const res = await openai.embeddings.create({ model: config.EMBEDDING_MODEL, input: texts });
    const ordered = [...res.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
    return checkDims(ordered);
  }
}

const PythonResponse = z.object({
  vectors: z.array(z.array(z.number())),
  model: z.string(),
  dim: z.number().int(),
});

/** Contract: POST /embed {texts} -> {vectors, model, dim}. */
export class PythonServiceEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'python_service';
  constructor(private baseUrl = config.EMBEDDING_SERVICE_URL) {}
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    return withRetry(async () => {
      const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts }),
      });
      if (!res.ok) throw new HttpError(res.status, `embed service ${res.status}`);
      const body = PythonResponse.parse(await res.json());
      if (body.vectors.length !== texts.length) throw new Error('embed service returned wrong vector count');
      return checkDims(body.vectors);
    });
  }
}

let provider: EmbeddingProvider | undefined;
export function getEmbeddingProvider(): EmbeddingProvider {
  provider ??= config.EMBEDDING_PROVIDER === 'python_service' ? new PythonServiceEmbeddingProvider() : new RouterEmbeddingProvider();
  return provider;
}

export async function embedOne(text: string): Promise<number[]> {
  const [v] = await getEmbeddingProvider().embed([text]);
  if (!v) throw new Error('no embedding returned');
  return v;
}
