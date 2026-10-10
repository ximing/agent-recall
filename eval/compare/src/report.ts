import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { mean, percentile } from './score.js';

export interface CompareRow {
  system: string;
  questionId: string;
  questionType: string;
  recallAnyAt5: number | null;
  recallAnyAt10: number | null;
  recallAnyAt20: number | null;
  recallAt5: number | null;
  ndcgAt10: number | null;
  mrr: number | null;
  indexMs: number | null;
  searchMs: number | null;
  top10Tokens: number | null;
  retrievedSessionIds: string[];
  goldSessionIds: string[];
  truncatedSessions: number;
  dedupedSessions: number;
  rerankApplied: boolean | null;
  rerankError: string | null;
  error: string | null;
}

export interface RunConditions {
  createdAt: string;
  gitSha: string;
  gitDirty: boolean;
  datasetFile: string;
  datasetBytes: number;
  datasetSha256: string;
  headlineQuestions: number;
  excludedAbstention: number;
  stratify: number | null;
  systems: string[];
  embeddingModel: string | null;
  meiliIndex: string | null;
  qdrantCollection: string | null;
  contentCharLimit: number;
  retrieveK: number;
  tokenizer: 'cl100k_base';
  skippedSystems: string[];
  rerankModel: string | null;
}

function pct(value: number | null): string {
  if (value === null) return '-';
  return (value * 100).toFixed(1) + '%';
}

function num(value: number | null, digits = 0): string {
  if (value === null) return '-';
  return value.toFixed(digits);
}

function column(rows: CompareRow[], pick: (row: CompareRow) => number | null): number | null {
  return mean(rows.map(pick).filter((value): value is number => value !== null));
}

export function renderSummary(conditions: RunConditions, rows: CompareRow[]): string {
  const systems = [...new Set(rows.map((row) => row.system))];
  const lines: string[] = [
    `# LongMemEval-S 检索分数（${conditions.createdAt.slice(0, 10)}）`,
    '',
    '计分照 agentmemory `benchmark/longmemeval-bench.ts`：每题单独建索引，会话正文为 `role: content`，取前 20 个会话。',
    '标题指标是 `recall_any@K`（前 K 个里出现任一金标会话）。拒答类型不在这张表里。检索环没有答题模型。',
    '',
    '## 条件',
    '',
    `- 数据文件：\`${conditions.datasetFile}\`，${conditions.datasetBytes} 字节，sha256 \`${conditions.datasetSha256}\``,
    `- git：\`${conditions.gitSha}\`${conditions.gitDirty ? '，工作区有未提交改动' : ''}`,
    `- 标题题 ${conditions.headlineQuestions}，分层 ${conditions.stratify ?? '全量'}，排除拒答 ${conditions.excludedAbstention}`,
    `- 检索深度 ${conditions.retrieveK}。正文上限 ${conditions.contentCharLimit} 字符，超出截断并计入 truncatedSessions。`,
    `- tokenizer：${conditions.tokenizer}。top10Tokens 是前 10 个命中会话正文的 token 数。`,
    conditions.embeddingModel
      ? `- agent-recall 嵌入模型：${conditions.embeddingModel}。索引 \`${conditions.meiliIndex}\`，集合 \`${conditions.qdrantCollection}\`。`
      : '- 这次没有跑 agent-recall。',
    conditions.rerankModel
      ? `- 重排模型：${conditions.rerankModel}。生效 ${rows.filter((row) => row.rerankApplied === true).length} 题，失败 ${rows.filter((row) => row.rerankError).length} 题。单篇超过 50000 字符时只把开头送去精排。`
      : '- 重排：未开。',
    `- 未跑：${conditions.skippedSystems.join('、')}。没有本机端点，不填模拟分数。`,
    '',
    '## 总分',
    '',
    '| system | n | errors | recall_any@5 | recall_any@10 | recall_any@20 | Recall@5 | nDCG@10 | MRR | search p50 | index p50 | top10 tokens |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const system of systems) {
    const own = rows.filter((row) => row.system === system);
    const ok = own.filter((row) => row.error === null);
    const search = ok.map((row) => row.searchMs).filter((value): value is number => value !== null);
    const index = ok.map((row) => row.indexMs).filter((value): value is number => value !== null);
    lines.push(
      `| ${system} | ${own.length} | ${own.length - ok.length} | ${pct(column(ok, (row) => row.recallAnyAt5))} | ${pct(column(ok, (row) => row.recallAnyAt10))} | ${pct(column(ok, (row) => row.recallAnyAt20))} | ${pct(column(ok, (row) => row.recallAt5))} | ${pct(column(ok, (row) => row.ndcgAt10))} | ${pct(column(ok, (row) => row.mrr))} | ${num(percentile(search, 50))} ms | ${num(percentile(index, 50))} ms | ${num(column(ok, (row) => row.top10Tokens), 0)} |`,
    );
  }

  const types = [...new Set(rows.map((row) => row.questionType))].sort();
  lines.push('', '## 分题型 recall_any@5', '', '| type | ' + systems.join(' | ') + ' | n |', '| --- | ' + systems.map(() => '---').join(' | ') + ' | --- |');
  for (const type of types) {
    const cells = systems.map((system) => {
      const own = rows.filter((row) => row.system === system && row.questionType === type && row.error === null);
      return pct(column(own, (row) => row.recallAnyAt5));
    });
    const n = rows.filter((row) => row.questionType === type && row.system === systems[0]).length;
    lines.push(`| ${type} | ${cells.join(' | ')} | ${n} |`);
  }

  const misses = rows.filter((row) => row.error === null && row.recallAnyAt5 === 0);
  lines.push('', '## recall_any@5 未命中', '');
  if (misses.length === 0) lines.push('没有。');
  else {
    lines.push('| system | question | type | top3 | gold |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const row of misses) {
      lines.push(
        `| ${row.system} | ${row.questionId} | ${row.questionType} | ${row.retrievedSessionIds.slice(0, 3).join(', ')} | ${row.goldSessionIds.join(', ')} |`,
      );
    }
  }

  const errors = rows.filter((row) => row.error !== null);
  lines.push('', '## 错误', '');
  if (errors.length === 0) lines.push('没有。');
  else {
    for (const row of errors) lines.push(`- ${row.system} ${row.questionId}: ${row.error}`);
  }
  lines.push('');
  return lines.join('\n');
}

export async function writeRun(outDir: string, conditions: RunConditions, rows: CompareRow[]): Promise<void> {
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'conditions.json'), JSON.stringify(conditions, null, 2) + '\n', 'utf8');
  await writeFile(path.join(outDir, 'scores.ndjson'), rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8');
  await writeFile(path.join(outDir, 'summary.md'), renderSummary(conditions, rows), 'utf8');
}
