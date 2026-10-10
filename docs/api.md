# HTTP API

给要直接调用服务的人。日常使用走网页和 MCP，不必记这些路径。

认证列：无、cookie、token、两者。两者表示网页登录会话或 `Authorization: Bearer arm_...` 都可以。

| 端点 | 认证 | 说明 |
|---|---|---|
| `GET /health` | 无 | 健康检查 |
| `POST /api/auth/register`、`/login` | 无 | 注册或登录，并种下 session cookie |
| `POST /api/auth/logout` | 无 | 清掉 session |
| `GET /api/auth/me` | 两者 | 当前用户 |
| `GET` `POST /api/memories`，`GET` `PATCH` `DELETE /api/memories/:id` | 两者 | 记忆 CRUD。PATCH 产生新版本 |
| `GET /api/memories/:id/versions` | 两者 | 版本链 |
| `POST /api/memories/recall`、`/smart-search`、`/context` | 两者 | 检索，以及与钩子相同的注入预览 |
| `GET /api/memories/recall-logs`、`/stats`、`/projects` | 两者 | 召回日志、统计、已有项目。项目列表可用 `q` 按名称包含匹配 |
| `GET /api/memories/export`，`POST /api/memories/import` | 两者 | 导出、导入 |
| `POST /api/memories/batch-forget`、`/auto-forget`、`/consolidate` | 两者 | 批量删除、自动遗忘、合并。哈希合并始终执行；语义合并要用户在设置里配过大模型 |
| `POST /api/memories/:id/share`，`GET /api/memories/shared-feed` | 两者 | 向队友发送邀请（对方接受前不复制）、查看已接受的分享 |
| `GET /api/shares/incoming`，`POST /api/shares/:id/accept`、`/reject` | 两者 | 列出、接受或拒绝收到的邀请 |
| `POST /api/memories/reflect` | 两者 | 生成反思 |
| `GET /api/sessions`，`GET /api/sessions/:sessionId` | 两者 | 会话列表、时间线。列表可用 `q` 按会话 ID 或项目名包含匹配 |
| `POST /api/sessions/:sessionId/crystallize` | 两者 | 把一场会话收成摘要 |
| `POST /api/hooks/events` | token | 插件写入。SessionEnd 时生成摘要 |
| `POST /api/hooks/context` | token | `{ query, tokenBudget?, project? }`，返回可注入的文本 |
| `GET` `POST /api/tokens`，`POST /api/tokens/:id/revoke` | cookie | access token |
| `GET` `POST /api/mcp/clients`，`POST /api/mcp/clients/:id/revoke` | cookie | MCP 客户端 |
| `GET /api/mcp/tools` | 两者 | 服务端工具目录。`?profile=core\|standard\|full`，不含本机文件工具 |
| `POST /api/mcp/tools/call` | 两者 | 执行一个服务端工具。`{ name, arguments, profile? }` |
| `POST /mcp` | token | 远程 MCP，无状态 JSON-RPC。`initialize`、`tools/list`、`tools/call`、`ping`。GET 和 DELETE 为 405。不使用网页 cookie。`?profile=` 或请求头 `x-agent-recall-profile` 选档，默认 full 的 62 个服务器工具 |
| `GET` `POST /api/llm-configs`，`PUT` `DELETE /api/llm-configs/:id`，`PUT /:id/default`，`POST /:id/test` | 两者 | 用户自己的对话模型。提供商 openai、deepseek、claude、zhipu、dashscope。密钥加密，响应只有预览 |
| `GET /api/llm-usage` | 两者 | 最近调用记录，默认 50 条，最多 100 条。`byCapability`、`totalCost`、`totalTokens` 是该用户全部调用的合计，固定包含对话、向量、精排，没有记录时为 0。金额是公开单价估算 |
| `GET` `PUT /api/settings` | 两者 | 精排、自动遗忘等 |
| `GET` `PUT` `DELETE /api/kv/:namespace/:key`，`GET /api/kv/:namespace`，`POST .../append` | 两者 | KV：槽位、信号、档案、租约 |
| `GET /api/graph/query`，`GET /api/memories/:id/relations` | 两者 | 关系图 |
| `POST` `GET /api/snapshots`，`POST /api/snapshots/:id/restore` | 两者 | 快照与恢复 |
| `GET /api/admin/diagnose`，`POST /api/admin/heal`，`GET /api/audit` | 两者 | 体检、修复、审计。按当前用户，不是全局管理员 |

导出格式是 `agent-recall/v1`。导入冲突策略为 skip、merge、replace。

钩子写入和钩子注入只接受令牌。用网页登录会话调用会得到 403。控制台预览注入使用 `POST /api/memories/context`。
