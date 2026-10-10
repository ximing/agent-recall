import { estimateTokens, readUsageTokens } from '../llm/pricing.js';
import { requestJson, RetrievalError, type RetrievalErrorCode } from './http.js';
import { assertRerankBaseUrl } from './url-guard.js';

export interface RerankClientOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs?: number;
  /** 与 APP_ENV / 配置一致。缺省时由地址守卫读取进程环境。 */
  appEnv?: string;
}

export interface RerankResult {
  index: number;
  score: number;
}

export interface RerankOutcome {
  results: RerankResult[];
  promptTokens: number;
}

export interface RerankClient {
  rerankTexts(query: string, documents: string[], topN: number): Promise<RerankOutcome>;
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

const SAFE_RERANK_FAILURE = /^rerank failed with status \d{3}$/;
/** qwen3.7-text-rerank 拒绝单篇超过 50000 字符的文档，超长时只把开头送去精排。 */
const RERANK_DOCUMENT_CHAR_LIMIT = 50_000;

function limitRerankDocument(text: string): string {
  return text.length > RERANK_DOCUMENT_CHAR_LIMIT ? text.slice(0, RERANK_DOCUMENT_CHAR_LIMIT) : text;
}

/** 日志和界面只保留固定短语，不带请求 URL 或响应体。 */
export function publicRerankFailure(err: unknown): string {
  const message = err instanceof Error ? err.message : '';
  if (message === 'rerank failed (network)' || SAFE_RERANK_FAILURE.test(message)) return message;
  if (err instanceof RetrievalError && typeof err.status === 'number') {
    return rerankStatusMessage(err.status);
  }
  return 'rerank failed (network)';
}

function rerankStatusMessage(status: number): string {
  if (status >= 100 && status <= 599) return `rerank failed with status ${String(status)}`;
  return 'rerank failed (network)';
}

function statusCode(status: number): RetrievalErrorCode {
  if (status >= 500) return 'HTTP_5XX';
  if (status >= 400) return 'HTTP_4XX';
  return 'BAD_RESPONSE';
}

/** 阿里云百炼 text-rerank：对候选文档按 query 相关性精排。 */
export function createRerankClient(options: RerankClientOptions): RerankClient {
  const url = `${options.baseUrl.replace(/\/$/, '')}/services/rerank/text-rerank/text-rerank`;

  return {
    async rerankTexts(query, documents, topN) {
      if (documents.length === 0) return { results: [], promptTokens: 0 };
      const limited = documents.map(limitRerankDocument);
      try {
        // 请求前再验一次：库里已经存下的内网地址也要失败关闭。
        await assertRerankBaseUrl(url, { appEnv: options.appEnv });
        const res = await requestJson('POST', url, {
          timeoutMs: options.timeoutMs ?? 20_000,
          redirect: 'manual',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${options.apiKey}`,
          },
          body: {
            model: options.model,
            input: { query, documents: limited },
            parameters: { top_n: topN, return_documents: false },
          },
        });
        // 3xx 也是失败。不读取 Location，也不把响应体写进错误。
        if (res.status < 200 || res.status >= 300) {
          throw new RetrievalError(statusCode(res.status), rerankStatusMessage(res.status), res.status);
        }
        return {
          results: parseRerankResponse(res.json),
          promptTokens: readUsageTokens(res.json, estimateTokens([query, ...limited].join('\n'))),
        };
      } catch (err) {
        const message = publicRerankFailure(err);
        if (err instanceof RetrievalError && err.message === message) throw err;
        const status = err instanceof RetrievalError ? err.status : undefined;
        const code = message === 'rerank failed (network)' ? 'NETWORK' : statusCode(status ?? 0);
        throw new RetrievalError(code, message, status);
      }
    },
  };
}
