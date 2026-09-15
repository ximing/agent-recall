# 开发与验证

给改这个仓库的人。使用方式见 [README](../README.md)，把服务跑起来见 [self-host.md](self-host.md)。

```
apps/
  server/    Fastify API、写入、检索
  mcp/       stdio MCP。转发服务端工具，本机只保留三个文件工具
  web/       网页。公开说明页和控制台
packages/
  dto/       共享的请求和响应 schema
plugins/     四种宿主插件，以及共享客户端和离线队列
eval/        检索管道回归
e2e/         服务与 MCP 工具端到端。不测网页
design/      设计稿
```

```bash
pnpm install
pnpm dev                                  # 网页 5178 + API。服务器读 .env.test
pnpm --filter @agent-recall/server dev    # 只起 API
pnpm --filter @agent-recall/web dev       # 只起网页
pnpm test                                 # server 的 vitest
pnpm e2e                                  # 临时 schema 上的服务和 MCP 回归
pnpm typecheck
pnpm build
pnpm eval                                 # 写入 eval/results/<date>.md
```

`pnpm e2e` 的账号、语料和覆盖范围见 [e2e/README.md](../e2e/README.md)。

`pnpm eval` 用确定性的检索替身守住管道：语料进得去、融合和精排还按原顺序工作。分数不代表真实语义质量。跑法和指标见 [eval/README.md](../eval/README.md)。
