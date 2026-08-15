// agent-recall capture plugin for OpenCode (1.x and 2.x).
// Self-contained: no runtime dependencies, no imports outside this file.
//
// Behavior (mirrors the other agent-recall host plugins):
//   - session.created  -> POST /api/hooks/events (SessionStart) + context prefetch
//   - prompt           -> POST /api/hooks/context with the prompt, injected via the
//                         system-transform hook; the prompt itself is not stored
//   - tool completion  -> POST /api/hooks/events (PostToolUse, toolName + ~2000 chars)
//   - session end      -> POST /api/hooks/events (SessionEnd; server summarizes)
//   - failures         -> spooled to ~/.agent-recall/spool/events.jsonl; replay with
//                         `node plugins/shared/drain.mjs`
import type { Plugin } from "@opencode-ai/plugin";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

const API = (process.env.AGENT_RECALL_URL || "http://127.0.0.1:8787").replace(/\/+$/, "");
const TOKEN = (process.env.AGENT_RECALL_TOKEN || "").trim();
const TIMEOUT_MS = 2000;
const DISABLED = /^(1|true|yes)$/i.test((process.env.AGENT_RECALL_DISABLED || "").trim());
const TOKEN_BUDGET = Number.parseInt(process.env.AGENT_RECALL_TOKEN_BUDGET || "", 10);
const DEBUG = process.env.AGENT_RECALL_OPENCODE_DEBUG === "1";

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (TOKEN) headers.authorization = `Bearer ${TOKEN}`;
  return headers;
}

function debug(...args: unknown[]): void {
  if (DEBUG) console.error("[agent-recall]", ...args);
}

function digest(parts: string[]): string {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 32);
}

function eventId(hook: string, sessionId: string, hostId?: string, content?: string): string {
  if (hostId) return `evh_${digest(["host", sessionId, hook, hostId])}`;
  return `evc_${digest(["content", sessionId, hook, content ?? ""])}`;
}

function safeSlice(value: unknown, max: number): string {
  if (typeof value === "string") return value.slice(0, max);
  if (value == null) return "";
  try {
    return JSON.stringify(value).slice(0, max);
  } catch {
    return "";
  }
}

// ~2000 chars total for PostToolUse content.
function toolContent(toolName: string, input: unknown, output: unknown, isError: boolean): string {
  const inText = safeSlice(input, 800);
  const outText = safeSlice(output, 1100);
  return `[PostToolUse] ${toolName}(${inText}) => ${isError ? "ERROR: " : ""}${outText}`;
}

// --- spool -------------------------------------------------------------------

function spoolFile(): string {
  const dir = (process.env.AGENT_RECALL_SPOOL_DIR || "").trim() || join(homedir(), ".agent-recall", "spool");
  return join(dir, "events.jsonl");
}

function appendSpool(record: Record<string, unknown>): void {
  try {
    const file = spoolFile();
    const existing = existsSync(file)
      ? readFileSync(file, "utf8").split("\n").filter((l) => l.trim().length > 0)
      : [];
    if (existing.some((line) => safeSlice(JSON.parse(line).eventId, 200) === record.eventId)) return;
    existing.push(JSON.stringify(record));
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, `${existing.join("\n")}\n`, "utf8");
    renameSync(tmp, file);
  } catch (e) {
    debug("spool append failed:", (e as Error).message);
  }
}

// --- server calls ------------------------------------------------------------

type HookEvent = {
  hook: "SessionStart" | "UserPromptSubmit" | "PostToolUse" | "SessionEnd";
  content: string;
  sessionId?: string;
  project?: string;
  toolName?: string;
  type?: string;
  hostId?: string;
};

