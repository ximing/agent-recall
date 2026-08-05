import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import pg from 'pg';
import * as schema from './schema.js';
import { SCHEMA_STATEMENTS } from './sql.js';

export type Database = PgliteDatabase<typeof schema> | NodePgDatabase<typeof schema>;

export interface OpenedDatabase {
  db: Database;
  close: () => Promise<void>;
}

async function applySchema(exec: (statement: string) => Promise<unknown>): Promise<void> {
  for (const statement of SCHEMA_STATEMENTS) {
    await exec(statement);
  }
}

export async function openDatabase(options: {
  dataDir?: string;
  databaseUrl?: string | undefined;
}): Promise<OpenedDatabase> {
  if (options.databaseUrl) {
    const pool = new pg.Pool({ connectionString: options.databaseUrl });
    await applySchema((statement) => pool.query(statement));
    const db = drizzlePg({ client: pool, schema });
    return {
      db,
      close: async () => {
        await pool.end();
      },
    };
  }

  const client = new PGlite(options.dataDir);
  await client.waitReady;
  await applySchema((statement) => client.exec(statement));
  const db = drizzlePglite({ client, schema });
  return {
    db,
    close: async () => {
      await client.close();
    },
  };
}
