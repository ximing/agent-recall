// agent-recall extension for the pi coding agent.
// - session_start       -> POST /api/hooks/events (SessionStart) + context prefetch
// - before_agent_start  -> POST /api/hooks/context with the prompt, appended to the
//                          system prompt; the prompt itself is not stored
// - tool_result         -> POST /api/hooks/events (PostToolUse, toolName + ~2000 chars)
// - session_shutdown    -> POST /api/hooks/events (SessionEnd; server summarizes)
// - memory_recall tool  -> query /api/hooks/context on demand
// - /agent-recall-status command -> reachability check
// Failures are spooled to ~/.agent-recall/spool/events.jsonl; replay with
// `node plugins/shared/drain.mjs`.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";

const DEFAULT_URL = "http://127.0.0.1:8787";
const TIMEOUT_MS = 2000;
const DISABLED = /^(1|true|yes)$/i.test((process.env.AGENT_RECALL_DISABLED || "").trim());
const TOKEN_BUDGET = Number.parseInt(process.env.AGENT_RECALL_TOKEN_BUDGET || "", 10);

function baseUrl(): string {
  return (process.env.AGENT_RECALL_URL || DEFAULT_URL).replace(/\/+$/, "");
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = (process.env.AGENT_RECALL_TOKEN || "").trim();
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

function digest(parts: string[]): string {
  return crypto.createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 32);
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

// --- spool --------------------------------------------------------------------

function spoolFile(): string {
  const dir =
    (process.env.AGENT_RECALL_SPOOL_DIR || "").trim() || path.join(homedir(), ".agent-recall", "spool");
  return path.join(dir, "events.jsonl");
}

function appendSpool(record: Record<string, unknown>): void {
  try {
    const file = spoolFile();
    const existing = existsSync(file)
      ? readFileSync(file, "utf8").split("\n").filter((l) => l.trim().length > 0)
      : [];
    if (existing.some((line) => safeSlice(JSON.parse(line).eventId, 200) === record.eventId)) return;
    existing.push(JSON.stringify(record));
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, `${existing.join("\n")}\n`, "utf8");
    renameSync(tmp, file);
  } catch {
    // spool failure is not fatal
  }
}

// --- server calls --------------------------------------------------------------

type HookEvent = {
  hook: "SessionStart" | "UserPromptSubmit" | "PostToolUse" | "SessionEnd";
  content: string;
  sessionId?: string;
  project?: string;
  toolName?: string;
  type?: string;
  hostId?: string;
};

async function deliver(evt: HookEvent): Promise<boolean> {
  if (DISABLED) return false;
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
    const res = await fetch(`${baseUrl()}/api/hooks/events`, {
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
    return res.ok;
  } catch {
    appendSpool(record);
    return false;
  }
}

async function fetchContext(query: string, sessionId?: string, project?: string): Promise<string | null> {
  if (DISABLED) return null;
  const body: Record<string, unknown> = { query };
  if (Number.isFinite(TOKEN_BUDGET) && TOKEN_BUDGET > 0) body.tokenBudget = TOKEN_BUDGET;
  if (sessionId) body.sessionId = sessionId;
  if (project) body.project = project;
  try {
    const res = await fetch(`${baseUrl()}/api/hooks/context`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { context?: unknown };
    return typeof data?.context === "string" ? data.context : "";
  } catch {
    return null;
  }
}

// --- extension -----------------------------------------------------------------

export default function agentRecallExtension(pi: ExtensionAPI) {
  let sessionId = `ephemeral-${crypto.randomUUID().slice(0, 8)}`;
  let currentCwd = process.cwd();

  const projectCache = new Map<string, string>();
  function resolveProjectName(dir: string): string {
    const explicit = process.env.AGENT_RECALL_PROJECT?.trim();
    if (explicit) return explicit;
    const cached = projectCache.get(dir);
    if (cached) return cached;
    let name = path.basename(dir) || dir;
    try {
      const top = execFileSync("git", ["rev-parse", "--show-toplevel"], {
        cwd: dir,
        stdio: ["ignore", "pipe", "ignore"],
        encoding: "utf8",
      }).trim();
      if (top) name = path.basename(top);
    } catch {
      // not a git repo
    }
    projectCache.set(dir, name);
    return name;
  }
  let currentProject = resolveProjectName(currentCwd);

  pi.registerCommand("agent-recall-status", {
    description: "Check agent-recall server reachability",
    handler: async (_args, ctx) => {
      const result = await fetchContext("status ping", sessionId, currentProject);
      if (result === null) {
        ctx.ui.notify(`agent-recall is unreachable at ${baseUrl()}`, "warning");
        return;
      }
      ctx.ui.notify(`agent-recall reachable at ${baseUrl()}`, "info");
    },
  });

  pi.registerTool({
    name: "memory_recall",
    label: "Memory Recall",
    description:
      "Recall cross-session project memory (prior decisions, conventions, session summaries) from the agent-recall service",
    parameters: Type.Object({
      query: Type.String({ description: "What to recall from memory" }),
    }),
    async execute(_toolCallId, params) {
      const context = await fetchContext(params.query, sessionId, currentProject);
      if (context === null) {
        return {
          content: [{ type: "text", text: `agent-recall is unreachable at ${baseUrl()}` }],
          details: { ok: false },
        };
      }
      return {
        content: [{ type: "text", text: context || "No relevant memories found." }],
        details: { query: params.query },
      };
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    const sessionFile = ctx.sessionManager.getSessionFile();
    sessionId = sessionFile
      ? path.basename(sessionFile).replace(/\.[^.]+$/, "")
      : `ephemeral-${crypto.randomUUID().slice(0, 8)}`;
    currentCwd = process.cwd();
    currentProject = resolveProjectName(currentCwd);
    void deliver({
      hook: "SessionStart",
      sessionId,
      project: currentProject,
      hostId: `${sessionId}:start`,
      content: `[SessionStart] ${JSON.stringify({ sessionId, project: currentProject, cwd: currentCwd })}`,
    });
  });

  pi.on("before_agent_start", async (event) => {
    currentCwd = event.systemPromptOptions.cwd || process.cwd();
    currentProject = resolveProjectName(currentCwd);
    const prompt = event.prompt?.trim() || "";
    if (!prompt) return;
    const context = await fetchContext(prompt, sessionId, currentProject);
    if (!context) return;
    return {
      systemPrompt: [event.systemPrompt, context].filter(Boolean).join("\n\n"),
    };
  });

  pi.on("tool_result", (event) => {
    const toolName = event.toolName;
    if (!toolName) return;
    // ~2000 chars total: 800 for input, 1100 for output.
    const input = safeSlice(event.input, 800);
    const output = safeSlice(event.content, 1100);
    void deliver({
      hook: "PostToolUse",
      sessionId,
      project: currentProject,
      toolName,
      type: event.isError ? "tool_error" : undefined,
      hostId: `${toolName}:${digest([input, output]).slice(0, 12)}`,
      content: `[PostToolUse] ${toolName}(${input}) => ${event.isError ? "ERROR: " : ""}${output}`,
    });
  });

  pi.on("session_shutdown", async (event) => {
    // /new, /resume, /fork and reloads fire this too; only quit ends the session.
    if (event.reason !== "quit") return;
    await deliver({
      hook: "SessionEnd",
      sessionId,
      project: currentProject,
      hostId: `${sessionId}:end`,
      content: `[SessionEnd] ${JSON.stringify({ sessionId, project: currentProject })}`,
    });
  });
}
