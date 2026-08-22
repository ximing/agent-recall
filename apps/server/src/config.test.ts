import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const databaseUrl = 'postgresql://localhost/agent_recall';
const encryptionKey = 'test-encryption-key';

describe('loadConfig', () => {
  it('defaults DashScope embeddings to qwen3-vl-embedding at 2560 dimensions', () => {
    const config = loadConfig({ DATABASE_URL: databaseUrl, ENCRYPTION_KEY: encryptionKey });
    expect(config.EMBEDDING_MODEL).toBe('qwen3-vl-embedding');
    expect(config.EMBEDDING_DIMENSIONS).toBe(2560);
    expect(config.EMBEDDING_BASE_URL).toBe('https://dashscope.aliyuncs.com/api/v1');
    expect(config.PORT).toBe(8787);
    expect(config.DATABASE_URL).toBe(databaseUrl);
    expect(config.ENCRYPTION_KEY).toBe(encryptionKey);
    expect(config.DATABASE_SCHEMA).toBeUndefined();
  });

  it('requires DATABASE_URL and ENCRYPTION_KEY', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ DATABASE_URL: '   ' })).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ DATABASE_URL: databaseUrl })).toThrow(/ENCRYPTION_KEY/);
    expect(() => loadConfig({ DATABASE_URL: databaseUrl, ENCRYPTION_KEY: '   ' })).toThrow(/ENCRYPTION_KEY/);
  });

  it('keeps a safe schema name and rejects anything else', () => {
    expect(loadConfig({ DATABASE_URL: databaseUrl, ENCRYPTION_KEY: encryptionKey, DATABASE_SCHEMA: 'ar_example' }).DATABASE_SCHEMA).toBe('ar_example');
    expect(loadConfig({ DATABASE_URL: databaseUrl, ENCRYPTION_KEY: encryptionKey, DATABASE_SCHEMA: '  ' }).DATABASE_SCHEMA).toBeUndefined();
    expect(() => loadConfig({ DATABASE_URL: databaseUrl, ENCRYPTION_KEY: encryptionKey, DATABASE_SCHEMA: 'Public;drop' })).toThrow();
  });
});
