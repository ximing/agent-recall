import { estimateTokens, readUsageTokens } from '../llm/pricing.js';
import { ensure2xx, requestJson, RetrievalError } from './http.js';

export interface EmbeddingClientOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  dimensions: number;
  timeoutMs?: number;
}

export interface EmbeddingResult {
  vectors: number[][];
  promptTokens: number;
}

export interface EmbeddingClient {
  embedTexts(texts: string[]): Promise<EmbeddingResult>;
}

const MAX_BATCH_SIZE = 20;

function asNumberVector(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const vector: number[] = [];
  for (const item of value) {
    if (typeof item !== 'number' || !Number.isFinite(item)) return null;
    vector.push(item);
  }
  return vector;
}

export function parseEmbeddingResponse(json: unknown, expectedCount: number): number[][] {
  const root = json as { output?: { embeddings?: unknown } };
  const embeddings = root.output?.embeddings;
  if (!Array.isArray(embeddings)) {
    throw new RetrievalError('BAD_RESPONSE', 'embedding response missing output.embeddings');
  }
  const rows = embeddings.map((item, position) => {
    const record = item as { index?: unknown; embedding?: unknown };
    const vector = asNumberVector(record.embedding);
    if (vector === null) {
      throw new RetrievalError('BAD_RESPONSE', 'embedding item missing numeric embedding vector');
    }
    return { index: typeof record.index === 'number' ? record.index : position, vector };
  });
  if (rows.length !== expectedCount) {
    throw new RetrievalError(
      'BAD_RESPONSE',
      `embedding count mismatch: expected ${String(expectedCount)}, got ${String(rows.length)}`,
    );
  }
  rows.sort((a, b) => a.index - b.index);
  return rows.map((row) => row.vector);
}

export function createEmbeddingClient(options: EmbeddingClientOptions): EmbeddingClient {
  const url = `${options.baseUrl.replace(/\/$/, '')}/services/embeddings/multimodal-embedding/multimodal-embedding`;

  async function embedBatch(texts: string[]): Promise<EmbeddingResult> {
    const res = await requestJson('POST', url, {
      timeoutMs: options.timeoutMs ?? 30_000,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${options.apiKey}`,
      },
      body: {
        model: options.model,
        input: { contents: texts.map((text) => ({ text })) },
        parameters: { dimension: options.dimensions },
      },
    });
    ensure2xx(res, 'dashscope embedding');
    const vectors = parseEmbeddingResponse(res.json, texts.length);
    for (const vector of vectors) {
      if (vector.length !== options.dimensions) {
        throw new RetrievalError(
          'BAD_RESPONSE',
          `embedding dimension mismatch: expected ${String(options.dimensions)}, got ${String(vector.length)}`,
        );
      }
    }
    return {
      vectors,
      promptTokens: readUsageTokens(res.json, estimateTokens(texts.join('\n'))),
    };
  }

  return {
    async embedTexts(texts) {
      if (texts.length === 0) return { vectors: [], promptTokens: 0 };
      const vectors: number[][] = [];
      let promptTokens = 0;
      for (let start = 0; start < texts.length; start += MAX_BATCH_SIZE) {
        const batch = await embedBatch(texts.slice(start, start + MAX_BATCH_SIZE));
        vectors.push(...batch.vectors);
        promptTokens += batch.promptTokens;
      }
      return { vectors, promptTokens };
    },
  };
}
