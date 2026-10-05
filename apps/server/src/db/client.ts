import { randomBytes } from 'node:crypto';
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';
import { SCHEMA_STATEMENTS } from './sql.js';

export type Database = NodePgDatabase<typeof schema>;

export interface OpenedDatabase {
  db: Database;
  pool: pg.Pool;
  close: () => Promise<void>;
}

const SCHEMA_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

export function assertSchemaName(name: string): string {
  if (!SCHEMA_NAME.test(name)) throw new Error(`invalid schema name: ${name}`);
  return name;
}

/** Throwaway schema for one test run. Never use this for the public schema. */
export function createSchemaName(): string {
  return `ar_${randomBytes(8).toString('hex')}`;
}

function quoteIdent(name: string): string {
  assertSchemaName(name);
  return `"${name}"`;
}

async function applySchema(exec: (statement: string) => Promise<unknown>): Promise<void> {
  for (const statement of SCHEMA_STATEMENTS) {
    await exec(statement);
  }
}

export async function dropSchema(databaseUrl: string, schemaName: string): Promise<void> {
  assertSchemaName(schemaName);
  if (!schemaName.startsWith('ar_')) {
    throw new Error(`refusing to drop schema ${schemaName}`);
  }
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(`DROP SCHEMA IF EXISTS ${quoteIdent(schemaName)} CASCADE`);
  } finally {
    await client.end();
  }
}

export async function openDatabase(options: {
  databaseUrl: string;
  schema?: string | undefined;
}): Promise<OpenedDatabase> {
  const databaseUrl = options.databaseUrl.trim();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required. Point it at the Postgres database.');
  }
  const schemaName = options.schema === undefined || options.schema.trim() === ''
    ? undefined
    : assertSchemaName(options.schema.trim());

  if (schemaName) {
    const bootstrap = new pg.Client({ connectionString: databaseUrl });
    await bootstrap.connect();
    try {
      await bootstrap.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(schemaName)}`);
    } finally {
      await bootstrap.end();
    }
  }

  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    ...(schemaName ? { options: `-c search_path=${schemaName}` } : {}),
  });
  try {
    if (schemaName) {
      const check = await pool.query<{ schema: string | null }>('select current_schema() as schema');
      if (check.rows[0]?.schema !== schemaName) {
        throw new Error(`search_path did not select schema ${schemaName}`);
      }
    }
    await applySchema((statement) => pool.query(statement));
  } catch (error) {
    await pool.end();
    throw error;
  }
  const db = drizzlePg({ client: pool, schema });
  return {
    db,
    pool,
    close: async () => {
      await pool.end();
    },
  };
}
