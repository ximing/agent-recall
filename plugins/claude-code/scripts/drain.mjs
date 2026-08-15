#!/usr/bin/env node
// Drains the local spool. Same as `node ../../shared/drain.mjs`; kept here so a
// copied plugin directory stays runnable on its own.
import { drainSpool, isDisabled } from '../../shared/client.mjs';

if (isDisabled(process.env)) {
  process.stdout.write('{"delivered":0,"remaining":0,"disabled":true}\n');
} else {
  const result = await drainSpool(process.env);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
