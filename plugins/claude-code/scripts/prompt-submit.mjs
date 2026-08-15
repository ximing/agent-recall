#!/usr/bin/env node
// Claude Code UserPromptSubmit hook: recall memories relevant to the prompt and
// inject them. The prompt itself is not stored (noise); the server trims the
// returned context to the configured token budget.
import {
  cwdOf,
  fetchContext,
  isDisabled,
  readStdin,
  resolveProject,
  sessionIdOf,
} from '../../shared/client.mjs';

async function main() {
  if (isDisabled(process.env)) return;
  const payload = await readStdin();
  const prompt = typeof payload.prompt === 'string' ? payload.prompt.trim() : '';
  if (!prompt) return;

  const sessionId = sessionIdOf(payload);
  const project = resolveProject(cwdOf(payload), process.env);
  const ctx = await fetchContext(process.env, { query: prompt, sessionId, project });

  if (ctx && ctx.context) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: ctx.context,
        },
      }),
    );
  }
}

main().catch(() => process.exit(0));
