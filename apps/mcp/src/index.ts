#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import nodePath from 'node:path';
import { createStdioTransport, JsonRpcError } from './stdio.js';

/**
 * agent-recall MCP server (stdio, hand-written JSON-RPC).
 *
 * Pure HTTP passthrough to the agent-recall server (AGENT_RECALL_URL,
 * Bearer AGENT_RECALL_TOKEN), plus a few client-side file tools
 * (node:fs only, no other dependencies). Tool taxonomy:
 *
 *   Core write:  memory_save, memory_remember, memory_lesson_save, memory_update,
 *                memory_import
 *   Core read:   memory_recall, memory_smart_search, memory_context, memory_list,
 *                memory_get, memory_versions, memory_sessions,
 *                memory_session_timeline, memory_stats, memory_export
 *   Core delete: memory_forget, memory_batch_forget, memory_auto_forget
 *   Capture:     memory_sketch_create, memory_sketch_promote, memory_compress_file,
 *                memory_claude_bridge_sync, memory_checkpoint, memory_signal_send
 *   KV state:    memory_signal_read, memory_action_create, memory_action_update,
 *                memory_sentinel_create, memory_sentinel_trigger,
 *                memory_slot_create, memory_slot_replace, memory_slot_append,
 *                memory_slot_get, memory_slot_list, memory_slot_delete,
 *                memory_profile, memory_lease, memory_routine_run
 *   Retrieval:   memory_lesson_recall, memory_patterns, memory_insight_list,
 *                memory_timeline, memory_frontier, memory_next,
 *                memory_graph_query, memory_relations, memory_facet_query,
 *                memory_commit_lookup, memory_commits, memory_file_history,
 *                memory_vision_search, memory_verify
 *   Tagging:     memory_facet_tag
 *   Sharing:     memory_mesh_sync, memory_team_share, memory_team_feed,
 *                memory_obsidian_export
 *   Maintenance: memory_crystallize, memory_reflect, memory_consolidate,
 *                memory_heal, memory_diagnose, memory_audit,
 *                memory_snapshot_create, memory_governance_delete,
 *                memory_lesson_delete
 */

const MEMORY_TYPES = ['fact', 'preference', 'pattern', 'architecture', 'bug', 'workflow', 'lesson'] as const;
const MEMORY_ORIGINS = ['web', 'agent', 'hook', 'import', 'summary'] as const;
const IMPORT_STRATEGIES = ['skip', 'merge', 'replace'] as const;

const FILTER_PROPERTIES = {
  origin: { type: 'string', enum: MEMORY_ORIGINS, description: 'Filter by origin' },
  type: { type: 'string', enum: MEMORY_TYPES, description: 'Filter by memory type' },
  tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
  project: { type: 'string', description: 'Filter by project' },
} as const;

