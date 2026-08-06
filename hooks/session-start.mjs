#!/usr/bin/env node
import { deliverHookEvent, readStdin } from './lib.mjs';

const payload = await readStdin();
await deliverHookEvent({ hook: 'SessionStart', payload, env: process.env });
