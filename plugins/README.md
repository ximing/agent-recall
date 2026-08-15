# agent-recall host plugins

Native plugins that connect four coding agents to a running
[agent-recall](https://github.com/ximing/agent-recall) server
(Fastify, default `http://127.0.0.1:8787`):

| Host | Directory | Mechanism |
|---|---|---|
| Claude Code | `claude-code/` | `.claude-plugin/` plugin, 4 hook events |
| Codex CLI | `codex/` | `.codex-plugin/` plugin, same 4 hook events |
| OpenCode | `opencode/` | plugin file auto-loaded from `~/.config/opencode/plugins/` (1.x and 2.x) |
| pi | `pi/` | pi extension (`pi.on(...)` lifecycle hooks + `memory_recall` tool) |

All four implement the same behavior:

1. **SessionStart** — fetches `POST /api/hooks/context` with the project as query
   and injects the returned `context` into the session; also records the session
   start via `POST /api/hooks/events`.
2. **UserPromptSubmit** — fetches context with the prompt text as query and
   injects it. The prompt itself is *not* stored (noise). OpenCode/pi inject via
   their system-prompt hooks instead of stdout.
3. **PostToolUse** — records tool name + key arguments + a result summary
   truncated to ~2000 chars, with `toolName`, `sessionId`, `project` (git
   toplevel basename, falling back to cwd basename).
4. **SessionEnd** — records session metadata; the server then generates the
   session's summary memory automatically.

Every call has a 2s timeout so hooks never block the host. On network failure
or HTTP 5xx the event is appended to `~/.agent-recall/spool/events.jsonl`
(deduped by `eventId`). Replay it with:

```bash
node plugins/shared/drain.mjs
```

All hosts share one spool file, so one drain covers every host.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `AGENT_RECALL_URL` | `http://127.0.0.1:8787` | agent-recall server URL |
| `AGENT_RECALL_TOKEN` | (none) | Bearer token; sent as `Authorization: Bearer ...` |
| `AGENT_RECALL_SPOOL_DIR` | `~/.agent-recall/spool` | Offline spool directory |
| `AGENT_RECALL_TOKEN_BUDGET` | (server default) | `tokenBudget` for `/api/hooks/context` |
| `AGENT_RECALL_PROJECT` | git toplevel basename | Explicit project name override |
| `AGENT_RECALL_DISABLED` | (off) | `1`/`true` short-circuits every hook |

## Claude Code

The plugin is `plugins/claude-code/` (`.claude-plugin/plugin.json` +
`hooks/hooks.json` + `scripts/`). The scripts import
`plugins/shared/client.mjs`, so install the **whole `plugins/` tree**, not the
`claude-code/` subdirectory alone.

Local marketplace install from a checkout:

```bash
claude plugin marketplace add /path/to/agent-recall/plugins
claude plugin install agent-recall@agent-recall
```

If your Claude Code version copies only the plugin subdirectory on install
(which would break the `../../shared/client.mjs` import), keep the plugin in
place instead and register the hooks from your working tree via
`~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "node /path/to/agent-recall/plugins/claude-code/scripts/session-start.mjs" }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "node /path/to/agent-recall/plugins/claude-code/scripts/prompt-submit.mjs" }] }],
    "PostToolUse": [{ "hooks": [{ "type": "command", "command": "node /path/to/agent-recall/plugins/claude-code/scripts/post-tool-use.mjs" }] }],
    "SessionEnd": [{ "hooks": [{ "type": "command", "command": "node /path/to/agent-recall/plugins/claude-code/scripts/session-end.mjs" }] }]
  }
}
```

Context is injected through `hookSpecificOutput.additionalContext` on
`SessionStart` and `UserPromptSubmit`.

Requires Node.js 18+ (uses global `fetch` and `AbortSignal.timeout`).

## Codex CLI

The plugin is `plugins/codex/` (`.codex-plugin/plugin.json` +
`hooks/hooks.json` + `scripts/`). Codex hook payloads and the stdout injection
contract are Claude Code compatible, so `codex/scripts/*.mjs` reuse the
`claude-code/scripts/` implementations verbatim (via import) — install the
whole `plugins/` tree for the same reason as above.

Install through a local marketplace:

```bash
codex plugin marketplace add /path/to/agent-recall/plugins
codex plugin add agent-recall@agent-recall
```

Then restart Codex, check `/hooks`, and trust the plugin hooks when prompted.
The hook commands use `${CLAUDE_PLUGIN_ROOT}`, which Codex expands for
Claude-compatible hook manifests.

## OpenCode

Self-contained single file (`opencode/agent-recall.ts`), no runtime
dependencies, no imports outside itself. Works on OpenCode 1.x (`server` hooks)
and 2.x (`setup` hooks) from the same file.

```bash
mkdir -p ~/.config/opencode/plugins ~/.config/opencode/commands
cp plugins/opencode/agent-recall.ts ~/.config/opencode/plugins/
cp plugins/opencode/commands/recall.md ~/.config/opencode/commands/
```

OpenCode auto-loads every file in `~/.config/opencode/plugins/` — do **not**
also list it under `"plugin"`/`"plugins"` in `opencode.json`, or events are
captured twice.

What it does:

- `session.created` / first event with a `sessionID` → SessionStart event +
  context prefetch.
- `chat.message` (v1) / `session.hook("prompt")` (v2) → fetches context for the
  prompt (not stored) and caches it for the turn.
- `experimental.chat.system.transform` (v1) / `session.hook("context")` (v2) →
  pushes the cached context into the system prompt.
- Tool parts completing/erroring (v1) / `tool.hook("execute.after")` (v2) →
  PostToolUse events with `toolName`, deduped per call ID.
- `session.deleted` → SessionEnd event.
- `/recall <query>` slash command → queries `/api/hooks/context` via curl.

## pi

Extension in `pi/` (`index.ts` + `package.json` with a `pi.extensions` entry).
Install:

```bash
mkdir -p ~/.pi/agent/extensions/agent-recall
cp plugins/pi/index.ts ~/.pi/agent/extensions/agent-recall/index.ts
```

pi auto-discovers extensions under `~/.pi/agent/extensions/`; `/reload`
hot-reloads it. To load it explicitly, add to `~/.pi/agent/settings.json`:

```json
{
  "extensions": ["~/.pi/agent/extensions/agent-recall"]
}
```

What it does:

- `session_start` → SessionStart event (session id from the session file name).
- `before_agent_start` → fetches context for the prompt and appends it to the
  system prompt; the prompt is not stored.
- `tool_result` → PostToolUse event with `toolName` and a ~2000-char summary.
- `session_shutdown` with reason `quit` → SessionEnd event.
- `memory_recall` tool → on-demand recall via `/api/hooks/context`.
- `/agent-recall-status` command → reachability check.

`typebox` and the pi SDK are peer dependencies provided by the pi runtime.

## Layout

```
plugins/
  README.md                    # this file
  shared/
    client.mjs                 # HTTP client, spool, drain, eventId derivation
    drain.mjs                  # spool replay: node plugins/shared/drain.mjs
  claude-code/
    .claude-plugin/plugin.json
    hooks/hooks.json           # SessionStart/UserPromptSubmit/PostToolUse/SessionEnd
    scripts/*.mjs              # per-event scripts + drain.mjs
  codex/
    .codex-plugin/plugin.json
    hooks/hooks.json
    scripts/*.mjs              # re-export claude-code/scripts (compatible payloads)
  opencode/
    plugin.json
    agent-recall.ts            # self-contained capture plugin (1.x + 2.x)
    commands/recall.md
  pi/
    package.json
    index.ts                   # pi extension
```

## Differences from the old `hooks/` directory

- Hooks now *inject* context (`/api/hooks/context` → stdout/system prompt) on
  SessionStart and UserPromptSubmit instead of only recording events.
- UserPromptSubmit no longer stores the prompt; it only recalls.
- PostToolUse sends structured fields (`toolName`, `sessionId`, `project`) and
  a ~2000-char summarized content instead of a raw payload dump.
- Events carry a `project` (git toplevel basename) everywhere.
- The client moved from `hooks/lib.mjs` to `plugins/shared/client.mjs` and now
  forwards all optional contract fields (`sessionId`, `project`, `toolName`,
  `type`) and supports `AGENT_RECALL_URL` default, `AGENT_RECALL_DISABLED`,
  and `AGENT_RECALL_TOKEN_BUDGET`.
- Spool format is unchanged (`~/.agent-recall/spool/events.jsonl`, deduped by
  `eventId`), and `drain` still replays it.
