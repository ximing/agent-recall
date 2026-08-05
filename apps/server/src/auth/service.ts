import { randomUUID } from 'node:crypto';
import type { McpClientPublic, TokenPublic, UserPublic } from '@agent-recall/dto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { accessTokens, mcpClients, sessions, users } from '../db/schema.js';
import { isUniqueViolation } from '../db/errors.js';
import { AppError } from '../errors.js';
import { hashPassword, verifyPassword } from './password.js';
import {
  generateAccessToken,
  generateSessionToken,
  hashSecret,
  previewSecret,
  SESSION_TTL_MS,
} from './token-logic.js';

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toUser(row: typeof users.$inferSelect): UserPublic {
  return { id: row.id, email: row.email, displayName: row.displayName };
}

export async function registerUser(
  db: Database,
  input: { email: string; password: string; displayName?: string },
): Promise<{ user: UserPublic; sessionToken: string }> {
  const email = input.email.toLowerCase();
  const now = new Date();
  const displayName = input.displayName ?? email.split('@')[0] ?? email;
  try {
    const inserted = await db
      .insert(users)
      .values({
        id: randomUUID(),
        email,
        passwordHash: await hashPassword(input.password),
        displayName,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const user = inserted[0];
    if (!user) throw new AppError(500, 'INTERNAL', '注册失败');
    const sessionToken = await createSession(db, user.id);
    return { user: toUser(user), sessionToken };
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError(409, 'CONFLICT', '邮箱已注册');
    throw err;
  }
}

export async function loginUser(
  db: Database,
  input: { email: string; password: string },
): Promise<{ user: UserPublic; sessionToken: string }> {
  const email = input.email.toLowerCase();
  const found = await db.select().from(users).where(eq(users.email, email));
  const user = found[0];
  if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
    throw new AppError(401, 'UNAUTHORIZED', '邮箱或密码错误');
  }
  const sessionToken = await createSession(db, user.id);
  return { user: toUser(user), sessionToken };
}

async function createSession(db: Database, userId: string): Promise<string> {
  const sessionToken = generateSessionToken();
  const now = new Date();
  await db.insert(sessions).values({
    id: randomUUID(),
    userId,
    tokenHash: hashSecret(sessionToken),
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    createdAt: now,
  });
  return sessionToken;
}

export async function userFromSession(db: Database, rawToken: string): Promise<{ userId: string } | null> {
  const found = await db.select().from(sessions).where(eq(sessions.tokenHash, hashSecret(rawToken)));
  const session = found[0];
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;
  return { userId: session.userId };
}

export async function deleteSession(db: Database, rawToken: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashSecret(rawToken)));
}

export async function getUser(db: Database, userId: string): Promise<UserPublic> {
  const found = await db.select().from(users).where(eq(users.id, userId));
  const user = found[0];
  if (!user) throw new AppError(401, 'UNAUTHORIZED', '未登录');
  return toUser(user);
}

export async function userFromAccessToken(db: Database, rawToken: string): Promise<{ userId: string } | null> {
  const found = await db
    .select()
    .from(accessTokens)
    .where(and(eq(accessTokens.tokenHash, hashSecret(rawToken)), isNull(accessTokens.revokedAt)));
  const token = found[0];
  if (!token) return null;
  return { userId: token.userId };
}

function toToken(row: typeof accessTokens.$inferSelect): TokenPublic {
  return {
    id: row.id,
    name: row.name,
    preview: row.preview,
    revokedAt: iso(row.revokedAt),
    createdAt: iso(row.createdAt) ?? '',
  };
}

export async function createAccessToken(
  db: Database,
  userId: string,
  name: string,
): Promise<{ token: TokenPublic; secret: string }> {
  const secret = generateAccessToken();
  const now = new Date();
  const inserted = await db
    .insert(accessTokens)
    .values({
      id: randomUUID(),
      userId,
      name,
      tokenHash: hashSecret(secret),
      preview: previewSecret(secret),
      revokedAt: null,
      createdAt: now,
    })
    .returning();
  const row = inserted[0];
  if (!row) throw new AppError(500, 'INTERNAL', '创建令牌失败');
  return { token: toToken(row), secret };
}

