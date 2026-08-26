import { bindServices, observer, useService } from '@rabjs/react';
import { Link } from 'react-router';
import { ROUTES } from '@/routes';
import { AuthService } from '@/services/auth.service';
import { STARTER, TOOL_COUNT } from './catalog';
import { GuideService } from './guide.service';
import { RecallStage } from './RecallStage';
import './landing.css';

const TERMINAL_HTML = `<span class="c"># 1. 起服务</span>
<span class="p">$</span> pnpm install && pnpm dev
<span class="c">#  web → http://127.0.0.1:5178   api → http://127.0.0.1:8787</span>

<span class="c"># 2. 构建 MCP 入口</span>
<span class="p">$</span> pnpm --filter @agent-recall/mcp build

<span class="c"># 3. 贴进 agent 的 MCP 配置</span>
{
  <span class="k">"mcpServers"</span>: {
    <span class="k">"agent-recall"</span>: {
      <span class="k">"command"</span>: <span class="s">"node"</span>,
      <span class="k">"args"</span>: [<span class="s">".../apps/mcp/dist/index.js"</span>],
      <span class="k">"env"</span>: {
        <span class="k">"AGENT_RECALL_URL"</span>: <span class="s">"http://127.0.0.1:8787"</span>,
        <span class="k">"AGENT_RECALL_TOKEN"</span>: <span class="s">"arm_..."</span>
      }
    }
  }
}

<span class="p">$</span> <span class="cursor"></span>`;

