import type { MemoryType, SemanticConsolidateResult } from '@agent-recall/dto';
import { and, desc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { failAgentResult, noteAgentResult, runAgent } from '../agent/runtime.js';
import { llmConfigs, memories, type MemoryRow } from '../db/schema.js';
import { AppError } from '../errors.js';
import { createMemory, deleteMemory, updateMemory, type MemoryDeps } from './service.js';
import { redactSecrets } from './privacy.js';

const SEMANTIC_TYPES = ['lesson', 'pattern', 'bug', 'architecture', 'workflow'] as const;
const SEMANTIC_TAG = 'semantic';
const CANDIDATE_LIMIT = 40;
const CONTENT_LIMIT = 400;

const mergeItemSchema = z.object({
  title: z.string().trim().min(1).max(80),
  type: z.enum(SEMANTIC_TYPES),
  content: z.string().trim().min(1).max(4000),
  sourceIds: z.array(z.string().uuid()).min(2).max(12),
});

function skipped(reason: string): SemanticConsolidateResult {
  return { skipped: true, reason, created: 0, evolved: 0, absorbed: 0 };
}

function titleOf(content: string): string | null {
  const line = content.split('\n', 1)[0]?.trim() ?? '';
  const match = /^#\s+(.+)$/.exec(line);
  const title = match?.[1]?.trim();
  return title ? title : null;
}

function normalizeTitle(raw: string): string {
  return raw.replace(/^#+\s*/, '').replace(/\s+/g, ' ').trim().slice(0, 40);
}

function formatSemantic(title: string, body: string): string {
  const stripped = body.replace(/^#\s+.+\n+/, '').trim();
  return `# ${title}\n\n${stripped}`;
}

function majorityType(rows: MemoryRow[]): MemoryType {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.type, (counts.get(row.type) ?? 0) + 1);
  let best = rows[0]?.type ?? 'lesson';
  let bestCount = -1;
  for (const [type, count] of counts) {
    if (count > bestCount) {
      best = type;
      bestCount = count;
    }
  }
  return best as MemoryType;
}

function mergeTags(rows: MemoryRow[]): string[] {
  const tags = [SEMANTIC_TAG];
  for (const row of rows) {
    for (const tag of row.tags) {
      if (typeof tag !== 'string' || tag === SEMANTIC_TAG || tag.length < 1 || tag.length > 48) continue;
      if (!tags.includes(tag)) tags.push(tag);
      if (tags.length >= 16) return tags;
    }
  }
  return tags;
}

async function hasDefaultModel(deps: MemoryDeps, userId: string): Promise<boolean> {
  const [row] = await deps.db
    .select({ id: llmConfigs.id })
    .from(llmConfigs)
    .where(and(eq(llmConfigs.userId, userId), eq(llmConfigs.isDefault, true)))
    .limit(1);
  return Boolean(row);
}

function buildPrompt(rows: MemoryRow[]): string {
  const blocks = rows.map((row) => {
    const text = redactSecrets(row.content).content.replace(/\s+/g, ' ').trim().slice(0, CONTENT_LIMIT);
    return [`id=${row.id}`, `type=${row.type}`, `project=${row.project ?? ''}`, text].join('\n');
  });
  return [
    '下面是同一用户最近的记忆。只合并明显在讲同一件事的条目。不要发明输入里没有的事实。',
    '只输出一个 JSON 对象，不要 Markdown 围栏：',
    '{"merges":[{"title":"不超过40字","type":"lesson|pattern|bug|architecture|workflow","content":"合并后的正文","sourceIds":["uuid"]}]}',
    '每组至少 2 个 sourceIds，且都必须来自下面的 id。同一个 id 只能出现一次。一组里的 project 必须相同。没有可合并的就返回 {"merges":[]}。最多 8 组。',
    '',
    ...blocks,
  ].join('\n');
}

function parseMerges(text: string): z.infer<typeof mergeItemSchema>[] {
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('模型没有返回 JSON');
  const json = JSON.parse(stripped.slice(start, end + 1)) as unknown;
  const root = z.object({ merges: z.array(z.unknown()).max(20) }).safeParse(json);
  if (!root.success) throw new Error('模型返回的结构无法识别');
  const merges: z.infer<typeof mergeItemSchema>[] = [];
  for (const item of root.data.merges) {
    const parsed = mergeItemSchema.safeParse(item);
    if (!parsed.success) continue;
    const title = normalizeTitle(parsed.data.title);
    if (!title) continue;
    merges.push({ ...parsed.data, title });
    if (merges.length >= 8) break;
  }
  return merges;
}

interface TitledMemory {
  id: string;
  chainId: string;
  type: string;
  project: string | null;
  content: string;
}

async function loadSemanticRows(deps: MemoryDeps, userId: string): Promise<TitledMemory[]> {
  const rows = await deps.db
    .select({
      id: memories.id,
      chainId: memories.chainId,
      type: memories.type,
      project: memories.project,
      content: memories.content,
    })
    .from(memories)
    .where(
      and(
        eq(memories.userId, userId),
        eq(memories.isLatest, true),
        sql`${memories.tags} @> ${JSON.stringify([SEMANTIC_TAG])}::jsonb`,
      ),
    )
    .limit(200);
  return rows;
}

/**
 * 语义合并：同一 project 内，按标题行演进已有的 semantic 记忆，其余来源整链删除。
 * 标题写在正文第一行 `# 标题`，并打上 semantic 标签，因为记忆表没有单独的标题列。
 */
export async function semanticConsolidate(
  deps: MemoryDeps,
  userId: string,
  dryRun: boolean,
): Promise<SemanticConsolidateResult> {
  if (dryRun) return skipped('预览不调用模型');
  if (!(await hasDefaultModel(deps, userId))) return skipped('尚未配置大模型');

  const now = new Date();
  const candidates = await deps.db
    .select()
    .from(memories)
    .where(
      and(
        eq(memories.userId, userId),
        eq(memories.isLatest, true),
        inArray(memories.type, [...SEMANTIC_TYPES]),
        or(isNull(memories.expiresAt), gte(memories.expiresAt, now)),
      ),
    )
    .orderBy(desc(memories.updatedAt))
    .limit(CANDIDATE_LIMIT);
  if (candidates.length < 2) return skipped('可合并的记忆不足');

  const byId = new Map(candidates.map((row) => [row.id, row]));
  let executionId: string | undefined;
  try {
    const run = await runAgent(
      deps.db,
      { encryptionKey: deps.encryptionKey, appEnv: deps.appEnv },
      {
        userId,
        agentType: 'consolidate',
        maxTokens: 1200,
        messages: [
          {
            role: 'system',
            content: '你是记忆整理代理。只根据给定记忆做合并，输出严格 JSON。',
          },
          { role: 'user', content: buildPrompt(candidates) },
        ],
      },
    );
    executionId = run.executionId;
    const merges = parseMerges(run.text);
    const used = new Set<string>();
    const titled = await loadSemanticRows(deps, userId);
    let created = 0;
    let evolved = 0;
    let absorbed = 0;

    for (const merge of merges) {
      const sources = merge.sourceIds
        .filter((id) => byId.has(id) && !used.has(id))
        .map((id) => byId.get(id)!);
      if (sources.length < 2) continue;
      const project = sources[0]?.project ?? null;
      if (sources.some((row) => (row.project ?? null) !== project)) continue;
      for (const source of sources) used.add(source.id);

      const type = sources.every((row) => row.type === merge.type) ? merge.type : majorityType(sources);
      const content = formatSemantic(merge.title, merge.content);
      const tags = mergeTags(sources);
      const matches = titled.filter(
        (row) => row.type === type && (row.project ?? null) === project && titleOf(row.content) === merge.title,
      );
      const evolve = matches.find((row) => sources.some((source) => source.chainId === row.chainId)) ?? matches[0];

      let keepChain: string | null = null;
      if (evolve) {
        const updated = await updateMemory(deps, userId, evolve.id, { content, type, tags });
        evolve.id = updated.id;
        evolve.content = updated.content;
        evolve.chainId = updated.chainId;
        keepChain = updated.chainId;
        evolved += 1;
      } else {
        const inserted = await createMemory(deps, userId, {
          content,
          origin: 'agent',
          type,
          tags,
          ...(project ? { project } : {}),
          skipDedup: true,
        });
        keepChain = inserted.memory.chainId;
        titled.push({
          id: inserted.memory.id,
          chainId: inserted.memory.chainId,
          type: inserted.memory.type,
          project: inserted.memory.project,
          content: inserted.memory.content,
        });
        created += 1;
      }

      for (const source of sources) {
        if (source.chainId === keepChain) continue;
        await deleteMemory(deps, userId, source.id);
        absorbed += 1;
      }
    }

    await noteAgentResult(
      deps.db,
      run.executionId,
      `created=${String(created)} evolved=${String(evolved)} absorbed=${String(absorbed)}`,
    );
    return { skipped: false, created, evolved, absorbed, executionId: run.executionId };
  } catch (err) {
    const message = err instanceof AppError ? err.message : err instanceof Error ? err.message : '语义合并失败';
    if (executionId) await failAgentResult(deps.db, executionId, message);
    return { skipped: false, reason: message.slice(0, 200), created: 0, evolved: 0, absorbed: 0, ...(executionId ? { executionId } : {}) };
  }
}
