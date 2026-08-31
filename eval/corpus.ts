/**
 * 召回质量评测语料：一个小型编程 agent 记忆库 + 标注查询。
 *
 * 设计约束（重要）：
 * protocol-standin 的词法搜索是「整串子串匹配」（doc.text.includes(query)），
 * 向量是字符分布伪向量（无语义），精排替身按 query 字符覆盖率打分。
 * 因此每个评测查询必须是其相关记忆文本的【字面子串】（大小写不敏感），
 * 且尽量不出现在非相关记忆里。本评测守住的是管道正确性（两路召回 → RRF 融合
 * → 可选精排 → 过滤裁决），不是绝对语义检索质量。
 */

export interface CorpusMemory {
  /** 语料内稳定标识，查询的 relevant 引用它 */
  key: string;
  type: 'fact' | 'preference' | 'pattern' | 'architecture' | 'bug' | 'workflow' | 'lesson';
  content: string;
  tags?: string[];
  project?: string;
}

export interface EvalQuery {
  key: string;
  query: string;
  /** 应命中的 CorpusMemory.key 列表 */
  relevant: string[];
}

export const CORPUS: CorpusMemory[] = [
  // ---- architecture ----
  { key: 'm01', type: 'architecture', content: '架构决策：检索采用 RRF k=60 融合词法与向量两路召回', tags: ['retrieval'], project: 'agent-recall' },
  { key: 'm02', type: 'architecture', content: '架构决策：服务端用 Fastify 5 加远端 Postgres，DATABASE_URL 必填', tags: ['server'], project: 'agent-recall' },
  { key: 'm03', type: 'architecture', content: '架构决策：向量库用 Qdrant，词法索引用 Meilisearch，嵌入走 DashScope', tags: ['retrieval'], project: 'agent-recall' },
  { key: 'm04', type: 'architecture', content: '架构决策：Web 前端 React 19 配 Vite 构建，路由集中在 src/routes.ts', tags: ['web'], project: 'agent-recall' },
  { key: 'm05', type: 'architecture', content: '架构决策：MCP server 通过 stdio 暴露 save 和 recall 两个工具', tags: ['mcp'], project: 'agent-recall' },
  { key: 'm06', type: 'architecture', content: '架构决策：monorepo 用 pnpm workspace 管理，包名统一前缀 @agent-recall', tags: ['repo'] },

  // ---- preference ----
  { key: 'm07', type: 'preference', content: '用户偏好用 pnpm 安装依赖，不要用 npm 或 yarn', tags: ['tooling'] },
  { key: 'm08', type: 'preference', content: '用户偏好提交信息遵循 Conventional Commits，例如 feat(server): 开头', tags: ['git'] },
  { key: 'm09', type: 'preference', content: '用户偏好中文回复，代码注释也写中文', tags: ['language'] },
  { key: 'm10', type: 'preference', content: '用户偏好测试框架用 vitest，不引入 jest', tags: ['testing'] },
  { key: 'm11', type: 'preference', content: '用户偏好样式用 Tailwind，不引入额外组件库', tags: ['web'] },
  { key: 'm12', type: 'preference', content: 'user prefers dark theme for all internal dashboards', tags: ['ui'] },

  // ---- bug ----
  { key: 'm13', type: 'bug', content: 'bug: 测试连远端 Postgres 时用隔离 schema，不要写入 public', tags: ['postgres'], project: 'agent-recall' },
  { key: 'm14', type: 'bug', content: 'bug: Meilisearch 的 filter 语法里字符串值必须用双引号', tags: ['retrieval'] },
  { key: 'm15', type: 'bug', content: 'bug: Qdrant points/query 的 filter 必须包在 must 数组里', tags: ['retrieval'] },
  { key: 'm16', type: 'bug', content: 'bug: Fastify inject 测试时 cookie 要手动拼 ar_session= 前缀', tags: ['testing'] },
  { key: 'm17', type: 'bug', content: 'bug: Vite dev server 在 macOS 上默认绑 IPv6，要显式指定 127.0.0.1', tags: ['web'] },
  { key: 'm18', type: 'bug', content: 'bug: argon2 在 CI 镜像里需要预编译二进制，源码编译会超时', tags: ['ci'] },

  // ---- workflow ----
  { key: 'm19', type: 'workflow', content: '工作流：改动检索代码后必须跑 pnpm eval 回归召回质量', tags: ['eval'], project: 'agent-recall' },
  { key: 'm20', type: 'workflow', content: '工作流：提交前跑 pnpm typecheck 和 pnpm test 两道闸', tags: ['ci'] },
  { key: 'm21', type: 'workflow', content: '工作流：新接口先在 packages/dto 里定义 zod schema，再实现服务端', tags: ['api'] },
  { key: 'm22', type: 'workflow', content: '工作流：数据库 schema 变更走 drizzle-kit generate 生成迁移文件', tags: ['db'] },
  { key: 'm23', type: 'workflow', content: '工作流：发布前用 start:prod 在本地冒烟一遍 Web 控制台', tags: ['release'] },
  { key: 'm24', type: 'workflow', content: 'workflow: rotate Bearer tokens every 90 days and revoke leaked ones immediately', tags: ['security'] },

  // ---- pattern ----
  { key: 'm25', type: 'pattern', content: '模式：所有路由用 zod schema 解析请求体，错误统一走 AppError', tags: ['api'] },
  { key: 'm26', type: 'pattern', content: '模式：测试用 app.inject 不起真实端口，外部协议靠内存 stand-in 替身', tags: ['testing'] },
  { key: 'm27', type: 'pattern', content: '模式：RRF 融合后可选接 rerank 精排，失败时回退 RRF 原始顺序', tags: ['retrieval'], project: 'agent-recall' },
  { key: 'm28', type: 'pattern', content: '模式：前端页面按 pages/<name>/index.tsx 加同级 service.ts 组织', tags: ['web'] },
  { key: 'm29', type: 'pattern', content: '模式：配置集中在 config.ts，测试用 testConfig 覆盖默认值', tags: ['testing'] },
  { key: 'm30', type: 'pattern', content: 'pattern: retrieval ports are plain interfaces so Qdrant and the lexical engine can be swapped', tags: ['retrieval'] },

  // ---- fact ----
  { key: 'm31', type: 'fact', content: '事实：生产环境部署在 222 端口那台主机，PUBLIC_BASE_URL 指向它', tags: ['deploy'] },
  { key: 'm32', type: 'fact', content: '事实：嵌入向量维度是 1024，模型名 qwen3-vl-embedding', tags: ['embedding'] },
  { key: 'm33', type: 'fact', content: 'fact: the rerank model in production is gte-rerank-v2 from DashScope', tags: ['rerank'] },
  { key: 'm34', type: 'fact', content: '事实：会话 cookie 名叫 ar_session，也支持 Bearer token 认证', tags: ['auth'] },
  { key: 'm35', type: 'fact', content: '事实：recall 日志保留 30 天，滚动清理过期记录', tags: ['logging'] },

  // ---- lesson ----
  { key: 'm36', type: 'lesson', content: '教训：不要把 API key 提交进仓库，曾经泄漏过一次 DashScope key', tags: ['security'] },
  { key: 'm37', type: 'lesson', content: '教训：自动化测试连远端 Postgres 时用隔离 schema，跑完删掉', tags: ['testing'] },
  { key: 'm38', type: 'lesson', content: '教训：RRF 的 k 值调小会让单路头部结果过度占优，保持 k=60', tags: ['retrieval'] },
  { key: 'm39', type: 'lesson', content: 'lesson: never trust a client-supplied user_id, always derive it from the session', tags: ['security'] },
  { key: 'm40', type: 'lesson', content: '教训：Meilisearch 写入任务是异步的，写完立刻查可能查不到', tags: ['retrieval'] },
];