const TOOLS = [
  {
    name: 'memory_save',
    description:
      'Save a memory. Returns the created memory, or the existing memory with a `deduped` flag when a near-duplicate already exists. ' +
      'Prefer memory_remember when the user explicitly asks to remember something, and memory_lesson_save for lessons learned.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Memory text' },
        type: { type: 'string', enum: MEMORY_TYPES, description: 'Memory type (default: fact)' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorization' },
        project: { type: 'string', description: 'Project name to scope the memory' },
        expiresAt: { type: 'string', description: 'ISO 8601 expiry timestamp; omit for permanent' },
      },
      required: ['content'],
    },
  },
  {
    name: 'memory_remember',
    description:
      'Explicitly remember an important fact, preference, or decision the user asked you to keep ("remember that..."). ' +
      'Same endpoint as memory_save but signals deliberate, user-requested retention. Deduplication still applies.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'What to remember' },
        type: { type: 'string', enum: MEMORY_TYPES, description: 'Memory type (default: fact)' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorization' },
        project: { type: 'string', description: 'Project name to scope the memory' },
        expiresAt: { type: 'string', description: 'ISO 8601 expiry timestamp; omit for permanent' },
      },
      required: ['content'],
    },
  },
  {
    name: 'memory_recall',
    description:
      'Recall memories relevant to a query using lexical and vector fusion. Fast, focused retrieval for a specific question. ' +
      'Use memory_smart_search for fuzzy/exploratory queries, memory_context when you need prompt-ready formatted context.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results' },
        ...FILTER_PROPERTIES,
      },
      required: ['query'],
    },
  },
  {
    name: 'memory_smart_search',
    description:
      'Deep retrieval: larger candidate pool plus reranking scores. Best for fuzzy or exploratory queries where memory_recall ' +
      'may miss relevant items. Results include a per-memory relevance score (null when unscored).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results' },
        ...FILTER_PROPERTIES,
      },
      required: ['query'],
    },
  },
  {
    name: 'memory_list',
    description:
      'List memories with pagination and filters. Browsing-oriented (no ranking); use memory_recall or memory_smart_search ' +
      'to find memories by meaning.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max results' },
        offset: { type: 'number', description: 'Pagination offset' },
        ...FILTER_PROPERTIES,
        sessionId: { type: 'string', description: 'Filter by session' },
      },
    },
  },
  {
    name: 'memory_get',
    description: 'Get a single memory by id, including full metadata (version chain, access stats, expiry).',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Memory id (uuid)' } },
      required: ['id'],
    },
  },
  {
    name: 'memory_update',
    description:
      'Edit a memory. Editing creates a NEW version and returns it; the old version is kept in the version chain ' +
      '(see memory_versions). Use memory_forget to delete instead.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Memory id (uuid)' },
        content: { type: 'string', description: 'New content' },
        type: { type: 'string', enum: MEMORY_TYPES, description: 'New type' },
        tags: { type: 'array', items: { type: 'string' }, description: 'New tags (replaces existing)' },
        expiresAt: { type: 'string', description: 'New ISO 8601 expiry timestamp' },
      },
      required: ['id', 'content'],
    },
  },
  {
    name: 'memory_forget',
    description: 'Delete a memory by id. Deletes the ENTIRE version chain, not just the latest version. Irreversible.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Memory id (uuid)' } },
      required: ['id'],
    },
  },
  {
    name: 'memory_batch_forget',
    description:
      'Delete many memories at once, either by explicit ids or by filter. Set dryRun to preview what would be deleted ' +
      'before committing. At least one of ids or a filter field is required. For governance-style deletes with an audit reason, use memory_governance_delete.',
    inputSchema: {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'string' }, description: 'Explicit memory ids (uuid) to delete' },
        ...FILTER_PROPERTIES,
        sessionId: { type: 'string', description: 'Filter by session' },
        dryRun: { type: 'boolean', description: 'Preview matches without deleting' },
      },
    },
  },
  {
    name: 'memory_versions',
    description: 'List all versions of a memory (ascending by version). Memories form a chain: each edit appends a version.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Memory id (uuid) — any version in the chain' } },
      required: ['id'],
    },
  },
  {
    name: 'memory_stats',
    description: 'Aggregate statistics: totals, breakdown by origin/type, expired count, pending index, recent activity, sessions.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'memory_export',
    description: 'Export all memories as a portable JSON bundle. Pair with memory_import for backup/migration. For a human-readable markdown vault export, use memory_obsidian_export.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'memory_import',
    description:
      'Import memories from an export bundle. strategy: "skip" ignores duplicates, "merge" keeps both, ' +
      '"replace" overwrites existing memories. Default: skip.',
    inputSchema: {
      type: 'object',
      properties: {
        memories: { type: 'array', items: { type: 'object' }, description: 'Memory objects to import' },
        strategy: { type: 'string', enum: IMPORT_STRATEGIES, description: 'Duplicate handling strategy' },
      },
      required: ['memories'],
    },
  },
  {
    name: 'memory_sessions',
    description: 'List sessions that produced memories, with counts, time range, and associated projects.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'memory_session_timeline',
    description: 'Get the memory timeline of one session, ordered chronologically. Use memory_sessions to discover session ids. For a cross-session timeline with date filters, use memory_timeline.',
    inputSchema: {
      type: 'object',
      properties: { sessionId: { type: 'string', description: 'Session id' } },
      required: ['sessionId'],
    },
  },
  {
    name: 'memory_lesson_save',
    description:
      'Save a lesson learned — what worked or what failed — as a memory of type "lesson". ' +
      'Use this after mistakes or successes worth avoiding/repeating; use memory_save for general facts.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The lesson: what happened and what to do differently' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorization' },
        project: { type: 'string', description: 'Project name to scope the lesson' },
      },
      required: ['content'],
    },
  },
  {
    name: 'memory_auto_forget',
    description:
      'Clean up expired memories and low-value stale fragments. Returns counts of expired/stale matches and deletions. ' +
      'Set dryRun to preview before deleting.',
    inputSchema: {
      type: 'object',
      properties: { dryRun: { type: 'boolean', description: 'Preview matches without deleting' } },
    },
  },
  {
    name: 'memory_context',
    description:
      'Get formatted memory context ready to inject into a prompt, fitted to a token budget. ' +
      'Unlike memory_recall (raw ranked list), this returns a ready-to-use context string plus the source memories.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What the context should be relevant to' },
        tokenBudget: { type: 'number', description: 'Max tokens for the formatted context' },
        project: { type: 'string', description: 'Scope context to a project' },
      },
      required: ['query'],
    },
  },
  // ---- Capture -------------------------------------------------------------
  {
    name: 'memory_sketch_create',
    description:
      'Capture a quick, ephemeral note ("sketch") that expires after 24 hours. Sketches are facts tagged "sketch". ' +
      'Promote a keeper with memory_sketch_promote; use memory_save for durable memories.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Sketch content' },
        sessionId: { type: 'string', description: 'Session id to attach the sketch to' },
        project: { type: 'string', description: 'Project name to scope the sketch' },
      },
      required: ['content'],
    },
  },
  {
    name: 'memory_sketch_promote',
    description:
      'Promote a sketch to a permanent memory: removes the "sketch" tag and clears its 24h expiry. ' +
      'Use memory_update instead if you also want to edit the content.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Sketch memory id (uuid)' } },
      required: ['id'],
    },
  },
  {
    name: 'memory_compress_file',
    description:
      'Read a local source file (max 200KB), extract its outline (exports/functions/classes/headings), and save it as a ' +
      'type "pattern" memory tagged "file-summary". Query it later with memory_file_history.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file to summarize' },
        project: { type: 'string', description: 'Project name to scope the summary' },
      },
      required: ['path'],
    },
  },
  {
    name: 'memory_claude_bridge_sync',
    description:
      'Sync between a local MEMORY.md file and the memory store. direction "from" imports bullet/heading entries as memories ' +
      'tagged "claude-bridge" (duplicates skipped); direction "to" renders all claude-bridge memories back into the file as markdown.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the MEMORY.md file (default: ./MEMORY.md)' },
        direction: { type: 'string', enum: ['from', 'to'], description: '"from" imports the file into the store; "to" writes the store back to the file' },
      },
      required: ['direction'],
    },
  },
  {
    name: 'memory_checkpoint',
    description:
      'Save a named checkpoint of arbitrary JSON state (e.g. task progress) into the KV store, overwriting any previous ' +
      'checkpoint with the same name. Read it back with memory_signal_read-style KV access via memory_profile or a slot.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Checkpoint name' },
        state: { description: 'Arbitrary JSON state to store' },
      },
      required: ['name', 'state'],
    },
  },
  // ---- KV state ------------------------------------------------------------
  {
    name: 'memory_signal_send',
    description:
      'Append a signal event to a named signal log in the KV store. Each event records the payload and a timestamp. ' +
      'Use memory_signal_read to consume signals.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Signal name' },
        data: { description: 'Arbitrary JSON payload for the signal' },
      },
      required: ['name'],
    },
  },
  {
    name: 'memory_signal_read',
    description: 'Read signals from the KV store. With a name, returns that signal log; without, lists all signal logs.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Signal name; omit to list all signals' } },
    },
  },
  {
    name: 'memory_action_create',
    description:
      'Create a tracked action item (status "open") in the KV store and return its generated id. ' +
      'Update its status with memory_action_update; see open actions in memory_next.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short action title' },
        detail: { type: 'string', description: 'Optional longer description' },
      },
      required: ['title'],
    },
  },
  {
    name: 'memory_action_update',
    description: 'Update the status of an action item created by memory_action_create.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Action id (uuid returned by memory_action_create)' },
        status: { type: 'string', enum: ['open', 'done', 'blocked'], description: 'New status' },
      },
      required: ['id', 'status'],
    },
  },
  {
    name: 'memory_sentinel_create',
    description:
      'Create a named sentinel: a condition to watch for, with an initially empty fire log. ' +
      'Record occurrences with memory_sentinel_trigger.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Sentinel name' },
        condition: { type: 'string', description: 'The condition being watched (free text)' },
      },
      required: ['name', 'condition'],
    },
  },
  {
    name: 'memory_sentinel_trigger',
    description: 'Record that a sentinel condition fired, appending a timestamped note to its fire log.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Sentinel name' },
        note: { type: 'string', description: 'Optional note about this occurrence' },
      },
      required: ['name'],
    },
  },
  {
    name: 'memory_slot_create',
    description:
      'Create a named KV slot with an arbitrary JSON value. Fails semantics aside, this overwrites any existing slot ' +
      'with the same name; use memory_slot_replace to make the overwrite intent explicit.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Slot name' },
        value: { description: 'Arbitrary JSON value to store' },
      },
      required: ['name', 'value'],
    },
  },
  {
    name: 'memory_slot_replace',
    description: 'Replace the value of an existing named KV slot. Same endpoint as memory_slot_create; prefer this name when overwriting.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Slot name' },
        value: { description: 'New JSON value' },
      },
      required: ['name', 'value'],
    },
  },
  {
    name: 'memory_slot_append',
    description: 'Append a value to a named KV slot (log-style). Use memory_slot_get to read the accumulated entries.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Slot name' },
        value: { description: 'Value to append' },
      },
      required: ['name', 'value'],
    },
  },
  {
    name: 'memory_slot_get',
    description: 'Read a single named KV slot.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Slot name' } },
      required: ['name'],
    },
  },
  {
    name: 'memory_slot_list',
    description: 'List all KV slots.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'memory_slot_delete',
    description: 'Delete a named KV slot.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Slot name' } },
      required: ['name'],
    },
  },
  {
    name: 'memory_profile',
    description:
      'Read or write agent/user profile keys in the KV store. No arguments lists all profile entries; ' +
      'key only reads one entry; key plus value writes it.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Profile key; omit to list all' },
        value: { description: 'Value to write (requires key)' },
      },
    },
  },
  {
    name: 'memory_lease',
    description:
      'Try to acquire a named, TTL-bound lease (mutual exclusion between agents). Returns {acquired: true} on success; ' +
      'when the lease is already held, returns {acquired: false, holder} with the current holder entry.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Lease name' },
        ttlSeconds: { type: 'number', description: 'Lease time-to-live in seconds' },
      },
      required: ['name', 'ttlSeconds'],
    },
  },
  {
    name: 'memory_routine_run',
    description: 'Fetch the step list of a named routine stored in the KV store. Fails with "routine not found" when absent.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Routine name' } },
      required: ['name'],
    },
  },
  // ---- Retrieval -----------------------------------------------------------
  {
    name: 'memory_lesson_recall',
    description:
      'Recall only memories of type "lesson" relevant to a query. Use this to surface past mistakes/successes; ' +
      'use memory_recall for unrestricted retrieval.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results' },
      },
      required: ['query'],
    },
  },
  {
    name: 'memory_lesson_delete',
    description: 'Delete a memory only if it is of type "lesson". Refuses to delete non-lesson memories (use memory_forget for those).',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Lesson memory id (uuid)' } },
      required: ['id'],
    },
  },
  {
    name: 'memory_patterns',
    description:
      'List or search memories of type "pattern" (recurring solutions, conventions). With a query, ranked recall restricted ' +
      'to patterns; without, a plain listing of all patterns.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Optional search query' } },
    },
  },
  {
    name: 'memory_insight_list',
    description: 'List recent insight-type memories (lessons and patterns combined). Use memory_lesson_recall or memory_patterns for ranked retrieval.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Max results' } },
    },
  },
  {
    name: 'memory_timeline',
    description:
      'Browse memories chronologically. With sessionId, returns that session\'s timeline (same as memory_session_timeline); ' +
      'otherwise lists memories filtered by creation time range.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session id (takes precedence over time filters)' },
        createdAfter: { type: 'string', description: 'ISO 8601 lower bound on creation time' },
        createdBefore: { type: 'string', description: 'ISO 8601 upper bound on creation time' },
        limit: { type: 'number', description: 'Max results' },
      },
    },
  },
  {
    name: 'memory_frontier',
    description: 'List the most recent memories (the "frontier" of the store), newest first. Default limit 10.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Max results (default 10)' } },
    },
  },
  {
    name: 'memory_next',
    description:
      'Orientation briefing: a text summary of open action items, the latest session, and the 5 most recent memories. ' +
      'Call at the start of a session to decide what to do next.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'memory_graph_query',
    description: 'Query the memory relation graph (nodes and edges) with a text query. For relations of one specific memory, use memory_relations.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Graph query text' },
        limit: { type: 'number', description: 'Max nodes' },
      },
      required: ['query'],
    },
  },
  {
    name: 'memory_relations',
    description: 'List memories related to a given memory id via the relation graph.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Memory id (uuid)' } },
      required: ['id'],
    },
  },
  {
    name: 'memory_facet_query',
    description:
      'Find memories by a facet tag of the form "<dimension>:<value>" (e.g. dimension "lang", value "ts"). ' +
      'Tag memories with facets using memory_facet_tag.',
    inputSchema: {
      type: 'object',
      properties: {
        dimension: { type: 'string', description: 'Facet dimension (tag prefix before the colon)' },
        value: { type: 'string', description: 'Facet value (tag suffix after the colon)' },
      },
      required: ['dimension', 'value'],
    },
  },
  {
    name: 'memory_facet_tag',
    description: 'Attach a facet tag "<dimension>:<value>" to a memory (deduplicated). Query facets with memory_facet_query.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Memory id (uuid)' },
        dimension: { type: 'string', description: 'Facet dimension' },
        value: { type: 'string', description: 'Facet value' },
      },
      required: ['id', 'dimension', 'value'],
    },
  },
  {
    name: 'memory_verify',
    description:
      'Check the freshness of a memory: existence, version, whether it is the latest in its chain, age, access count, ' +
      'and expiry status. Use before relying on a stale memory.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Memory id (uuid)' } },
      required: ['id'],
    },
  },
  {
    name: 'memory_commit_lookup',
    description: 'Find memories referencing a specific commit SHA. For a broader commit search, use memory_commits.',
    inputSchema: {
      type: 'object',
      properties: { sha: { type: 'string', description: 'Commit SHA (full or short)' } },
      required: ['sha'],
    },
  },
  {
    name: 'memory_commits',
    description:
      'Search commit-related memories (tagged "commit"). With a query, ranked recall within commit memories, falling back ' +
      'to an unrestricted recall when nothing matches.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Optional search query' } },
    },
  },
  {
    name: 'memory_file_history',
    description:
      'Recall summaries and notes about a file path — primarily memories created by memory_compress_file ' +
      '(tagged "file-summary"), falling back to a general recall on the path.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'File path to look up' } },
      required: ['path'],
    },
  },
  {
    name: 'memory_vision_search',
    description: 'Recall memories tagged "vision" (image/vision-derived notes) relevant to a query.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results' },
      },
      required: ['query'],
    },
  },
  // ---- Sharing -------------------------------------------------------------
  {
    name: 'memory_mesh_sync',
    description: 'Synchronize memories with a peer agent-recall server (mesh replication). strategy controls duplicate handling.',
    inputSchema: {
      type: 'object',
      properties: {
        peerUrl: { type: 'string', description: 'Base URL of the peer server' },
        peerToken: { type: 'string', description: 'Bearer token for the peer server' },
        strategy: { type: 'string', enum: IMPORT_STRATEGIES, description: 'Duplicate handling strategy' },
      },
      required: ['peerUrl', 'peerToken'],
    },
  },
  {
    name: 'memory_team_share',
    description: 'Share a memory with a teammate by email. Shared memories appear in their memory_team_feed.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Memory id (uuid)' },
        email: { type: 'string', description: 'Teammate email address' },
      },
      required: ['id', 'email'],
    },
  },
  {
    name: 'memory_team_feed',
    description: 'List memories teammates have shared with you.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'memory_obsidian_export',
    description:
      'Export every memory as an individual markdown file with YAML frontmatter into a local directory (Obsidian-compatible vault). ' +
      'For a machine-readable JSON bundle, use memory_export.',
    inputSchema: {
      type: 'object',
      properties: { dir: { type: 'string', description: 'Target directory (created recursively)' } },
      required: ['dir'],
    },
  },
  // ---- Maintenance ---------------------------------------------------------
  {
    name: 'memory_crystallize',
    description: 'Condense a whole session into one durable summary memory. Use at the end of a productive session.',
    inputSchema: {
      type: 'object',
      properties: { sessionId: { type: 'string', description: 'Session id to crystallize' } },
      required: ['sessionId'],
    },
  },
  {
    name: 'memory_reflect',
    description: 'Generate a reflection memory summarizing patterns over recent days, optionally scoped to a project.',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Look-back window in days' },
        project: { type: 'string', description: 'Scope the reflection to a project' },
      },
    },
  },
  {
    name: 'memory_consolidate',
    description:
      'Find groups of near-duplicate memories and merge them. Set dryRun to preview the groups without merging. ' +
      'Unlike memory_auto_forget (which deletes), this merges content.',
    inputSchema: {
      type: 'object',
      properties: { dryRun: { type: 'boolean', description: 'Preview groups without merging' } },
    },
  },
  {
    name: 'memory_heal',
    description: 'Repair the store: reindex pending memories and run auto-forget cleanup. Use memory_diagnose first to see what is wrong.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'memory_diagnose',
    description: 'Run a health check on the memory store and return a text report of problems (with suggested fixes) and stats.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'memory_audit',
    description: 'List recent audit log entries (mutations, deletions, admin actions) for accountability.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Max entries' } },
    },
  },
  {
    name: 'memory_snapshot_create',
    description: 'Take a point-in-time snapshot of the whole memory store, with an optional note. Restore via the server API.',
    inputSchema: {
      type: 'object',
      properties: { note: { type: 'string', description: 'Optional note describing the snapshot' } },
    },
  },
  {
    name: 'memory_governance_delete',
    description:
      'Policy-driven bulk delete with an audit reason. Filters select the memories; dryRun previews. ' +
      'The reason is recorded in the tool output for the audit trail. For id-based deletes, use memory_batch_forget.',
    inputSchema: {
      type: 'object',
      properties: {
        ...FILTER_PROPERTIES,
        before: { type: 'string', description: 'Only memories created before this ISO 8601 timestamp' },
        dryRun: { type: 'boolean', description: 'Preview matches without deleting' },
        reason: { type: 'string', description: 'Audit reason for the deletion' },
      },
    },
  },
];

