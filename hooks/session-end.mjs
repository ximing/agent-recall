#!/usr/bin/env node
import { deliverHookEvent, readStdin } from './lib.mjs';

const payload = await readStdin();
await deliverHookEvent({ hook: 'SessionEnd', payload, env: process.env });
