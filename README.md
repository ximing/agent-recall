# agent-recall

自托管的 agent 记忆服务。给 Claude Code、Codex CLI、OpenCode、pi，以及任何能说 MCP 的 coding agent。

下次开会话，它还记得上次的架构决定、踩过的坑，以及你说过要记住的偏好。打开网页就能看说明、管记忆、签发接入用的令牌。首页不用登录。

记忆存在你配置的 Postgres 里。全文和向量检索按需再配。

## 是什么

一台记忆服务，三个面：

- **自动记下。** 插件接在会话上。开场注入相关记忆，每条提问前再补一段，工具调用后记一笔观察，会话结束生成摘要。单次请求超过 2 秒就放弃，失败的事件先落在本机，之后再补投。
- **主动存取。** MCP 有两种接法。远程 HTTPS 不用安装包，提供 62 个服务器工具。本机 stdio 在此之外多三个本机文件工具。Agent 用来保存、召回、改出版本、忘掉和整理。
- **人来看。** 登录之后先到看板：记忆有多少、哪些要接着做、最近的会话和召回。往下是记忆的筛选、召回、精排、分享和版本，会话时间线与结晶，以及状态、关系、治理。令牌和 MCP 客户端配置只在网页里签发。

压缩文件、同步本地 `MEMORY.md`、导出 Obsidian 这三件在你的电脑上完成。

编辑一条记忆会留下旧版本，检索只用最新版。五分钟内相同内容不会存成第二条。API key、Bearer token、PEM 和写在 `<private>` 里的内容不会进库。

注入进新会话的，是来源为网页、agent、摘要和导入的记忆。插件当场记下的原始碎片留在库里，可以以后翻，不自动塞回提示词。

召回走两路：Meilisearch 认词，Qdrant 认意思，再合成一个顺序。设置里可以打开精排；没开或失败时，保持这个顺序。少配一路时，另一路继续召回。两路都没有时，按条件翻列表仍然可用。

## 怎么用

接入点就是你正在看的这个网页的地址。协议、主机和端口都要带上，例如 `https://你的站点`。MCP 和插件的 `AGENT_RECALL_URL` 都填它。

1. 打开这个网页，注册并登录。
2. 在「MCP 客户端」注册一个客户端。页面给出一份配置，令牌只显示一次。也可以在「令牌」里单独建一把 `arm_` 开头的令牌。
3. 把配置交给 agent。控制台会给出两份，令牌相同。

远程 HTTPS，不用安装包。没有本机文件工具。要缩小工具面，在地址后加 `?profile=core` 或 `standard`：

```json
{
  "mcpServers": {
    "agent-recall": {
      "type": "http",
      "url": "https://你的站点/mcp",
      "headers": {
        "Authorization": "Bearer arm_..."
      }
    }
  }
}
```

本机 stdio。需要 Node.js 22，`npx` 拉取已发布的包。full 档包含三个本机文件工具：

```json
{
  "mcpServers": {
    "agent-recall": {
      "command": "npx",
      "args": ["-y", "@yeanzhi/agent-recall-mcp"],
      "env": {
        "AGENT_RECALL_URL": "https://你的站点",
        "AGENT_RECALL_TOKEN": "arm_..."
      }
    }
  }
}
```

控制台生成的地址来自服务器的 `PUBLIC_BASE_URL`。它和地址栏不一致时，改成地址栏里的地址。插件的 `AGENT_RECALL_URL` 也填这个地址，不要填 `/mcp`。

4. 对 agent 说「记住我们用请求 id 追踪接口错误」。下一场会话，它会自己想起来。

