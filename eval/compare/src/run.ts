/**
 * LongMemEval-S 检索对比。
 *
 * 计分见 eval/compare/PROTOCOL.md。grep 不联网。agent-recall 用 apps/server/.env.test
 * 的测试库和 -test 索引，每题写完即删。不要把数据文件提交进 git。
 *
 *   pnpm eval:compare -- --stratify 10
 *   pnpm eval:compare -- --all --systems grep
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { call, makeDataDir, openTestApp, removeDataDir, sessionCookie, testConfig, testDatabaseUrl } from '../../../apps/server/src/test/app-harness.js';
import { memories, recallLogs } from '../../../apps/server/src/db/schema.js';
import { envFilePath, serverRoot } from '../../../apps/server/src/env.js';
import { createRetrieval } from '../../../apps/server/src/retrieval/ports.js';
import type { AppConfig } from '../../../apps/server/src/config.js';
import type { FastifyInstance } from 'fastify';
import { rankGrep } from './grep.js';
import { loadLongMemEval, stratifySample, type LongMemQuestion } from './longmemeval.js';
import { writeRun, type CompareRow, type RunConditions } from './report.js';
import { ndcgAt, recallAny, recallAt, reciprocalRank, assertScoreFixtures } from './score.js';
import { countTokens } from './tokens.js';

const RETRIEVE_K = 20;
const CONTENT_CHAR_LIMIT = 100_000;
const QUERY_CHAR_LIMIT = 10_000;
/** 本机没有端点，不模拟分数。 */
const SKIPPED_SYSTEMS = ['mem0', 'graphiti', 'letta', 'cognee', 'supermemory'];
const compareRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(compareRoot, '../..');
const serverRequire = createRequire(path.join(serverRoot, 'package.json'));
const { parse } = serverRequire('dotenv') as typeof import('dotenv');
const { desc, eq } = serverRequire('drizzle-orm') as typeof import('drizzle-orm');

interface Cli {
  data: string;
  out: string;
  stratify: number | null;
  systems: string[];
}

function parseCli(): Cli {
  // pnpm 会把 `pnpm eval:compare -- --stratify 10` 原样转成带 `--` 的参数。
  // node:util 把 `--` 后面的旗标当成位置参数，这里剥掉这一层。
  const raw = process.argv.slice(2);
  const separator = raw.indexOf('--');
  const args = separator === -1 ? raw : [...raw.slice(0, separator), ...raw.slice(separator + 1)];
  const { values } = parseArgs({
    args,
    options: {
      data: { type: 'string', default: path.join(compareRoot, 'data', 'longmemeval_s_cleaned.json') },
      out: { type: 'string' },
      stratify: { type: 'string' },
      all: { type: 'boolean', default: false },
      systems: { type: 'string', default: 'grep,agent-recall' },
    },
  });
  const date = new Date().toISOString().slice(0, 10);
  let stratify: number | null = 10;
  if (values.all) stratify = null;
  else if (values.stratify !== undefined) {
    stratify = Number(values.stratify);
    if (!Number.isInteger(stratify) || stratify <= 0) throw new Error(`--stratify 必须是正整数，收到 ${values.stratify}`);
  }
  const fromRepo = (value: string) => (path.isAbsolute(value) ? value : path.resolve(repoRoot, value));
  return {
    data: fromRepo(values.data ?? path.join(compareRoot, 'data', 'longmemeval_s_cleaned.json')),
    out: fromRepo(values.out ?? path.join(compareRoot, 'results', date)),
    stratify,
    systems: (values.systems ?? '').split(',').map((item) => item.trim()).filter(Boolean),
  };
}

function gitMeta(): { sha: string; dirty: boolean } {
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' }).trim().length > 0;
    return { sha, dirty };
  } catch {
    return { sha: 'unknown', dirty: true };
  }
}

async function sha256(file: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve());
  });
  return hash.digest('hex');
}

