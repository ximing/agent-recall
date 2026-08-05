import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type AppEnvName = 'development' | 'test' | 'production';

export function serverRootFrom(importMetaUrl: string): string {
  return path.resolve(path.dirname(fileURLToPath(importMetaUrl)), '..');
}

export const serverRoot = serverRootFrom(import.meta.url);

export function appEnvName(env: NodeJS.ProcessEnv): AppEnvName {
  const requested = env.APP_ENV?.trim();
  if (requested === 'development' || requested === 'test' || requested === 'production') return requested;
  if (env.NODE_ENV === 'test' || env.NODE_ENV === 'production') return env.NODE_ENV;
  return 'development';
}

export function envFilePath(root: string, name: AppEnvName): string {
  return path.join(root, `.env.${name}`);
}

export function loadAppEnv(env: NodeJS.ProcessEnv = process.env, root = serverRoot): AppEnvName {
  const name = appEnvName(env);
  const result = loadEnv({
    path: envFilePath(root, name),
    processEnv: env as { [key: string]: string },
  });
  const code = result.error && 'code' in result.error ? result.error.code : undefined;
  if (result.error && code !== 'ENOENT') throw result.error;
  env.PGGSSENCMODE ??= 'disable';
  return name;
}
