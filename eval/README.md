# eval/ — 召回质量评测 harness（P3）

对检索管道（词法 + 向量两路召回 → RRF k=60 融合 → 可选精排 → 版本/过期裁决）做端到端回归评测。

## 运行

```bash
pnpm eval        # 仓库根目录
```

实际执行的是 `pnpm --filter @agent-recall/server exec tsx ../../eval/run.ts`（tsx 复用 server 的 devDependency，根目录不新增依赖）。

运行后：

- stdout 打印两策略对比表 + 逐查询明细；
- 分数卡写入 `eval/results/<date>.md`（同一天重复跑会覆盖）。

## 组成部分

- `corpus.ts` — 40 条模拟编程 agent 记忆（type 覆盖 architecture/preference/bug/workflow/pattern/fact/lesson，中英文混合）+ 18 个标注查询，每个查询标注应命中的记忆 key。
- `run.ts` — runner：protocol-standin 起内存版 Meilisearch/Qdrant/DashScope，`openTestApp` 连远端 Postgres 的隔离 schema，注册用户 + 建 Bearer token，灌语料，逐查询跑两种策略并计算指标。
- `results/` — 历次评测分数卡。

## 指标定义

对每条查询取 top 10 结果，设相关记忆数为 R：

- **Recall@5 / Recall@10**：top 5 / top 10 中命中的相关记忆数 ÷ R，再对全部查询取平均。
- **MRR**：第一条相关结果排名的倒数（无命中记 0），对全部查询取平均。
- **avg latency**：单次召回接口耗时（客户端计时）的平均值。

对比的两个策略：

| strategy | 接口 | 说明 |
| --- | --- | --- |
| `rrf` | POST /api/memories/recall | 两路召回 + RRF 融合，settings 默认精排关闭 |
| `rrf+rerank` | POST /api/memories/smart-search | deep 候选池，settings 开启精排（替身按 query 字符覆盖率打分） |

## 重要限制：这是管道回归，不是语义质量 benchmark

protocol-standin（`apps/server/src/retrieval/protocol-standin.ts`）是确定性替身：

- **词法搜索**：`doc.text.includes(query)` 整串子串匹配（无语义、无分词）；
- **向量**：字符分布哈希伪向量（无语义相似度）；
- **精排**：按 query 字符在文档中的覆盖率打分。

因此语料和查询的设计约定：**每个评测查询必须是其相关记忆文本的字面子串（大小写不敏感），且尽量不出现在非相关记忆里**。分数用来守住「管道是否还正确工作」（写入索引、两路召回、RRF 融合、精排重排、用户隔离、过滤裁决），分数高低不代表真实语义检索质量。要测真实语义质量，需把 standin 换成真实 Meilisearch/Qdrant/DashScope 后用同一套语料重跑。

## 扩展语料

1. 在 `corpus.ts` 的 `CORPUS` 加记忆（`key` 保持稳定，`type` 用 7 种枚举之一）。
2. 在 `QUERIES` 加查询：`query` 必须逐字出现在每条 `relevant` 记忆的 `content` 里（子串匹配，大小写不敏感）；同时 grep 一遍语料，确认它没有意外出现在非相关记忆里。
3. `pnpm eval` 重跑，把新的 `eval/results/<date>.md` 提交入库。

指标掉到基线以下（见最新分数卡）即视为回归信号：`rrf` 的 Recall@10 应为 100%，精排策略的 MRR / Recall@5 应不低于 `rrf`。
