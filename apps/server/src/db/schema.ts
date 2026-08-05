import { index, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  displayName: varchar('display_name', { length: 64 }),
  createdAt: timestamptz('created_at').notNull(),
  updatedAt: timestamptz('updated_at').notNull(),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  expiresAt: timestamptz('expires_at').notNull(),
  createdAt: timestamptz('created_at').notNull(),
});

export const accessTokens = pgTable('access_tokens', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 80 }).notNull(),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  preview: varchar('preview', { length: 32 }).notNull(),
  revokedAt: timestamptz('revoked_at'),
  createdAt: timestamptz('created_at').notNull(),
});

export const mcpClients = pgTable('mcp_clients', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 80 }).notNull(),
  tokenId: uuid('token_id')
    .notNull()
    .references(() => accessTokens.id, { onDelete: 'cascade' }),
  revokedAt: timestamptz('revoked_at'),
  createdAt: timestamptz('created_at').notNull(),
});

export const memories = pgTable(
  'memories',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    origin: varchar('origin', { length: 16 }).notNull(),
    eventId: varchar('event_id', { length: 128 }),
    indexedAt: timestamptz('indexed_at'),
    createdAt: timestamptz('created_at').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (table) => [
    index('memories_user_created_idx').on(table.userId, table.createdAt),
    uniqueIndex('memories_user_event_uidx').on(table.userId, table.eventId),
  ],
);

export type MemoryRow = typeof memories.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type TokenRow = typeof accessTokens.$inferSelect;
export type McpClientRow = typeof mcpClients.$inferSelect;