async function deliver(evt: HookEvent): Promise<void> {
  if (DISABLED) return;
  const sessionId = evt.sessionId || "unknown";
  const record: Record<string, unknown> = {
    v: 1,
    eventId: eventId(evt.hook, sessionId, evt.hostId, evt.content),
    hook: evt.hook,
    content: evt.content,
    spooledAt: new Date().toISOString(),
  };
  if (evt.sessionId) record.sessionId = evt.sessionId;
  if (evt.project) record.project = evt.project;
  if (evt.toolName) record.toolName = evt.toolName;
  if (evt.type) record.type = evt.type;
  try {
    const res = await fetch(`${API}/api/hooks/events`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        eventId: record.eventId,
        hook: record.hook,
        content: record.content,
        sessionId: evt.sessionId,
        project: evt.project,
        toolName: evt.toolName,
        type: evt.type,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status >= 500) throw new Error(`status ${res.status}`);
  } catch (e) {
    debug("event delivery failed, spooling:", (e as Error).message);
    appendSpool(record);
  }
}

async function fetchContext(query: string, sessionId?: string, project?: string): Promise<string> {
  if (DISABLED) return "";
  const body: Record<string, unknown> = { query };
  if (Number.isFinite(TOKEN_BUDGET) && TOKEN_BUDGET > 0) body.tokenBudget = TOKEN_BUDGET;
  if (sessionId) body.sessionId = sessionId;
  if (project) body.project = project;
  try {
    const res = await fetch(`${API}/api/hooks/context`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return "";
    const data = (await res.json()) as { context?: unknown };
    return typeof data?.context === "string" ? data.context : "";
  } catch (e) {
    debug("context fetch failed:", (e as Error).message);
    return "";
  }
}

// --- project/session state ----------------------------------------------------

const projectNameCache = new Map<string, string>();

function resolveProjectName(dir: string): string {
  const explicit = process.env.AGENT_RECALL_PROJECT?.trim();
  if (explicit) return explicit;
  const cached = projectNameCache.get(dir);
  if (cached !== undefined) return cached;
  let name = basename(dir) || dir;
  try {
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: dir,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
      timeout: 500,
    }).trim();
    if (top) name = basename(top);
  } catch {
    // not a git repo
  }
  projectNameCache.set(dir, name);
  return name;
}

let activeSessionId: string | null = null;
let defaultProjectName: string | null = null;
let defaultProjectCwd: string = process.cwd();
const sessionProjects = new Map<string, { name: string; cwd: string }>();
const seenToolCallIds = new Map<string, Set<string>>();
// Context fetched per prompt, injected by the system-transform hook; cleared on
// each new prompt so the recalled set tracks the latest user message.
const turnContextCache = new Map<string, string>();
const contextInjectedSessions = new Set<string>();

function projectFor(sid: string): { name: string | null; cwd: string | null } {
  const p = sessionProjects.get(sid);
  return p ?? { name: defaultProjectName, cwd: defaultProjectCwd };
}

function toolCallSetFor(sid: string): Set<string> {
  let s = seenToolCallIds.get(sid);
  if (!s) {
    s = new Set<string>();
    seenToolCallIds.set(sid, s);
  }
  return s;
}

async function startSession(sid: string, directory: string | null): Promise<void> {
  if (directory) {
    sessionProjects.set(sid, { cwd: directory, name: resolveProjectName(directory) });
  }
  const proj = projectFor(sid);
  await deliver({
    hook: "SessionStart",
    sessionId: sid,
    project: proj.name ?? undefined,
    hostId: `${sid}:start`,
    content: `[SessionStart] ${JSON.stringify({ sessionId: sid, project: proj.name, cwd: proj.cwd })}`,
  });
  // Prefetch project-level context so the first injection needs no extra call.
  const ctx = await fetchContext(`project ${proj.name ?? ""} session context`, sid, proj.name ?? undefined);
  if (ctx) turnContextCache.set(sid, ctx);
}

