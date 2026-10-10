# LongMemEval-S 检索分数（2026-10-10）

计分照 agentmemory `benchmark/longmemeval-bench.ts`：每题单独建索引，会话正文为 `role: content`，取前 20 个会话。
标题指标是 `recall_any@K`（前 K 个里出现任一金标会话）。拒答类型不在这张表里。检索环没有答题模型。

## 条件

- 数据文件：`longmemeval_s_cleaned.json`，277383467 字节，sha256 `d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442`
- git：`cf69628`，工作区有未提交改动
- 标题题 60，分层 10，排除拒答 30
- 检索深度 20。正文上限 100000 字符，超出截断并计入 truncatedSessions。
- tokenizer：cl100k_base。top10Tokens 是前 10 个命中会话正文的 token 数。
- agent-recall 嵌入模型：qwen3-vl-embedding。索引 `agent-recall-memories-test`，集合 `agent-recall-memories-test`。
- 重排模型：qwen3.7-text-rerank。生效 60 题，失败 0 题。单篇超过 50000 字符时只把开头送去精排。
- 未跑：mem0、graphiti、letta、cognee、supermemory。没有本机端点，不填模拟分数。

## 总分

| system | n | errors | recall_any@5 | recall_any@10 | recall_any@20 | Recall@5 | nDCG@10 | MRR | search p50 | index p50 | top10 tokens |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| grep | 60 | 0 | 86.7% | 91.7% | 95.0% | 79.7% | 72.1% | 70.6% | 2 ms | 0 ms | 29862 |
| agent-recall | 60 | 0 | 100.0% | 100.0% | 100.0% | 98.8% | 99.0% | 99.2% | 2369 ms | 33006 ms | 30653 |

## 分题型 recall_any@5

| type | grep | agent-recall | n |
| --- | --- | --- | --- |
| knowledge-update | 100.0% | 100.0% | 10 |
| multi-session | 80.0% | 100.0% | 10 |
| single-session-assistant | 70.0% | 100.0% | 10 |
| single-session-preference | 70.0% | 100.0% | 10 |
| single-session-user | 100.0% | 100.0% | 10 |
| temporal-reasoning | 100.0% | 100.0% | 10 |

## recall_any@5 未命中

| system | question | type | top3 | gold |
| --- | --- | --- | --- | --- |
| grep | gpt4_59c863d7 | multi-session | 2f09d4c8, a7d014e4_1, 2f310ba0 | answer_593bdffd_4, answer_593bdffd_1, answer_593bdffd_3, answer_593bdffd_2 |
| grep | gpt4_f2262a51 | multi-session | c0d6fa6f_2, 0984a772, 2aeb1268 | answer_55a6940c_3, answer_55a6940c_1, answer_55a6940c_2 |
| grep | 7e00a6cb | single-session-assistant | 4dd1ba8d_2, 5534efcb_2, 956ce238 | answer_ultrachat_370515 |
| grep | 1903aded | single-session-assistant | 9b4c070c, b163d176, 184efb91_3 | answer_sharegpt_hA7AkP3_0 |
| grep | ceb54acb | single-session-assistant | 511bdbe3_2, f6fd00cf, 0bbd7094_1 | answer_sharegpt_cGdjmYo_0 |
| grep | 06878be2 | single-session-preference | a6074da9_1, 3e9fce53_1, 465e7ef9 | answer_555dfb94 |
| grep | 75832dbd | single-session-preference | 47ec1674_2, 1ef63c66, 220cb2a0_2 | answer_d87a6ef8 |
| grep | 0edc2aef | single-session-preference | f20e72e4_1, 08ca1f31_2, 32d6bf49 | answer_d586e9cd |

## 错误

没有。
