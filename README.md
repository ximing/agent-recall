# agent-recall

自托管的 agent 记忆服务。给 Claude Code、Codex CLI、OpenCode、pi，以及任何能说 MCP 的 coding agent。

下次开会话，它还记得上次的架构决定、踩过的坑，以及你说过要记住的偏好。网页首页可以直接打开，不用登录，上面写着这个项目做什么、66 个工具分别是什么、怎么接上你的 agent。

记忆存在你配置的 Postgres 里。`DATABASE_URL` 必填，指向远端数据库。Meilisearch 和 Qdrant 按需再配。

- [快速开始](#快速开始)
- [接哪些 agent](#接哪些-agent)
- [一次会话里发生什么](#一次会话里发生什么)
- [它怎么工作](#它怎么工作)
- [检索](#检索)
- [MCP 工具](#mcp-工具)
- [网页](#网页)
- [插件](#插件)
- [配置](#配置)
- [API](#api)
- [开发](#开发)

---

## 快速开始

依赖：

- Node.js 22 或更新，pnpm 10
- Meilisearch、Qdrant 按需安装。不配的那一路会跳过，关系库里的检索继续可用

```bash
git clone <repo> && cd agent-recall
pnpm install
pnpm dev
```

`pnpm dev` 同时启动：

| 进程 | 地址 | 作用 |
|---|---|---|
| `@agent-recall/server` | http://127.0.0.1:8787 | API。`GET /health` 不需要登录 |
| `@agent-recall/web` | http://127.0.0.1:5178 | 网页。`/` 是公开说明页 |

然后：

1. 打开 http://127.0.0.1:5178 读说明。点「登录」注册账号。
2. 在「MCP 客户端」注册一个客户端。页面给出可粘贴的配置，令牌只显示这一次。也可以先在「令牌」页单独建一把 `arm_` 开头的 access token。
3. 把「MCP 客户端」页给出的配置贴进 agent。本机要有 Node 22。`npx` 会拉取已发布的包，不需要仓库里的 `apps/mcp/dist`：

```json
{
  "mcpServers": {
    "agent-recall": {
      "command": "npx",
      "args": ["-y", "@yeanzhi/agent-recall-mcp"],
      "env": {
        "AGENT_RECALL_URL": "http://127.0.0.1:8787",
        "AGENT_RECALL_TOKEN": "arm_..."
      }
    }
  }
}
```

4. 要自动注入，再装 [插件](#插件)。四种宿主的逐步命令在 `plugins/README.md`。

生产环境把构建好的网页交给服务器：设置 `NODE_ENV=production`（服务器会找 `apps/web/dist`），或显式设置 `WEB_DIST`。同一个端口托管站点，首页同样公开。

```bash
pnpm build
NODE_ENV=production pnpm start:prod
```

---

## 接哪些 agent

一条记忆服务，所有宿主共用。

| 宿主 | 接入 | 行为 |
|---|---|---|
| Claude Code | `plugins/claude-code/`，4 个 hook，再加 MCP | SessionStart / UserPromptSubmit 注入，PostToolUse 记观察，SessionEnd 触发摘要 |
| Codex CLI | `plugins/codex/`，同一套 4 个 hook，再加 MCP | 载荷和 Claude Code 兼容 |
| OpenCode | `plugins/opencode/`，1.x 和 2.x | 注入进系统提示词；另有 `/recall` |
| pi | `plugins/pi/` | 生命周期钩子，外加 `memory_recall` 工具 |
| 其他 MCP 客户端 | 只配上面的 stdio MCP（`npx -y @yeanzhi/agent-recall-mcp`） | 66 个 `memory_*` 工具，没有自动注入 |

插件每次请求 2 秒超时，失败写入 `~/.agent-recall/spool/events.jsonl`。补投：

```bash
node plugins/shared/drain.mjs
```

---

## 一次会话里发生什么

上一场你定过：默认数据库用远端 Postgres，检索接 Meilisearch 和 Qdrant，令牌前缀是 `arm_`。这些被记成记忆。

下一场你问「召回的两路是怎么融合的」。SessionStart 和这条提问会调用 `POST /api/hooks/context`。服务器按问题召回，把裁剪过的上下文交回插件，插件写进宿主的上下文。你不用把上次的结论再贴一遍。

你让它记住一条新决定时，agent 调用 `memory_remember`。工具观察由 PostToolUse 记下。会话结束时，服务器生成这场会话的摘要。

注入只用最新、未过期、来源为 web / agent / summary / import 的记忆。Hook 当场记下的原始碎片留在库里，不自动塞回提示词。

---

## 它怎么工作

```
                        ┌────────────────────────────────────────────┐
                        │              apps/server (Fastify)          │
                        │                                             │
  Claude Code ─┐        │   /api/hooks/events   /api/hooks/context    │
  Codex CLI    ├─hooks──▶│        │                   │               │
  OpenCode     ┘ (token) │        ▼                   ▼               │
  pi            plugins/ │   写入治理 ──▶ 检索（全文 + 向量 + RRF）    │
                         │   幂等 / 去重     Meilisearch              │
  Agent ────MCP stdio───▶│   隐私清洗        Qdrant                   │
            (apps/mcp,   │                  可选精排                  │
             token)      │        │                   │               │
                         │        ▼                   ▼               │
  浏览器 ────cookie─────▶│           Postgres (Drizzle)               │
         (apps/web)      │         DATABASE_URL 远端数据库            │
                         └────────────────────────────────────────────┘
```

三个接入面：

- **MCP（`apps/mcp`，发布为 `@yeanzhi/agent-recall-mcp`）**。stdio，手写 JSON-RPC，运行时零依赖。宿主拉起这个包。包向 `GET /api/mcp/tools` 要工具目录，用 `POST /api/mcp/tools/call` 执行。服务端新增不碰本机文件的工具时，不用发新的 npm 包。压缩源文件、同步 MEMORY.md、导出 Obsidian 这三件留在包里，改它们才需要发布。
- **插件（`plugins/`）**。四个宿主的 native 插件。负责自动召回注入和观察捕获。
- **网页（`apps/web`）**。React（`@rabjs/react`）。首页公开。控制台要登录，用来管理记忆、会话、状态、关系、治理、令牌、MCP 客户端和设置。

一条记忆包含 `content`、`origin`（web / agent / hook / import / summary）、`type`（fact / preference / pattern / architecture / bug / workflow / lesson）、`tags`、`project`、`sessionId`、`expiresAt`。

编辑生成新版本（`chainId` / `parentId` / `version` / `isLatest`）。旧版本退出检索，可以回溯、可以 diff。`accessCount` 和 `lastAccessedAt` 记录被召回的情况。

写入时：

- `eventId` 幂等，重复事件可以安全重放。
- 内容哈希在 5 分钟窗口内去重。
- 入库前去掉 API key、Bearer token、PEM、URL 里的凭据，以及 `<private>` 标签中的内容。
- TodoWrite 这类没有信息量的 PostToolUse 不入库。清洗后过短的观察丢弃。

---

## 检索

`memory_recall` 和 `POST /api/memories/recall`：Meilisearch 全文加 Qdrant 向量，RRF（k=60）融合。

`memory_smart_search` 和 `POST /api/memories/smart-search`：更大的候选池。用户在设置里打开精排后，使用 DashScope `gte-rerank-v2`。精排失败时退回 RRF 结果。API key 以 AES-256-GCM 加密落库，主密钥是环境变量 `ENCRYPTION_KEY`。

向量默认走 DashScope `qwen3-vl-embedding`，2560 维。没配 `QDRANT_URL` 时不做向量召回。没配 `MEILI_URL` 时不做全文召回。

`POST /api/hooks/context` 用提问换一段格式化文本，默认预算 2000 token。

过期记忆自动退出检索。自动遗忘会清掉过期记忆，以及超过 `autoForgetDays` 的低价值 hook 碎片，天数在设置页改。每次召回把策略、分数、延迟写入召回日志，保留 30 天，控制台可以看。

`eval/` 是这条管道的回归评测：40 条语料、18 个标注查询，对比 RRF 和 RRF+精排。里面的检索后端是确定性替身，分数用来守住管道还在正确工作，不代表真实语义质量。跑法见 `eval/README.md`。

---

## MCP 工具

66 个。日常先用这 7 个：

| 工具 | 什么时候用 |
|---|---|
| `memory_remember` | 用户明确说记住一件事 |
| `memory_recall` | 有一个具体问题 |
| `memory_smart_search` | 问题含糊，普通召回可能漏 |
| `memory_context` | 要一段能直接放进提示词的上下文 |
| `memory_update` | 改正一条已有记忆，旧版保留 |
| `memory_forget` | 删掉整条版本链 |
| `memory_next` | 会话刚开始，先看未完成的行动和最近的记忆 |

其余按组。参数和取舍写在工具自己的 description 里，agent 调工具时能看见。网页首页有同一份名单，可以筛选。

### 写入与遗忘

| 工具 | 作用 |
|---|---|
| `memory_save` | 保存一条记忆。近重复返回已有记录，并带 `deduped` |
| `memory_remember` | 同 save，表示用户要求保留 |
| `memory_lesson_save` | 存成 lesson |
| `memory_update` | 编辑并产生新版本 |
| `memory_import` | 从导出包导入。`skip` / `merge` / `replace`，默认 skip |
| `memory_forget` | 按 id 删除整条版本链 |
| `memory_batch_forget` | 按 id 或过滤条件批量删除，可 `dryRun` |
| `memory_auto_forget` | 清理过期记忆和低价值旧碎片，可 `dryRun` |
| `memory_lesson_delete` | 只删除 lesson，其他类型会拒绝 |
| `memory_governance_delete` | 按策略批量删除，并记下原因 |

### 召回

| 工具 | 作用 |
|---|---|
| `memory_recall` | 词法 + 向量融合 |
| `memory_smart_search` | 更大候选池，带精排分数 |
| `memory_context` | 按 token 预算裁好的上下文 |
| `memory_lesson_recall` | 只在 lesson 里召回 |
| `memory_patterns` | 列出或搜索 pattern |
| `memory_insight_list` | 最近的 lesson 和 pattern |
| `memory_vision_search` | 带 `vision` 标签的记忆 |
| `memory_file_history` | 按文件路径找摘要 |
| `memory_commits` | 带 `commit` 标签的记忆 |
| `memory_commit_lookup` | 按 commit SHA 查找 |

### 浏览

| 工具 | 作用 |
|---|---|
| `memory_list` | 分页浏览，可过滤，不做语义排序 |
| `memory_get` | 按 id 取一条，含版本和访问统计 |
| `memory_versions` | 一条记忆的全部版本 |
| `memory_sessions` | 产生过记忆的会话 |
| `memory_session_timeline` | 一个会话的时间线 |
| `memory_timeline` | 按创建时间浏览；给了 sessionId 就只看那场 |
| `memory_frontier` | 最新的记忆，默认 10 条 |
| `memory_next` | 开场简报：未完成行动、最近会话、最新 5 条 |
| `memory_stats` | 总量、分布、过期、待索引 |
| `memory_verify` | 是否还在、是不是最新版、有没有过期 |
| `memory_export` | 导出全部记忆为 JSON |

### 当场记下

| 工具 | 作用 |
|---|---|
| `memory_sketch_create` | 24 小时后过期的草稿 |
| `memory_sketch_promote` | 把草稿留成永久记忆 |
| `memory_compress_file` | 读本地文件（最大 200KB），抽出大纲，存成 `file-summary` |
| `memory_claude_bridge_sync` | 和本地 `MEMORY.md` 双向同步 |
| `memory_checkpoint` | 把一份 JSON 状态存进 KV，同名覆盖 |

### 状态

存在 KV 里，不进召回排序。

| 工具 | 作用 |
|---|---|
| `memory_signal_send` / `memory_signal_read` | 追加或读取命名信号日志 |
| `memory_action_create` / `memory_action_update` | 行动项。状态 `open` / `done` / `blocked` |
| `memory_sentinel_create` / `memory_sentinel_trigger` | 要盯住的条件，以及触发记录 |
| `memory_slot_create` / `memory_slot_replace` | 命名槽位，存任意 JSON |
| `memory_slot_append` / `memory_slot_get` | 追加或读取槽位 |
| `memory_slot_list` / `memory_slot_delete` | 列出或删除槽位 |
| `memory_profile` | 读或写档案。不传 key 列出全部 |
| `memory_lease` | 带 TTL 的租约。已被占用时返回持有者 |
| `memory_routine_run` | 读取某个 routine 的步骤。不存在则报错 |

### 关系与分面

| 工具 | 作用 |
|---|---|
| `memory_graph_query` | 用一段文本查关系图 |
| `memory_relations` | 和某一条记忆有关的其他记忆 |
| `memory_facet_tag` | 打上 `维度:值` 标签 |
| `memory_facet_query` | 按维度和值查找 |

### 共享与导出

| 工具 | 作用 |
|---|---|
| `memory_mesh_sync` | 和另一台 agent-recall 同步 |
| `memory_team_share` | 按邮箱把一条记忆分给队友 |
| `memory_team_feed` | 别人分给你的记忆 |
| `memory_obsidian_export` | 每条记忆一个带 frontmatter 的 Markdown 文件 |

### 整理

| 工具 | 作用 |
|---|---|
| `memory_crystallize` | 把一场会话收成一条摘要 |
| `memory_reflect` | 根据最近几天写一条反思 |
| `memory_consolidate` | 合并近似重复，可 `dryRun` |
| `memory_heal` | 重新索引，并跑一遍自动遗忘 |
| `memory_diagnose` | 体检，返回问题和建议 |
| `memory_audit` | 最近的审计记录 |
| `memory_snapshot_create` | 给整个记忆库做快照。恢复走 `POST /api/snapshots/:id/restore` |

---

## 网页

| 路径 | 登录 | 内容 |
|---|---|---|
| `/` | 不用 | 说明：项目做什么、怎么启动、66 个工具。可按名字或用途筛选 |
| `/login` | 不用 | 登录 / 注册 |
| `/memories` | 要 | 筛选、召回、精排、注入预览、按筛选删除、分享、相关记忆、草图转正、版本 diff、导入导出 |
| `/sessions` | 要 | 会话列表、时间线、结晶 |
| `/state` | 要 | 简报，以及行动、信号、哨兵、槽位、档案、租约、例程、检查点 |
| `/graph` | 要 | 由记忆推导出的关系图 |
| `/ops` | 要 | 诊断、自愈、合并、反思、快照、分享订阅、Mesh、审计 |
| `/tokens` | 要 | access token。明文只在创建时出现 |
| `/mcp` | 要 | MCP 客户端。创建时签发令牌并生成配置 JSON |
| `/settings` | 要 | 精排、自动遗忘天数、召回历史 |

未登录访问控制台会被送到 `/login`。登录页可以回到说明。

---

## 插件

安装整棵 `plugins/` 树。Claude Code 和 Codex 的脚本依赖 `plugins/shared/client.mjs`。

Claude Code：

```bash
claude plugin marketplace add /path/to/agent-recall/plugins
claude plugin install agent-recall@agent-recall
```

Codex：

```bash
codex plugin marketplace add /path/to/agent-recall/plugins
codex plugin add agent-recall@agent-recall
```

OpenCode：

```bash
mkdir -p ~/.config/opencode/plugins ~/.config/opencode/commands
cp plugins/opencode/agent-recall.ts ~/.config/opencode/plugins/
cp plugins/opencode/commands/recall.md ~/.config/opencode/commands/
```

不要再在 `opencode.json` 的 `plugin` 里登记一次，否则事件会记两遍。

pi：

```bash
mkdir -p ~/.pi/agent/extensions/agent-recall
cp plugins/pi/index.ts ~/.pi/agent/extensions/agent-recall/index.ts
```

插件环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `AGENT_RECALL_URL` | `http://127.0.0.1:8787` | 服务器地址 |
| `AGENT_RECALL_TOKEN` | 无 | Bearer token，`arm_` 前缀 |
| `AGENT_RECALL_SPOOL_DIR` | `~/.agent-recall/spool` | 离线队列目录 |
| `AGENT_RECALL_TOKEN_BUDGET` | 服务器默认 2000 | `/api/hooks/context` 的 token 预算 |
| `AGENT_RECALL_PROJECT` | git 仓库根目录名 | 项目名 |
| `AGENT_RECALL_DISABLED` | 关 | `1` 或 `true` 时所有钩子直接返回 |

细节、兜底的 `settings.json` 写法和各宿主差异见 `plugins/README.md`。

---

## 配置

`apps/server` 按 `APP_ENV` 读取 `apps/server/.env.development`、`.env.test` 或 `.env.production`。文件不存在时用下面的默认值。

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `8787` | 监听端口 |
| `HOST` | `127.0.0.1` | 监听地址 |
| `DATABASE_URL` | 必填 | Postgres 连接串。没有内嵌数据库 |
| `ENCRYPTION_KEY` | 必填 | 加密每个用户的精排 API Key。测试和生产用不同的值。丢掉之后已保存的 Key 解不开 |
| `DATABASE_SCHEMA` | 空 | 设置后表建在这个 schema。测试使用，日常运行不要设 |
| `MEILI_URL` / `MEILI_API_KEY` / `MEILI_INDEX` | 空 / 空 / `memories` | Meilisearch。URL 为空则关闭全文 |
| `QDRANT_URL` / `QDRANT_API_KEY` / `QDRANT_COLLECTION` | 空 / 空 / `memories` | Qdrant。URL 为空则关闭向量 |
| `EMBEDDING_API_KEY` | 空 | 向量服务密钥 |
| `EMBEDDING_BASE_URL` | `https://dashscope.aliyuncs.com/api/v1` | 向量服务地址 |
| `EMBEDDING_MODEL` | `qwen3-vl-embedding` | 向量模型 |
| `EMBEDDING_DIMENSIONS` | `2560` | 向量维度 |
| `PUBLIC_BASE_URL` | `http://127.0.0.1:8787` | 写进 MCP 配置的服务器地址 |
| `WEB_ORIGIN` | `http://127.0.0.1:5178` | 网页来源，用于 CORS |
| `WEB_DIST` | 空 | 网页构建目录。生产且 `NODE_ENV=production` 时默认 `apps/web/dist` |
| `COOKIE_SECURE` | `false` | `true` 时 session cookie 只走 HTTPS |

`apps/mcp` 读 `AGENT_RECALL_URL`、`AGENT_RECALL_TOKEN` 和 `AGENT_RECALL_MCP_PROFILE`（`core` / `standard` / `full`，默认 `full`）。档位由本机包传给服务器，服务器只返回该档位的工具；三个本机文件工具只在 `full`。

网页用 httpOnly cookie（argon2id）。Agent 和插件用 `Authorization: Bearer arm_...`（sha256 存库）。令牌和 MCP 客户端的管理接口只接受网页 session。`POST /api/hooks/events` 和 `POST /api/hooks/context` 只接受 Bearer token。控制台预览注入走 `POST /api/memories/context`，session 和 token 都可以，裁剪规则与钩子注入相同。

---

## API

认证列：无、cookie、token、两者。两者表示 cookie session 或 Bearer 都可以。

| 端点 | 认证 | 说明 |
|---|---|---|
| `GET /health` | 无 | 健康检查 |
| `POST /api/auth/register`、`/login` | 无 | 注册或登录，并种下 session cookie |
| `POST /api/auth/logout` | 无 | 清掉 session |
| `GET /api/auth/me` | 两者 | 当前用户 |
| `GET` `POST /api/memories`，`GET` `PATCH` `DELETE /api/memories/:id` | 两者 | 记忆 CRUD。PATCH 产生新版本 |
| `GET /api/memories/:id/versions` | 两者 | 版本链 |
| `POST /api/memories/recall`、`/smart-search`、`/context` | 两者 | 检索，以及与钩子相同的注入预览 |
| `GET /api/memories/recall-logs`、`/stats` | 两者 | 召回日志、统计 |
| `GET /api/memories/export`，`POST /api/memories/import` | 两者 | 导出、导入 |
| `POST /api/memories/batch-forget`、`/auto-forget`、`/consolidate` | 两者 | 批量删除、自动遗忘、合并近似重复 |
| `POST /api/memories/:id/share`，`GET /api/memories/shared-feed` | 两者 | 分给队友、查看收到的分享 |
| `POST /api/memories/reflect` | 两者 | 生成反思 |
| `GET /api/sessions`，`GET /api/sessions/:sessionId` | 两者 | 会话列表、时间线 |
| `POST /api/sessions/:sessionId/crystallize` | 两者 | 把一场会话收成摘要 |
| `POST /api/hooks/events` | token | 插件写入。SessionEnd 时生成摘要 |
| `POST /api/hooks/context` | token | `{ query, tokenBudget?, project? }`，返回可注入的文本 |
| `GET` `POST /api/tokens`，`POST /api/tokens/:id/revoke` | cookie | access token |
| `GET` `POST /api/mcp/clients`，`POST /api/mcp/clients/:id/revoke` | cookie | MCP 客户端 |
| `GET /api/mcp/tools` | 两者 | 服务端工具目录。`?profile=core\|standard\|full`，不含本机文件工具 |
| `POST /api/mcp/tools/call` | 两者 | 执行一个服务端工具。`{ name, arguments, profile? }` |
| `GET` `PUT /api/settings` | 两者 | 精排、自动遗忘等 |
| `GET` `PUT` `DELETE /api/kv/:namespace/:key`，`GET /api/kv/:namespace`，`POST .../append` | 两者 | KV：槽位、信号、档案、租约 |
| `GET /api/graph/query`，`GET /api/memories/:id/relations` | 两者 | 关系图 |
| `POST` `GET /api/snapshots`，`POST /api/snapshots/:id/restore` | 两者 | 快照与恢复 |
| `POST /api/mesh/sync` | 两者 | 和另一台服务器同步 |
| `GET /api/admin/diagnose`，`POST /api/admin/heal`，`GET /api/audit` | 两者 | 体检、修复、审计 |

导出格式是 `agent-recall/v1`。导入冲突策略为 skip、merge、replace。

---

## 开发

```
apps/
  server/    Fastify + Drizzle + Postgres：API、写入治理、检索
  mcp/       stdio MCP。转发服务端工具，本机只保留文件工具
  web/       React 网页（@rabjs/react + Vite）
packages/
  dto/       共享 zod schema
plugins/     四端插件 + shared client / spool
eval/        检索管道回归
e2e/         服务与 MCP 工具端到端（不测网页）
design/      设计稿
```

```bash
pnpm install
pnpm dev                                  # server + web
pnpm --filter @agent-recall/server dev    # 只起 server
pnpm --filter @agent-recall/web dev       # 只起 web，端口 5178
pnpm test                                 # server 测试（vitest）
pnpm e2e                                  # 临时库 + 固定测试账号，校验服务和 MCP
pnpm typecheck
pnpm build
pnpm eval                                 # 写入 eval/results/<date>.md
```

网页开发时，Vite 把 `/api` 和 `/health` 代理到 `127.0.0.1:8787`。
