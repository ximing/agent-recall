#!/usr/bin/env node
// Claude Code SessionEnd hook: record session metadata. The server generates a
// summary memory for the session once this event lands.
import {
  cwdOf,
  deliverEvent,
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
  const project = resolveProject(cwdOf(payload), process.env);

  await deliverEvent({
    hook: 'SessionEnd',
    payload,
    env: process.env,
    sessionId,
    project,
    content: `[SessionEnd] ${stableStringify({
      sessionId,
      project,
      reason: payload.reason ?? null,
      transcript_path: payload.transcript_path ?? null,
    })}`,
  });
}

main().catch(() => process.exit(0));
