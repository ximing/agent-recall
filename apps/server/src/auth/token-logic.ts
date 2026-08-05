import { createHash, randomBytes } from 'node:crypto';

export const ACCESS_TOKEN_PREFIX = 'arm_';
export const SESSION_COOKIE = 'ar_session';
const ENTROPY_BYTES = 32;

export function generateAccessToken(entropy: Buffer = randomBytes(ENTROPY_BYTES)): string {
  return `${ACCESS_TOKEN_PREFIX}${entropy.toString('base64url')}`;
}

export function generateSessionToken(entropy: Buffer = randomBytes(ENTROPY_BYTES)): string {
  return `ars_${entropy.toString('base64url')}`;
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

export function readBearerToken(authorization: string | undefined): string | undefined {
  if (!authorization) return undefined;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization.trim());
  return match?.[1];
}

/** First 8 and last 4 characters. The stored preview is never the full secret. */
export function previewSecret(secret: string): string {
  if (secret.length <= 14) return `${secret.slice(0, Math.min(4, secret.length))}***`;
  return `${secret.slice(0, 8)}***${secret.slice(-4)}`;
}

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
