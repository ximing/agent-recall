# LongMemEval-S 检索分数（2026-10-10）

计分照 agentmemory `benchmark/longmemeval-bench.ts`：每题单独建索引，会话正文为 `role: content`，取前 20 个会话。
标题指标是 `recall_any@K`（前 K 个里出现任一金标会话）。拒答类型不在这张表里。检索环没有答题模型。

## 条件

- 数据文件：`longmemeval_s_cleaned.json`，277383467 字节，sha256 `d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442`
- git：`cf69628`，工作区有未提交改动
- 标题题 60，分层 10，排除拒答 0
- 这份 cleaned 文件另有 30 道 `question_id` 以 `_abs` 结尾的拒答题，类型字段没有这个后缀。它们不在这 60 题里。加载器后来按题号后缀排除。全量 grep 见 `../2026-10-10-grep-all/`。
- 检索深度 20。正文上限 100000 字符，超出截断并计入 truncatedSessions。
- tokenizer：cl100k_base。top10Tokens 是前 10 个命中会话正文的 token 数。
- agent-recall 嵌入模型：qwen3-vl-embedding。索引 `agent-recall-memories-test`，集合 `agent-recall-memories-test`。
- 未跑：mem0、graphiti、letta、cognee、supermemory。没有本机端点，不填模拟分数。

## 总分

| system | n | errors | recall_any@5 | recall_any@10 | recall_any@20 | Recall@5 | nDCG@10 | MRR | search p50 | index p50 | top10 tokens |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| grep | 60 | 0 | 86.7% | 91.7% | 95.0% | 79.7% | 72.1% | 70.6% | 2 ms | 0 ms | 29862 |
| agent-recall | 60 | 0 | 56.7% | 80.0% | 86.7% | 45.0% | 45.6% | 42.5% | 454 ms | 30715 ms | 27015 |

## 分题型 recall_any@5

| type | grep | agent-recall | n |
| --- | --- | --- | --- |
| knowledge-update | 100.0% | 90.0% | 10 |
| multi-session | 80.0% | 50.0% | 10 |
| single-session-assistant | 70.0% | 10.0% | 10 |
| single-session-preference | 70.0% | 90.0% | 10 |
| single-session-user | 100.0% | 30.0% | 10 |
| temporal-reasoning | 100.0% | 70.0% | 10 |

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
| agent-recall | 945e3d21 | knowledge-update | sharegpt_E7VUcfj_0, ef0341d4_2, 6da0bba2_1 | answer_6a4f8626_1, answer_6a4f8626_2 |
| agent-recall | 0a995998 | multi-session | fa46a10e, 85846900_2, afbd7193_2 | answer_afa9873b_2, answer_afa9873b_3, answer_afa9873b_1 |
| agent-recall | gpt4_59c863d7 | multi-session | 2f09d4c8, ultrachat_233858, a7d014e4_1 | answer_593bdffd_4, answer_593bdffd_1, answer_593bdffd_3, answer_593bdffd_2 |
| agent-recall | b5ef892d | multi-session | 35dcacdc_2, 12cff183_1, 1a44346c_1 | answer_a8b4290f_3, answer_a8b4290f_1, answer_a8b4290f_2 |
| agent-recall | e831120c | multi-session | sharegpt_sDfu38Q_0, ba6b67af_2, e9e19917_2 | answer_86c505e7_1, answer_86c505e7_2 |
| agent-recall | dd2973ad | multi-session | 41743aae_1, sharegpt_O6NO7Vo_9, ultrachat_478199 | answer_f9de4602_2, answer_f9de4602_1 |
| agent-recall | 7161e7e2 | single-session-assistant | dba97bb1_4, e89b6be2_2, ad361482_1 | answer_sharegpt_5Lzox6N_0 |
| agent-recall | c4f10528 | single-session-assistant | 51c89181_1, c8c90a81_1, 107d40f0 | answer_ultrachat_234453 |
| agent-recall | 89527b6b | single-session-assistant | 9fa1d135_1, 197410bc, 07f3f0e0_2 | answer_sharegpt_YkWn1Ne_0 |
| agent-recall | e9327a54 | single-session-assistant | ba944cdc, 61e1ba53_2, c58fdf1e_2 | answer_ultrachat_480665 |
| agent-recall | 6ae235be | single-session-assistant | sharegpt_TVK4gjw_24, 43811b62, 99188307 | answer_sharegpt_IUWQYGQ_0 |
| agent-recall | 7e00a6cb | single-session-assistant | 24f78a31_2, 4dd1ba8d_2, 2fa50779_5 | answer_ultrachat_370515 |
| agent-recall | 1903aded | single-session-assistant | fa68c9d6_1, 9b4c070c, 66369fde_1 | answer_sharegpt_hA7AkP3_0 |
| agent-recall | ceb54acb | single-session-assistant | c60d5c8a_1, 44202c74_2, dddce60a_1 | answer_sharegpt_cGdjmYo_0 |
| agent-recall | f523d9fe | single-session-assistant | 22aa7cca_4, b1de645e, e6e4fd83_3 | answer_sharegpt_m2xJfjo_0 |
| agent-recall | 0edc2aef | single-session-preference | 53dc1394, 3c3a9042_3, 08ca1f31_2 | answer_d586e9cd |
| agent-recall | e47becba | single-session-user | sharegpt_rnG0ZuV_0, ultrachat_422229, 02bd2b90_3 | answer_280352e9 |
| agent-recall | 118b2229 | single-session-user | db73b7e4_4, db50c0f6, 7d8b5834_1 | answer_40a90d51 |
| agent-recall | 51a45a95 | single-session-user | sharegpt_MKMWjX0_25, 07d1915d_1, dfe646a7_1 | answer_d61669c7 |
| agent-recall | 1e043500 | single-session-user | 01bd9def, 8020d945_2, sharegpt_bph7DTk_7 | answer_3e012175 |
| agent-recall | 6ade9755 | single-session-user | 7c5ab02a_2, ultrachat_462, ultrachat_270925 | answer_9398da02 |
| agent-recall | 6f9b354f | single-session-user | 0c0f2449_2, 68d4de04_2, ultrachat_549317 | answer_feb5200f |
| agent-recall | 58ef2f1c | single-session-user | 6d13e73a_2, 2eceeb9d_1, sharegpt_RFw4j0W_0 | answer_59547700 |
| agent-recall | gpt4_59149c77 | temporal-reasoning | 6e672b84_1, 7966888b_3, 31829c1b_1 | answer_d00ba6d0_1, answer_d00ba6d0_2 |
| agent-recall | af082822 | temporal-reasoning | 1a920713_2, 6cf1848e_3, cae65795_2 | answer_b51b6115_1 |
| agent-recall | 9a707b81 | temporal-reasoning | 990f3ef9_6, 318048af_1, 5a13d047_1 | answer_dba89487_2, answer_dba89487_1 |

## 错误

没有。
