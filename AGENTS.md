<!-- agent-recall -->
## 记忆

本仓库的持久记忆由 agent-recall 接管。不要把决定、偏好或教训写进 `MEMORY.md`、`.claude/` 或本文件。密钥、令牌、私钥不要写入记忆。

项目名是 `agent-recall`。没有 `AGENT_RECALL_PROJECT` 时用这个名字；设置了该变量时改用变量的值。`memory_save`、`memory_remember`、`memory_recall`、`memory_smart_search`、`memory_context`、`memory_lesson_save`、`memory_lesson_recall` 都要带这个 `project`。漏掉 `project` 的写入不会进本项目的开场注入。

开工前用 `memory_context` 取与当前任务相关的上下文。核对具体事实用 `memory_recall`，问题含糊用 `memory_smart_search`。只使用工具返回的内容。插件注入过的上下文可以接着用；工具调用观察不会自动回到以后的会话，值得留下的决定要自己写入。

要留下的内容用这些类型：`architecture` 架构与接口决定，`preference` 偏好，`workflow` 固定做法，`bug` 已确认的坑，`pattern` 反复出现的规律，`fact` 其他稳定事实，`lesson` 只通过 `memory_lesson_save` 写入。用户说记住时用 `memory_remember`，其余稳定结论用 `memory_save`。旧记录错了用 `memory_update`，不要并存一条相反的。用户要求删除时才 `memory_forget`。

临时笔记用 `memory_sketch_create`（约 24 小时），确认要留再 `memory_sketch_promote`。有 `memory_next` 时，开工先看未完成行动。当前档位没有的工具跳过，不要改 MCP 配置来凑工具。
<!-- /agent-recall -->
