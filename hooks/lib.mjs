import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const HOST_ID_FIELDS = [
  'event_id',
  'eventId',
  'tool_use_id',
  'toolUseId',
  'tool_call_id',
  'toolCallId',
  'prompt_id',
  'promptId',
  'message_id',
  'messageId',
];

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

export function deriveEventId(hook, payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const sessionId =
    typeof source.session_id === 'string' && source.session_id.trim()
      ? source.session_id.trim()
      : typeof source.sessionId === 'string' && source.sessionId.trim()
        ? source.sessionId.trim()
        : 'unknown';
  const id = hostId(source);
  if (id) return `evh_${digest(['host', sessionId, hook, id])}`;
  return `evc_${digest(['content', sessionId, hook, stableStringify(source)])}`;
}

export function renderHookContent(hook, payload) {
  return `[${hook}] ${stableStringify(payload ?? {})}`;
}

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

export async function postEvent(env, record, fetchImpl = fetch) {
  const base = String(env.AGENT_RECALL_URL ?? '').replace(/\/$/, '');
  const token = String(env.AGENT_RECALL_TOKEN ?? '');
  return fetchImpl(`${base}/api/hooks/events`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ eventId: record.eventId, hook: record.hook, content: record.content }),
    signal: AbortSignal.timeout(2000),
  });
}

export async function deliverHookEvent({ hook, payload, env, fetchImpl }) {
  const eventId = deriveEventId(hook, payload);
  const content = renderHookContent(hook, payload);
  const record = { v: 1, eventId, hook, content, spooledAt: new Date().toISOString() };
  try {
    const res = await postEvent(env, record, fetchImpl);
    if (res.status >= 500) throw new Error(`status ${String(res.status)}`);
    if (res.status >= 400) return { status: 'rejected', eventId };
    return { status: 'delivered', eventId };
  } catch {
    appendSpool(env, record);
    return { status: 'spooled', eventId };
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
