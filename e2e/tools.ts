/**
 * MCP 工具面合同。名字与 apps/mcp/src/index.ts 的 TOOLS / CORE / STANDARD 保持一致。
 * tools/list 一旦增删，这里要一起改，e2e 才会失败。
 */

export const CORE_TOOLS = [
  'memory_save',
  'memory_remember',
  'memory_recall',
  'memory_smart_search',
  'memory_context',
  'memory_list',
  'memory_get',
  'memory_update',
  'memory_forget',
  'memory_stats',
  'memory_lesson_save',
  'memory_lesson_recall',
] as const;

export const STANDARD_EXTRA = [
  'memory_sessions',
  'memory_session_timeline',
  'memory_versions',
  'memory_export',
  'memory_import',
  'memory_batch_forget',
  'memory_auto_forget',
  'memory_checkpoint',
  'memory_sketch_create',
  'memory_sketch_promote',
  'memory_crystallize',
  'memory_snapshot_create',
  'memory_governance_delete',
] as const;

export const FULL_TOOLS = [
  'memory_save',
  'memory_remember',
  'memory_recall',
  'memory_smart_search',
  'memory_list',
  'memory_get',
  'memory_update',
  'memory_forget',
  'memory_batch_forget',
  'memory_versions',
  'memory_stats',
  'memory_export',
  'memory_import',
  'memory_sessions',
  'memory_session_timeline',
  'memory_lesson_save',
  'memory_auto_forget',
  'memory_context',
  'memory_sketch_create',
  'memory_sketch_promote',
  'memory_compress_file',
  'memory_claude_bridge_sync',
  'memory_checkpoint',
  'memory_signal_send',
  'memory_signal_read',
  'memory_action_create',
  'memory_action_update',
  'memory_sentinel_create',
  'memory_sentinel_trigger',
  'memory_slot_create',
  'memory_slot_replace',
  'memory_slot_append',
  'memory_slot_get',
  'memory_slot_list',
  'memory_slot_delete',
  'memory_profile',
  'memory_lease',
  'memory_routine_run',
  'memory_lesson_recall',
  'memory_lesson_delete',
  'memory_patterns',
  'memory_insight_list',
  'memory_timeline',
  'memory_frontier',
  'memory_next',
  'memory_graph_query',
  'memory_relations',
  'memory_facet_query',
  'memory_facet_tag',
  'memory_verify',
  'memory_commit_lookup',
  'memory_commits',
  'memory_file_history',
  'memory_vision_search',
  'memory_mesh_sync',
  'memory_team_share',
  'memory_team_feed',
  'memory_obsidian_export',
  'memory_crystallize',
  'memory_reflect',
  'memory_consolidate',
  'memory_heal',
  'memory_diagnose',
  'memory_audit',
  'memory_snapshot_create',
  'memory_governance_delete',
] as const;

export function standardTools(): string[] {
  return [...CORE_TOOLS, ...STANDARD_EXTRA];
}

/** 返回 null 表示集合一致（忽略顺序）。 */
export function diffToolNames(actual: string[], expected: readonly string[]): string | null {
  const seen = new Set(actual);
  const wanted = new Set(expected);
  const missing = expected.filter((name) => !seen.has(name));
  const extra = actual.filter((name) => !wanted.has(name));
  if (missing.length === 0 && extra.length === 0 && actual.length === expected.length) return null;
  return `count ${String(actual.length)} vs ${String(expected.length)}; missing [${missing.join(', ')}]; extra [${extra.join(', ')}]`;
}