async function endSession(sid: string): Promise<void> {
  const proj = projectFor(sid);
  await deliver({
    hook: "SessionEnd",
    sessionId: sid,
    project: proj.name ?? undefined,
    hostId: `${sid}:end`,
    content: `[SessionEnd] ${JSON.stringify({ sessionId: sid, project: proj.name })}`,
  });
  if (sid === activeSessionId) activeSessionId = null;
  sessionProjects.delete(sid);
  seenToolCallIds.delete(sid);
  turnContextCache.delete(sid);
  contextInjectedSessions.delete(sid);
}

async function promptSubmitted(sid: string, prompt: string): Promise<void> {
  if (!prompt.trim()) return;
  const proj = projectFor(sid);
  turnContextCache.delete(sid);
  const ctx = await fetchContext(prompt, sid, proj.name ?? undefined);
  if (ctx) turnContextCache.set(sid, ctx);
}

function injectInto(system: unknown[], sid: string): void {
  const ctx = turnContextCache.get(sid);
  if (typeof ctx === "string" && ctx.length > 0) {
    system.push(ctx);
  }
}

// --- OpenCode 1.x (V1 hooks object) -------------------------------------------

const v1Hooks: Plugin = async (ctx) => {
  defaultProjectCwd = ctx.worktree || ctx.project?.id || process.cwd();
  defaultProjectName = resolveProjectName(defaultProjectCwd);

  return {
    event: async ({ event }) => {
      if (DISABLED) return;
      const type = event.type;
      const props = (event as any).properties || {};

      if (type === "session.created") {
        const info = props.info as Record<string, unknown> | undefined;
        const sid = (info?.id as string) || props.sessionID || null;
        if (!sid) return;
        activeSessionId = sid;
        seenToolCallIds.delete(sid);
        contextInjectedSessions.delete(sid);
        const dir = typeof info?.directory === "string" && info.directory ? info.directory : defaultProjectCwd;
        await startSession(sid, dir);
      }

      if (type === "session.deleted") {
        const sid = props.info?.id || props.sessionID || activeSessionId;
        if (sid) await endSession(sid);
      }

      if (type === "message.part.updated") {
        const part = props.part as Record<string, unknown> | undefined;
        if (!part || part.type !== "tool") return;
        const state = part.state as Record<string, unknown> | undefined;
        if (!state) return;
        const sid = (part.sessionID as string) || props.sessionID || activeSessionId;
        if (!sid) return;
        const callId = part.callID as string;
        if (!callId) return;
        const status = state.status as string;
        if (status !== "completed" && status !== "error") return;
        const callSet = toolCallSetFor(sid);
        if (callSet.has(callId)) return;
        callSet.add(callId);
        const toolName = (part.tool as string) || "unknown";
        const isError = status === "error";
        await deliver({
          hook: "PostToolUse",
          sessionId: sid,
          project: projectFor(sid).name ?? undefined,
          toolName,
          type: isError ? "tool_error" : undefined,
          hostId: callId,
          content: toolContent(toolName, state.input, isError ? state.error : state.output, isError),
        });
      }
    },

    "chat.message": async (input, output) => {
      if (DISABLED) return;
      const sid = input.sessionID || activeSessionId;
      if (!sid) return;
      const text = (output.parts || [])
        .filter((p: any) => p.type === "text" && !p.synthetic && !p.ignored)
        .map((p: any) => p.text || "")
        .join("\n");
      await promptSubmitted(sid, text);
    },

    "experimental.chat.system.transform": async (input, output) => {
      const sid = input.sessionID || activeSessionId;
      if (!sid || !Array.isArray(output.system)) return;
      if (!contextInjectedSessions.has(sid)) {
        let ctx = turnContextCache.get(sid);
        if (!ctx) {
          ctx = await fetchContext(
            `project ${projectFor(sid).name ?? ""} session context`,
            sid,
            projectFor(sid).name ?? undefined,
          );
        }
        if (ctx) output.system.push(ctx);
        contextInjectedSessions.add(sid);
        return;
      }
      injectInto(output.system, sid);
    },
  };
};

