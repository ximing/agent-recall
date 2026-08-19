# agent-recall

自托管的 agent 记忆系统：为你的 coding agent（Claude Code / Codex CLI / OpenCode / pi）提供跨会话的长期记忆——写入、检索、注入、治理一条龙，数据完全在你自己手里。

pnpm monorepo，默认零外部依赖即可跑起来（内嵌 PGlite 作为 Postgres），检索能力按需接入 Meilisearch 与 Qdrant。

## 架构

```
                        ┌────────────────────────────────────────────┐
                        │              apps/server (Fastify)          │
                        │                                             │
  Claude Code ─┐        │   /api/hooks/events   /api/hooks/context    │
  Codex CLI    ├─hooks──▶│        │                   │               │
  OpenCode     ┘ (token) │        ▼                   ▼               │
  pi            plugins/ │   写入治理 ──▶ 检索管道（双路召回 + 融合）   │
                         │   幂等/去重      Meilisearch 全文          │
  Agent ────MCP stdio───▶│   隐私清洗       Qdrant 向量               │
            (apps/mcp,   │                RRF 融合 + 可选精排          │
             token)      │        │                   │               │
                         │        ▼                   ▼               │
  浏览器 ────cookie─────▶│      PGlite / Postgres (Drizzle ORM)        │
         (apps/web 管理端)│      数据默认在 ~/.agent-recall/pgdata     │
                         └────────────────────────────────────────────┘
```

三个接入面：

- **MCP（`apps/mcp`）**：stdio MCP server，手写 JSON-RPC、零 SDK 依赖，向 agent 暴露 18 个 `memory_*` 工具（save/recall/context/update/forget/export 等）。agent 通过工具主动存取记忆。
- **Hooks（`plugins/`）**：Claude Code、Codex CLI、OpenCode、pi 四端 native 插件。SessionStart/UserPromptSubmit 自动召回注入上下文，PostToolUse 捕获工具观察，SessionEnd 触发服务端自动生成会话摘要。每次调用 2s 超时，失败落本地 spool 补投，绝不阻塞宿主。
- **管理端（`apps/web`）**：React（@rabjs/react）Web 界面，管理记忆（筛选/搜索/富文本编辑/版本历史 diff/批量删除/导入导出/统计）、令牌、MCP 客户端和设置（rerank、自动遗忘、召回历史）。

## 快速开始

依赖：

- Node.js >= 22，pnpm 10
- Meilisearch（全文召回，可选）
- Qdrant（向量召回，可选）

Meilisearch 和 Qdrant 都是可选的：不配置时对应召回路径自动降级，系统仍可运行（仅剩的关系型检索路径继续工作）。要获得完整的双路召回 + RRF 融合效果，建议两者都配上。

```bash
git clone <repo> && cd agent-recall
pnpm install

# 启动 server（默认 http://127.0.0.1:8787，内嵌 PGlite）
pnpm --filter @agent-recall/server dev

# 另开终端，启动管理端
pnpm --filter @agent-recall/web dev
```

首次使用：打开管理端注册账号 → 在「令牌」页创建 access token → 在「MCP 客户端」页创建客户端（自动签发 token 并生成 MCP 配置 JSON）→ 把配置贴进你的 agent。

## 配置

`apps/server` 环境变量：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `8787` | 监听端口 |
| `HOST` | `127.0.0.1` | 监听地址 |
| `DATA_DIR` | `~/.agent-recall` | 数据目录（PGlite 数据、加密密钥等） |
| `DATABASE_URL` | （内嵌 PGlite） | 设置后改用外部 Postgres |
| `MEILI_URL` / `MEILI_API_KEY` / `MEILI_INDEX` | （关闭全文召回） | Meilisearch 连接 |
| `QDRANT_URL` / `QDRANT_API_KEY` / `QDRANT_COLLECTION` | （关闭向量召回） | Qdrant 连接 |
| `EMBEDDING_API_KEY` / `EMBEDDING_BASE_URL` / `EMBEDDING_MODEL` / `EMBEDDING_DIMENSIONS` | DashScope `qwen3-vl-embedding`，2560 维 | 向量 embedding 服务 |
| `PUBLIC_BASE_URL` | — | 对外 base URL（生成 MCP 配置等） |
| `WEB_ORIGIN` | — | 管理端来源（CORS） |
| `COOKIE_SECURE` | — | 置为 `true` 时 session cookie 仅走 HTTPS |

`apps/mcp` 与 `plugins/` 共用两个变量：`AGENT_RECALL_URL`（默认 `http://127.0.0.1:8787`）、`AGENT_RECALL_TOKEN`（Bearer token，`arm_` 前缀）。插件另有 `AGENT_RECALL_SPOOL_DIR`、`AGENT_RECALL_TOKEN_BUDGET`、`AGENT_RECALL_PROJECT`、`AGENT_RECALL_DISABLED`，详见 `plugins/README.md`。

## 使用

### 管理端

`pnpm --filter @agent-recall/web dev` 启动后登录，页面包括：记忆（筛选/搜索/编辑/版本历史/批量删除/导入导出/统计）、令牌、MCP 客户端、设置（DashScope rerank 配置、自动遗忘天数、召回历史）。

### MCP

在管理端创建 MCP 客户端后会得到一段配置，形如（Claude Code `mcpServers`）：

```json
{
  "mcpServers": {
    "agent-recall": {
      "command": "node",
      "args": ["/path/to/agent-recall/apps/mcp/dist/index.js"],
      "env": {
        "AGENT_RECALL_URL": "http://127.0.0.1:8787",
        "AGENT_RECALL_TOKEN": "arm_..."
      }
    }
  }
}
```

