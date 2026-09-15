# 自己跑一份

这份说明给要启动服务的人。已经有人把网页给你时，按 [README](../README.md) 把 agent 接到地址栏里的地址即可。

## 准备

- Node.js 22 或更新，pnpm 10
- Postgres。`DATABASE_URL` 必填，没有内嵌数据库
- `ENCRYPTION_KEY` 必填。它加密每个用户在设置页保存的精排 API Key，它本身不是精排 Key。测试和生产用不同的值。丢掉之后，已经保存的精排 Key 解不开
- Meilisearch、Qdrant 按需安装

`apps/server` 按 `APP_ENV` 读取 `apps/server/.env.development`、`.env.test` 或 `.env.production`。文件可以缺省，缺的变量用下面的默认值。`DATABASE_URL` 和 `ENCRYPTION_KEY` 没有默认值，缺了进程起不来。

## 本地开发

```bash
pnpm install
pnpm dev
```

`pnpm dev` 使用 `APP_ENV=test`，所以服务器读的是 `apps/server/.env.test`。

| 进程 | 地址 | 作用 |
|---|---|---|
| `@agent-recall/server` | http://127.0.0.1:8787 | API。`GET /health` 不需要登录 |
| `@agent-recall/web` | http://127.0.0.1:5178 | 网页。把 `/api` 和 `/health` 代理到 8787 |

浏览器打开 http://127.0.0.1:5178 。agent 和插件的 `AGENT_RECALL_URL` 填这个地址，请求会经网页代理到达 API。

## 同一个端口对外

构建网页后，由服务器一并托管。`NODE_ENV=production` 时，服务器使用 `apps/web/dist`；也可以用 `WEB_DIST` 指到别的目录。`pnpm start:prod` 会把 `APP_ENV` 设为 `production`，从而读取 `.env.production`。

```bash
pnpm build
NODE_ENV=production pnpm start:prod
```

这时网页和 API 在同一个主机上。把 `PUBLIC_BASE_URL` 和 `WEB_ORIGIN` 都设成用户浏览器里看到的地址（含协议和端口）。控制台签发的 MCP 配置会带上 `PUBLIC_BASE_URL`。用户侧的接入点仍然是地址栏里的地址；两个值一致时，签发出来的配置可以直接粘贴。

`COOKIE_SECURE=true` 用于 HTTPS。

## 配置

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `8787` | 监听端口 |
| `HOST` | `127.0.0.1` | 监听地址。对外时改为 `0.0.0.0` |
| `DATABASE_URL` | 必填 | Postgres 连接串 |
| `ENCRYPTION_KEY` | 必填 | 加密每个用户的精排 API Key |
| `DATABASE_SCHEMA` | 空 | 设置后表建在这个 schema。测试使用，日常运行留空 |
| `MEILI_URL` / `MEILI_API_KEY` / `MEILI_INDEX` | 空 / 空 / `memories` | Meilisearch。URL 为空则关闭全文 |
| `QDRANT_URL` / `QDRANT_API_KEY` / `QDRANT_COLLECTION` | 空 / 空 / `memories` | Qdrant。URL 为空则关闭向量 |
| `EMBEDDING_API_KEY` | 空 | 向量服务密钥 |
| `EMBEDDING_BASE_URL` | `https://dashscope.aliyuncs.com/api/v1` | 向量服务地址。换成自建地址就不再访问默认服务 |
| `EMBEDDING_MODEL` | `qwen3-vl-embedding` | 向量模型 |
| `EMBEDDING_DIMENSIONS` | `2560` | 向量维度 |
| `PUBLIC_BASE_URL` | `http://127.0.0.1:8787` | 写进 MCP 配置的服务器地址 |
| `WEB_ORIGIN` | `http://127.0.0.1:5178` | 网页来源，用于 CORS |
| `WEB_DIST` | 空 | 网页构建目录 |
| `COOKIE_SECURE` | `false` | `true` 时 session cookie 只走 HTTPS |

MCP 进程另读 `AGENT_RECALL_URL`、`AGENT_RECALL_TOKEN` 和 `AGENT_RECALL_MCP_PROFILE`（`core` / `standard` / `full`，默认 `full`）。

## 检索

`memory_recall` 是 Meilisearch 全文加 Qdrant 向量，再用 RRF（k=60）融合。`memory_smart_search` 使用更大的候选池。用户在设置里打开精排后，使用所配置的 rerank 服务；失败时退回融合顺序。精排 API Key 按用户存在设置里，用 `ENCRYPTION_KEY` 做 AES-256-GCM 加密。

没配 `MEILI_URL` 时跳过全文。没配 `QDRANT_URL` 时跳过向量。两路都不可用时，语义召回没有结果；按条件翻列表仍然读 Postgres。

`POST /api/hooks/context` 用提问换一段格式化文本，默认预算 2000 token。这个接口只接受 Bearer 令牌。控制台里的注入预览走 `POST /api/memories/context`，登录会话和令牌都可以，裁剪规则相同。

过期记忆退出检索。自动遗忘清掉过期记忆，以及超过 `autoForgetDays` 的低价值 hook 碎片，天数在设置页改。每次召回的策略和延迟写入召回日志，控制台可以看。

## 谁可以调用

网页登录使用 httpOnly cookie。Agent 和插件使用 `Authorization: Bearer arm_...`。

令牌和 MCP 客户端的管理只接受网页登录。`POST /api/hooks/events` 和 `POST /api/hooks/context` 只接受 Bearer 令牌。其余记忆、状态、关系和治理接口，登录会话和令牌都可以。

接口一览见 [api.md](api.md)。