const GuidePage = observer(function GuidePage() {
  const auth = useService(AuthService);
  const guide = useService(GuideService);
  const filtering = guide.query.trim().length > 0;

  const entry =
    auth.ready && auth.user ? (
      <Link className="lbtn primary small" to={ROUTES.memories}>
        进入控制台
      </Link>
    ) : (
      <Link className="lbtn primary small" to={ROUTES.login}>
        登录
      </Link>
    );

  return (
    <div className="landing">
      <div className="landing-glow" aria-hidden="true" />
      <div className="landing-grid" aria-hidden="true" />

      <nav className="landing-nav">
        <div className="landing-nav-inner">
          <a className="landing-brand" href="#top">
            <span className="lb-mark">
              召<em>回</em>
            </span>
            <span className="lb-sub">AGENT RECALL</span>
          </a>
          <div className="landing-links">
            <a href="#surfaces">做什么</a>
            <a href="#retrieval">怎么检索</a>
            <a href="#start">怎么用</a>
            <a href="#tools">工具</a>
            {entry}
          </div>
        </div>
      </nav>

      <div className="landing-wrap" id="top">
        {/* ============ Hero ============ */}
        <header className="hero">
          <div>
            <span className="hero-kicker rise" style={{ animationDelay: '.05s' }}>
              <span className="dot" />
              自托管 · 记忆在远端 Postgres
            </span>
            <h1 className="rise" style={{ animationDelay: '.15s' }}>
              <span className="zh">下次开会话，</span>
              <span className="zh">
                它<span className="recalled">还记得</span>。
              </span>
            </h1>
            <p className="hero-lede rise" style={{ animationDelay: '.25s' }}>
              给 Claude Code、Codex、OpenCode、pi 的长期记忆服务。上次的<strong>架构决定</strong>、踩过的<strong>坑</strong>、你说过要记住的
              <strong>偏好</strong>——新会话开始时，自动回到它的上下文里。
            </p>
            <div className="hero-ctas rise" style={{ animationDelay: '.35s' }}>
              <a className="lbtn primary" href="#start">
                接上我的 agent
              </a>
              <a className="lbtn ghost" href="#surfaces">
                看看它做什么
              </a>
            </div>
            <div className="hero-meta rise" style={{ animationDelay: '.45s' }}>
              <div className="m">
                <b>{TOOL_COUNT}</b>MCP 工具
              </div>
              <div className="m">
                <b>4</b>种 agent 宿主
              </div>
              <div className="m">
                <b>2s</b>注入超时预算
              </div>
              <div className="m">
                <b>2 路</b>召回，RRF 融合
              </div>
            </div>
          </div>
          <RecallStage />
        </header>

        {/* ============ 三个面 ============ */}
        <section id="surfaces" className="lsec">
          <div className="sec-head">
            <span className="sec-index">/ 做什么</span>
            <h2>
              一台你自己跑的记忆服务，
              <br />
              三个面各管一件事。
            </h2>
            <p>
              Agent 通过插件自动写入和注入，通过 MCP 主动存取，人通过网页查看和整理。数据库走远端
              Postgres。Meilisearch 和 Qdrant 按需再配。
            </p>
          </div>
          <div className="lanes">
            <div className="lane">
              <div className="glyph">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
                  <circle cx="12" cy="12" r="3.2" />
                </svg>
              </div>
              <h3>自动记下</h3>
              <p>
                插件接在会话上：开场注入相关记忆，每条提问前再补一段，工具调用后记一笔观察，会话结束生成摘要。请求超过 2
                秒就放弃，失败事件落在本地 spool 之后补投。
              </p>
              <div className="carrier">
                载体 · <b>plugins/ 四种宿主插件</b>
              </div>
            </div>
            <div className="lane">
              <div className="glyph">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 17l6-5-6-5M12 19h8" />
                </svg>
              </div>
              <h3>主动存取</h3>
              <p>
                stdio MCP 服务把记忆库暴露成 {TOOL_COUNT} 个 memory_* 工具。Agent
                用它们保存事实、按问题召回、改出新版本、忘掉、整理。MCP 进程只转发 HTTP，存储和检索都在服务器上。
              </p>
              <div className="carrier">
                载体 · <b>@agent-recall/mcp</b>
              </div>
            </div>
            <div className="lane">
              <div className="glyph">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="14" rx="2" />
                  <path d="M8 21h8M12 18v3" />
                </svg>
              </div>
              <h3>人来看</h3>
              <p>
                登录之后是控制台：记忆的筛选、搜索、编辑和版本对比，会话时间线，访问令牌，MCP
                客户端配置，以及精排和自动遗忘。令牌和客户端配置只在网页里签发。
              </p>
              <div className="carrier">
                载体 · <b>这个网页</b>
              </div>
            </div>
          </div>
        </section>

        {/* ============ 检索 ============ */}
        <section id="retrieval" className="lsec">
          <div className="sec-head">
            <span className="sec-index">/ 检索</span>
            <h2>
              一次召回，两路并行，
              <br />
              融合之后再精排。
            </h2>
            <p>
              写入前会做隐私清洗——API key、Bearer token、PEM 和写在 &lt;private&gt;
              里的内容都不会进库。编辑不覆盖旧文本，而是挂上新版本，检索只认最新版。
            </p>
          </div>
          <div className="pipeline-panel">
            <div className="pipeline">
              <div className="p-node amber src-full">
                <h4>全文检索</h4>
                <div className="sub">Meilisearch</div>
                <p>词法一路，精确的词和短语不会漏。</p>
              </div>
              <div className="p-node amber src-vec">
                <h4>向量检索</h4>
                <div className="sub">Qdrant · DashScope embedding</div>
                <p>语义一路，换个说法也能找到。</p>
              </div>
              <svg className="merge-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                <path d="M0 25 C 55 25, 45 50, 100 50" fill="none" stroke="#7C6CFF" strokeOpacity=".55" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
                <path d="M0 75 C 55 75, 45 50, 100 50" fill="none" stroke="#7C6CFF" strokeOpacity=".55" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
              </svg>
              <div className="p-node violet p-rrf">
                <h4>RRF 融合</h4>
                <div className="sub">Reciprocal Rank Fusion</div>
                <p>两路名次互相校准，谁排得前谁说了算。</p>
              </div>
              <div className="p-link" />
              <div className="p-node violet p-mid">
                <h4>精排</h4>
                <div className="sub">可选 · 失败退回融合结果</div>
                <p>设置里打开，候选更多，给出精排分数。</p>
              </div>
              <div className="p-link" />
              <div className="p-node end p-final">
                <h4>上下文注入</h4>
                <div className="sub">POST /api/hooks/context</div>
                <p>按 2000 token 预算裁好，直接进提示词。</p>
              </div>
            </div>
            <div className="pipeline-note">
              <div className="n">
                <b>缺一路也能跑。</b>不配 Meilisearch 或 Qdrant 时，缺的那一路自动跳过，关系库里的检索继续可用。
              </div>
              <div className="n">
                <b>去重</b>在同一内容短时间窗口内生效，近重复返回已有记录。注入只用来源为 web、agent、summary、import
                的记忆。
              </div>
              <div className="n">
                <b>embedding 服务可换。</b>向量召回和精排会把文本发给配置的服务（默认 DashScope），换成自建地址就完全不出网。
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* ============ 数字带 ============ */}
      <div className="stats-band">
        <div className="stats">
          <div className="stat">
            <div className="num">{TOOL_COUNT}</div>
            <div className="lbl">个 MCP 工具，写入 / 召回 / 浏览 / 整理</div>
          </div>
          <div className="stat">
            <div className="num">4</div>
            <div className="lbl">种宿主插件：Claude Code、Codex、OpenCode、pi</div>
          </div>
          <div className="stat">
            <div className="num">
              <em>2000</em>
            </div>
            <div className="lbl">token 默认注入预算，裁好再进上下文</div>
          </div>
          <div className="stat">
            <div className="num">
              <em>自托管</em>
            </div>
            <div className="lbl">跑在你自己的机器上；embedding 可换自建，不配不出网</div>
          </div>
        </div>
      </div>

      <div className="landing-wrap">
        {/* ============ 怎么用 ============ */}
        <section id="start" className="lsec">
          <div className="quickstart">
            <div>
              <div className="sec-head" style={{ marginBottom: 24 }}>
                <span className="sec-index">/ 怎么用</span>
                <h2>
                  四条命令，
                  <br />
                  让它开始记。
                </h2>
                <p>需要 Node.js 22 和 pnpm 10。令牌只在网页里签发，只显示一次。</p>
              </div>
              <ol className="steps">
                <li>
                  <div>
                    <h4>启动服务和网页</h4>
                    <p>
                      仓库根目录 <code>pnpm install && pnpm dev</code>，网页在 5178，接口在 8787。
                    </p>
                  </div>
                </li>
                <li>
                  <div>
                    <h4>注册，签发一把令牌</h4>
                    <p>
                      登录后进「MCP 客户端」注册客户端，拿到可粘贴的配置和一把 <code>arm_</code> 令牌。
                    </p>
                  </div>
                </li>
                <li>
                  <div>
                    <h4>构建 MCP 入口，交给 agent</h4>
                    <p>
                      <code>pnpm --filter @agent-recall/mcp build</code>，把右边的配置贴进 agent。
                    </p>
                  </div>
                </li>
                <li>
                  <div>
                    <h4>让它存，再让它找</h4>
                    <p>说「记住我们用远端 Postgres 做默认数据库」。下一场会话，它会自己想起来。</p>
                  </div>
                </li>
              </ol>
            </div>
            <div className="terminal">
              <div className="term-head">
                <span className="lights">
                  <i />
                  <i />
                  <i />
                </span>
                <span>~/agent-recall — zsh</span>
              </div>
              {/* 静态展示内容，非用户输入 */}
              <pre dangerouslySetInnerHTML={{ __html: TERMINAL_HTML }} />
            </div>
          </div>
        </section>

        {/* ============ 工具 ============ */}
        <section id="tools" className="lsec">
          <div className="sec-head">
            <span className="sec-index">/ 工具</span>
            <h2>
              {TOOL_COUNT} 个工具，
              <br />
              日常只用这一小把。
            </h2>
            <p>全部由 MCP 暴露。写入与遗忘、召回、浏览、整理，按场景分组，下面可以按名字和用途筛选。</p>
          </div>
          <div className="tools-panel">
            <div className="tools-search">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.3-4.3" />
              </svg>
              <input
                type="search"
                aria-label="筛选工具"
                placeholder="按名字或用途筛选，例如 recall"
                value={guide.query}
                onChange={(event) => guide.setQuery(event.target.value)}
              />
              <span className="count">{filtering ? `${guide.matchCount} 个匹配` : `${TOOL_COUNT} 个工具`}</span>
            </div>
            {filtering
              ? null
              : STARTER.map((tool) => (
                  <div className="tool-row" key={tool.name}>
                    <code>{tool.name}</code>
                    <p>{tool.summary}</p>
                    <span className="tag">常用</span>
                  </div>
                ))}
            {guide.groups.length === 0 ? (
              <p className="tools-empty">没有符合这个条件的工具。换一个词，或清空筛选。</p>
            ) : (
              <div className="tools-groups">
                {guide.groups.map((group) => (
                  <section key={group.id} aria-labelledby={`landing-group-${group.id}`}>
                    <div className="tools-group-head">
                      <h3 id={`landing-group-${group.id}`}>{group.title}</h3>
                      <p>{group.intro}</p>
                    </div>
                    {group.tools.map((tool) => (
                      <div className="tool-row" key={tool.name}>
                        <code>{tool.name}</code>
                        <p>{tool.summary}</p>
                        <span className="tag">{group.title}</span>
                      </div>
                    ))}
                  </section>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* ============ 收尾 CTA ============ */}
        <section className="lsec" style={{ paddingBottom: 0 }}>
          <div className="cta-final">
            <div>
              <h2>
                让下一场会话，
                <br />
                从「记得」开始。
              </h2>
              <p>打开控制台注册账号，签发第一把令牌，把记忆接进你的 agent。</p>
            </div>
            <div className="ctas">
              {auth.ready && auth.user ? (
                <Link className="lbtn primary" to={ROUTES.memories}>
                  进入控制台
                </Link>
              ) : (
                <Link className="lbtn primary" to={ROUTES.login}>
                  进入控制台
                </Link>
              )}
              <a className="lbtn ghost" href="#start">
                先看怎么接
              </a>
            </div>
          </div>
        </section>
      </div>

      <footer className="landing-foot">
        <div className="landing-foot-inner">
          <a className="landing-brand" href="#top">
            <span className="lb-mark" style={{ fontSize: 16 }}>
              召<em>回</em>
            </span>
          </a>
          <a href="#surfaces">做什么</a>
          <a href="#start">怎么用</a>
          <a href="#tools">工具</a>
          <span className="right">agent-recall · self-hosted</span>
        </div>
      </footer>
    </div>
  );
});

export default bindServices(GuidePage, [GuideService]);
