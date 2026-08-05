import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('defaults DashScope embeddings to qwen3-vl-embedding at 2560 dimensions', () => {
    const config = loadConfig({});
    expect(config.EMBEDDING_MODEL).toBe('qwen3-vl-embedding');
    expect(config.EMBEDDING_DIMENSIONS).toBe(2560);
    expect(config.EMBEDDING_BASE_URL).toBe('https://dashscope.aliyuncs.com/api/v1');
    expect(config.PORT).toBe(8787);
    expect(config.DATABASE_URL).toBeUndefined();
  });
});
