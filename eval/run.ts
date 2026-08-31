/**
 * 召回质量评测 runner（P3）。
 *
 * 流程：protocol-standin 起内存版 Meili/Qdrant/DashScope → openTestApp 连远端 Postgres 的隔离 schema
 * → 注册用户 + 建 Bearer token → 灌入语料 → 对每个标注查询分别跑
 *   A: POST /api/memories/recall        （rrf，settings 默认关精排）
 *   B: POST /api/memories/smart-search  （rrf+rerank，settings 开启精排）
 * 指标：Recall@5、Recall@10、MRR、平均延迟。表格输出到 stdout，
 * 分数卡写入 eval/results/<date>.md。
 *
 * 运行：仓库根目录 `pnpm eval`。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import {
  call,
  makeDataDir,
  openTestApp,
  removeDataDir,
  sessionCookie,
  testConfig,
} from '../apps/server/src/test/app-harness.js';
import { createRetrieval } from '../apps/server/src/retrieval/ports.js';
import { startProtocolStandin } from '../apps/server/src/retrieval/protocol-standin.js';
import { CORPUS, QUERIES } from './corpus.js';

const LIMIT = 10;
const evalDir = path.dirname(fileURLToPath(import.meta.url));

interface QueryResult {
  key: string;
  query: string;
  relevantCount: number;
  hitAt5: number;
  hitAt10: number;
  rr: number;
  latencyMs: number;
  ids: string[];
}

interface StrategyReport {
  name: string;
  results: QueryResult[];
  recallAt5: number;
  recallAt10: number;
  mrr: number;
  avgLatencyMs: number;
}

function metricRow(rankedIds: string[], relevant: Set<string>, latencyMs: number, key: string, query: string): QueryResult {
  const hit = (k: number) => rankedIds.slice(0, k).filter((id) => relevant.has(id)).length;
  const firstRank = rankedIds.findIndex((id) => relevant.has(id));
  return {
    key,
    query,
    relevantCount: relevant.size,
    hitAt5: hit(5),
    hitAt10: hit(10),
    rr: firstRank >= 0 ? 1 / (firstRank + 1) : 0,
    latencyMs,
    ids: rankedIds,
  };
}

function aggregate(name: string, results: QueryResult[]): StrategyReport {
  const n = results.length || 1;
  const sum = (pick: (r: QueryResult) => number) => results.reduce((acc, r) => acc + pick(r), 0);
  return {
    name,
    results,
    recallAt5: sum((r) => r.hitAt5 / r.relevantCount) / n,
    recallAt10: sum((r) => r.hitAt10 / r.relevantCount) / n,
    mrr: sum((r) => r.rr) / n,
    avgLatencyMs: sum((r) => r.latencyMs) / n,
  };
}

function pct(value: number): string {
  return (value * 100).toFixed(1) + '%';
}

function renderStdout(reports: StrategyReport[]): void {
  console.log('\n=== 召回质量评测 ===');
  console.log(`语料 ${CORPUS.length} 条记忆，${QUERIES.length} 个标注查询，limit=${LIMIT}\n`);
  const header = ['strategy', 'Recall@5', 'Recall@10', 'MRR', 'avg latency'];
  const rows = reports.map((r) => [r.name, pct(r.recallAt5), pct(r.recallAt10), pct(r.mrr), r.avgLatencyMs.toFixed(1) + 'ms']);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i]?.length ?? 0)));
  const line = (cols: string[]) => cols.map((c, i) => (c ?? '').padEnd(widths[i] ?? 0)).join('  ');
  console.log(line(header));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) console.log(line(row));
  console.log('\n逐查询明细：');
  for (const report of reports) {
    console.log(`\n[${report.name}]`);
    for (const r of report.results) {
      console.log(
        `  ${r.key} ${JSON.stringify(r.query)}  R@5=${r.hitAt5}/${r.relevantCount}  R@10=${r.hitAt10}/${r.relevantCount}  RR=${r.rr.toFixed(2)}  ${r.latencyMs.toFixed(0)}ms`,
      );
    }
  }
}

function renderMarkdown(date: string, reports: StrategyReport[]): string {
  const lines: string[] = [
    `# 召回质量评测分数卡（${date}）`,
    '',
    '## 方法',
    '',
    '- 环境：远端 Postgres 的隔离 schema + protocol-standin（内存版 Meilisearch/Qdrant/DashScope 嵌入与精排）。',
    `- 语料：${CORPUS.length} 条编程 agent 记忆（type 覆盖 architecture/preference/bug/workflow/pattern/fact/lesson，中英文混合），${QUERIES.length} 个标注查询。`,
    '- 策略对比：',
    '  - `rrf`：POST /api/memories/recall，词法+向量两路召回，RRF k=60 融合，精排关闭。',
    '  - `rrf+rerank`：POST /api/memories/smart-search（deep 候选池），settings 开启精排，精排替身按 query 字符覆盖率打分。',
    `- 每条查询取 top ${LIMIT}。指标：Recall@5、Recall@10、MRR、平均延迟（客户端计时）。`,
    '',
    '> 注意：standin 的词法搜索是整串子串匹配、向量是字符分布伪向量，无语义能力。',
    '> 本评测用于回归守住检索管道正确性（召回→融合→精排→过滤），分数不代表真实语义检索质量。',
    '',
    '## 指标',
    '',
    '| strategy | Recall@5 | Recall@10 | MRR | avg latency |',
    '| --- | --- | --- | --- | --- |',
    ...reports.map(
      (r) => `| ${r.name} | ${pct(r.recallAt5)} | ${pct(r.recallAt10)} | ${pct(r.mrr)} | ${r.avgLatencyMs.toFixed(1)}ms |`,
    ),
    '',
    '## 逐查询明细',
    '',
    '| query | relevant | rrf hits@10 | rrf RR | rrf+rerank hits@10 | rrf+rerank RR |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  const [rrf, rerank] = reports;
  for (let i = 0; i < QUERIES.length; i += 1) {
    const a = rrf?.results[i];
    const b = rerank?.results[i];
    if (!a) continue;
    lines.push(
      `| ${JSON.stringify(a.query)} | ${a.relevantCount} | ${a.hitAt10} | ${a.rr.toFixed(2)} | ${b?.hitAt10 ?? 0} | ${b ? b.rr.toFixed(2) : '-'} |`,
    );
  }
  lines.push(
    '',
    '## 结论',
    '',
    '- 两路召回 + RRF 融合管道对所有标注查询均有命中能力；精排在候选充足时应维持或提升头部指标（MRR、Recall@5）。',
    '- 若某次运行中 `rrf` 的 Recall@10 跌破 100%，说明词法/向量/融合链路出现回归，需排查。',
    '- 精排分数低于 `rrf` 时检查 settings 的 rerank 配置是否生效（strategy 应为 `rrf+rerank`）。',
    '',
  );
  return lines.join('\n');
}

async function main(): Promise<void> {
  const standin = await startProtocolStandin();
  const dataDir = await makeDataDir();
  const config = testConfig({
    MEILI_URL: standin.url,
    MEILI_API_KEY: 'eval-meili',
    QDRANT_URL: standin.url,
    QDRANT_API_KEY: 'eval-qdrant',
    EMBEDDING_API_KEY: 'eval-dash',
    EMBEDDING_BASE_URL: standin.url,
    EMBEDDING_MODEL: 'qwen3-vl-embedding',
    EMBEDDING_DIMENSIONS: 8,
  });
  const app = await openTestApp({ dataDir, config, retrieval: createRetrieval(config) });

  try {
    // 注册用户 + 建 Bearer token（评测全程走 token 认证，贴近 MCP/agent 调用方式）
    const registered = await call(app, 'POST', '/api/auth/register', {
      payload: { email: 'eval@example.com', password: 'eval-password' },
    });
    if (registered.status !== 201) throw new Error(`register failed: ${JSON.stringify(registered.body)}`);
    const cookie = sessionCookie(registered.headers);
    const tokenRes = await call(app, 'POST', '/api/tokens', { cookie, payload: { name: 'eval' } });
    const token = (tokenRes.body as { secret?: string } | null)?.secret;
    if (!token) throw new Error(`token create failed: ${JSON.stringify(tokenRes.body)}`);

    // 灌入语料
    const idByKey = new Map<string, string>();
    for (const item of CORPUS) {
      const res = await call(app, 'POST', '/api/memories', {
        token,
        payload: { content: item.content, type: item.type, tags: item.tags, project: item.project },
      });
      if (res.status !== 201) throw new Error(`seed ${item.key} failed: ${JSON.stringify(res.body)}`);
      const memory = (res.body as { memory?: { id: string } } | null)?.memory;
      if (!memory) throw new Error(`seed ${item.key}: no memory in response`);
      idByKey.set(item.key, memory.id);
    }
    console.log(`已灌入 ${idByKey.size} 条记忆`);

    const runQuery = async (endpoint: string): Promise<QueryResult[]> => {
      const out: QueryResult[] = [];
      for (const q of QUERIES) {
        const relevant = new Set(q.relevant.map((key) => idByKey.get(key) ?? key));
        const started = performance.now();
        const res = await call(app, 'POST', endpoint, { token, payload: { query: q.query, limit: LIMIT } });
        const latencyMs = performance.now() - started;
        if (res.status !== 200) throw new Error(`${endpoint} ${q.key} failed: ${JSON.stringify(res.body)}`);
        const body = res.body as { memories?: { id: string }[]; strategy?: string } | null;
        const ids = (body?.memories ?? []).map((m) => m.id);
        out.push(metricRow(ids, relevant, latencyMs, q.key, q.query));
      }
      return out;
    };

    // 策略 A：rrf（settings 默认精排关闭）
    const rrf = aggregate('rrf', await runQuery('/api/memories/recall'));

    // 策略 B：rrf+rerank（开启精排，走 smart-search 深候选池）
    const saved = await call(app, 'PUT', '/api/settings', {
      token,
      payload: {
        rerankEnabled: true,
        rerankBaseUrl: standin.url,
        rerankModel: 'gte-rerank-v2',
        rerankApiKey: 'eval-rerank-key',
      },
    });
    if (saved.status !== 200) throw new Error(`enable rerank failed: ${JSON.stringify(saved.body)}`);
    const rerank = aggregate('rrf+rerank', await runQuery('/api/memories/smart-search'));

    const reports = [rrf, rerank];
    renderStdout(reports);

    const date = new Date().toISOString().slice(0, 10);
    const resultsDir = path.join(evalDir, 'results');
    await mkdir(resultsDir, { recursive: true });
    const file = path.join(resultsDir, `${date}.md`);
    await writeFile(file, renderMarkdown(date, reports), 'utf8');
    console.log(`\n分数卡已写入 ${file}`);
  } finally {
    await app.close();
    await standin.close();
    await removeDataDir(dataDir);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
