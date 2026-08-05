import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appEnvName, envFilePath, loadAppEnv } from './env.js';

const dirs: string[] = [];

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('app env files', () => {
  it('selects test or production from APP_ENV before NODE_ENV', () => {
    expect(appEnvName({ APP_ENV: 'test', NODE_ENV: 'production' })).toBe('test');
    expect(appEnvName({ NODE_ENV: 'production' })).toBe('production');
    expect(appEnvName({})).toBe('development');
  });

  it('loads the matching file and does not let it override variables already set', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'agent-recall-env-'));
    dirs.push(root);
    await writeFile(path.join(root, '.env.test'), 'PORT=8799\nMEILI_INDEX=from-test\nALREADY=from-file\n', 'utf8');
    await writeFile(path.join(root, '.env.production'), 'PORT=1\nMEILI_INDEX=from-prod\n', 'utf8');
    const env: NodeJS.ProcessEnv = { APP_ENV: 'test', NODE_ENV: 'production', ALREADY: 'from-process' };
    expect(loadAppEnv(env, root)).toBe('test');
    expect(env.PORT).toBe('8799');
    expect(env.MEILI_INDEX).toBe('from-test');
    expect(env.ALREADY).toBe('from-process');
    expect(env.PGGSSENCMODE).toBe('disable');
    expect(envFilePath(root, 'production')).toBe(path.join(root, '.env.production'));
  });

  it('ignores a missing development file', () => {
    const env: NodeJS.ProcessEnv = {};
    expect(loadAppEnv(env, path.join(tmpdir(), 'agent-recall-missing-env'))).toBe('development');
  });
});
