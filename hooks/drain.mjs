#!/usr/bin/env node
import { drainSpool } from './lib.mjs';

const result = await drainSpool(process.env);
process.stdout.write(`${JSON.stringify(result)}\n`);
