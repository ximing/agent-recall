# LongMemEval-S 检索分数（2026-10-10）

计分照 agentmemory `benchmark/longmemeval-bench.ts`：每题单独建索引，会话正文为 `role: content`，取前 20 个会话。
标题指标是 `recall_any@K`（前 K 个里出现任一金标会话）。拒答类型不在这张表里。检索环没有答题模型。

## 条件

- 数据文件：`longmemeval_s_cleaned.json`，277383467 字节，sha256 `d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442`
- git：`cf69628`，工作区有未提交改动
- 标题题 470，分层 全量，排除拒答 30
- 检索深度 20。正文上限 100000 字符，超出截断并计入 truncatedSessions。
- tokenizer：cl100k_base。top10Tokens 是前 10 个命中会话正文的 token 数。
- 这次没有跑 agent-recall。
- 未跑：mem0、graphiti、letta、cognee、supermemory。没有本机端点，不填模拟分数。

## 总分

| system | n | errors | recall_any@5 | recall_any@10 | recall_any@20 | Recall@5 | nDCG@10 | MRR | search p50 | index p50 | top10 tokens |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| grep | 470 | 0 | 88.5% | 93.6% | 98.3% | 80.1% | 76.2% | 76.4% | 2 ms | 0 ms | 30120 |

## 分题型 recall_any@5

| type | grep | n |
| --- | --- | --- |
| knowledge-update | 97.2% | 72 |
| multi-session | 92.6% | 121 |
| single-session-assistant | 87.5% | 56 |
| single-session-preference | 46.7% | 30 |
| single-session-user | 92.2% | 64 |
| temporal-reasoning | 88.2% | 127 |

## recall_any@5 未命中

