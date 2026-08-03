import { z } from 'zod';

export const originSchema = z.enum(['web', 'agent', 'hook']);
export type Origin = z.infer<typeof originSchema>;

export const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'SessionEnd'] as const;
export const hookEventNameSchema = z.enum(HOOK_EVENTS);
export type HookEventName = z.infer<typeof hookEventNameSchema>;

export const registerSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8).max(200),
  displayName: z.string().trim().min(1).max(64).optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string().nullable(),
});
export type UserPublic = z.infer<typeof userSchema>;

export const memoryCreateSchema = z.object({
  content: z.string().trim().min(1).max(100_000),
});
export type MemoryCreateInput = z.infer<typeof memoryCreateSchema>;

export const memoryUpdateSchema = memoryCreateSchema;
export type MemoryUpdateInput = z.infer<typeof memoryUpdateSchema>;

export const memorySchema = z.object({
  id: z.string().uuid(),
  content: z.string(),
  origin: originSchema,
  eventId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MemoryPublic = z.infer<typeof memorySchema>;

export const recallSchema = z.object({
  query: z.string().trim().min(1).max(10_000),
  limit: z.number().int().min(1).max(50).optional(),
});
export type RecallInput = z.infer<typeof recallSchema>;

export const tokenCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
});
export type TokenCreateInput = z.infer<typeof tokenCreateSchema>;

export const tokenSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  preview: z.string(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type TokenPublic = z.infer<typeof tokenSchema>;

export const mcpCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
});
export type McpCreateInput = z.infer<typeof mcpCreateSchema>;

export const mcpClientSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  tokenPreview: z.string(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type McpClientPublic = z.infer<typeof mcpClientSchema>;

export const hookIngestSchema = z.object({
  eventId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/),
  hook: hookEventNameSchema,
  content: z.string().trim().min(1).max(100_000),
});
export type HookIngestInput = z.infer<typeof hookIngestSchema>;
