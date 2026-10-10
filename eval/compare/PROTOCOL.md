# 公开测试集

主结果只用论文作者发布、并且记忆产品厂商也在报的公开集。仓库里不自造问答当成绩。原始对话不提交：LongMemEval-S 约 265MB，LoCoMo 是 CC BY-NC 4.0。提交下载地址、版本、抽题规则和我们自己的分数。

## 用哪一份

| 顺序 | 数据集 | 出处 | 这次用的文件 | 题量 | 协议 |
| --- | --- | --- | --- | --- | --- |
| 主结果 | LongMemEval-S cleaned | ICLR 2025，[arXiv:2410.10813](https://arxiv.org/abs/2410.10813) | `longmemeval_s_cleaned.json` | 500 | 信息抽取、多会话、时间、知识更新、偏好。官方指标是答题准确率 |
| 对照 | LoCoMo 公开 10 段 | ACL 2024，[arXiv:2402.17753](https://arxiv.org/abs/2402.17753) | `data/locomo10.json` | 先报可答题，对抗题单独一列 | Mem0、Zep 的宣传数字来自这里 |
| 规模，后做 | BEAM | ICLR 2026，[arXiv:2510.27246](https://arxiv.org/abs/2510.27246) | 100K 或 1M 桶 | 每段对话约 20 道探针 | 十种能力，含拒答和矛盾。对话很长，灌库贵 |

LongMemEval 还有两份不进主表：

- `longmemeval_oracle.json` 只含证据会话，测的是阅读，不是检索。
- `longmemeval_m_cleaned.json` 每题约 500 个会话、2.6GB，作为压力测试，不作为第一张分数卡。
- LongMemEval-V2（2026-05，偏 agent 场景）还没有和 Mem0 / Zep 对齐的冻结分数，先不拿来对打。

## 下载

数据放在 `eval/compare/data/`，该目录已忽略。

```bash
mkdir -p eval/compare/data
curl -L -C - --retry 8 --retry-all-errors -o eval/compare/data/longmemeval_s_cleaned.json \
  https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_s_cleaned.json

curl -L -o eval/compare/data/locomo10.json \
  https://raw.githubusercontent.com/snap-research/locomo/main/data/locomo10.json
```

作者仓库：<https://github.com/xiaowu0162/LongMemEval>，<https://github.com/snap-research/locomo>。

跑检索对比（原始对话不进 git，分数写到 `eval/compare/results/<日期>/`）：

```bash
pnpm eval:compare -- --stratify 10
pnpm eval:compare -- --all --systems grep
```

`--systems` 目前接受 `grep` 和 `agent-recall`。agent-recall 只连 `apps/server/.env.test` 里的测试库，并且要求 Meilisearch 索引和 Qdrant 集合都以 `-test` 结尾。每题写完就从索引里删掉。

BEAM 稍后从 <https://huggingface.co/datasets/Mohammadta/BEAM> 取，许可证 CC BY-SA 4.0。

## 计分照 agentmemory 的检索脚本

agentmemory 有两套 LongMemEval，数字不能混。我们的主表照它真正打出 95.2% 的那支：`benchmark/longmemeval-bench.ts`。适配器外壳照 `eval/runner/longmemeval.ts`。

它的做法：

- 数据文件是 `longmemeval_s_cleaned.json`。每道题单独建索引，用完丢掉。一个 haystack 会话是一条文档。
- 会话正文把每轮拼成 `role: content`，轮与轮之间用换行接上。`eval/runner/load.ts` 用的是 `[role] content`，两套拼接不一样。主表跟 benchmark 那支，用 `role: content`。
- 检索取前 20 个会话。标题指标是 `recall_any@5`、`recall_any@10`、`recall_any@20`、nDCG@10、MRR。`recall_any@K` 表示前 K 个里只要出现任一金标会话就记 1。
- 拒答题不进这张表，另计。agentmemory 按 `question_type` 丢掉 `single-session-user_abs`、`multi-session_abs`、`knowledge-update_abs`、`temporal-reasoning_abs`。这份 cleaned 文件把类型写成了不带 `_abs` 的原类型，拒答只留在 `question_id` 后缀上，一共 30 题。加载时两种都排除。它们排在各类型靠后的位置，分层每类前 10 题碰不到，所以 60 题主表不变。
- 检索环里没有答题模型，也没有裁判。它在 `benchmark/LONGMEMEVAL.md` 里写明这不是论文的 QA 准确率。Mem0、Zep 公布的 90% 以上是 QA 分，和这张表不是同一个数。
- 向量那一档只嵌入每个会话的前 512 个字符，混合权重是 BM25 0.4、向量 0.6。这是它自己的系统设置。agent-recall 索引全文，不截成 512。
- 分层抽题用 `eval/runner/load.ts` 的 `stratifySample`：题型名字排序，题型内部保持文件顺序，每类取前 N 题。
- 基线有两个。`grep` 把查询切成小写的 `[a-z0-9_]` 词，丢掉长度不超过 2 的词，按命中词数排序。`vector` 是另一条嵌入基线。
- 逐题写 `scores.ndjson`，汇总写 `summary.md`，条件写 `conditions.json`。原始对话不进 git。

同一条排序再补两列，来自 `eval/runner/score.ts`：严格 Recall@5（命中的金标数除以金标数）和 hit。延迟用客户端墙钟，汇总报 p50。

token 不在它的 LongMemEval 脚本里。我们在同一轮额外数前 10 个会话正文的 `cl100k_base` token，单独成列。QA 裁判留到检索表稳定之后，用同一个答题模型和同一个裁判再跑，不写进检索标题分。

`eval/data/coding-agent-life-v1` 是它的 15 题冒烟集。P@5 的数学上限是 0.24，作者自己也不拿它当公开成绩。我们不跑这套，也不自造题。

## 和厂商数字对齐时要写明的四件事

1. **变体。** LongMemEval 的 S 和 M 差一个数量级。LoCoMo 论文是 50 段对话、7512 题；GitHub 上的 `locomo10.json` 是其中 10 段。厂商口中的约 1540 题，一般是这 10 段里去掉对抗题之后的可答题。
2. **裁判。** 标题分用同一答题模型和同一裁判。Mem0 公开的 92.5 / 94.4 与 Zep 公开的 94.7 / 90.2 使用了不同模型和不同宽严，不能并排。
3. **预算。** 等预算列把检索上下文裁到 2000 token（`cl100k_base`）。出厂列保留各系统默认条数。
4. **写入方式。** 抽取型产品按它自己的入库接口灌会话。agent-recall 把每个会话存成一条记忆，不另做抽事实。两笔 token 分开记：写入、检索上下文。

抽题在全量之前用分层：按 `question_type` 排序后每类取前 10 题。LongMemEval-S 因此是 60 题量级（以文件里的实际类型数为准）。全量 500 题只在这 60 题的适配器不再改接口之后跑。

## 仓库里留什么

- 本协议、下载命令、抽题规则。
- 跑完之后的 `eval/compare/results/<date>/`：条件（模型名、系统版本、文件校验和）、逐题 `rows.ndjson`、`summary.md`。
- 逐题记录含问题 id、检索上下文的 token 数、延迟、裁判标签。不含整段原始对话。
