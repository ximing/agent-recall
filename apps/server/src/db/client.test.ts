import { describe, expect, it } from 'vitest';
import { assertSchemaName, createSchemaName, dropSchema } from './client.js';

describe('schema names', () => {
  it('creates an ar_ name and rejects anything a test must not drop', async () => {
    expect(createSchemaName()).toMatch(/^ar_[0-9a-f]{16}$/);
    expect(assertSchemaName('ar_example')).toBe('ar_example');
    expect(() => assertSchemaName('public;drop')).toThrow(/invalid schema name/);
    await expect(dropSchema('postgresql://localhost/agent_recall', 'public')).rejects.toThrow(/refusing to drop/);
  });
});
