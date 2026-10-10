# LongMemEval-S 检索评测（2026-10-10）

这次测的是检索：给定问题，前 K 条结果里有没有金标会话。没有答题模型，也没有裁判。数字不能和 Mem0、Zep 公布的问答准确率放在一起，那些分数用了不同的模型和裁判。Mem0、Graphiti、Letta、Cognee、Supermemory 这次没有本机端点，没有填分。

协议在 [PROTOCOL.md](PROTOCOL.md)。原始对话在 `data/`，不进 git。逐题记录在 `results/`。

## 结论

同一批 60 题上：

- 词面匹配的 `recall_any@5` 是 86.7%。
- agent-recall 只用全文加向量、再按 RRF 合并时，是 56.7%。金标会话经常被找到，但排不进前 5：进前 20 的比例是 86.7%，进前 10 是 80.0%。
- 同一套检索打开 `qwen3.7-text-rerank` 之后，`recall_any@5`、`@10`、`@20` 都是 100%。严格 Recall@5 是 98.8%，因为有的题有多个金标会话，前 5 条没有把它们全部收齐，但每题至少命中了一个。
- 精排把检索中位数从 454 ms 提高到 2.4 秒。按协议每题单独建索引，写入中位数大约 33 秒，精排不改变这一步。

不开精排时，差距集中在单会话助手（10%）和单会话用户（30%）。问句里常有证据会话里的稀有词，只数字词的 grep 容易排到前面。整段会话压成一个向量后，有用的那一两句被其余对话稀释，RRF 又把向量名次和词面名次等权相加，词面已经找对的会话就被拉出前 5。偏好题的问法经常换了说法，这一类不开精排时 agent-recall 是 90%，grep 是 70%。每类只有 10 题。

精排默认关闭。新用户要在设置里打开，并填写精排地址、模型和密钥。这次评测在测试用户上打开了它。`qwen3.7-text-rerank` 拒绝单篇超过 50000 字符的文档，请求前会把超长文档截到这个长度，只把开头送去精排。60 题里精排全部生效，没有失败。

## 测了什么

数据集是 [LongMemEval](https://github.com/xiaowu0162/LongMemEval) 的 S 版本清洗文件 `longmemeval_s_cleaned.json`（Hugging Face `xiaowu0162/longmemeval-cleaned`）。文件 277383467 字节，sha256 `d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442`。500 道题里有 30 道拒答，`question_id` 以 `_abs` 结尾，类型字段本身不带这个后缀。这 30 题不进标题表。

标题样本按题型名字排序，每类保留文件中的前 10 题，共 60 题。拒答题排在各类靠后，不在这 60 题里。grep 和 agent-recall 用的是同一批题。

计分照 agentmemory 的 `benchmark/longmemeval-bench.ts`：

- 每题单独建索引，题与题不共用文档。
- 一个 haystack 会话是一篇文档。正文把轮次拼成 `role: content`，中间用换行连接。
- 取前 20 个会话。
- `recall_any@K`：前 K 条里出现任一金标会话记 1，否则记 0，再对题取平均。
- Recall@5：前 5 条里命中的金标数除以该题金标数。
- nDCG@10、MRR 用二元相关。
- 检索耗时只计召回。写入耗时单列，是这一题全部会话的入库时间。
- `top10Tokens` 用 cl100k 数前 10 条命中会话的正文，不用各产品自报的 token。

agent-recall 连的是 `apps/server/.env.test` 里的测试库。Meilisearch 索引和 Qdrant 集合都以 `-test` 结尾。每题写完就从库和两个索引里删掉。嵌入模型是 `qwen3-vl-embedding`。全文检索是 Meilisearch 的词匹配、错字、词距和精确匹配，不是 BM25。两路用 RRF（k=60）等权合并。词面基线把问句收成小写英文词，丢掉长度不超过 2 的词，按命中词种数排序。

跑分时的 git 是 `cf69628`，工作区有未提交改动。`results/probe/` 是每类 1 题的计时探测，不作为成绩。

## 60 题主表

### 不开精排

目录：`results/2026-10-10/`。

| 系统 | n | recall_any@5 | @10 | @20 | Recall@5 | nDCG@10 | MRR | 检索 p50 | 写入 p50 | 前 10 条 token |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| grep | 60 | 86.7% | 91.7% | 95.0% | 79.7% | 72.1% | 70.6% | 2 ms | 0 | 29862 |
| agent-recall | 60 | 56.7% | 80.0% | 86.7% | 45.0% | 45.6% | 42.5% | 454 ms | 30.7 s | 27015 |

`recall_any@5` 按题型，每类 10 题：

| 题型 | grep | agent-recall |
| --- | --- | --- |
| 知识更新 | 100% | 90% |
| 多会话 | 80% | 50% |
| 单会话助手 | 70% | 10% |
| 偏好 | 70% | 90% |
| 单会话用户 | 100% | 30% |
| 时间推理 | 100% | 70% |

60 题没有索引错误，没有截断。相同正文在五分钟窗口里并成一条的情况一共 3 次。

### 打开精排

目录：`results/2026-10-10-rerank/`。模型 `qwen3.7-text-rerank`。60 题精排都生效。

| 系统 | n | recall_any@5 | @10 | @20 | Recall@5 | nDCG@10 | MRR | 检索 p50 | 写入 p50 | 前 10 条 token |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| grep | 60 | 86.7% | 91.7% | 95.0% | 79.7% | 72.1% | 70.6% | 2 ms | 0 | 29862 |
| agent-recall | 60 | 100% | 100% | 100% | 98.8% | 99.0% | 99.2% | 2.4 s | 33.0 s | 30653 |

六类题的 `recall_any@5` 都是 100%。grep 的未命中题和不开精排那次相同，因为它不经过精排。agent-recall 这 60 题没有 `recall_any@5` 未命中。

前 10 条命中会话的正文大约 2.7 万到 3.1 万 token。两边返回的都是整段会话，上下文并不小。

## 全量词面

目录：`results/2026-10-10-grep-all/`。470 道可答题，排除 30 道拒答。只有 grep，没有 agent-recall。

| 系统 | n | recall_any@5 | @10 | @20 | Recall@5 | nDCG@10 | MRR | 检索 p50 | 前 10 条 token |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| grep | 470 | 88.5% | 93.6% | 98.3% | 80.1% | 76.2% | 76.4% | 2 ms | 30120 |

| 题型 | n | recall_any@5 |
| --- | --- | --- |
| 知识更新 | 72 | 97.2% |
| 多会话 | 121 | 92.6% |
| 单会话助手 | 56 | 87.5% |
| 偏好 | 30 | 46.7% |
| 单会话用户 | 64 | 92.2% |
| 时间推理 | 127 | 88.2% |

偏好题在全量上只有 46.7%。60 题样本里这类是 70%，样本偏乐观。agent-recall 还没有对应的全量分。

## 复现

下载数据的命令在 [PROTOCOL.md](PROTOCOL.md)。原始 json 不提交。

```bash
pnpm eval:compare -- --stratify 10
pnpm eval:compare -- --all --systems grep --out eval/compare/results/2026-10-10-grep-all
```

打开精排时，给进程准备 `DASHSCOPE_API_KEY`、`DASHSCOPE_BASE_URL` 和 `RERANK_MODEL`。密钥不要写进仓库。这次用的地址是 `https://dashscope.aliyuncs.com/api/v1`，模型是 `qwen3.7-text-rerank`。

```bash
pnpm eval:compare -- --stratify 10 --out eval/compare/results/2026-10-10-rerank
```

agent-recall 只连测试库。索引名和集合名必须以 `-test` 结尾。
