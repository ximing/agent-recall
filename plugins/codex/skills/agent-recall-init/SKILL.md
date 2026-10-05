---
name: agent-recall-init
description: >
  Initialize a target git repository so its coding agents keep project memory
  in agent-recall. Writes one block under 60 lines into that repo's CLAUDE.md
  and AGENTS.md. Use when the user says 初始化仓库, 目标仓库初始化, 接管记忆,
  接入 agent-recall, onboard a repo, or asks to wire CLAUDE.md / AGENTS.md to
  recall. Slash command: /agent-recall-init.
---

# 初始化目标仓库

把下面的块写入目标仓库根目录的 `CLAUDE.md` 和 `AGENTS.md`。块是给以后在该仓库里工作的 agent 看的。这次只改这两个文件。

## 步骤

1. 目标目录用用户给出的路径。用户没给路径时用当前工作目录。当前目录是 agent-recall 自己的仓库、且用户没点名它时，先问目标路径，不要写本仓库。
2. 在目标目录执行 `git rev-parse --show-toplevel`，项目名用该目录的文件夹名。不是 git 仓库时用目标目录自己的文件夹名，并在结果里说明。名字含换行、反引号或 `-->` 时停下来问。
3. 读已有的 `CLAUDE.md` 和 `AGENTS.md`。用下方模板生成块，只把 `{{project}}` 换成项目名，其余一字不改。
4. 数块的行数，含两行注释。大于或等于 60 行就不要写。
5. 两个文件写入同一块。文件不存在就创建，内容只有这块。已有 `<!-- agent-recall -->` 到 `<!-- /agent-recall -->` 时，连注释一起换成新块。没有标记时补在文件末尾，与原文空一行。只出现一个标记时停下来问。
6. 不要提交，不要写令牌、地址或 MCP 配置，不要改其他文件。
7. 回复目标路径、项目名、两个文件是新建还是替换，以及块的行数。

## 模板

```markdown
<!-- agent-recall -->
## 记忆

本仓库的持久记忆由 agent-recall 接管。不要把决定、偏好或教训写进 `MEMORY.md`、`.claude/` 或本文件。密钥、令牌、私钥不要写入记忆。

项目名是 `{{project}}`。没有 `AGENT_RECALL_PROJECT` 时用这个名字；设置了该变量时改用变量的值。`memory_save`、`memory_remember`、`memory_recall`、`memory_smart_search`、`memory_context`、`memory_lesson_save`、`memory_lesson_recall` 都要带这个 `project`。漏掉 `project` 的写入不会进本项目的开场注入。

开工前用 `memory_context` 取与当前任务相关的上下文。核对具体事实用 `memory_recall`，问题含糊用 `memory_smart_search`。只使用工具返回的内容。插件注入过的上下文可以接着用；工具调用观察不会自动回到以后的会话，值得留下的决定要自己写入。

要留下的内容用这些类型：`architecture` 架构与接口决定，`preference` 偏好，`workflow` 固定做法，`bug` 已确认的坑，`pattern` 反复出现的规律，`fact` 其他稳定事实，`lesson` 只通过 `memory_lesson_save` 写入。用户说记住时用 `memory_remember`，其余稳定结论用 `memory_save`。旧记录错了用 `memory_update`，不要并存一条相反的。用户要求删除时才 `memory_forget`。

临时笔记用 `memory_sketch_create`（约 24 小时），确认要留再 `memory_sketch_promote`。有 `memory_next` 时，开工先看未完成行动。当前档位没有的工具跳过，不要改 MCP 配置来凑工具。
<!-- /agent-recall -->
```