function baseUrl(): string {
  return (process.env.AGENT_RECALL_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
}

function token(): string {
  return process.env.AGENT_RECALL_TOKEN ?? '';
}

interface ApiResponse {
  status: number;
  json: unknown;
}

async function apiRaw(path: string, init?: { method?: string; body?: unknown }): Promise<ApiResponse> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      // 仅在携带 body 时声明 JSON，避免空 body DELETE 被 Fastify 以 400 拒绝
      ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }),
      authorization: `Bearer ${token()}`,
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  const json: unknown = text ? (JSON.parse(text) as unknown) : null;
  if (res.status === 401) throw new JsonRpcError(-32001, 'Unauthorized');
  return { status: res.status, json };
}

async function api(path: string, init?: { method?: string; body?: unknown }): Promise<unknown> {
  const { status, json } = await apiRaw(path, init);
  if (status < 200 || status >= 300) throw new JsonRpcError(-32603, `API ${String(status)}`);
  return json;
}

function textResult(payload: unknown): { content: Array<{ type: string; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new JsonRpcError(-32602, `${key} is required`);
  }
  return value;
}

function requiredValue(args: Record<string, unknown>, key: string): unknown {
  if (!(key in args) || args[key] === undefined) {
    throw new JsonRpcError(-32602, `${key} is required`);
  }
  return args[key];
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new JsonRpcError(-32602, `${key} must be a string`);
  return value;
}

