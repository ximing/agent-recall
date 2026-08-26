export interface GuideTool {
  name: string;
  summary: string;
}

export interface GuideGroup {
  id: string;
  title: string;
  intro: string;
  tools: GuideTool[];
}

export const TOOL_GROUPS: readonly GuideGroup[] = [
  {
    id: 'write',
    title: '写入与遗忘',
    intro: '把值得留下的东西写进记忆库，或按范围删掉。',
    tools: [
      { name: 'memory_save', summary: '保存一条记忆。近重复会返回已有记录，并带上 deduped。' },
      { name: 'memory_remember', summary: '用户明确说「记住」时用。写入规则和 memory_save 相同。' },
      { name: 'memory_lesson_save', summary: '把一条教训存成 lesson：什么发生了，下次怎么做。' },
      { name: 'memory_update', summary: '编辑一条记忆。会生成新版本，旧版本留在版本链里。' },
      { name: 'memory_import', summary: '从导出包导入。重复时可选 skip、merge、replace，默认 skip。' },
      { name: 'memory_forget', summary: '按 id 删除整条版本链，不能撤销。' },
      { name: 'memory_batch_forget', summary: '按 id 列表或过滤条件批量删除。dryRun 只预览不删。' },
      { name: 'memory_auto_forget', summary: '清理已过期的记忆，以及放太久的低价值碎片。可先 dryRun。' },
      { name: 'memory_lesson_delete', summary: '只删除类型为 lesson 的记忆。其他类型会拒绝。' },
      { name: 'memory_governance_delete', summary: '按过滤条件批量删除，并记下原因，方便事后审计。' },
    ],
  },
  {
    id: 'recall',
    title: '召回',
    intro: '按问题把相关记忆找出来。要塞进提示词时用 memory_context。',
    tools: [
      { name: 'memory_recall', summary: '针对一个具体问题做词法和向量融合召回。' },
      { name: 'memory_smart_search', summary: '候选更多，并给出精排分数。适合含糊、探索性的问题。' },
      { name: 'memory_context', summary: '返回按 token 预算裁好的上下文，可以直接放进提示词。' },
      { name: 'memory_lesson_recall', summary: '只在 lesson 里召回，用来翻以前的成败。' },
      { name: 'memory_patterns', summary: '列出或搜索 pattern：反复出现的做法和约定。' },
      { name: 'memory_insight_list', summary: '最近的 lesson 和 pattern，按时间浏览，不做排序。' },
      { name: 'memory_vision_search', summary: '在带 vision 标签的记忆里按问题召回。' },
      { name: 'memory_file_history', summary: '按文件路径找摘要，主要是 memory_compress_file 写过的。' },
      { name: 'memory_commits', summary: '在带 commit 标签的记忆里搜索。' },
      { name: 'memory_commit_lookup', summary: '按某一次 commit 的 SHA 查找相关记忆。' },
    ],
  },
  {
    id: 'browse',
    title: '浏览',
    intro: '不按语义排序，用来翻清单、看版本、看一场会话。',
    tools: [
      { name: 'memory_list', summary: '分页列出记忆，可按来源、类型、标签、项目、会话过滤。' },
      { name: 'memory_get', summary: '按 id 取一条，带版本链、访问次数和过期时间。' },
      { name: 'memory_versions', summary: '列出一条记忆的全部版本，从旧到新。' },
      { name: 'memory_sessions', summary: '列出产生过记忆的会话，含数量和时间范围。' },
      { name: 'memory_session_timeline', summary: '一个会话里的记忆，按时间排列。' },
      { name: 'memory_timeline', summary: '按创建时间浏览。给了 sessionId 就只看那一场。' },
      { name: 'memory_frontier', summary: '最新的记忆，默认 10 条。' },
      { name: 'memory_next', summary: '开场简报：未完成的行动、最近一场会话、最新 5 条记忆。' },
      { name: 'memory_stats', summary: '总量、来源和类型分布、过期数、待索引、最近活动。' },
      { name: 'memory_verify', summary: '检查一条记忆是否还在、是不是最新版本、有没有过期。' },
      { name: 'memory_export', summary: '把全部记忆导出成 JSON，配合 memory_import 做备份。' },
    ],
  },
  {
    id: 'capture',
    title: '当场记下',
    intro: '草稿、文件大纲、本地 MEMORY.md，以及一份可覆盖的检查点。',
    tools: [
      { name: 'memory_sketch_create', summary: '记一条 24 小时后过期的草稿，标签为 sketch。' },
      { name: 'memory_sketch_promote', summary: '去掉草稿标签和过期时间，把它留成永久记忆。' },
      { name: 'memory_compress_file', summary: '读本地文件（最大 200KB），抽出大纲，存成 file-summary。' },
      { name: 'memory_claude_bridge_sync', summary: '和本地 MEMORY.md 双向同步。from 导入，to 写回。' },
      { name: 'memory_checkpoint', summary: '用一个名字把 JSON 状态存进 KV。同名会覆盖。' },
    ],
  },
  {
    id: 'state',
    title: '状态',
    intro: '信号、行动、哨兵、槽位、档案、租约。存在 KV 里，不进召回排序。',
    tools: [
      { name: 'memory_signal_send', summary: '往一个命名信号日志里追加一条带时间的事件。' },
      { name: 'memory_signal_read', summary: '读某个信号日志。不给名字就列出全部。' },
      { name: 'memory_action_create', summary: '建一条状态为 open 的行动，返回 id。' },
      { name: 'memory_action_update', summary: '把行动改成 open、done 或 blocked。' },
      { name: 'memory_sentinel_create', summary: '建一个哨兵：要盯住的条件，以及空的触发记录。' },
      { name: 'memory_sentinel_trigger', summary: '记下这个哨兵触发了一次，可附一句说明。' },
      { name: 'memory_slot_create', summary: '建一个命名槽位，存任意 JSON。同名会覆盖。' },
      { name: 'memory_slot_replace', summary: '覆盖已有槽位。意图是替换时用这个名字。' },
      { name: 'memory_slot_append', summary: '往槽位里追加一条，适合当日志。' },
      { name: 'memory_slot_get', summary: '读一个槽位。' },
      { name: 'memory_slot_list', summary: '列出全部槽位。' },
      { name: 'memory_slot_delete', summary: '删除一个槽位。' },
      { name: 'memory_profile', summary: '读或写档案。不传 key 列出全部；只传 key 读取；再传 value 写入。' },
      { name: 'memory_lease', summary: '抢一个带 TTL 的租约。已被占用时返回当前持有者。' },
      { name: 'memory_routine_run', summary: '读取某个 routine 的步骤列表。不存在会报 routine not found。' },
    ],
  },
  {
    id: 'graph',
    title: '关系与分面',
    intro: '记忆之间的关系，以及「维度:值」这种分面标签。',
    tools: [
      { name: 'memory_graph_query', summary: '用一段文本查询关系图里的节点和边。' },
      { name: 'memory_relations', summary: '列出和某一条记忆有关系的其他记忆。' },
      { name: 'memory_facet_tag', summary: '给一条记忆打上「维度:值」标签，重复打会去重。' },
      { name: 'memory_facet_query', summary: '按维度和值查找，例如语言是 TypeScript。' },
    ],
  },
  {
    id: 'share',
    title: '共享与导出',
    intro: '分给队友、和另一台服务器同步，或导出成 Obsidian 笔记。',
    tools: [
      { name: 'memory_mesh_sync', summary: '和另一台 agent-recall 同步。strategy 决定重复怎么处理。' },
      { name: 'memory_team_share', summary: '按邮箱把一条记忆分给队友。' },
      { name: 'memory_team_feed', summary: '看别人分给你的记忆。' },
      { name: 'memory_obsidian_export', summary: '每条记忆写成一个带 frontmatter 的 Markdown 文件。' },
    ],
  },
  {
    id: 'maintain',
    title: '整理',
    intro: '摘要、合并、体检、审计和快照。',
    tools: [
      { name: 'memory_crystallize', summary: '把一整场会话收成一条可以长期留下的摘要。' },
      { name: 'memory_reflect', summary: '根据最近几天的记忆写一条反思，可以限定项目。' },
      { name: 'memory_consolidate', summary: '找出近似重复并合并。dryRun 只列出分组。' },
      { name: 'memory_heal', summary: '重新索引待处理的记忆，并跑一遍自动遗忘。' },
      { name: 'memory_diagnose', summary: '体检：列出问题和建议，附上统计。' },
      { name: 'memory_audit', summary: '最近的审计记录：改动、删除、管理操作。' },
      { name: 'memory_snapshot_create', summary: '给整个记忆库做一份快照。恢复走服务器 API。' },
    ],
  },
];

export const TOOL_COUNT = TOOL_GROUPS.reduce((count, group) => count + group.tools.length, 0);

const BY_NAME = new Map(TOOL_GROUPS.flatMap((group) => group.tools.map((tool) => [tool.name, tool] as const)));

export const STARTER: readonly GuideTool[] = [
  'memory_remember',
  'memory_recall',
  'memory_smart_search',
  'memory_context',
  'memory_update',
  'memory_forget',
  'memory_next',
].map((name) => {
  const tool = BY_NAME.get(name);
  if (!tool) throw new Error(`missing starter tool ${name}`);
  return tool;
});