// --- OpenCode 2.x (setup with domain hooks) ------------------------------------

async function v2Setup(ctx: any) {
  if (
    typeof ctx?.tool?.hook !== "function" ||
    typeof ctx?.session?.hook !== "function" ||
    typeof ctx?.event?.subscribe !== "function"
  ) {
    return;
  }
  const location = ctx.location;
  defaultProjectCwd = location?.directory ?? location?.project?.directory ?? process.cwd();
  defaultProjectName = resolveProjectName(defaultProjectCwd);

  await ctx.tool.hook("execute.after", async (event: any) => {
    if (DISABLED) return;
    const sid = event?.sessionID || activeSessionId;
    if (!sid) return;
    const toolName = String(event?.tool ?? "unknown");
    const callId = (event?.id as string) || (event?.messageID as string) || undefined;
    const status = String(event?.status ?? "");
    const result = event?.result ?? {};
    const output = result?.output as Record<string, unknown> | undefined;
    const raw = output?.output ?? result?.content;
    const text = Array.isArray(raw)
      ? raw.map((p: any) => (typeof p === "string" ? p : (p?.text ?? ""))).join("\n")
      : typeof raw === "string"
        ? raw
        : "";
    const isError = status === "error";
    await deliver({
      hook: "PostToolUse",
      sessionId: sid,
      project: projectFor(sid).name ?? undefined,
      toolName,
      type: isError ? "tool_error" : undefined,
      hostId: callId,
      content: toolContent(toolName, event?.input, isError ? (event?.error ?? text) : text, isError),
    });
  });

  await ctx.session.hook("prompt", async (event: any) => {
    if (DISABLED) return;
    const sid = event?.sessionID || activeSessionId;
    if (!sid) return;
    await promptSubmitted(sid, (event?.prompt?.text ?? "").slice(0, 8000));
  });

  await ctx.session.hook("context", async (event: any) => {
    const sid = event?.sessionID || activeSessionId;
    if (!sid || !Array.isArray(event.system)) return;
    const push = (text: string) => event.system.push({ type: "text", text });
    if (!contextInjectedSessions.has(sid)) {
      let ctx = turnContextCache.get(sid);
      if (!ctx) {
        ctx = await fetchContext(
          `project ${projectFor(sid).name ?? ""} session context`,
          sid,
          projectFor(sid).name ?? undefined,
        );
      }
      if (ctx) push(ctx);
      contextInjectedSessions.add(sid);
      return;
    }
    const ctx = turnContextCache.get(sid);
    if (ctx) push(ctx);
  });

  const controller = new AbortController();
  const registeredSessions = new Set<string>();

  const handleEvent = async (event: any): Promise<void> => {
    if (DISABLED) return;
    const type = String(event?.type ?? "");
    const data: any = event?.data ?? {};
    const sid = typeof data.sessionID === "string" && data.sessionID ? data.sessionID : null;

    if (sid && !registeredSessions.has(sid)) {
      registeredSessions.add(sid);
      if (!activeSessionId) activeSessionId = sid;
      const dir = (data.location?.directory as string) || (event?.location?.directory as string) || null;
      await startSession(sid, dir);
    }

    if (type === "session.deleted") {
      const endSid = sid || activeSessionId;
      if (endSid) {
        registeredSessions.delete(endSid);
        await endSession(endSid);
      }
    }
  };

  void (async () => {
    try {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        try {
          await handleEvent(event);
        } catch (e) {
          debug("event handler failed:", (e as Error).message);
        }
      }
    } catch (e) {
      debug("event stream failed:", (e as Error).message);
    }
  })();

  return () => {
    controller.abort();
    turnContextCache.clear();
    contextInjectedSessions.clear();
  };
}

export default {
  id: "agent-recall-capture",
  setup: v2Setup,
  server: v1Hooks,
};

export const AgentRecallCapturePlugin: Plugin = v1Hooks;