function scoreRanked(
  question: LongMemQuestion,
  ranked: string[],
  indexMs: number | null,
  searchMs: number | null,
  system: string,
  extra: Pick<CompareRow, 'truncatedSessions' | 'dedupedSessions' | 'rerankApplied' | 'rerankError' | 'error'>,
): CompareRow {
  const byId = new Map(question.sessions.map((session) => [session.id, session.content]));
  const top10 = ranked.slice(0, 10).map((id) => byId.get(id) ?? '').join('\n');
  return {
    system,
    questionId: question.id,
    questionType: question.type,
    recallAnyAt5: extra.error ? null : recallAny(ranked, question.goldSessionIds, 5),
    recallAnyAt10: extra.error ? null : recallAny(ranked, question.goldSessionIds, 10),
    recallAnyAt20: extra.error ? null : recallAny(ranked, question.goldSessionIds, 20),
    recallAt5: extra.error ? null : recallAt(ranked, question.goldSessionIds, 5),
    ndcgAt10: extra.error ? null : ndcgAt(ranked, question.goldSessionIds, 10),
    mrr: extra.error ? null : reciprocalRank(ranked, question.goldSessionIds),
    indexMs,
    searchMs,
    top10Tokens: extra.error ? null : countTokens(top10),
    retrievedSessionIds: ranked.slice(0, RETRIEVE_K),
    goldSessionIds: question.goldSessionIds,
    truncatedSessions: extra.truncatedSessions,
    dedupedSessions: extra.dedupedSessions,
    rerankApplied: extra.rerankApplied,
    rerankError: extra.rerankError,
    error: extra.error,
  };
}

function runGrep(questions: LongMemQuestion[]): CompareRow[] {
  const rows: CompareRow[] = [];
  for (const question of questions) {
    const started = performance.now();
    const ranked = rankGrep(question, RETRIEVE_K);
    const searchMs = performance.now() - started;
    rows.push(scoreRanked(question, ranked, 0, searchMs, 'grep', { truncatedSessions: 0, dedupedSessions: 0, rerankApplied: null, rerankError: null, error: null }));
    const mark = rows[rows.length - 1]?.recallAnyAt5 === 1 ? '+' : '-';
    console.log(`  ${mark} ${question.id} [${question.type}] any@5=${rows[rows.length - 1]?.recallAnyAt5} ${searchMs.toFixed(0)}ms`);
  }
  return rows;
}

function loadRetrievalConfig(): { config: AppConfig; model: string; index: string; collection: string } {
  const databaseUrl = testDatabaseUrl();
  if (!/\/agent_recall_test(?:\?|$)/.test(databaseUrl)) {
    throw new Error('拒绝运行：DATABASE_URL 不是 agent_recall_test');
  }
  const parsed = parse(readFileSync(envFilePath(serverRoot, 'test')));
  const index = parsed.MEILI_INDEX?.trim() ?? '';
  const collection = parsed.QDRANT_COLLECTION?.trim() ?? '';
  if (!index.endsWith('-test')) throw new Error(`拒绝运行：Meilisearch 索引不是 -test（${index}）`);
  if (!collection.endsWith('-test')) throw new Error(`拒绝运行：Qdrant 集合不是 -test（${collection}）`);
  const config = testConfig({
    MEILI_URL: parsed.MEILI_URL,
    MEILI_API_KEY: parsed.MEILI_API_KEY,
    MEILI_INDEX: index,
    QDRANT_URL: parsed.QDRANT_URL,
    QDRANT_API_KEY: parsed.QDRANT_API_KEY,
    QDRANT_COLLECTION: collection,
    EMBEDDING_API_KEY: parsed.EMBEDDING_API_KEY,
    EMBEDDING_BASE_URL: parsed.EMBEDDING_BASE_URL,
    EMBEDDING_MODEL: parsed.EMBEDDING_MODEL,
    EMBEDDING_DIMENSIONS: Number(parsed.EMBEDDING_DIMENSIONS),
  });
  return { config, model: parsed.EMBEDDING_MODEL ?? '', index, collection };
}

async function forget(app: FastifyInstance, token: string, ids: string[], index: string, collection: string): Promise<void> {
  for (let offset = 0; offset < ids.length; offset += 500) {
    const slice = ids.slice(offset, offset + 500);
    const res = await call(app, 'POST', '/api/memories/batch-forget', { token, payload: { ids: slice } });
    if (res.status !== 200) throw new Error(`batch-forget ${res.status} ${JSON.stringify(res.body)}`);
    await app.ctx.retrieval.meili.deleteDocuments(index, slice);
    await app.ctx.retrieval.qdrant.deletePoints(collection, slice);
  }
}

function rerankFromEnv(): { baseUrl: string; model: string; apiKey: string } | null {
  const apiKey = process.env.DASHSCOPE_API_KEY?.trim() ?? '';
  const model = process.env.RERANK_MODEL?.trim() ?? '';
  const baseUrl = process.env.DASHSCOPE_BASE_URL?.trim() || 'https://dashscope.aliyuncs.com/api/v1';
  if (!apiKey && !model) return null;
  if (!apiKey || !model) throw new Error('重排需要同时设置 DASHSCOPE_API_KEY 和 RERANK_MODEL');
  return { baseUrl, model, apiKey };
}

