import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export interface StandInScript {
  meiliStatus?: number;
  qdrantStatus?: number;
  meiliIds?: string[];
  qdrantIds?: string[];
  rerankStatus?: number;
  /** 指定精排返回的候选顺序（下标按请求 documents 顺序） */
  rerankOrder?: number[];
}

export interface RecordedEmbedding {
  url: string;
  authorization: string | null;
  body: unknown;
}

export interface StandInControl {
  failWrites: boolean;
  reverseIndexes: boolean;
  script: StandInScript | null;
  embeddingRequests: RecordedEmbedding[];
  meiliSearches: unknown[];
  qdrantQueries: unknown[];
  rerankRequests: RecordedEmbedding[];
  settings: unknown[];
}

interface Doc {
  id: string;
  user_id: string;
  text: string;
  origin?: string;
  project: string | null;
}

interface Point {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}

export interface ProtocolStandIn {
  url: string;
  control: StandInControl;
  close: () => Promise<void>;
}

export function embedDeterministic(text: string, dimensions: number): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    vector[index % dimensions] += (code % 97) + 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / norm);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(text);
}

/** 读出 `field = "value"`，value 里的 `\\` 和 `\"` 按 Meilisearch 规则还原。 */
function meiliEquals(filter: unknown, field: string): string | null {
  if (typeof filter !== 'string') return null;
  const match = new RegExp(`(?:^|\\s)${field}\\s*=\\s*"((?:\\\\.|[^"\\\\])*)"`).exec(filter);
  if (!match?.[1]) return null;
  return match[1].replace(/\\(.)/g, '$1');
}

function qdrantEquals(filter: unknown, key: string): string | null {
  const must = (filter as { must?: unknown } | null)?.must;
  if (!Array.isArray(must)) return null;
  for (const clause of must) {
    const record = clause as { key?: unknown; match?: { value?: unknown } };
    if (record.key === key && typeof record.match?.value === 'string') return record.match.value;
  }
  return null;
}

