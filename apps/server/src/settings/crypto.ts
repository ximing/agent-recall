import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * 设置敏感字段（如 rerankApiKey）的本地加密：
 * 密钥为随机 32 字节，首次使用时生成并写入 <dataDir 上级目录>/.secret（0600），
 * 避免放在 PGlite 数据目录内部。密文格式 enc:v1:<iv>:<tag>:<data>（base64）。
 * 未加密的历史明文原样返回。
 */

const PREFIX = 'enc:v1:';

let cachedKey: Buffer | null = null;

function secretPath(dataDir: string): string {
  return join(dirname(dataDir), '.secret');
}

function loadKey(dataDir: string): Buffer {
  if (cachedKey) return cachedKey;
  const path = secretPath(dataDir);
  if (existsSync(path)) {
    cachedKey = createHash('sha256').update(readFileSync(path)).digest();
    return cachedKey;
  }
  const dir = dirname(dataDir);
  mkdirSync(dir, { recursive: true });
  const raw = randomBytes(32);
  writeFileSync(path, raw.toString('base64'), { mode: 0o600 });
  chmodSync(path, 0o600);
  cachedKey = createHash('sha256').update(raw.toString('base64')).digest();
  return cachedKey;
}

export function encryptSecret(dataDir: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', loadKey(dataDir), iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${data.toString('base64')}`;
}

export function decryptSecret(dataDir: string, stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored; // 历史明文兼容
  const [iv, tag, data] = stored.slice(PREFIX.length).split(':');
  if (!iv || !tag || !data) throw new Error('malformed encrypted secret');
  const decipher = createDecipheriv('aes-256-gcm', loadKey(dataDir), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

export function isEncrypted(stored: string): boolean {
  return stored.startsWith(PREFIX);
}