要让它自己记、自己在开场时找回来，再装 [插件](#装上插件)。插件使用同一组地址和令牌。

只配 MCP、不装插件时，工具都在，但不会自动注入。远程地址是 62 个服务器工具；本机 stdio 的 full 档是 65 个。

## 一次会话里发生什么

上一场你定过：接口错误要带请求 id，列表默认按更新时间排。这些被记成记忆。

下一场你问「错误响应里有没有请求 id」。开场和这条提问会按问题召回，把裁好的上下文放进这次会话。你不用把上次的结论再贴一遍。

你让它记住一条新决定时，agent 调用 `memory_remember`。工具调用后的观察由插件记下。会话结束时，服务器生成这场会话的摘要。

## 网页

| 路径 | 登录 | 用来做什么 |
|---|---|---|
| `/` | 不用 | 说明：项目做什么、怎么接、65 个工具。可按名字或用途筛选 |
| `/login` | 不用 | 注册 / 登录 |
| `/board` | 要 | 看板：记忆统计、要处理的行动、最近会话、召回和库况 |
| `/memories` | 要 | 筛选、召回、精排、注入预览、分享、版本、导入导出 |
| `/sessions` | 要 | 会话列表、时间线、结晶 |
| `/state` | 要 | 行动、信号、哨兵、槽位、档案、租约、例程、检查点 |
| `/graph` | 要 | 由记忆推导出的关系 |
| `/ops` | 要 | 诊断与修复、合并、反思、快照、收到的分享、审计 |
| `/tokens` | 要 | 令牌。明文只在创建时出现 |
| `/mcp` | 要 | 注册 MCP 客户端，签发远程 HTTPS 和本机 stdio 两份配置 |
| `/cost` | 要 | 大模型、向量、精排的 token 消耗、估算费用和调用记录 |
| `/settings` | 要 | 大模型、精排、自动遗忘、召回历史 |

未登录访问控制台会去登录页。登录页可以回到说明。

## 先用这 7 个

| 工具 | 什么时候用 |
|---|---|
| `memory_remember` | 你明确说记住一件事 |
| `memory_recall` | 有一个具体问题 |
| `memory_smart_search` | 问题含糊，普通召回可能漏 |
| `memory_context` | 要一段能直接放进提示词的上下文 |
| `memory_update` | 改正一条已有记忆，旧版保留 |
| `memory_forget` | 删掉整条版本链 |
| `memory_next` | 会话刚开始，先看未完成的行动和最近的记忆 |

其余 59 个按写入、召回、浏览、当场记下、状态、关系、共享、整理分成八组。名单和每条的用途在 [docs/tools.md](docs/tools.md)。网页首页有同一份名单，可以筛选。参数写在工具自己的说明里，agent 调的时候能看见。

## 装上插件

安装整棵 `plugins/` 树。Claude Code 和 Codex 的脚本依赖里面的共享客户端。这两个插件的 `skills/` 里带有 `agent-recall-init`。装上插件就有这个技能。在目标仓库里说「初始化仓库」，或运行 `/agent-recall-init`，它会把一段不到 60 行的说明写进该仓库的 `CLAUDE.md` 和 `AGENTS.md`。

Cursor、Kimi、OpenCode、Pi，以及把本仓库本身当作插件市场来装的 Claude Code / Codex，读的是仓库根目录的 `skills/agent-recall-init`。Grok 从 [ximing/grok-plugins](https://github.com/ximing/grok-plugins) 安装，`skills/**` 或 `.claude-plugin/plugin.json` 变更时由 GitHub Actions 同步过去。

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

不要再在 `opencode.json` 的 `plugin` 里登记一次，否则事件会记两遍。技能另装仓库插件，它只注册 `skills/`，不记事件：

```json
{
  "plugin": ["agent-recall@git+https://github.com/ximing/agent-recall.git"]
}
```

pi：

```bash
mkdir -p ~/.pi/agent/extensions/agent-recall
cp plugins/pi/index.ts ~/.pi/agent/extensions/agent-recall/index.ts
```

`plugins/pi/package.json` 的 `pi.skills` 指向同目录的 `skills/`。用包安装时技能会一起装上。只拷 `index.ts` 时，技能用仓库根目录：

```bash
pi install git:github.com/ximing/agent-recall
```

Cursor：清单在 [`.cursor-plugin/plugin.json`](.cursor-plugin/plugin.json)。在 Cursor Agent 对话里执行 `/add-plugin agent-recall`。

Kimi Code：

```text
/plugins install https://github.com/ximing/agent-recall
```

然后 `/new` 开一个新会话。

Grok：

```bash
grok plugin marketplace add ximing/grok-plugins
grok plugin install agent-recall --trust
```

插件要配的就是接入用的那两个变量：

| 变量 | 填什么 |
|---|---|
| `AGENT_RECALL_URL` | 地址栏里的网页地址 |
| `AGENT_RECALL_TOKEN` | 网页里签发的 `arm_` 令牌 |

离线时失败事件写到 `~/.agent-recall/spool/events.jsonl`。网络恢复后执行 `node plugins/shared/drain.mjs`。各宿主的兜底写法和其余变量见 [plugins/README.md](plugins/README.md)。

## 自己跑一份

准备 Node.js 22、pnpm 10，以及一台 Postgres。`DATABASE_URL` 和 `ENCRYPTION_KEY` 必填。Meilisearch 和 Qdrant 可以后配。

服务起来之后，用浏览器打开它的网页，再按上面的步骤把 agent 接到这个地址。本地开发时网页在 `http://127.0.0.1:5178`，这个地址可以直接当作接入点。环境变量、生产和开发的差别见 [docs/self-host.md](docs/self-host.md)。

## 更多

- [工具名单](docs/tools.md)
- [自己部署](docs/self-host.md)
- [HTTP API](docs/api.md)
- [开发与验证](docs/develop.md)
- [插件细节](plugins/README.md)