| system | question | type | top3 | gold |
| --- | --- | --- | --- | --- |
| grep | 6b168ec8 | single-session-user | 0232f77d, 258645ba_1, 285a29e7_2 | answer_e623ae87 |
| grep | 60d45044 | single-session-user | 4ebf9095_1, 35a61ccd_1, 446173bb_1 | answer_9cddca88 |
| grep | e01b8e2f | single-session-user | 97338ddd_1, d31c3ec8_1, 1aaf8057_3 | answer_5ca6cd28 |
| grep | ccb36322 | single-session-user | bdcee74e_3, 06d1a1a0, 6d52ee93_1 | answer_f1fbb330 |
| grep | c14c00dd | single-session-user | c77250d2, 183b6085, 5dac7cc2_1 | answer_304511ce |
| grep | gpt4_59c863d7 | multi-session | 2f09d4c8, a7d014e4_1, 2f310ba0 | answer_593bdffd_4, answer_593bdffd_1, answer_593bdffd_3, answer_593bdffd_2 |
| grep | gpt4_f2262a51 | multi-session | c0d6fa6f_2, 0984a772, 2aeb1268 | answer_55a6940c_3, answer_55a6940c_1, answer_55a6940c_2 |
| grep | eeda8a6d | multi-session | sharegpt_PTZ2ime_0, 0ef02bf2, 45fa8f75 | answer_3e5fea0e_1, answer_3e5fea0e_2 |
| grep | 10d9b85a | multi-session | c51583cd_3, 84889496_1, 8dd2fca2 | answer_e0585cb5_2, answer_e0585cb5_1 |
| grep | 06878be2 | single-session-preference | a6074da9_1, 3e9fce53_1, 465e7ef9 | answer_555dfb94 |
| grep | 75832dbd | single-session-preference | 47ec1674_2, 1ef63c66, 220cb2a0_2 | answer_d87a6ef8 |
| grep | 0edc2aef | single-session-preference | f20e72e4_1, 08ca1f31_2, 32d6bf49 | answer_d586e9cd |
| grep | 06f04340 | single-session-preference | 6e6fbb6b, 0844dea6, 42924d15 | answer_92d5f7cd |
| grep | 6b7dfb22 | single-session-preference | 377f8fd9_1, 77a26018, 9ee69ca6_3 | answer_f6502d0f |
| grep | 1a1907b4 | single-session-preference | 4f3b36d4_5, 9585e0c6_1, 233605cc_2 | answer_719502eb |
| grep | 09d032c9 | single-session-preference | 3fc2244f, 612e23f1, d3971322_1 | answer_b10dce5e |
| grep | d24813b1 | single-session-preference | 3124bb28_1, 084802f9_3, 61a46ff7_3 | answer_7c0ade93 |
| grep | 57f827a0 | single-session-preference | d0f42e3f, 1bff1675, 2ef55f49_1 | answer_1bde8d3b |
| grep | 95228167 | single-session-preference | 3d2e66f2_2, 084802f9_2, 8199fb3a_4 | answer_5e613445 |
| grep | d6233ab6 | single-session-preference | 0e726047, 87cfeb28_2, 94bc18df_3 | answer_b0fac439 |
| grep | fca70973 | single-session-preference | 2f2884ad_1, 5d5e80c5_1, 7b9ee249_2 | answer_a1e169b1 |
| grep | b0479f84 | single-session-preference | 6af947bf_1, 98bd4ca2, fbfda981 | answer_30f63ddb |
| grep | 1d4e3b97 | single-session-preference | ecb24dd8_2, 809cabca_1, c51583cd_3 | answer_e6b6353d |
| grep | 07b6f563 | single-session-preference | dcc7f430_1, 0ac1a6f9_2, 13b79e39_2 | answer_d03098f9 |
| grep | 1c0ddc50 | single-session-preference | 2aa70c9c_1, b33e89b5_1, 0a7d5bf6_2 | answer_8da8c7e0 |
| grep | a1cc6108 | multi-session | 298a07de_5, 0e3f4574_2, 31e254b5 | answer_17dc2f5b_2, answer_17dc2f5b_1 |
| grep | 3fdac837 | multi-session | 92b06116_1, a98ff421_7, 09d021e7_1 | answer_419d21d5_2, answer_419d21d5_1 |
| grep | 92a0aa75 | multi-session | 2bdd78cb_1, 5e3eeb12_2, 6da0bba2_1 | answer_6cb8f792_1, answer_6cb8f792_2 |
| grep | 157a136e | multi-session | ultrachat_255132, ultrachat_3770, 01049599_1 | answer_8de18468_2, answer_8de18468_1 |
| grep | 8e91e7d9 | multi-session | sharegpt_PZrBCF2_0, ultrachat_147574, 06170195_1 | answer_477ae455_1, answer_477ae455_2 |
| grep | gpt4_8279ba02 | temporal-reasoning | 85f19a30_1, 3a735bfa_1, 4f52229e | answer_56521e65_1 |
| grep | gpt4_468eb063 | temporal-reasoning | 23ecf657, 982514b2_1, d97db962_2 | answer_9b09d95b_1 |
| grep | gpt4_e061b84f | temporal-reasoning | 0a6bf5e4_1, ultrachat_129606, 11a8f823_1 | answer_8c64ce25_2, answer_8c64ce25_1, answer_8c64ce25_3 |
| grep | 5e1b23de | temporal-reasoning | 1380576d_1, 1a5344e9_3, a13abca5_2 | answer_c18d480b_1 |
| grep | gpt4_e061b84g | temporal-reasoning | ae15e8b6_1, 68705467_1, 9dac9e37_1 | answer_8c64ce26_2, answer_8c64ce26_1, answer_8c64ce26_3 |
| grep | gpt4_1e4a8aec | temporal-reasoning | 9f1f3bf4, 4c8455cb_2, a8086137 | answer_16bd5ea6_1, answer_16bd5ea6_2 |
| grep | gpt4_4929293b | temporal-reasoning | b4ed7223_3, cae65795_1, sharegpt_KFhIUCO_0 | answer_add9b013_2, answer_add9b013_1 |
| grep | gpt4_468eb064 | temporal-reasoning | 1d74a734, db1aefb6_3, dff89d9d_1 | answer_9b09d95b_1 |
| grep | 9a707b82 | temporal-reasoning | 8e78fa70_1, f8e9d4fa, fab41c07 | answer_dba89488_2, answer_dba89488_1 |
| grep | eac54add | temporal-reasoning | 2ea6fda4_1, 773aebbd_3, 7bb01253 | answer_0d4d0348_1, answer_0d4d0348_2 |
| grep | 4dfccbf8 | temporal-reasoning | 460c2850_1, 7db28e68_1, edd89480_1 | answer_4bebc783_1, answer_4bebc783_2 |
| grep | 6e984302 | temporal-reasoning | 7285299a_8, b7702ee4_1, 3535dbf0_4 | answer_88841f27_1, answer_88841f27_2 |
| grep | gpt4_8279ba03 | temporal-reasoning | b357fb8b_2, 2ef55f49_3, 864a563d_5 | answer_56521e66_1 |
| grep | gpt4_93159ced | temporal-reasoning | 9279d42e, 263efe64_1, 43df393f | answer_e5131a1b_2, answer_e5131a1b_1 |
| grep | gpt4_88806d6e | temporal-reasoning | 1382d6fb_1, 24bfc009_5, sharegpt_1gGwK6p_0 | answer_e60a93ff_1, answer_e60a93ff_2 |
| grep | 2698e78f | knowledge-update | 338281a4_1, d76030af_1, 0fffb38f_2 | answer_9282283d_1, answer_9282283d_2 |
| grep | 0977f2af | knowledge-update | 809cbce9_3, 104be29f_1, 1692563c_1 | answer_3bf5b73b_1, answer_3bf5b73b_2 |
| grep | 7e00a6cb | single-session-assistant | 4dd1ba8d_2, 5534efcb_2, 956ce238 | answer_ultrachat_370515 |
| grep | 1903aded | single-session-assistant | 9b4c070c, b163d176, 184efb91_3 | answer_sharegpt_hA7AkP3_0 |
| grep | ceb54acb | single-session-assistant | 511bdbe3_2, f6fd00cf, 0bbd7094_1 | answer_sharegpt_cGdjmYo_0 |
| grep | 1568498a | single-session-assistant | 6ad46850_2, 38de4c2a_1, 1fef8ffe_1 | answer_sharegpt_d6JJiqH_76 |
| grep | e8a79c70 | single-session-assistant | c0d099e6_2, c4c504d2_6, cdf068b1_4 | answer_ultrachat_13075 |
| grep | eaca4986 | single-session-assistant | 931c521e_1, 1c1a2b7f_2, 0e543e9e_2 | answer_sharegpt_SS141vi_0 |
| grep | 778164c6 | single-session-assistant | 490bb46d_1, 05b551b6, 483ddd90 | answer_ultrachat_399000 |

## 错误

没有。
