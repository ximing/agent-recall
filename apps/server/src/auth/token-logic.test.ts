import { describe, expect, it } from 'vitest';
import { generateAccessToken, hashSecret, previewSecret, readBearerToken } from './token-logic.js';

describe('token logic', () => {
  it('previews a secret without equaling it, and hashes stably', () => {
    const secret = generateAccessToken();
    const preview = previewSecret(secret);
    expect(secret.startsWith('arm_')).toBe(true);
    expect(preview).not.toBe(secret);
    expect(preview.startsWith(secret.slice(0, 8))).toBe(true);
    expect(preview.endsWith(secret.slice(-4))).toBe(true);
    expect(preview.includes('***')).toBe(true);
    expect(hashSecret(secret)).toHaveLength(64);
    expect(hashSecret(secret)).toBe(hashSecret(secret));
    expect(readBearerToken(`Bearer ${secret}`)).toBe(secret);
    expect(readBearerToken('Basic abc')).toBeUndefined();
  });
});
