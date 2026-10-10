# LongMemEval-S 检索分数（2026-10-10）

这是每类 1 题的计时探测，不是主表。主表是同日 `--stratify 10` 的结果目录。

计分照 agentmemory `benchmark/longmemeval-bench.ts`：每题单独建索引，会话正文为 `role: content`，取前 20 个会话。
标题指标是 `recall_any@K`（前 K 个里出现任一金标会话）。拒答类型不在这张表里。检索环没有答题模型。

## 条件

- 数据文件：`longmemeval_s_cleaned.json`，277383467 字节，sha256 `d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442`
- git：`cf69628`，工作区有未提交改动
- 标题题 6，分层 1，排除拒答 0
- 检索深度 20。正文上限 100000 字符，超出截断并计入 truncatedSessions。
- tokenizer：cl100k_base。top10Tokens 是前 10 个命中会话正文的 token 数。
- agent-recall 嵌入模型：qwen3-vl-embedding。索引 `agent-recall-memories-test`，集合 `agent-recall-memories-test`。
- 未跑：mem0、graphiti、letta、cognee、supermemory。没有本机端点，不填模拟分数。

## 总分

| system | n | errors | recall_any@5 | recall_any@10 | recall_any@20 | Recall@5 | nDCG@10 | MRR | search p50 | index p50 | top10 tokens |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| grep | 6 | 0 | 100.0% | 100.0% | 100.0% | 100.0% | 81.2% | 75.0% | 2 ms | 0 ms | 30980 |
| agent-recall | 6 | 0 | 33.3% | 100.0% | 100.0% | 33.3% | 44.3% | 34.5% | 454 ms | 32541 ms | 28353 |

## 分题型 recall_any@5

| type | grep | agent-recall | n |
| --- | --- | --- | --- |
| knowledge-update | 100.0% | 100.0% | 1 |
| multi-session | 100.0% | 0.0% | 1 |
| single-session-assistant | 100.0% | 0.0% | 1 |
| single-session-preference | 100.0% | 100.0% | 1 |
| single-session-user | 100.0% | 0.0% | 1 |
| temporal-reasoning | 100.0% | 0.0% | 1 |

## recall_any@5 未命中

| system | question | type | top3 | gold |
| --- | --- | --- | --- | --- |
| agent-recall | 0a995998 | multi-session | fa46a10e, 85846900_2, afbd7193_2 | answer_afa9873b_2, answer_afa9873b_3, answer_afa9873b_1 |
| agent-recall | 7161e7e2 | single-session-assistant | dba97bb1_4, e89b6be2_2, ad361482_1 | answer_sharegpt_5Lzox6N_0 |
| agent-recall | e47becba | single-session-user | sharegpt_rnG0ZuV_0, ultrachat_422229, 02bd2b90_3 | answer_280352e9 |
| agent-recall | gpt4_59149c77 | temporal-reasoning | 6e672b84_1, 7966888b_3, 31829c1b_1 | answer_d00ba6d0_1, answer_d00ba6d0_2 |

## 错误

没有。
