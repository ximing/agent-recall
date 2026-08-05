import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { bootStandin, readJson, sessionFrom, startServer, stopProcess, waitForHealth } from './support.js';

const port = Number(process.env.LAUNCH_PORT ?? 8791);
const dataDir = process.env.LAUNCH_DATA_DIR ?? (await mkdtemp(path.join(tmpdir(), 'agent-recall-launch-')));
const email = `launch-${String(Date.now())}@example.com`;
const password = 'launch-password';
const content = `双进程记忆-${String(Date.now())}`;

const standin = await bootStandin();
const base = `http://127.0.0.1:${String(port)}`;

function spawnOnce() {
  const child = startServer({ port, dataDir, standin });
  child.stdout?.on('data', (chunk: Buffer) => process.stdout.write(`[server] ${chunk.toString()}`));
  child.stderr?.on('data', (chunk: Buffer) => process.stderr.write(`[server] ${chunk.toString()}`));
  return child;
}

async function recall(cookie: string): Promise<{ id: string; content: string }> {
  const res = await fetch(`${base}/api/memories/recall`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: `ar_session=${cookie}` },
    body: JSON.stringify({ query: content }),
  });
  const body = await readJson(res);
  const memories = body.memories as { id: string; content: string }[];
  const hit = memories.find((item) => item.content === content);
  if (!hit) throw new Error(`recall missed ${content}: ${JSON.stringify(body)}`);
  return hit;
}

const first = spawnOnce();
try {
  await waitForHealth(base);
  const registered = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const cookie = sessionFrom(registered);
  await readJson(registered);
  const created = await readJson(
    await fetch(`${base}/api/memories`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `ar_session=${cookie}` },
      body: JSON.stringify({ content }),
    }),
  );
  const memory = created.memory as { id: string; content: string };
  if (memory.content !== content) throw new Error('create content mismatch');
  const listed = await readJson(
    await fetch(`${base}/api/memories`, { headers: { cookie: `ar_session=${cookie}` } }),
  );
  if (!JSON.stringify(listed).includes(content)) throw new Error('list missed the memory');
  const firstRecall = await recall(cookie);
  const secondRecall = await recall(cookie);
  if (firstRecall.id !== memory.id || secondRecall.id !== memory.id) throw new Error('recall id changed inside one process');
  if (firstRecall.content !== content || secondRecall.content !== content) throw new Error('recall content mismatch');
  console.log(`PASS first process id=${memory.id} content=${content}`);
} finally {
  await stopProcess(first);
}

const second = spawnOnce();
try {
  await waitForHealth(base);
  const logged = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const cookie = sessionFrom(logged);
  await readJson(logged);
  const listed = await readJson(
    await fetch(`${base}/api/memories`, { headers: { cookie: `ar_session=${cookie}` } }),
  );
  if (!JSON.stringify(listed).includes(content)) throw new Error('restart lost the memory');
  const again = await recall(cookie);
  console.log(`PASS second process id=${again.id} content=${again.content}`);
} finally {
  await stopProcess(second);
  await standin.close();
}
