export const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY,
    email varchar(255) NOT NULL UNIQUE,
    password_hash varchar(255) NOT NULL,
    display_name varchar(64),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash varchar(64) NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS access_tokens (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name varchar(80) NOT NULL,
    token_hash varchar(64) NOT NULL UNIQUE,
    preview varchar(32) NOT NULL,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS mcp_clients (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name varchar(80) NOT NULL,
    token_id uuid NOT NULL REFERENCES access_tokens(id) ON DELETE CASCADE,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS memories (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content text NOT NULL,
    origin varchar(16) NOT NULL,
    event_id varchar(128),
    indexed_at timestamptz,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    CONSTRAINT memories_origin_check CHECK (origin IN ('web', 'agent', 'hook'))
  )`,
  `CREATE INDEX IF NOT EXISTS memories_user_created_idx ON memories (user_id, created_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS memories_user_event_uidx ON memories (user_id, event_id) WHERE event_id IS NOT NULL`,
];
