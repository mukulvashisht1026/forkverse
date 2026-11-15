import { z } from 'zod';
import 'dotenv/config';
const EnvSchema = z.object({
  MONGODB_URI: z.string().regex(/^mongodb(\+srv)?:\/\//, 'must be a mongodb:// or mongodb+srv:// URI'),
  MONGODB_DB: z.string().default('forkverse'), // existing Atlas database (kept after the TRACEWIRE rename)
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
  // Live monitors: how often to pull detected changes from Context.dev (0 = webhook only).
  MONITOR_POLL_MS: z.coerce.number().int().min(0).default(60_000),
  // Screen every source for propaganda (page text + domain lists) before it is used to build
  // the claim graph. false = domain lists only (no extra scrape/LLM cost).
  AUTO_VET_SOURCES: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),

  LLM_BASE_URL: z.string().default(''),
  LLM_API_KEY: z.string().default(''),
  LLM_MODEL: z.string().default(''),
  GEMINI_API_KEY: z.string().default(''),
  GEMINI_TRANSCRIPTION_MODEL: z.string().default('gemini-3.5-transcribe'),

  // Embeddings: OpenAI via LangChain OpenAIEmbeddings, same setup as Agentic-GitPayBit (key from
  // OPENAI_API_KEY). EMBEDDING_DIM must match the model (text-embedding-3-small / ada-002: 1536).
  OPENAI_API_KEY: z.string().default(''),
  EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  EMBEDDING_DIM: z.coerce.number().int().positive().default(1536),

  // Demo timeline (in-memory, no MongoDB needed) streamed to the frontend over /ws.
  TIMELINE_MOCK: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  TIMELINE_MOCK_INTERVAL_MS: z.coerce.number().int().min(250).default(4000),
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
