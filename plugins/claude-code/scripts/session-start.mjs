#!/usr/bin/env node
// Claude Code SessionStart hook: recall project context, register the session.
// Stdout contract: hookSpecificOutput.additionalContext is injected into the session.
import {
  cwdOf,
  deliverEvent,
  fetchContext,
  isDisabled,
  readStdin,
  resolveProject,
  sessionIdOf,
  stableStringify,
} from '../../shared/client.mjs';

async function main() {
  if (isDisabled(process.env)) return;
  const payload = await readStdin();
  const sessionId = sessionIdOf(payload);
  const cwd = cwdOf(payload);
  const project = resolveProject(cwd, process.env);

  const [ctx] = await Promise.all([
    fetchContext(process.env, { query: `project ${project} session context`, sessionId, project }),
    deliverEvent({
      hook: 'SessionStart',
      payload,
      env: process.env,
      sessionId,
      project,
      content: `[SessionStart] ${stableStringify({
        sessionId,
        project,
        cwd,
        source: payload.source ?? null,
        model: payload.model ?? null,
      })}`,
    }),
  ]);

  if (ctx && ctx.context) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: ctx.context,
        },
      }),
    );
  }
}

main().catch(() => process.exit(0));
