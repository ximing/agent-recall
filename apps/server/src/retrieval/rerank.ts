import { ensure2xx, requestJson, RetrievalError } from './http.js';

export interface RerankClientOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs?: number;
}

export interface RerankResult {
  index: number;
  score: number;
}

export interface RerankClient {
  rerankTexts(query: string, documents: string[], topN: number): Promise<RerankResult[]>;
}

// 响应结构与 inwit 线上验证一致：output.results[] 携带 {index, relevance_score}
function parseRerankResponse(json: unknown): RerankResult[] {
  const root = json as { output?: { results?: unknown } };
  const results = root.output?.results;
  if (!Array.isArray(results)) {
    throw new RetrievalError('BAD_RESPONSE', 'rerank response missing output.results');
  }
  return (results as unknown[]).map((item) => {
    const record = item as { index?: unknown; relevance_score?: unknown };
    if (typeof record.index !== 'number' || typeof record.relevance_score !== 'number') {
      throw new RetrievalError('BAD_RESPONSE', 'rerank result missing index / relevance_score');
    }
    return { index: record.index, score: record.relevance_score };
  });
}

/** 阿里云百炼 text-rerank：对候选文档按 query 相关性精排。 */
export function createRerankClient(options: RerankClientOptions): RerankClient {
  const url = `${options.baseUrl.replace(/\/$/, '')}/services/rerank/text-rerank/text-rerank`;

  return {
    async rerankTexts(query, documents, topN) {
      if (documents.length === 0) return [];
      const res = await requestJson('POST', url, {
        timeoutMs: options.timeoutMs ?? 20_000,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${options.apiKey}`,
        },
        body: {
          model: options.model,
          input: { query, documents },
          parameters: { top_n: topN, return_documents: false },
        },
      });
      ensure2xx(res, 'dashscope rerank');
      return parseRerankResponse(res.json);
    },
  };
}