function cosine(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

export async function startProtocolStandin(): Promise<ProtocolStandIn> {
  const control: StandInControl = {
    failWrites: false,
    reverseIndexes: false,
    script: null,
    embeddingRequests: [],
    meiliSearches: [],
    qdrantQueries: [],
    rerankRequests: [],
    settings: [],
  };
  const indexes = new Map<string, Map<string, Doc>>();
  const collections = new Map<string, Map<string, Point>>();
  const tasks = new Map<number, { status: string }>();
  let taskSeq = 0;

  function enqueue(): number {
    taskSeq += 1;
    tasks.set(taskSeq, { status: 'succeeded' });
    return taskSeq;
  }

  const server: Server = createServer((req, res) => {
    void handle(req, res);
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const pathname = url.pathname;
    const method = req.method ?? 'GET';
    const raw = await readBody(req);
    const body: unknown = raw ? (JSON.parse(raw) as unknown) : undefined;

    if (method === 'POST' && pathname === '/services/embeddings/multimodal-embedding/multimodal-embedding') {
      control.embeddingRequests.push({
        url: pathname,
        authorization: typeof req.headers.authorization === 'string' ? req.headers.authorization : null,
        body,
      });
      const input = body as {
        input?: { contents?: { text?: string }[] };
        parameters?: { dimension?: number };
      };
      const contents = input.input?.contents ?? [];
      const dimensions = input.parameters?.dimension ?? 8;
      let rows = contents.map((item, index) => ({
        embedding: embedDeterministic(item.text ?? '', dimensions),
        index,
        type: 'text',
      }));
      if (control.reverseIndexes) rows = [...rows].reverse();
      send(res, 200, { output: { embeddings: rows }, usage: { input_tokens: contents.length } });
      return;
    }

    if (method === 'POST' && pathname === '/services/rerank/text-rerank/text-rerank') {
      control.rerankRequests.push({
        url: pathname,
        authorization: typeof req.headers.authorization === 'string' ? req.headers.authorization : null,
        body,
      });
      if (control.script?.rerankStatus && control.script.rerankStatus >= 400) {
        send(res, control.script.rerankStatus, { message: 'rerank failed' });
        return;
      }
      const input = body as { input?: { query?: string; documents?: string[] }; parameters?: { top_n?: number } };
      const query = input.input?.query ?? '';
      const documents = input.input?.documents ?? [];
      const topN = input.parameters?.top_n ?? documents.length;
      const indexes = control.script?.rerankOrder ?? documents.map((_, index) => index);
      // 默认按 query 字符覆盖率打分；rerankOrder 指定时按给定顺序排
      const scored = documents.map((text, index) => {
        const order = indexes.indexOf(index);
        const overlap = [...query].filter((char) => text.includes(char)).length;
        const score = order >= 0 ? 1 - order * 0.01 : query.length > 0 ? overlap / query.length : 0;
        return { index, relevance_score: score };
      });
      scored.sort((left, right) => right.relevance_score - left.relevance_score);
      send(res, 200, { output: { results: scored.slice(0, topN) }, usage: { total_tokens: query.length } });
      return;
    }

    const taskMatch = /^\/tasks\/(\d+)$/.exec(pathname);
    if (method === 'GET' && taskMatch) {
      const task = tasks.get(Number(taskMatch[1]));
      if (!task) {
        send(res, 404, { message: 'missing task' });
        return;
      }
      send(res, 200, task);
      return;
    }

    if (method === 'POST' && pathname === '/indexes') {
      const uid = String((body as { uid?: string }).uid ?? '');
      if (!indexes.has(uid)) indexes.set(uid, new Map());
      send(res, 202, { taskUid: enqueue(), status: 'enqueued' });
      return;
    }

    const indexMatch = /^\/indexes\/([^/]+)(\/.*)?$/.exec(pathname);
    if (indexMatch) {
      const uid = decodeURIComponent(indexMatch[1] ?? '');
      const rest = indexMatch[2] ?? '';
      if (method === 'GET' && rest === '') {
        if (!indexes.has(uid)) {
          send(res, 404, { message: 'index not found' });
          return;
        }
        send(res, 200, { uid, primaryKey: 'id' });
        return;
      }
      if (method === 'PATCH' && rest === '/settings') {
        if (!indexes.has(uid)) indexes.set(uid, new Map());
        control.settings.push(body);
        send(res, 202, { taskUid: enqueue() });
        return;
      }
      if (method === 'POST' && rest === '/documents') {
        if (control.failWrites) {
          send(res, 500, { message: 'meili write failed' });
          return;
        }
        const docs = indexes.get(uid) ?? new Map<string, Doc>();
        indexes.set(uid, docs);
        const rows = Array.isArray(body) ? body : [];
        for (const row of rows) {
          const doc = row as Doc;
          docs.set(String(doc.id), {
            id: String(doc.id),
            user_id: String(doc.user_id),
            text: String(doc.text),
            origin: typeof doc.origin === 'string' ? doc.origin : undefined,
            project: typeof doc.project === 'string' ? doc.project : null,
          });
        }
        send(res, 202, { taskUid: enqueue() });
        return;
      }
      if (method === 'POST' && rest === '/documents/delete') {
        const docs = indexes.get(uid);
        const filter = (body as { filter?: string }).filter ?? '';
        for (const match of filter.matchAll(/"([^"]+)"/g)) {
          docs?.delete(match[1] ?? '');
        }
        send(res, 202, { taskUid: enqueue() });
        return;
      }
      if (method === 'POST' && rest === '/search') {
        control.meiliSearches.push(body);
        if (control.script?.meiliStatus && control.script.meiliStatus >= 400) {
          send(res, control.script.meiliStatus, { message: 'meili search failed' });
          return;
        }
        if (control.script?.meiliIds) {
          send(res, 200, { hits: control.script.meiliIds.map((id) => ({ id })) });
          return;
        }
        const query = body as { q?: string; filter?: string; limit?: number };
        const userId = meiliEquals(query.filter, 'user_id');
        const project = meiliEquals(query.filter, 'project');
        const needle = (query.q ?? '').toLowerCase();
        const hits = [...(indexes.get(uid)?.values() ?? [])].filter((doc) => {
          if (userId && doc.user_id !== userId) return false;
          if (project !== null && doc.project !== project) return false;
          return doc.text.toLowerCase().includes(needle);
        });
        send(res, 200, { hits: hits.slice(0, query.limit ?? 20) });
        return;
      }
    }

    if (method === 'GET' && /^\/collections\/[^/]+$/.test(pathname)) {
      const name = decodeURIComponent(pathname.split('/')[2] ?? '');
      if (!collections.has(name)) {
        send(res, 404, { status: { error: 'Not found' } });
        return;
      }
      send(res, 200, { result: { status: 'green' } });
      return;
    }

    const collectionMatch = /^\/collections\/([^/]+)(\/.*)?$/.exec(pathname);
    if (collectionMatch) {
      const name = decodeURIComponent(collectionMatch[1] ?? '');
      const rest = collectionMatch[2] ?? '';
      if (method === 'PUT' && rest === '') {
        if (!collections.has(name)) collections.set(name, new Map());
        send(res, 200, { result: true });
        return;
      }
      if (method === 'PUT' && rest === '/index') {
        send(res, 200, { result: { status: 'acknowledged' } });
        return;
      }
      if (method === 'PUT' && rest === '/points') {
        if (control.failWrites) {
          send(res, 500, { status: { error: 'qdrant write failed' } });
          return;
        }
        const points = collections.get(name) ?? new Map<string, Point>();
        collections.set(name, points);
        const rows = (body as { points?: Point[] }).points ?? [];
        for (const point of rows) {
          points.set(String(point.id), {
            id: String(point.id),
            vector: point.vector,
            payload: point.payload ?? {},
          });
        }
        send(res, 200, { result: { status: 'completed' } });
        return;
      }
      if (method === 'POST' && rest === '/points/query') {
        control.qdrantQueries.push(body);
        if (control.script?.qdrantStatus && control.script.qdrantStatus >= 400) {
          send(res, control.script.qdrantStatus, { status: { error: 'qdrant query failed' } });
          return;
        }
        if (control.script?.qdrantIds) {
          send(res, 200, {
            result: {
              points: control.script.qdrantIds.map((id, index) => ({
                id,
                score: 1 - index * 0.01,
                payload: {},
              })),
            },
          });
          return;
        }
        const query = body as { query?: number[]; filter?: unknown; limit?: number };
        const userId = qdrantEquals(query.filter, 'user_id');
        const project = qdrantEquals(query.filter, 'project');
        const vector = query.query ?? [];
        const ranked = [...(collections.get(name)?.values() ?? [])]
          .filter((point) => !userId || point.payload.user_id === userId)
          .filter((point) => project === null || point.payload.project === project)
          .map((point) => ({ point, score: cosine(vector, point.vector) }))
          .sort((left, right) => right.score - left.score)
          .slice(0, query.limit ?? 20);
        send(res, 200, {
          result: {
            points: ranked.map(({ point, score }) => ({ id: point.id, score, payload: point.payload })),
          },
        });
        return;
      }
      if (method === 'POST' && rest === '/points/delete') {
        const points = collections.get(name);
        const ids = (body as { points?: string[] }).points ?? [];
        for (const id of ids) points?.delete(String(id));
        send(res, 200, { result: { status: 'completed' } });
        return;
      }
    }

    send(res, 404, { message: 'not found', method, pathname });
  }

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('stand-in failed to bind');

  return {
    url: `http://127.0.0.1:${String(address.port)}`,
    control,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
