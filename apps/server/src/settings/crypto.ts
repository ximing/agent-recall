import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * 设置敏感字段（如 rerankApiKey）的加密。
 * 主密钥来自环境变量 ENCRYPTION_KEY，SHA-256 后作为 AES-256-GCM 密钥。
 * 密文格式 enc:v1:<iv>:<tag>:<data>（base64）。未加密的历史明文原样返回。
 */

const PREFIX = 'enc:v1:';

export function deriveKey(secret: string): Buffer {
  const trimmed = secret.trim();
  if (!trimmed) throw new Error('ENCRYPTION_KEY is required. Set it in the server environment.');
  return createHash('sha256').update(trimmed, 'utf8').digest();
}

export function encryptSecret(secret: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${data.toString('base64')}`;
}

export function decryptSecret(secret: string, stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored;
  const [iv, tag, data] = stored.slice(PREFIX.length).split(':');
  if (!iv || !tag || !data) throw new Error('malformed encrypted secret');
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

export function isEncrypted(stored: string): boolean {
  return stored.startsWith(PREFIX);
}
