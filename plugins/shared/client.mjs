// Shared client for agent-recall host plugins (Claude Code, Codex CLI).
// Pure Node ESM, zero dependencies. Evolved from hooks/lib.mjs.
//
// Server contract:
//   POST /api/hooks/events  {eventId, hook, content, sessionId?, project?, toolName?, type?}
//   POST /api/hooks/context {query, tokenBudget?, sessionId?, project?} -> {context, memories}
//
// Env:
//   AGENT_RECALL_URL          default http://127.0.0.1:8787
//   AGENT_RECALL_TOKEN        bearer token
//   AGENT_RECALL_SPOOL_DIR    default ~/.agent-recall/spool
//   AGENT_RECALL_TOKEN_BUDGET optional tokenBudget for /context
//   AGENT_RECALL_DISABLED     "1"/"true" short-circuits every hook
//   AGENT_RECALL_PROJECT      explicit project name override

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

export const DEFAULT_URL = 'http://127.0.0.1:8787';
export const REQUEST_TIMEOUT_MS = 2000;

const HOST_ID_FIELDS = [
  'event_id',
  'eventId',
  'tool_use_id',
  'toolUseId',
  'tool_call_id',
  'toolCallId',
  'call_id',
  'callId',
  'prompt_id',
  'promptId',
  'message_id',
  'messageId',
];

export function isDisabled(env) {
  return /^(1|true|yes)$/i.test(String(env.AGENT_RECALL_DISABLED ?? '').trim());
}

export function baseUrl(env) {
  const raw = String(env.AGENT_RECALL_URL ?? '').trim();
  return (raw || DEFAULT_URL).replace(/\/+$/, '');
}

export function stableStringify(value) {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? 'null' : encoded;
  }
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const keys = Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function digest(parts) {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 32);
}

function hostId(payload) {
  for (const field of HOST_ID_FIELDS) {
    const value = payload?.[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

export function sessionIdOf(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  for (const field of ['session_id', 'sessionId', 'conversation_id', 'conversationId']) {
    const value = source[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return 'unknown';
}

export function cwdOf(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  if (typeof source.cwd === 'string' && source.cwd.trim()) return source.cwd.trim();
  const roots = source.workspace_roots;
  if (Array.isArray(roots)) {
    for (const root of roots) {
      if (typeof root === 'string' && root.trim()) return root.trim();
    }
  }
  return process.cwd();
}

export function resolveProject(cwd, env) {
  const explicit = typeof env.AGENT_RECALL_PROJECT === 'string' ? env.AGENT_RECALL_PROJECT.trim() : '';
  if (explicit) return explicit;
  const dir = cwd && cwd.trim() ? cwd.trim() : process.cwd();
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
      timeout: 500,
    }).trim();
    if (top) return basename(top);
  } catch {
    // not a git repo
  }
  return basename(dir) || dir;
}

// eventId must match ^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$ — evh_/evc_ + 32 hex chars qualifies.
export function deriveEventId(hook, payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const sessionId = sessionIdOf(source);
  const id = hostId(source);
  if (id) return `evh_${digest(['host', sessionId, hook, id])}`;
  return `evc_${digest(['content', sessionId, hook, stableStringify(source)])}`;
}

export function truncate(value, max = 2000) {
  let text;
  if (typeof value === 'string') text = value;
  else {
    try {
      text = stableStringify(value ?? '');
    } catch {
      text = '';
    }
  }
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…[truncated]`;
}

// --- spool -----------------------------------------------------------------

export function spoolFile(env) {
  const configured = typeof env.AGENT_RECALL_SPOOL_DIR === 'string' ? env.AGENT_RECALL_SPOOL_DIR.trim() : '';
  const dir = configured || join(homedir(), '.agent-recall', 'spool');
  return join(dir, 'events.jsonl');
}

export function readSpool(env) {
  const file = spoolFile(env);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

function writeSpool(env, records) {
  const file = spoolFile(env);
  mkdirSync(dirname(file), { recursive: true });
  const body = records.map((record) => JSON.stringify(record)).join('\n');
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, body.length > 0 ? `${body}\n` : '', 'utf8');
  renameSync(tmp, file);
}

export function appendSpool(env, record) {
  const existing = readSpool(env);
  if (existing.some((item) => item.eventId === record.eventId)) return false;
  existing.push(record);
  writeSpool(env, existing);
  return true;
}

// --- HTTP -------------------------------------------------------------------

function authHeaders(env) {
  const headers = { 'content-type': 'application/json' };
  const token = String(env.AGENT_RECALL_TOKEN ?? '').trim();
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

export async function postEvent(env, record, fetchImpl = fetch) {
  const body = {
    eventId: record.eventId,
    hook: record.hook,
    content: record.content,
  };
  if (record.sessionId && record.sessionId !== 'unknown') body.sessionId = record.sessionId;
  if (record.project) body.project = record.project;
  if (record.toolName) body.toolName = record.toolName;
  if (record.type) body.type = record.type;
  return fetchImpl(`${baseUrl(env)}/api/hooks/events`, {
    method: 'POST',
    headers: authHeaders(env),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

// Delivers one event; on network failure or 5xx, spools it for drain.
// 4xx (validation, dedup rejection) is terminal and not spooled.
export async function deliverEvent({ hook, payload, env, content, toolName, type, sessionId, project, eventId, fetchImpl }) {
  const sid = sessionId ?? sessionIdOf(payload);
  const id = eventId ?? deriveEventId(hook, payload);
  const record = {
    v: 1,
    eventId: id,
    hook,
    content,
    sessionId: sid,
    project,
    toolName,
    type,
    spooledAt: new Date().toISOString(),
  };
  try {
    const res = await postEvent(env, record, fetchImpl);
    if (res.status >= 500) throw new Error(`status ${String(res.status)}`);
    if (res.status >= 400) return { status: 'rejected', eventId: id, httpStatus: res.status };
    return { status: 'delivered', eventId: id, httpStatus: res.status };
  } catch {
    appendSpool(env, record);
    return { status: 'spooled', eventId: id };
  }
}

// Read-only context fetch. Never spooled; failure returns null so the host
// simply injects nothing.
export async function fetchContext(env, { query, sessionId, project }, fetchImpl = fetch) {
  const body = { query: String(query ?? '') };
  const budget = Number.parseInt(String(env.AGENT_RECALL_TOKEN_BUDGET ?? ''), 10);
  if (Number.isFinite(budget) && budget > 0) body.tokenBudget = budget;
  if (sessionId && sessionId !== 'unknown') body.sessionId = sessionId;
  if (project) body.project = project;
  try {
    const res = await fetchImpl(`${baseUrl(env)}/api/hooks/context`, {
      method: 'POST',
      headers: authHeaders(env),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || typeof data !== 'object') return null;
    return { context: typeof data.context === 'string' ? data.context : '', memories: data.memories };
  } catch {
    return null;
  }
}

export async function drainSpool(env, fetchImpl = fetch) {
  const records = readSpool(env);
  const remaining = [];
  let delivered = 0;
  for (const record of records) {
    try {
      const res = await postEvent(env, record, fetchImpl);
      if (res.status >= 500) {
        remaining.push(record);
        continue;
      }
      if (res.status < 400) delivered += 1;
    } catch {
      remaining.push(record);
    }
  }
  writeSpool(env, remaining);
  return { delivered, remaining: remaining.length };
}

export async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}
