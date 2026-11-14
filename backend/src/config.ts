import { z } from 'zod';
import 'dotenv/config';
const EnvSchema = z.object({
  MONGODB_URI: z.string().regex(/^mongodb(\+srv)?:\/\//, 'must be a mongodb:// or mongodb+srv:// URI'),
  MONGODB_DB: z.string().default('forkverse'),
  PORT: z.coerce.number().int().default(3000),
  // Comma-separated browser origins allowed to call the REST API cross-origin, e.g. the
  // Azure Static Web Apps URL. Empty = no CORS headers (same-origin / dev proxy only).
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((v) => v.split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean)),
  LOG_LEVEL: z.string().default('info'),
  PUBLIC_BASE_URL: z.string().default('http://localhost:3000'),
  DEBUG_RAW_DIR: z.string().default('./debug'),

  CONTEXT_DEV_API_KEY: z.string().default(''),
  CONTEXT_DEV_BASE_URL: z.string().url().default('https://api.context.dev/v1'),
  CONTEXT_DEV_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(10),

  LLM_BASE_URL: z.string().default(''),
  LLM_API_KEY: z.string().default(''),
  LLM_MODEL: z.string().default(''),

  EMBEDDING_PROVIDER: z.enum(['router', 'python_service']).default('router'),
  EMBEDDING_MODEL: z.string().default(''),
  EMBEDDING_DIM: z.coerce.number().int().positive().default(1536),
  EMBEDDING_SERVICE_URL: z.string().default('http://embedder:8000'),

  // Demo timeline (in-memory, no MongoDB needed) streamed to the frontend over /ws.
  TIMELINE_MOCK: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  TIMELINE_MOCK_INTERVAL_MS: z.coerce.number().int().min(250).default(4000),
  // OpenAIEmbeddings (LangChain) used by the MongoDB vector store. Point the base URL at any
  // OpenAI-compatible /embeddings endpoint, e.g. https://ai.mongodb.com/v1 for MongoDB's models.
  EMBEDDING_BASE_URL: z.string().default(''),
  EMBEDDING_API_KEY: z.string().default(''),
});

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  return parsed.data;
}

export const config = loadConfig();
