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
    type varchar(24) NOT NULL DEFAULT 'fact',
    tags jsonb NOT NULL DEFAULT '[]',
    project varchar(128),
    session_id varchar(128),
    event_id varchar(128),
    content_hash varchar(64),
    expires_at timestamptz,
    chain_id uuid NOT NULL,
    parent_id uuid,
    version integer NOT NULL DEFAULT 1,
    is_latest boolean NOT NULL DEFAULT true,
    access_count integer NOT NULL DEFAULT 0,
    last_accessed_at timestamptz,
    indexed_at timestamptz,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    CONSTRAINT memories_origin_check CHECK (origin IN ('web', 'agent', 'hook', 'import', 'summary')),
    CONSTRAINT memories_type_check CHECK (type IN ('fact', 'preference', 'pattern', 'architecture', 'bug', 'workflow', 'lesson'))
  )`,
  `CREATE INDEX IF NOT EXISTS memories_user_created_idx ON memories (user_id, created_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS memories_user_event_uidx ON memories (user_id, event_id) WHERE event_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS memories_user_chain_idx ON memories (user_id, chain_id)`,
  `CREATE INDEX IF NOT EXISTS memories_user_session_idx ON memories (user_id, session_id)`,
  `CREATE INDEX IF NOT EXISTS memories_user_hash_idx ON memories (user_id, content_hash)`,
  `CREATE TABLE IF NOT EXISTS user_settings (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    rerank_enabled boolean NOT NULL DEFAULT false,
    rerank_base_url varchar(255) NOT NULL DEFAULT 'https://dashscope.aliyuncs.com/api/v1',
    rerank_model varchar(80) NOT NULL DEFAULT 'gte-rerank-v2',
    rerank_api_key varchar(512),
    auto_forget_days integer NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS recall_logs (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    query text NOT NULL,
    strategy varchar(16) NOT NULL,
    rerank_model varchar(80),
    rerank_applied boolean NOT NULL,
    rerank_error text,
    results jsonb NOT NULL,
    latency_ms integer NOT NULL,
    created_at timestamptz NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS recall_logs_user_created_idx ON recall_logs (user_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS kv_entries (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    namespace varchar(32) NOT NULL,
    key varchar(128) NOT NULL,
    value jsonb NOT NULL,
    expires_at timestamptz,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    PRIMARY KEY (user_id, namespace, key)
  )`,
  `CREATE INDEX IF NOT EXISTS kv_entries_user_ns_idx ON kv_entries (user_id, namespace)`,
  `CREATE TABLE IF NOT EXISTS snapshots (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    note text,
    memory_count integer NOT NULL,
    data jsonb NOT NULL,
    created_at timestamptz NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS snapshots_user_created_idx ON snapshots (user_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS audit_entries (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action varchar(48) NOT NULL,
    detail jsonb,
    created_at timestamptz NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS audit_entries_user_created_idx ON audit_entries (user_id, created_at)`,
];