export const QUERIES: EvalQuery[] = [
  { key: 'q01', query: 'RRF', relevant: ['m01', 'm27', 'm38'] },
  { key: 'q02', query: '远端 Postgres', relevant: ['m02', 'm13', 'm37'] },
  { key: 'q03', query: 'pnpm', relevant: ['m06', 'm07', 'm19', 'm20'] },
  { key: 'q04', query: 'Meilisearch', relevant: ['m03', 'm14', 'm40'] },
  { key: 'q05', query: 'Qdrant', relevant: ['m03', 'm15', 'm30'] },
  { key: 'q06', query: 'Fastify', relevant: ['m02', 'm16'] },
  { key: 'q07', query: 'rerank', relevant: ['m27', 'm33'] },
  { key: 'q08', query: 'vitest', relevant: ['m10'] },
  { key: 'q09', query: 'Bearer', relevant: ['m24', 'm34'] },
  { key: 'q10', query: 'DashScope', relevant: ['m03', 'm33', 'm36'] },
  { key: 'q11', query: 'argon2', relevant: ['m18'] },
  { key: 'q12', query: 'drizzle', relevant: ['m22'] },
  { key: 'q13', query: 'zod', relevant: ['m21', 'm25'] },
  { key: 'q14', query: 'cookie', relevant: ['m16', 'm34'] },
  { key: 'q15', query: 'stdio', relevant: ['m05'] },
  { key: 'q16', query: 'Vite', relevant: ['m04', 'm17'] },
  { key: 'q17', query: '融合', relevant: ['m01', 'm27'] },
  { key: 'q18', query: 'k=60', relevant: ['m01', 'm38'] },
];
