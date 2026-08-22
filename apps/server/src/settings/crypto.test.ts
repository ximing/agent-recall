import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from './crypto.js';

describe('settings encryption', () => {
  it('round-trips a secret with ENCRYPTION_KEY and rejects a different key', () => {
    const stored = encryptSecret('test-encryption-key', 'sk-rerank');
    expect(stored.startsWith('enc:v1:')).toBe(true);
    expect(decryptSecret('test-encryption-key', stored)).toBe('sk-rerank');
    expect(() => decryptSecret('other-key', stored)).toThrow();
  });
});