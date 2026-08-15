#!/usr/bin/env node
// Replays spooled events to the agent-recall server.
// Usage: node plugins/shared/drain.mjs
import { drainSpool, isDisabled } from './client.mjs';

if (isDisabled(process.env)) {
  process.stdout.write('{"delivered":0,"remaining":0,"disabled":true}\n');
} else {
  const result = await drainSpool(process.env);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
