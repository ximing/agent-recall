# e2e/ — 服务与 MCP 端到端

一次跑完，确认账号、记忆、检索和 66 个 MCP 工具还按合同工作。网页不在这套里面。

不读取、不写入 `~/.agent-recall`。每次运行读 `apps/server/.env.test` 的 `DATABASE_URL`，在远端 Postgres 里建一个 `ar_` 开头的临时 schema，再起一份检索替身（protocol-standin）。跑完 `DROP SCHEMA CASCADE`。加密用测试进程里的固定密钥，不读部署用的 `ENCRYPTION_KEY`。临时目录只放 Obsidian 文件，不写入 public，也不碰生产库。

## 运行

```bash
pnpm e2e
```

实际执行 `pnpm --filter @agent-recall/server exec tsx ../../e2e/run.ts`。任一检查失败，进程退出码为 1，其余检查仍会继续，最后打印 `passed / failed`。

## 测试账号

只存在于这次的临时 schema：

| 角色 | 邮箱 | 用途 |
| --- | --- | --- |
| 主账号 | `e2e@agent-recall.test` | 语料、MCP full profile、令牌吊销 |
| 队友 | `e2e-peer@agent-recall.test` | 隔离、分享、feed |
| mesh | `e2e-mesh@agent-recall.test` | 另一个临时 schema 上的同步来源 |

密码写在 `account.ts`。令牌由运行时创建，名字是 `e2e-agent`、`e2e-peer`、`e2e-mesh`。

## 测试集

`corpus.ts` 有 11 条记忆，每条带一个不重复的标记（青金石、松烟墨、赭石……）。召回断言用这些标记做字面匹配。语料经 HTTP 写入，因为 `memory_save` 不接收 `sessionId`；MCP 自己的写入（remember、sketch、import、forget 等）在 runner 里另外发生。

## 覆盖

- HTTP：注册、登录、错误密码、令牌不回显、MCP 客户端吊销、设置、cookie 来源是 `web`、钩子脱敏、快照恢复、重启后数据还在。
- MCP stdio：full 的 66 个工具各至少调用一次，外加 core / standard 两个 profile 的工具面。
- 失败路径：空参数、吊销后的令牌、公网 mesh 地址、队友读不到主账号的记忆。

`pnpm test` 是 vitest 集成测试。`pnpm eval` 是检索分数。这套是「服务和工具还能不能串起来」的回归。