export async function listAccessTokens(db: Database, userId: string): Promise<TokenPublic[]> {
  const rows = await db
    .select()
    .from(accessTokens)
    .where(eq(accessTokens.userId, userId))
    .orderBy(desc(accessTokens.createdAt));
  return rows.map(toToken);
}

export async function revokeAccessToken(db: Database, userId: string, tokenId: string): Promise<TokenPublic> {
  const found = await db
    .select()
    .from(accessTokens)
    .where(and(eq(accessTokens.id, tokenId), eq(accessTokens.userId, userId)));
  const row = found[0];
  if (!row) throw new AppError(404, 'NOT_FOUND', '令牌不存在');
  if (row.revokedAt) return toToken(row);
  const revokedAt = new Date();
  const updated = await db
    .update(accessTokens)
    .set({ revokedAt })
    .where(eq(accessTokens.id, row.id))
    .returning();
  const next = updated[0];
  if (!next) throw new AppError(500, 'INTERNAL', '吊销令牌失败');
  await db.update(mcpClients).set({ revokedAt }).where(eq(mcpClients.tokenId, row.id));
  return toToken(next);
}

export async function createMcpClient(
  db: Database,
  userId: string,
  name: string,
): Promise<{ client: McpClientPublic; secret: string; tokenId: string }> {
  const created = await createAccessToken(db, userId, `mcp:${name}`);
  const now = new Date();
  const inserted = await db
    .insert(mcpClients)
    .values({
      id: randomUUID(),
      userId,
      name,
      tokenId: created.token.id,
      revokedAt: null,
      createdAt: now,
    })
    .returning();
  const row = inserted[0];
  if (!row) throw new AppError(500, 'INTERNAL', '注册 MCP 客户端失败');
  return {
    client: {
      id: row.id,
      name: row.name,
      tokenPreview: created.token.preview,
      revokedAt: null,
      createdAt: iso(row.createdAt) ?? '',
    },
    secret: created.secret,
    tokenId: created.token.id,
  };
}

export async function listMcpClients(db: Database, userId: string): Promise<McpClientPublic[]> {
  const rows = await db
    .select({
      id: mcpClients.id,
      name: mcpClients.name,
      revokedAt: mcpClients.revokedAt,
      createdAt: mcpClients.createdAt,
      preview: accessTokens.preview,
      tokenRevokedAt: accessTokens.revokedAt,
    })
    .from(mcpClients)
    .innerJoin(accessTokens, eq(mcpClients.tokenId, accessTokens.id))
    .where(eq(mcpClients.userId, userId))
    .orderBy(desc(mcpClients.createdAt));
  return rows.map((row) => {
    const revoked = row.revokedAt ?? row.tokenRevokedAt;
    return {
      id: row.id,
      name: row.name,
      tokenPreview: row.preview,
      revokedAt: iso(revoked),
      createdAt: iso(row.createdAt) ?? '',
    };
  });
}

export async function revokeMcpClient(db: Database, userId: string, clientId: string): Promise<McpClientPublic> {
  const found = await db
    .select()
    .from(mcpClients)
    .where(and(eq(mcpClients.id, clientId), eq(mcpClients.userId, userId)));
  const row = found[0];
  if (!row) throw new AppError(404, 'NOT_FOUND', 'MCP 客户端不存在');
  const revokedAt = row.revokedAt ?? new Date();
  await db.update(mcpClients).set({ revokedAt }).where(eq(mcpClients.id, row.id));
  await db.update(accessTokens).set({ revokedAt }).where(eq(accessTokens.id, row.tokenId));
  const tokens = await db.select().from(accessTokens).where(eq(accessTokens.id, row.tokenId));
  const token = tokens[0];
  return {
    id: row.id,
    name: row.name,
    tokenPreview: token?.preview ?? '',
    revokedAt: iso(revokedAt),
    createdAt: iso(row.createdAt) ?? '',
  };
}