async function runAgentRecall(questions: LongMemQuestion[]): Promise<{ rows: CompareRow[]; model: string; index: string; collection: string; rerankModel: string | null }> {
  const { config, model, index, collection } = loadRetrievalConfig();
  const dataDir = await makeDataDir();
  const app = await openTestApp({ dataDir, config, retrieval: createRetrieval(config) });
  const created: string[] = [];
  let token = '';
  try {
    const email = `compare-${Date.now()}@example.com`;
    const registered = await call(app, 'POST', '/api/auth/register', { payload: { email, password: 'compare-password' } });
    if (registered.status !== 201) throw new Error(`注册失败 ${registered.status}`);
    const cookie = sessionCookie(registered.headers);
    const tokenRes = await call(app, 'POST', '/api/tokens', { cookie, payload: { name: 'compare' } });
    token = String((tokenRes.body as { secret?: string } | null)?.secret ?? '');
    if (!token) throw new Error('创建令牌失败');
    const userId = String((registered.body as { user?: { id?: string } } | null)?.user?.id ?? '');
    if (!userId) throw new Error('注册没有返回用户 id');
    const rerank = rerankFromEnv();
    if (rerank) {
      const saved = await call(app, 'PUT', '/api/settings', {
        token,
        payload: {
          rerankEnabled: true,
          rerankBaseUrl: rerank.baseUrl,
          rerankModel: rerank.model,
          rerankApiKey: rerank.apiKey,
        },
      });
      const settings = (saved.body as { settings?: { rerankEnabled?: boolean; hasRerankApiKey?: boolean; rerankModel?: string }; error?: { message?: string } } | null);
      if (saved.status !== 200 || !settings?.settings?.rerankEnabled || !settings.settings.hasRerankApiKey) {
        throw new Error(`打开重排失败 ${saved.status} ${settings?.error?.message ?? ''}`);
      }
      console.log(`重排 ${settings.settings.rerankModel}`);
    }

    const rows: CompareRow[] = [];
    for (const question of questions) {
      const ids: string[] = [];
      const sessionByMemory = new Map<string, string>();
      console.log(`  ${question.id} [${question.type}] sessions=${question.sessions.length}`);
      let truncatedSessions = 0;
      let dedupedSessions = 0;
      let error: string | null = null;
      const indexStarted = performance.now();
      try {
        const project = `lme-${question.id}`.slice(0, 128);
        for (const session of question.sessions) {
          let content = session.content.trim();
          if (content.length > CONTENT_CHAR_LIMIT) {
            content = content.slice(0, CONTENT_CHAR_LIMIT);
            truncatedSessions += 1;
          }
          if (!content) continue;
          const payload: Record<string, unknown> = { content, type: 'fact', project };
          if (session.id.length <= 128) payload.sessionId = session.id;
          const res = await call(app, 'POST', '/api/memories', { token, payload });
          if (res.status !== 201 && res.status !== 200) {
            throw new Error(`写入 ${session.id} 失败 ${res.status} ${JSON.stringify(res.body)?.slice(0, 300)}`);
          }
          const memory = (res.body as { memory?: { id?: string }; deduped?: boolean } | null)?.memory;
          if (!memory?.id) throw new Error(`写入 ${session.id} 没有返回 id`);
          ids.push(memory.id);
          created.push(memory.id);
          sessionByMemory.set(memory.id, session.id);
          const body = res.body as { deduped?: boolean; memory?: { project?: string | null } } | null;
          if (body?.deduped) {
            if ((body.memory?.project ?? null) !== project) {
              throw new Error(`去重命中了其他题的记忆 ${session.id}`);
            }
            dedupedSessions += 1;
          }
          const indexed = await app.ctx.db
            .select({ indexedAt: memories.indexedAt })
            .from(memories)
            .where(eq(memories.id, memory.id))
            .limit(1);
          if (!indexed[0]?.indexedAt) throw new Error(`索引未完成 ${session.id}`);
          if (ids.length % 10 === 0 || ids.length === question.sessions.length) {
            console.log(`    ${question.id} 已索引 ${ids.length}/${question.sessions.length}`);
          }
        }
        const indexMs = performance.now() - indexStarted;
        const query = question.question.trim().slice(0, QUERY_CHAR_LIMIT);
        const searchStarted = performance.now();
        const recalled = await call(app, 'POST', '/api/memories/recall', {
          token,
          payload: { query, limit: RETRIEVE_K, filter: { project } },
        });
        const searchMs = performance.now() - searchStarted;
        if (recalled.status !== 200) throw new Error(`召回失败 ${recalled.status} ${JSON.stringify(recalled.body)?.slice(0, 300)}`);
        const [rerankLog] = await app.ctx.db
          .select({ applied: recallLogs.rerankApplied, failure: recallLogs.rerankError })
          .from(recallLogs)
          .where(eq(recallLogs.userId, userId))
          .orderBy(desc(recallLogs.createdAt))
          .limit(1);
        const rerankApplied = rerank ? rerankLog?.applied === true : null;
        const rerankError = rerank ? (rerankLog?.failure ?? null) : null;
        const hits = ((recalled.body as { memories?: Array<{ id?: string; sessionId?: string | null }> } | null)?.memories) ?? [];
        const ranked: string[] = [];
        const seen = new Set<string>();
        for (const memory of hits) {
          const sessionId = memory.sessionId || (memory.id ? sessionByMemory.get(memory.id) : undefined);
          if (!sessionId || seen.has(sessionId)) continue;
          seen.add(sessionId);
          ranked.push(sessionId);
        }
        rows.push(scoreRanked(question, ranked, indexMs, searchMs, 'agent-recall', { truncatedSessions, dedupedSessions, rerankApplied, rerankError, error: null }));
        const last = rows[rows.length - 1];
        console.log(`  ${last?.recallAnyAt5 === 1 ? '+' : '-'} ${question.id} [${question.type}] any@5=${last?.recallAnyAt5} search=${searchMs.toFixed(0)}ms index=${indexMs.toFixed(0)}ms rerank=${rerankApplied ? 'on' : 'off'}${rerankError ? ` ${rerankError}` : ''}`);
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        rows.push(scoreRanked(question, [], null, null, 'agent-recall', { truncatedSessions, dedupedSessions, rerankApplied: rerank ? false : null, rerankError: null, error }));
        console.log(`  ! ${question.id} ${error}`);
      } finally {
        await forget(app, token, ids, index, collection).catch((err: unknown) => {
          console.error(`清理 ${question.id} 失败`, err instanceof Error ? err.message : err);
        });
      }
    }
    return { rows, model, index, collection, rerankModel: rerank?.model ?? null };
  } finally {
    if (token && created.length > 0) {
      await forget(app, token, created, index, collection).catch(() => undefined);
    }
    await app.close();
    await removeDataDir(dataDir);
  }
}

