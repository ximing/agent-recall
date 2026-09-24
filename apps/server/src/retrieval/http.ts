export type RetrievalErrorCode = 'TIMEOUT' | 'NETWORK' | 'HTTP_4XX' | 'HTTP_5XX' | 'BAD_RESPONSE';

export class RetrievalError extends Error {
  readonly code: RetrievalErrorCode;
  readonly status: number | undefined;

  constructor(code: RetrievalErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'RetrievalError';
    this.code = code;
    this.status = status;
  }
}

export interface JsonResponse {
  status: number;
  json: unknown;
  text: string;
}

export interface RequestJsonOptions {
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  /** 默认 follow。精排必须传 manual，避免带着密钥跟随 Location。 */
  redirect?: 'follow' | 'error' | 'manual';
}

function isAbortLike(err: unknown): boolean {
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
}

async function attemptOnce(method: string, url: string, opts: RequestJsonOptions): Promise<JsonResponse> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      redirect: opts.redirect ?? 'follow',
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
      ...(opts.headers ? { headers: opts.headers } : {}),
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
  } catch (err) {
    if (isAbortLike(err)) throw new RetrievalError('TIMEOUT', `request ${method} ${url} timed out`);
    throw new RetrievalError('NETWORK', `request ${method} ${url} failed: ${String(err)}`);
  }
  const text = await res.text();
  let json: unknown = null;
  if (text !== '') {
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = null;
    }
  }
  return { status: res.status, json, text };
}

export async function requestJson(method: string, url: string, opts: RequestJsonOptions = {}): Promise<JsonResponse> {
  let last: JsonResponse | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const res = await attemptOnce(method, url, opts);
    last = res;
    if (res.status < 500 || attempt === 1) return res;
  }
  return last as JsonResponse;
}

export function ensure2xx(res: JsonResponse, what: string): void {
  if (res.status >= 200 && res.status < 300) return;
  const code: RetrievalErrorCode = res.status >= 500 ? 'HTTP_5XX' : 'HTTP_4XX';
  throw new RetrievalError(code, `${what} failed with status ${String(res.status)}: ${res.text.slice(0, 200)}`, res.status);
}
