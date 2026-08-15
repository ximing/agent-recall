import { homedir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';

const blank = z.preprocess((value) => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}, z.string().optional());

const envSchema = z.object({
  APP_ENV: z.enum(['development', 'test', 'production']).optional(),
  PORT: z.coerce.number().int().positive().default(8787),
  HOST: z.string().min(1).default('127.0.0.1'),
  NODE_ENV: z.string().default('development'),
  DATA_DIR: blank,
  DATABASE_URL: blank,
  PUBLIC_BASE_URL: z.string().min(1).default('http://127.0.0.1:8787'),
  WEB_ORIGIN: z.string().min(1).default('http://127.0.0.1:5178'),
  WEB_DIST: blank,
  MEILI_URL: z.string().default(''),
  MEILI_API_KEY: z.string().default(''),
  MEILI_INDEX: z.string().min(1).default('memories'),
  QDRANT_URL: z.string().default(''),
  QDRANT_API_KEY: z.string().default(''),
  QDRANT_COLLECTION: z.string().min(1).default('memories'),
  EMBEDDING_API_KEY: z.string().default(''),
  EMBEDDING_BASE_URL: z.string().min(1).default('https://dashscope.aliyuncs.com/api/v1'),
  EMBEDDING_MODEL: z.string().min(1).default('qwen3-vl-embedding'),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(2560),
  COOKIE_SECURE: z.enum(['true', 'false']).default('false'),
});

export type AppConfig = z.infer<typeof envSchema> & { dataDir: string };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);
  const dataDir = parsed.DATA_DIR ?? path.join(homedir(), '.agent-recall', 'pgdata');
  return { ...parsed, dataDir };
}