async function main(): Promise<void> {
  assertScoreFixtures();
  const cli = parseCli();
  const info = await stat(cli.data).catch(() => null);
  if (!info) throw new Error(`找不到数据文件 ${cli.data}。下载命令见 eval/compare/PROTOCOL.md`);
  console.log(`加载 ${cli.data}`);
  const all = loadLongMemEval(cli.data);
  const abstention = all.filter((question) => question.abstention);
  let headline = all.filter((question) => !question.abstention);
  if (cli.stratify !== null) headline = stratifySample(headline, cli.stratify);
  console.log(`标题题 ${headline.length}，排除拒答 ${abstention.length}，系统 ${cli.systems.join(',')}`);

  const rows: CompareRow[] = [];
  let embeddingModel: string | null = null;
  let rerankModel: string | null = null;
  let meiliIndex: string | null = null;
  let qdrantCollection: string | null = null;
  const fileStat = await stat(cli.data);
  const git = gitMeta();
  const datasetSha = await sha256(cli.data);
  const publish = async () => {
    const conditions: RunConditions = {
      createdAt: new Date().toISOString(),
      gitSha: git.sha,
      gitDirty: git.dirty,
      datasetFile: path.basename(cli.data),
      datasetBytes: fileStat.size,
      datasetSha256: datasetSha,
      headlineQuestions: headline.length,
      excludedAbstention: abstention.length,
      stratify: cli.stratify,
      systems: cli.systems,
      embeddingModel,
      meiliIndex,
      qdrantCollection,
      contentCharLimit: CONTENT_CHAR_LIMIT,
      retrieveK: RETRIEVE_K,
      tokenizer: 'cl100k_base',
      skippedSystems: SKIPPED_SYSTEMS,
      rerankModel,
    };
    await writeRun(cli.out, conditions, rows);
  };
  for (const system of cli.systems) {
    console.log(`\n== ${system} ==`);
    if (system === 'grep') {
      rows.push(...runGrep(headline));
      await publish();
      continue;
    }
    if (system === 'agent-recall') {
      const result = await runAgentRecall(headline);
      rows.push(...result.rows);
      embeddingModel = result.model;
      rerankModel = result.rerankModel;
      meiliIndex = result.index;
      qdrantCollection = result.collection;
      await publish();
      continue;
    }
    throw new Error(`未知系统 ${system}。当前可跑 grep, agent-recall`);
  }
  console.log(`\n写入 ${cli.out}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