暴露的 18 个工具：

- 写入：`memory_save`、`memory_remember`、`memory_lesson_save`、`memory_update`、`memory_import`
- 读取：`memory_recall`、`memory_smart_search`、`memory_context`、`memory_list`、`memory_get`、`memory_versions`、`memory_sessions`、`memory_session_timeline`、`memory_stats`、`memory_export`
- 遗忘：`memory_forget`、`memory_batch_forget`、`memory_auto_forget`

### 四端插件

`plugins/` 下有 Claude Code、Codex CLI、OpenCode、pi 四个 native 插件，行为一致：SessionStart/UserPromptSubmit 召回注入、PostToolUse 观察捕获、SessionEnd 摘要。以 Claude Code 为例，从本地 checkout 安装：

```bash
claude plugin marketplace add /path/to/agent-recall/plugins
claude plugin install agent-recall@agent-recall
```

其余三端安装方式与配置项见 `plugins/README.md`。所有宿主共用一个离线 spool（`~/.agent-recall/spool/events.jsonl`），网络失败的事件用 `node plugins/shared/drain.mjs` 统一补投。

## 记忆模型与检索管道

### 记忆模型

每条记忆包含：`content`、`origin`（web / agent / hook / import / summary）、`type`（fact / preference / pattern / architecture / bug / workflow / lesson）、`tags`、`project`、`sessionId`、`expiresAt`，以及：

- **版本链**：编辑即产生新版本（`chainId` / `parentId` / `version` / `isLatest`），旧版本退出检索但保留，可回溯、可 diff。
- **命中反馈**：`accessCount` / `lastAccessedAt` 记录召回命中情况，供治理与排序参考。

### 写入治理

- `eventId` 幂等：重复事件安全重放。
- 内容哈希 5 分钟窗口去重。
- 隐私清洗：入库前自动脱敏 API key、bearer token、PEM 块、URL 内嵌凭据、`<private>` 标签内容。
- PostToolUse 噪音过滤：TodoWrite 等无信息量工具不入库，清洗后过短的观察丢弃。

### 检索管道

Meilisearch 全文 + Qdrant 向量（DashScope embedding）双路召回，RRF（k=60）融合；可选 DashScope `gte-rerank-v2` 精排（用户级设置，API key 以 AES-256-GCM 加密落库，密钥在 `~/.agent-recall/.secret`），精排失败自动回退 RRF 结果。每次召回记录策略、分数、延迟到召回日志（30 天滚动），管理端可查。

`/api/hooks/context` 是召回注入闭环：hook 拿 prompt 换格式化好的注入文本，默认预算 2000 token，且 hook 原始碎片不参与注入（只注入 web/agent/summary/import 来源）。

### 衰减与治理

- `expiresAt` 过期的记忆自动退出检索。
- 自动遗忘：清理过期记忆 + 超过 `autoForgetDays` 的低价值 hook 碎片（设置页可配）。
- 批量删除：按 ids 或过滤器，支持 `dryRun` 预览。
- 导出/导入：`agent-recall/v1` 格式，冲突策略 skip / merge / replace。

## API 概览

认证双通道：网页用 httpOnly cookie session（argon2id 密码），agent/hook 用 `Authorization: Bearer arm_...`（sha256 存库）。下表「认证」列：cookie = 仅网页 session，token = 仅 Bearer token，两者 = 均可。

| 端点 | 认证 | 说明 |
|---|---|---|
| `GET /health` | 无 | 健康检查 |
| `POST /api/auth/register` / `login` / `logout`，`GET /api/auth/me` | 无 / cookie | 账号与 session |
| `GET/POST /api/memories`，`GET/PATCH/DELETE /api/memories/:id` | 两者 | 记忆 CRUD（PATCH 产生新版本） |
| `GET /api/memories/:id/versions` | 两者 | 版本链 |
| `POST /api/memories/recall` / `smart-search` | 两者 | 检索 |
| `GET /api/memories/recall-logs` / `stats` | 两者 | 召回日志 / 统计 |
| `GET /api/memories/export`，`POST /api/memories/import` | 两者 | 导出 / 导入 |
| `POST /api/memories/batch-forget` / `auto-forget` | 两者 | 批量删除 / 自动遗忘 |
| `GET /api/sessions`，`GET /api/sessions/:sessionId` | 两者 | 会话列表 / 时间线 |
| `POST /api/hooks/events` | token | hook 事件写入（SessionEnd 自动生成摘要） |
| `POST /api/hooks/context` | token | 召回注入（`{query, tokenBudget?}`） |
| `GET/POST /api/tokens`，`POST /api/tokens/:id/revoke` | cookie | access token 管理 |
| `GET/POST /api/mcp/clients`，`POST /api/mcp/clients/:id/revoke` | cookie | MCP 客户端（创建时签发 token + 生成配置） |
| `GET/PUT /api/settings` | 两者 | 用户设置（rerank、自动遗忘等） |

## 开发

```
apps/
  server/    Fastify + Drizzle ORM + PGlite：API、写入治理、检索管道
  mcp/       stdio MCP server（手写 JSON-RPC，零 SDK 依赖）
  web/       React 管理端（@rabjs/react + Vite）
packages/
  dto/       共享 zod schema / 类型
plugins/     四端 native 插件 + shared client/spool
design/      设计文档
```

常用命令：

```bash
pnpm install
pnpm dev                                  # server + web 并行（先构建 dto）
pnpm --filter @agent-recall/server dev    # 只起 server
pnpm --filter @agent-recall/web dev       # 只起 web
pnpm test                                 # server 测试（vitest）
pnpm typecheck
pnpm build
```

评测 harness 见 `eval/`（`pnpm eval`）。