function optionalNumber(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new JsonRpcError(-32602, `${key} must be a number`);
  }
  return value;
}

function requiredNumber(args: Record<string, unknown>, key: string): number {
  const value = optionalNumber(args, key);
  if (value === undefined) throw new JsonRpcError(-32602, `${key} is required`);
  return value;
}

function optionalBoolean(args: Record<string, unknown>, key: string): boolean | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw new JsonRpcError(-32602, `${key} must be a boolean`);
  return value;
}

function optionalStringArray(args: Record<string, unknown>, key: string): string[] | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new JsonRpcError(-32602, `${key} must be an array of strings`);
  }
  return value as string[];
}

function optionalEnum(args: Record<string, unknown>, key: string, values: readonly string[]): string | undefined {
  const value = optionalString(args, key);
  if (value === undefined) return undefined;
  if (!values.includes(value)) {
    throw new JsonRpcError(-32602, `${key} must be one of: ${values.join(', ')}`);
  }
  return value;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requiredUuid(args: Record<string, unknown>, key: string): string {
  const value = requiredString(args, key);
  if (!UUID_RE.test(value)) throw new JsonRpcError(-32602, `${key} must be a uuid`);
  return value;
}

/** Assemble a recall/search/batch-forget filter from flat tool arguments. */
function buildFilter(args: Record<string, unknown>, keys: string[]): Record<string, unknown> | undefined {
  const filter: Record<string, unknown> = {};
  for (const key of keys) {
    const value = args[key];
    if (value !== undefined && value !== null) filter[key] = value;
  }
  return Object.keys(filter).length > 0 ? filter : undefined;
}

/** Trim a memory object to the fields an agent actually needs, to save tokens. */
function slimMemory(memory: unknown, score?: number | null): unknown {
  if (typeof memory !== 'object' || memory === null) return memory;
  const m = memory as Record<string, unknown>;
  const slim: Record<string, unknown> = {
    id: m.id,
    content: m.content,
    type: m.type,
    tags: m.tags,
    project: m.project,
    sessionId: m.sessionId,
  };
  if (score !== undefined) slim.score = score;
  return slim;
}

function slimMemories(payload: unknown, scores?: unknown): unknown {
  if (typeof payload !== 'object' || payload === null) return payload;
  const p = payload as Record<string, unknown>;
  if (!Array.isArray(p.memories)) return payload;
  const scoreMap =
    typeof scores === 'object' && scores !== null ? (scores as Record<string, number | null>) : undefined;
  return {
    ...p,
    memories: p.memories.map((m) => {
      const id = typeof m === 'object' && m !== null ? (m as Record<string, unknown>).id : undefined;
      const score = scoreMap && typeof id === 'string' ? scoreMap[id] : undefined;
      return slimMemory(m, score);
    }),
  };
}

function writeBody(args: Record<string, unknown>, forcedType?: string): Record<string, unknown> {
  const body: Record<string, unknown> = { content: requiredString(args, 'content') };
  const type = forcedType ?? optionalEnum(args, 'type', MEMORY_TYPES);
  if (type !== undefined) body.type = type;
  const tags = optionalStringArray(args, 'tags');
  if (tags !== undefined) body.tags = tags;
  const project = optionalString(args, 'project');
  if (project !== undefined) body.project = project;
  const expiresAt = optionalString(args, 'expiresAt');
  if (expiresAt !== undefined) body.expiresAt = expiresAt;
  return body;
}

/** Build a /api/kv path with URI-encoded namespace and key segments. */
function kvPath(ns: string, key?: string): string {
  const base = `/api/kv/${encodeURIComponent(ns)}`;
  return key === undefined ? base : `${base}/${encodeURIComponent(key)}`;
}

/** Extract the `value` field of a KV entry payload ({entry: {value}}), if present. */
function kvEntryValue(payload: unknown): unknown {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const entry = (payload as Record<string, unknown>).entry;
  if (typeof entry !== 'object' || entry === null) return undefined;
  return (entry as Record<string, unknown>).value;
}

/**
 * GET /api/memories/:id returns `{ memory }`. Tools that read fields
 * (type, content, tags) need the inner object, not the envelope.
 */
function unwrapMemory(payload: unknown): Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null) {
    throw new JsonRpcError(-32603, 'memory payload is empty');
  }
  const record = payload as Record<string, unknown>;
  const nested = record.memory;
  if (typeof nested === 'object' && nested !== null) return nested as Record<string, unknown>;
  return record;
}

function hasMemories(payload: unknown): boolean {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    Array.isArray((payload as Record<string, unknown>).memories) &&
    ((payload as Record<string, unknown>).memories as unknown[]).length > 0
  );
}

async function recallBody(args: Record<string, unknown>, extraFilter?: Record<string, unknown>): Promise<unknown> {
  const query = requiredString(args, 'query');
  const body: Record<string, unknown> = { query };
  const limit = optionalNumber(args, 'limit');
  if (limit !== undefined) body.limit = limit;
  const filter = extraFilter ?? buildFilter(args, ['origin', 'type', 'tags', 'project']);
  if (filter) body.filter = filter;
  const result = await api('/api/memories/recall', { method: 'POST', body });
  return slimMemories(result);
}

// ---- client-side file helpers -----------------------------------------------

const FORBIDDEN_PATH_PREFIXES = ['/etc', '/usr', '/system', 'c:\\windows'];
const MAX_FILE_BYTES = 200 * 1024;

/** Resolve a user-supplied path and refuse protected system directories. */
function resolveSafePath(input: string): string {
  const resolved = nodePath.resolve(input);
  const lower = resolved.toLowerCase();
  for (const prefix of FORBIDDEN_PATH_PREFIXES) {
    if (lower === prefix || lower.startsWith(prefix + nodePath.sep)) {
      throw new JsonRpcError(-32602, `path points to a protected system directory: ${input}`);
    }
  }
  return resolved;
}

