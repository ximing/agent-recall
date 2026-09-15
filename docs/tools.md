# MCP 工具

66 个 `memory_*` 工具，八组。日常先用 README 里的 7 个。这里是全部名单。

参数和取舍写在工具自己的 description 里，agent 调工具时能看见。网页首页有同一份名单，可以按名字、用途或档位筛选。

`AGENT_RECALL_MCP_PROFILE` 决定宿主能看见哪些工具。表里的档位是最小可见面：标 `core` 的 12 个三档都有，标 `standard` 的从 standard 起（加上 core 一共 25 个），标 `full` 的只有 full。不设或写成这三档以外的值，都是 `full`。

`memory_compress_file`、`memory_claude_bridge_sync`、`memory_obsidian_export` 在代理本机读写文件，只在 `full`。其余工具由服务器执行。

## 写入与遗忘

把值得留下的东西写进记忆库，或按范围删掉。

| 工具 | 档位 | 作用 |
|---|---|---|
| `memory_save` | core | 保存一条记忆。近重复返回已有记录，并带 `deduped` |
| `memory_remember` | core | 同 save，表示用户要求保留 |
| `memory_lesson_save` | core | 存成 lesson：什么发生了，下次怎么做 |
| `memory_update` | core | 编辑并产生新版本 |
| `memory_forget` | core | 按 id 删除整条版本链 |
| `memory_import` | standard | 从导出包导入。`skip` / `merge` / `replace`，默认 skip |
| `memory_batch_forget` | standard | 按 id 或过滤条件批量删除，可 `dryRun` |
| `memory_auto_forget` | standard | 清理过期记忆和低价值旧碎片，可 `dryRun` |
| `memory_governance_delete` | standard | 按策略批量删除，并在工具结果里带回原因 |
| `memory_lesson_delete` | full | 只删除 lesson，其他类型会拒绝 |

## 召回

按问题把相关记忆找出来。要塞进提示词时用 `memory_context`。

| 工具 | 档位 | 作用 |
|---|---|---|
| `memory_recall` | core | 词法 + 向量融合 |
| `memory_smart_search` | core | 更大的候选池。设置里打开精排后带精排分数；没开或失败时保持融合顺序 |
| `memory_context` | core | 按 token 预算裁好的上下文 |
| `memory_lesson_recall` | core | 只在 lesson 里召回 |
| `memory_patterns` | full | 列出或搜索 pattern |
| `memory_insight_list` | full | 最近的 lesson 和 pattern |
| `memory_vision_search` | full | 带 `vision` 标签的记忆 |
| `memory_file_history` | full | 按文件路径找摘要 |
| `memory_commits` | full | 带 `commit` 标签的记忆 |
| `memory_commit_lookup` | full | 按 commit SHA 查找 |

## 浏览

不按语义排序。用来翻清单、看版本、看一场会话。

| 工具 | 档位 | 作用 |
|---|---|---|
| `memory_list` | core | 分页浏览，可过滤 |
| `memory_get` | core | 按 id 取一条，含版本和访问统计 |
| `memory_stats` | core | 总量、分布、过期、待索引 |
| `memory_versions` | standard | 一条记忆的全部版本 |
| `memory_sessions` | standard | 产生过记忆的会话 |
| `memory_session_timeline` | standard | 一个会话的时间线 |
| `memory_export` | standard | 导出全部记忆为 JSON |
| `memory_timeline` | full | 按创建时间浏览；给了 sessionId 就只看那场 |
| `memory_frontier` | full | 最新的记忆，默认 10 条 |
| `memory_next` | full | 开场简报：未完成行动、最近会话、最新 5 条 |
| `memory_verify` | full | 是否还在、是不是最新版、有没有过期 |

## 当场记下

草稿、文件大纲、本地 `MEMORY.md`，以及一份可覆盖的检查点。

| 工具 | 档位 | 作用 |
|---|---|---|
| `memory_sketch_create` | standard | 24 小时后过期的草稿，标签为 `sketch` |
| `memory_sketch_promote` | standard | 去掉草稿标签和过期时间，留成永久记忆 |
| `memory_checkpoint` | standard | 把一份 JSON 状态存进 KV，同名覆盖 |
| `memory_compress_file` | full | 读本地文件（最大 200KB），抽出大纲，存成 `file-summary` |
| `memory_claude_bridge_sync` | full | 和本地 `MEMORY.md` 双向同步 |

## 状态

存在 KV 里，不进召回排序。控制台的「状态」页管理同一批数据。这一组全部是 `full`。

| 工具 | 档位 | 作用 |
|---|---|---|
| `memory_signal_send` / `memory_signal_read` | full | 追加或读取命名信号日志 |
| `memory_action_create` / `memory_action_update` | full | 行动项。状态 `open` / `done` / `blocked` |
| `memory_sentinel_create` / `memory_sentinel_trigger` | full | 要盯住的条件，以及触发记录 |
| `memory_slot_create` / `memory_slot_replace` | full | 命名槽位，存任意 JSON |
| `memory_slot_append` / `memory_slot_get` | full | 追加或读取槽位 |
| `memory_slot_list` / `memory_slot_delete` | full | 列出或删除槽位 |
| `memory_profile` | full | 读或写档案。不传 key 列出全部 |
| `memory_lease` | full | 带 TTL 的租约。已被占用时返回持有者 |
| `memory_routine_run` | full | 读取某个 routine 的步骤。不存在则报错 |

## 关系与分面

这一组全部是 `full`。

| 工具 | 档位 | 作用 |
|---|---|---|
| `memory_graph_query` | full | 用一段文本查关系图 |
| `memory_relations` | full | 和某一条记忆有关的其他记忆 |
| `memory_facet_tag` | full | 打上 `维度:值` 标签 |
| `memory_facet_query` | full | 按维度和值查找 |

## 共享与导出

这一组全部是 `full`。

| 工具 | 档位 | 作用 |
|---|---|---|
| `memory_mesh_sync` | full | 和另一台 agent-recall 同步。对端地址必须是内网或本机 |
| `memory_team_share` | full | 按邮箱把一条记忆复制给队友。入库前会做隐私清洗，并带上 `shared` 标签 |
| `memory_team_feed` | full | 别人分给你的记忆 |
| `memory_obsidian_export` | full | 每条记忆一个带 frontmatter 的 Markdown 文件，写在本机 |

## 整理

| 工具 | 档位 | 作用 |
|---|---|---|
| `memory_crystallize` | standard | 把一场会话收成一条摘要。同一小时内重复调用得到同一条 |
| `memory_snapshot_create` | standard | 给整个记忆库做快照。恢复走 `POST /api/snapshots/:id/restore` |
| `memory_reflect` | full | 根据最近几天写一条反思。抽取已有内容，不调用大模型 |
| `memory_consolidate` | full | 合并近似重复，可 `dryRun` |
| `memory_heal` | full | 重新索引，并跑一遍自动遗忘 |
| `memory_diagnose` | full | 体检，返回问题和统计 |
| `memory_audit` | full | 最近的审计记录 |
