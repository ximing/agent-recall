#!/usr/bin/env node
// Claude Code PostToolUse hook: record tool name + key args + truncated result.
import {
  cwdOf,
  deliverEvent,
  isDisabled,
  readStdin,
  resolveProject,
  sessionIdOf,
  truncate,
} from '../../shared/client.mjs';

async function main() {
  if (isDisabled(process.env)) return;
  const payload = await readStdin();
  const toolName =
    (typeof payload.tool_name === 'string' && payload.tool_name) ||
    (typeof payload.toolName === 'string' && payload.toolName) ||
    'unknown';
  const sessionId = sessionIdOf(payload);
  const project = resolveProject(cwdOf(payload), process.env);

  // ~2000 chars total: budget split between input summary and result summary.
  const input = truncate(payload.tool_input ?? payload.toolInput ?? {}, 800);
  const rawResponse = payload.tool_response ?? payload.tool_output ?? payload.toolResult ?? '';
  const output = truncate(rawResponse, 1100);
  const isError = payload.is_error === true || payload.error != null;
  const content = `[PostToolUse] ${toolName}(${input}) => ${isError ? 'ERROR: ' : ''}${output}`;

  await deliverEvent({
    hook: 'PostToolUse',
    payload,
    env: process.env,
    sessionId,
    project,
    toolName,
    content,
  });
}

main().catch(() => process.exit(0));