/** Read a UTF-8 file, truncating to MAX_FILE_BYTES. Returns [text, truncated]. */
async function readFileCapped(path: string): Promise<[string, boolean]> {
  const buf = await readFile(path);
  if (buf.byteLength <= MAX_FILE_BYTES) return [buf.toString('utf8'), false];
  return [buf.subarray(0, MAX_FILE_BYTES).toString('utf8'), true];
}

async function callTool(params: Record<string, unknown>): Promise<unknown> {
  const name = params.name;
  const args =
    typeof params.arguments === 'object' && params.arguments !== null
      ? (params.arguments as Record<string, unknown>)
      : {};

  switch (name) {
    case 'memory_save':
    case 'memory_remember':
      return textResult(await api('/api/memories', { method: 'POST', body: writeBody(args) }));

    case 'memory_lesson_save':
      return textResult(await api('/api/memories', { method: 'POST', body: writeBody(args, 'lesson') }));

    case 'memory_recall':
      return textResult(await recallBody(args));

    case 'memory_smart_search': {
      const query = requiredString(args, 'query');
      const body: Record<string, unknown> = { query };
      const limit = optionalNumber(args, 'limit');
      if (limit !== undefined) body.limit = limit;
      const filter = buildFilter(args, ['origin', 'type', 'tags', 'project']);
      if (filter) body.filter = filter;
      const result = await api('/api/memories/smart-search', { method: 'POST', body });
      const scores =
        typeof result === 'object' && result !== null
          ? (result as Record<string, unknown>).scores
          : undefined;
      return textResult(slimMemories(result, scores));
    }

    case 'memory_list': {
      const params = new URLSearchParams();
      const limit = optionalNumber(args, 'limit');
      if (limit !== undefined) params.set('limit', String(limit));
      const offset = optionalNumber(args, 'offset');
      if (offset !== undefined) params.set('offset', String(offset));
      const origin = optionalEnum(args, 'origin', MEMORY_ORIGINS);
      if (origin !== undefined) params.set('origin', origin);
      const type = optionalEnum(args, 'type', MEMORY_TYPES);
      if (type !== undefined) params.set('type', type);
      const tags = optionalStringArray(args, 'tags');
      if (tags !== undefined) params.set('tags', tags.join(','));
      const project = optionalString(args, 'project');
      if (project !== undefined) params.set('project', project);
      const sessionId = optionalString(args, 'sessionId');
      if (sessionId !== undefined) params.set('sessionId', sessionId);
      const qs = params.toString();
      return textResult(await api(`/api/memories${qs ? `?${qs}` : ''}`));
    }

    case 'memory_get': {
      const id = requiredUuid(args, 'id');
      return textResult(await api(`/api/memories/${id}`));
    }

    case 'memory_update': {
      const id = requiredUuid(args, 'id');
      const body: Record<string, unknown> = { content: requiredString(args, 'content') };
      const type = optionalEnum(args, 'type', MEMORY_TYPES);
      if (type !== undefined) body.type = type;
      const tags = optionalStringArray(args, 'tags');
      if (tags !== undefined) body.tags = tags;
      const expiresAt = optionalString(args, 'expiresAt');
      if (expiresAt !== undefined) body.expiresAt = expiresAt;
      return textResult(await api(`/api/memories/${id}`, { method: 'PATCH', body }));
    }

    case 'memory_forget': {
      const id = requiredUuid(args, 'id');
      await api(`/api/memories/${id}`, { method: 'DELETE' });
      return textResult({ id, deleted: true });
    }

    case 'memory_batch_forget': {
      const body: Record<string, unknown> = {};
      const ids = optionalStringArray(args, 'ids');
      if (ids !== undefined) {
        for (const id of ids) {
          if (!UUID_RE.test(id)) throw new JsonRpcError(-32602, 'ids must contain only uuids');
        }
        body.ids = ids;
      }
      const filter = buildFilter(args, ['origin', 'type', 'tags', 'project', 'sessionId']);
      if (filter) body.filter = filter;
      if (ids === undefined && !filter) {
        throw new JsonRpcError(-32602, 'memory_batch_forget requires ids or at least one filter field');
      }
      const dryRun = optionalBoolean(args, 'dryRun');
      if (dryRun !== undefined) body.dryRun = dryRun;
      return textResult(await api('/api/memories/batch-forget', { method: 'POST', body }));
    }

    case 'memory_versions': {
      const id = requiredUuid(args, 'id');
      return textResult(await api(`/api/memories/${id}/versions`));
    }

    case 'memory_stats':
      return textResult(await api('/api/memories/stats'));

    case 'memory_export':
      return textResult(await api('/api/memories/export'));

    case 'memory_import': {
      const memories = args.memories;
      if (!Array.isArray(memories) || memories.length === 0) {
        throw new JsonRpcError(-32602, 'memories is required and must be a non-empty array');
      }
      const body: Record<string, unknown> = { memories };
      const strategy = optionalEnum(args, 'strategy', IMPORT_STRATEGIES);
      if (strategy !== undefined) body.strategy = strategy;
      return textResult(await api('/api/memories/import', { method: 'POST', body }));
    }

    case 'memory_sessions':
      return textResult(await api('/api/sessions'));

    case 'memory_session_timeline': {
      const sessionId = requiredString(args, 'sessionId');
      return textResult(await api(`/api/sessions/${encodeURIComponent(sessionId)}`));
    }

    case 'memory_auto_forget': {
      const body: Record<string, unknown> = {};
      const dryRun = optionalBoolean(args, 'dryRun');
      if (dryRun !== undefined) body.dryRun = dryRun;
      return textResult(await api('/api/memories/auto-forget', { method: 'POST', body }));
    }

    case 'memory_context': {
      const query = requiredString(args, 'query');
      const body: Record<string, unknown> = { query };
      const tokenBudget = optionalNumber(args, 'tokenBudget');
      if (tokenBudget !== undefined) body.tokenBudget = tokenBudget;
      const project = optionalString(args, 'project');
      if (project !== undefined) body.project = project;
      return textResult(await api('/api/hooks/context', { method: 'POST', body }));
    }

    // ---- Capture -----------------------------------------------------------

    case 'memory_sketch_create': {
      const body: Record<string, unknown> = {
        content: requiredString(args, 'content'),
        type: 'fact',
        tags: ['sketch'],
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      };
      const sessionId = optionalString(args, 'sessionId');
      if (sessionId !== undefined) body.sessionId = sessionId;
      const project = optionalString(args, 'project');
      if (project !== undefined) body.project = project;
      return textResult(await api('/api/memories', { method: 'POST', body }));
    }

    case 'memory_sketch_promote': {
      const id = requiredUuid(args, 'id');
      const current = unwrapMemory(await api(`/api/memories/${id}`));
      const tags = Array.isArray(current.tags) ? (current.tags as unknown[]).filter((t) => t !== 'sketch') : [];
      const body: Record<string, unknown> = {
        content: current.content,
        tags,
        expiresAt: null,
      };
      return textResult(await api(`/api/memories/${id}`, { method: 'PATCH', body }));
    }

    case 'memory_compress_file': {
      const inputPath = requiredString(args, 'path');
      const filePath = resolveSafePath(inputPath);
      const [text, truncated] = await readFileCapped(filePath);
      const outline = text
        .split('\n')
        .filter((line) => /^\s*(export\s|function\s|class\s|#+\s)/.test(line))
        .slice(0, 80)
        .join('\n');
      const body: Record<string, unknown> = {
        content: `文件摘要 ${inputPath}${truncated ? ' (truncated to 200KB)' : ''}\n${outline}`,
        type: 'pattern',
        tags: ['file-summary'],
      };
      const project = optionalString(args, 'project');
      if (project !== undefined) body.project = project;
      return textResult(await api('/api/memories', { method: 'POST', body }));
    }

    case 'memory_claude_bridge_sync': {
      const direction = optionalEnum(args, 'direction', ['from', 'to']);
      if (direction === undefined) throw new JsonRpcError(-32602, 'direction is required');
      const filePath = resolveSafePath(optionalString(args, 'path') ?? './MEMORY.md');
      if (direction === 'from') {
        const [text] = await readFileCapped(filePath);
        const entries = text
          .split('\n')
          .map((line) => {
            const bullet = /^-\s+(.*)$/.exec(line);
            if (bullet) return bullet[1].trim();
            const heading = /^##\s+(.*)$/.exec(line);
            if (heading) return heading[1].trim();
            return null;
          })
          .filter((entry): entry is string => entry !== null && entry.length > 0);
        if (entries.length === 0) throw new JsonRpcError(-32602, 'no importable entries found in the file');
        const body = {
          memories: entries.map((content) => ({ content, tags: ['claude-bridge'] })),
          strategy: 'skip',
        };
        const result = await api('/api/memories/import', { method: 'POST', body });
        return textResult({ direction, path: filePath, entries: entries.length, result });
      }
      const result = (await api('/api/memories?tags=claude-bridge&limit=500')) as Record<string, unknown>;
      const memories = Array.isArray(result.memories) ? (result.memories as Array<Record<string, unknown>>) : [];
      const markdown = ['# Memory', '', ...memories.map((m) => `- ${String(m.content ?? '')}`), ''].join('\n');
      await mkdir(nodePath.dirname(filePath), { recursive: true });
      await writeFile(filePath, markdown, 'utf8');
      return textResult({ direction, path: filePath, written: memories.length });
    }

    case 'memory_checkpoint': {
      const checkpointName = requiredString(args, 'name');
      const state = requiredValue(args, 'state');
      return textResult(await api(kvPath('checkpoints', checkpointName), { method: 'PUT', body: { value: state } }));
    }

    // ---- KV state ----------------------------------------------------------

    case 'memory_signal_send': {
      const signalName = requiredString(args, 'name');
      const body = { value: { data: args.data ?? null, at: new Date().toISOString() } };
      return textResult(await api(`${kvPath('signals', signalName)}/append`, { method: 'POST', body }));
    }

    case 'memory_signal_read': {
      const signalName = optionalString(args, 'name');
      return textResult(await api(signalName === undefined ? kvPath('signals') : kvPath('signals', signalName)));
    }

    case 'memory_action_create': {
      const title = requiredString(args, 'title');
      const detail = optionalString(args, 'detail');
      const id = randomUUID();
      const body = { value: { title, detail: detail ?? null, status: 'open' } };
      await api(kvPath('actions', id), { method: 'PUT', body });
      return textResult({ id, title, status: 'open' });
    }

    case 'memory_action_update': {
      const id = requiredUuid(args, 'id');
      const status = optionalEnum(args, 'status', ['open', 'done', 'blocked']);
      if (status === undefined) throw new JsonRpcError(-32602, 'status is required');
      const existing = await api(kvPath('actions', id));
      const value = kvEntryValue(existing);
      const merged = { ...(typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}), status };
      await api(kvPath('actions', id), { method: 'PUT', body: { value: merged } });
      return textResult({ id, ...merged });
    }

    case 'memory_sentinel_create': {
      const sentinelName = requiredString(args, 'name');
      const condition = requiredString(args, 'condition');
      const body = { value: { condition, fires: [] } };
      return textResult(await api(kvPath('sentinels', sentinelName), { method: 'PUT', body }));
    }

    case 'memory_sentinel_trigger': {
      const sentinelName = requiredString(args, 'name');
      const note = optionalString(args, 'note');
      const existing = await api(kvPath('sentinels', sentinelName));
      const value = kvEntryValue(existing);
      const sentinel =
        typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : { condition: null };
      const fires = Array.isArray(sentinel.fires) ? (sentinel.fires as unknown[]) : [];
      fires.push({ note: note ?? null, at: new Date().toISOString() });
      const body = { value: { ...sentinel, fires } };
      return textResult(await api(kvPath('sentinels', sentinelName), { method: 'PUT', body }));
    }

    case 'memory_slot_create':
    case 'memory_slot_replace': {
      const slotName = requiredString(args, 'name');
      const value = requiredValue(args, 'value');
      return textResult(await api(kvPath('slots', slotName), { method: 'PUT', body: { value } }));
    }

    case 'memory_slot_append': {
      const slotName = requiredString(args, 'name');
      const value = requiredValue(args, 'value');
      return textResult(await api(`${kvPath('slots', slotName)}/append`, { method: 'POST', body: { value } }));
    }

    case 'memory_slot_get': {
      const slotName = requiredString(args, 'name');
      return textResult(await api(kvPath('slots', slotName)));
    }

    case 'memory_slot_list':
      return textResult(await api(kvPath('slots')));

    case 'memory_slot_delete': {
      const slotName = requiredString(args, 'name');
      await api(kvPath('slots', slotName), { method: 'DELETE' });
      return textResult({ name: slotName, deleted: true });
    }

    case 'memory_profile': {
      const key = optionalString(args, 'key');
      const hasValue = 'value' in args && args.value !== undefined;
      if (key === undefined) {
        if (hasValue) throw new JsonRpcError(-32602, 'value requires key');
        return textResult(await api(kvPath('profile')));
      }
      if (!hasValue) return textResult(await api(kvPath('profile', key)));
      return textResult(await api(kvPath('profile', key), { method: 'PUT', body: { value: args.value } }));
    }

    case 'memory_lease': {
      const leaseName = requiredString(args, 'name');
      const ttlSeconds = requiredNumber(args, 'ttlSeconds');
      const body = { value: { holder: 'mcp' }, ttlSeconds, ifAbsent: true };
      const { status, json } = await apiRaw(kvPath('leases', leaseName), { method: 'PUT', body });
      if (status === 409) {
        const holder =
          typeof json === 'object' && json !== null ? (json as Record<string, unknown>).entry ?? json : json;
        return textResult({ acquired: false, holder });
      }
      if (status < 200 || status >= 300) throw new JsonRpcError(-32603, `API ${String(status)}`);
      return textResult({ acquired: true, entry: typeof json === 'object' && json !== null ? (json as Record<string, unknown>).entry ?? json : json });
    }

    case 'memory_routine_run': {
      const routineName = requiredString(args, 'name');
      const { status, json } = await apiRaw(kvPath('routines', routineName));
      if (status === 404) throw new JsonRpcError(-32602, 'routine not found');
      if (status < 200 || status >= 300) throw new JsonRpcError(-32603, `API ${String(status)}`);
      const value = kvEntryValue(json);
      if (typeof value === 'object' && value !== null && 'steps' in (value as Record<string, unknown>)) {
        return textResult({ name: routineName, steps: (value as Record<string, unknown>).steps });
      }
      return textResult({ name: routineName, value });
    }

    // ---- Retrieval ---------------------------------------------------------

    case 'memory_lesson_recall':
      return textResult(await recallBody(args, { type: ['lesson'] }));

    case 'memory_lesson_delete': {
      const id = requiredUuid(args, 'id');
      const memory = unwrapMemory(await api(`/api/memories/${id}`));
      if (memory.type !== 'lesson') {
        throw new JsonRpcError(-32602, `memory ${id} is not a lesson (type: ${String(memory.type)})`);
      }
      await api(`/api/memories/${id}`, { method: 'DELETE' });
      return textResult({ id, deleted: true });
    }

    case 'memory_patterns': {
      const query = optionalString(args, 'query');
      if (query !== undefined) return textResult(await recallBody(args, { type: ['pattern'] }));
      return textResult(slimMemories(await api('/api/memories?type=pattern')));
    }

    case 'memory_insight_list': {
      const limit = optionalNumber(args, 'limit');
      const qs = `type=lesson,pattern${limit !== undefined ? `&limit=${String(limit)}` : ''}`;
      return textResult(slimMemories(await api(`/api/memories?${qs}`)));
    }

    case 'memory_timeline': {
      const sessionId = optionalString(args, 'sessionId');
      if (sessionId !== undefined) {
        return textResult(await api(`/api/sessions/${encodeURIComponent(sessionId)}`));
      }
      const params = new URLSearchParams();
      const createdAfter = optionalString(args, 'createdAfter');
      if (createdAfter !== undefined) params.set('createdAfter', createdAfter);
      const createdBefore = optionalString(args, 'createdBefore');
      if (createdBefore !== undefined) params.set('createdBefore', createdBefore);
      const limit = optionalNumber(args, 'limit');
      if (limit !== undefined) params.set('limit', String(limit));
      const qs = params.toString();
      return textResult(slimMemories(await api(`/api/memories${qs ? `?${qs}` : ''}`)));
    }

    case 'memory_frontier': {
      const limit = optionalNumber(args, 'limit') ?? 10;
      return textResult(slimMemories(await api(`/api/memories?limit=${String(limit)}`)));
    }

    case 'memory_next': {
      const [actionsPayload, sessionsPayload, memoriesPayload] = await Promise.all([
        api(kvPath('actions')),
        api('/api/sessions'),
        api('/api/memories?limit=5'),
      ]);
      const entries =
        typeof actionsPayload === 'object' && actionsPayload !== null && Array.isArray((actionsPayload as Record<string, unknown>).entries)
          ? ((actionsPayload as Record<string, unknown>).entries as Array<Record<string, unknown>>)
          : [];
      const openActions = entries.filter((e) => {
        const value = e.value;
        return typeof value === 'object' && value !== null && (value as Record<string, unknown>).status === 'open';
      });
      const sessions = Array.isArray(sessionsPayload)
        ? (sessionsPayload as Array<Record<string, unknown>>)
        : typeof sessionsPayload === 'object' && sessionsPayload !== null && Array.isArray((sessionsPayload as Record<string, unknown>).sessions)
          ? ((sessionsPayload as Record<string, unknown>).sessions as Array<Record<string, unknown>>)
          : [];
      const memories =
        typeof memoriesPayload === 'object' && memoriesPayload !== null && Array.isArray((memoriesPayload as Record<string, unknown>).memories)
          ? ((memoriesPayload as Record<string, unknown>).memories as Array<Record<string, unknown>>)
          : [];
      const lines: string[] = [];
      lines.push(`Open actions (${String(openActions.length)}):`);
      for (const action of openActions) {
        const value = action.value as Record<string, unknown>;
        lines.push(`- [${String(action.key ?? '')}] ${String(value.title ?? '')}`);
      }
      if (openActions.length === 0) lines.push('- (none)');
      lines.push('');
      const latest = sessions[0];
      lines.push(
        latest === undefined
          ? 'Latest session: (none)'
          : `Latest session: ${String(latest.id ?? latest.sessionId ?? '')} (memories: ${String(latest.count ?? latest.memoryCount ?? '?')})`,
      );
      lines.push('');
      lines.push('Recent memories:');
      for (const memory of memories) {
        lines.push(`- (${String(memory.type ?? 'fact')}) ${String(memory.content ?? '').slice(0, 120)}`);
      }
      if (memories.length === 0) lines.push('- (none)');
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    case 'memory_graph_query': {
      const query = requiredString(args, 'query');
      const params = new URLSearchParams({ q: query });
      const limit = optionalNumber(args, 'limit');
      if (limit !== undefined) params.set('limit', String(limit));
      return textResult(await api(`/api/graph/query?${params.toString()}`));
    }

    case 'memory_relations': {
      const id = requiredUuid(args, 'id');
      return textResult(await api(`/api/memories/${id}/relations`));
    }

    case 'memory_facet_query': {
      const dimension = requiredString(args, 'dimension');
      const value = requiredString(args, 'value');
      const tag = `${dimension}:${value}`;
      return textResult(slimMemories(await api(`/api/memories?tags=${encodeURIComponent(tag)}`)));
    }

    case 'memory_facet_tag': {
      const id = requiredUuid(args, 'id');
      const dimension = requiredString(args, 'dimension');
      const value = requiredString(args, 'value');
      const facet = `${dimension}:${value}`;
      const current = unwrapMemory(await api(`/api/memories/${id}`));
      const tags = Array.isArray(current.tags) ? (current.tags as string[]) : [];
      if (!tags.includes(facet)) tags.push(facet);
      const body = { content: current.content, tags };
      return textResult(await api(`/api/memories/${id}`, { method: 'PATCH', body }));
    }

    case 'memory_verify': {
      const id = requiredUuid(args, 'id');
      const { status, json } = await apiRaw(`/api/memories/${id}`);
      if (status === 404) {
        return { content: [{ type: 'text', text: `exists: false\nid: ${id}` }] };
      }
      if (status < 200 || status >= 300) throw new JsonRpcError(-32603, `API ${String(status)}`);
      const memory = unwrapMemory(json);
      let isLatest: boolean | undefined;
      try {
        const versionsPayload = (await api(`/api/memories/${id}/versions`)) as Record<string, unknown>;
        const versions = Array.isArray(versionsPayload)
          ? (versionsPayload as Array<Record<string, unknown>>)
          : Array.isArray(versionsPayload.versions)
            ? (versionsPayload.versions as Array<Record<string, unknown>>)
            : [];
        if (versions.length > 0) isLatest = versions[versions.length - 1].id === id;
      } catch {
        isLatest = undefined;
      }
      const createdAt = typeof memory.createdAt === 'string' ? new Date(memory.createdAt) : undefined;
      const ageMs = createdAt && !Number.isNaN(createdAt.getTime()) ? Date.now() - createdAt.getTime() : undefined;
      const ageText =
        ageMs === undefined ? 'unknown' : `${String(Math.floor(ageMs / 86_400_000))}d ${String(Math.floor((ageMs % 86_400_000) / 3_600_000))}h`;
      const expiresAt = typeof memory.expiresAt === 'string' ? memory.expiresAt : null;
      const expired = expiresAt !== null && new Date(expiresAt).getTime() < Date.now();
      const lines = [
        'exists: true',
        `id: ${id}`,
        `type: ${String(memory.type ?? '')}`,
        `version: ${String(memory.version ?? '?')}${isLatest === undefined ? '' : isLatest ? ' (latest)' : ' (superseded)'}`,
        `age: ${ageText}`,
        `accessCount: ${String(memory.accessCount ?? '?')}`,
        `expiresAt: ${expiresAt ?? 'permanent'}${expiresAt === null ? '' : expired ? ' (EXPIRED)' : ' (valid)'}`,
      ];
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    case 'memory_commit_lookup': {
      const sha = requiredString(args, 'sha');
      const result = await api('/api/memories/recall', { method: 'POST', body: { query: sha, limit: 5 } });
      return textResult(slimMemories(result));
    }

    case 'memory_commits': {
      const query = optionalString(args, 'query') ?? 'commit';
      let result = await api('/api/memories/recall', {
        method: 'POST',
        body: { query, filter: { tags: ['commit'] } },
      });
      if (!hasMemories(result)) {
        result = await api('/api/memories/recall', { method: 'POST', body: { query } });
      }
      return textResult(slimMemories(result));
    }

    case 'memory_file_history': {
      const filePath = requiredString(args, 'path');
      let result = await api('/api/memories/recall', {
        method: 'POST',
        body: { query: filePath, filter: { tags: ['file-summary'] } },
      });
      if (!hasMemories(result)) {
        result = await api('/api/memories/recall', { method: 'POST', body: { query: filePath } });
      }
      return textResult(slimMemories(result));
    }

    case 'memory_vision_search':
      return textResult(await recallBody(args, { tags: ['vision'] }));

    // ---- Sharing -----------------------------------------------------------

    case 'memory_mesh_sync': {
      const peerUrl = requiredString(args, 'peerUrl');
      const peerToken = requiredString(args, 'peerToken');
      const body: Record<string, unknown> = { peerUrl, peerToken };
      const strategy = optionalEnum(args, 'strategy', IMPORT_STRATEGIES);
      if (strategy !== undefined) body.strategy = strategy;
      return textResult(await api('/api/mesh/sync', { method: 'POST', body }));
    }

    case 'memory_team_share': {
      const id = requiredUuid(args, 'id');
      const email = requiredString(args, 'email');
      return textResult(await api(`/api/memories/${id}/share`, { method: 'POST', body: { email } }));
    }

    case 'memory_team_feed':
      return textResult(slimMemories(await api('/api/memories/shared-feed')));

    case 'memory_obsidian_export': {
      const dir = resolveSafePath(requiredString(args, 'dir'));
      const bundle = (await api('/api/memories/export')) as Record<string, unknown>;
      const memories = Array.isArray(bundle)
        ? (bundle as Array<Record<string, unknown>>)
        : Array.isArray(bundle.memories)
          ? (bundle.memories as Array<Record<string, unknown>>)
          : [];
      await mkdir(dir, { recursive: true });
      let written = 0;
      for (const memory of memories) {
        const id = typeof memory.id === 'string' && UUID_RE.test(memory.id) ? memory.id : randomUUID();
        const tags = Array.isArray(memory.tags) ? (memory.tags as unknown[]).map(String) : [];
        const frontmatter = [
          '---',
          `id: ${id}`,
          `type: ${String(memory.type ?? 'fact')}`,
          `tags: [${tags.map((t) => JSON.stringify(t)).join(', ')}]`,
          `createdAt: ${String(memory.createdAt ?? '')}`,
          '---',
          '',
        ].join('\n');
        await writeFile(nodePath.join(dir, `${id}.md`), `${frontmatter}${String(memory.content ?? '')}\n`, 'utf8');
        written += 1;
      }
      return textResult({ dir, written });
    }

    // ---- Maintenance -------------------------------------------------------

    case 'memory_crystallize': {
      const sessionId = requiredString(args, 'sessionId');
      return textResult(await api(`/api/sessions/${encodeURIComponent(sessionId)}/crystallize`, { method: 'POST' }));
    }

    case 'memory_reflect': {
      const body: Record<string, unknown> = {};
      const days = optionalNumber(args, 'days');
      if (days !== undefined) body.days = days;
      const project = optionalString(args, 'project');
      if (project !== undefined) body.project = project;
      return textResult(await api('/api/memories/reflect', { method: 'POST', body }));
    }

    case 'memory_consolidate': {
      const body: Record<string, unknown> = {};
      const dryRun = optionalBoolean(args, 'dryRun');
      if (dryRun !== undefined) body.dryRun = dryRun;
      return textResult(await api('/api/memories/consolidate', { method: 'POST', body }));
    }

    case 'memory_heal':
      return textResult(await api('/api/admin/heal', { method: 'POST' }));

    case 'memory_diagnose': {
      const report = (await api('/api/admin/diagnose')) as Record<string, unknown>;
      const lines: string[] = [`ok: ${String(report.ok ?? false)}`];
      const problems = Array.isArray(report.problems) ? (report.problems as unknown[]) : [];
      lines.push(`problems (${String(problems.length)}):`);
      for (const problem of problems) {
        if (typeof problem === 'string') {
          lines.push(`- ${problem}`);
        } else if (typeof problem === 'object' && problem !== null) {
          const p = problem as Record<string, unknown>;
          const message = String(p.message ?? p.problem ?? JSON.stringify(p));
          const fix = p.fix === undefined ? '' : ` (fix: ${String(p.fix)})`;
          lines.push(`- ${message}${fix}`);
        }
      }
      if (problems.length === 0) lines.push('- (none)');
      lines.push(`stats: ${JSON.stringify(report.stats ?? null)}`);
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    case 'memory_audit': {
      const limit = optionalNumber(args, 'limit');
      const qs = limit !== undefined ? `?limit=${String(limit)}` : '';
      return textResult(await api(`/api/audit${qs}`));
    }

    case 'memory_snapshot_create': {
      const body: Record<string, unknown> = {};
      const note = optionalString(args, 'note');
      if (note !== undefined) body.note = note;
      return textResult(await api('/api/snapshots', { method: 'POST', body }));
    }

    case 'memory_governance_delete': {
      const filter = buildFilter(args, ['origin', 'type', 'tags', 'project', 'before']);
      if (!filter) {
        throw new JsonRpcError(-32602, 'memory_governance_delete requires at least one filter field');
      }
      const body: Record<string, unknown> = { filter };
      const dryRun = optionalBoolean(args, 'dryRun');
      if (dryRun !== undefined) body.dryRun = dryRun;
      const result = await api('/api/memories/batch-forget', { method: 'POST', body });
      const reason = optionalString(args, 'reason');
      return textResult({ reason: reason ?? null, result });
    }

    default:
      throw new JsonRpcError(-32602, `Unknown tool: ${String(name)}`);
  }
}

/**
 * 工具面 profile（AGENT_RECALL_MCP_PROFILE）：控制 tools/list 暴露的子集，
 * 避免 66 个工具 schema（≈29KB / 8k tokens）常驻宿主上下文。
 * - core：12 个日常工具（≈5KB）
 * - standard：core + 生命周期/会话/治理（25 个）
 * - full：全部 66 个（默认，保持兼容）
 * 被 profile 隐藏的工具在 tools/call 时报错并提示切换方式。
 */
const CORE_TOOL_NAMES = [
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
];

const STANDARD_EXTRA_NAMES = [
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
];

type ToolProfile = 'core' | 'standard' | 'full';

function profile(): ToolProfile {
  const raw = (process.env.AGENT_RECALL_MCP_PROFILE ?? 'full').trim().toLowerCase();
  return raw === 'core' || raw === 'standard' ? raw : 'full';
}

function visibleToolNames(): Set<string> {
  const p = profile();
  if (p === 'full') return new Set(TOOLS.map((tool) => tool.name));
  const names = new Set(CORE_TOOL_NAMES);
  if (p === 'standard') for (const name of STANDARD_EXTRA_NAMES) names.add(name);
  return names;
}

function visibleTools(): typeof TOOLS {
  const names = visibleToolNames();
  return TOOLS.filter((tool) => names.has(tool.name));
}

async function handle(method: string, params: Record<string, unknown>): Promise<unknown> {  if (method === 'initialize') {
    const protocolVersion = typeof params.protocolVersion === 'string' ? params.protocolVersion : '2024-11-05';
    return {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'agent-recall', version: '0.3.0' },
    };
  }
  if (method === 'notifications/initialized' || method === 'initialized') return {};
  if (method === 'tools/list') {
    await api('/api/auth/me');
    return { tools: visibleTools() };
  }
  if (method === 'tools/call') {
    await api('/api/auth/me');
    const name = typeof params.name === 'string' ? params.name : '';
    if (!visibleToolNames().has(name)) {
      throw new JsonRpcError(
        -32602,
        `Tool ${name} is hidden by AGENT_RECALL_MCP_PROFILE=${profile()}; set AGENT_RECALL_MCP_PROFILE=full to enable it`,
      );
    }
    return callTool(params);
  }
  throw new JsonRpcError(-32601, `Method not found: ${method}`);
}

createStdioTransport((method, params) => handle(method, params)).start();
