import { MEMORY_TYPES, type Origin } from '@agent-recall/dto';
import { bindServices, observer, useService } from '@rabjs/react';
import { useEffect } from 'react';
import { Link } from 'react-router';
import { MarkdownView } from '@/components/MarkdownView';
import { ROUTES } from '@/routes';
import { formatTime } from '@/utils/format';
import { ORIGIN_LABEL, TYPE_LABEL } from '@/utils/labels';
import { BoardService } from './board.service';
import {
  formatCount,
  mixRows,
  originLabel,
  rollupProjects,
  summarizeActions,
  summarizeRecall,
  typeLabel,
} from './summarize';
import './board.css';

const ORIGINS: Origin[] = ['web', 'agent', 'hook', 'import', 'summary'];

function Hint({ loading }: { loading: boolean }) {
  return <p className="board-hint">{loading ? '加载中…' : '这次没读到。'}</p>;
}

function Figure({
  to,
  value,
  label,
  tone,
}: {
  to: string;
  value: number | null;
  label: string;
  tone?: 'warn' | 'live';
}) {
  const hot = tone !== undefined && value !== null && value > 0;
  return (
    <Link to={to} className={hot ? `figure ${tone}` : 'figure'}>
      <span className="num">{value === null ? '—' : formatCount(value)}</span>
      <span className="lbl">{label}</span>
    </Link>
  );
}

const BoardPage = observer(function BoardPage() {
  const service = useService(BoardService);

  useEffect(() => {
    void service.load();
  }, [service]);

  const actions = service.actions ? summarizeActions(service.actions) : null;
  const recall = service.logs ? summarizeRecall(service.logs) : null;
  const projects = service.sessions ? rollupProjects(service.sessions) : [];
  const typeRows = service.stats
    ? mixRows(service.stats.byType, MEMORY_TYPES, (key) => typeLabel(key, TYPE_LABEL))
    : null;
  const originRows = service.stats
    ? mixRows(service.stats.byOrigin, ORIGINS, (key) => originLabel(key, ORIGIN_LABEL))
    : null;
  const pending = actions ? actions.open + actions.blocked : null;

  return (
    <section className="page" aria-busy={service.loading}>
      <header className="page-head">
        <div>
          <h1>看板</h1>
          <p className="desc">记忆有多少、哪些要接着做、最近的会话和召回。</p>
        </div>
        <div className="head-actions">
          <button type="button" className="btn" disabled={service.loading} onClick={() => void service.load()}>
            {service.loading ? '刷新中' : '刷新'}
          </button>
        </div>
      </header>

      {service.error ? (
        <p className="form-error" role="alert">
          {service.error}
        </p>
      ) : null}

      <nav className="board-figures" aria-label="库况">
        <Figure to={ROUTES.memories} value={service.stats?.total ?? null} label="记忆" />
        <Figure to={ROUTES.memories} value={service.stats?.createdLast7d ?? null} label="近 7 天" />
        <Figure to={ROUTES.sessions} value={service.stats?.sessions ?? null} label="会话" />
        <Figure to={ROUTES.state} value={pending} label="要处理" tone="live" />
        <Figure to={ROUTES.ops} value={service.stats?.pendingIndex ?? null} label="待索引" tone="warn" />
        <Figure to={ROUTES.ops} value={service.stats?.expired ?? null} label="已过期" tone="warn" />
      </nav>

      <div className="board-grid">
        <section className="panel board-panel">
          <div className="panel-head">
            <div>
              <h2>按类型</h2>
              <p className="sub">最新版各类型的条数。</p>
            </div>
          </div>
          {typeRows === null ? (
            <Hint loading={service.loading} />
          ) : (
            <div className="mix">
              {typeRows.map((row) => (
                <div key={row.key} className="mix-row">
                  <span className="mix-label">{row.label}</span>
                  <span className="mix-track" aria-hidden="true">
                    <span className="mix-fill" style={{ width: `${row.width}%` }} />
                  </span>
                  <span className="mix-count">{formatCount(row.count)}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel board-panel">
          <div className="panel-head">
            <div>
              <h2>按来源</h2>
              <p className="sub">最新版各来源的条数。颜色和记忆列表里的来源标一致。</p>
            </div>
          </div>
          {originRows === null ? (
            <Hint loading={service.loading} />
          ) : (
            <div className="mix">
              {originRows.map((row) => (
                <div key={row.key} className="mix-row">
                  <span className="mix-label">{row.label}</span>
                  <span className="mix-track" aria-hidden="true">
                    <span
                      className={ORIGINS.includes(row.key as Origin) ? `mix-fill ${row.key}` : 'mix-fill'}
                      style={{ width: `${row.width}%` }}
                    />
                  </span>
                  <span className="mix-count">{formatCount(row.count)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="board-grid">
        <section className="panel board-panel">
          <div className="panel-head">
            <div>
              <h2>要接着做</h2>
              <p className="sub">进行中和受阻的行动。还没接受的分享也放在这里。</p>
            </div>
            <Link to={ROUTES.state} className="board-more">
              去状态
            </Link>
          </div>
          {actions === null ? (
            <Hint loading={service.loading} />
          ) : actions.shown.length === 0 ? (
            <p className="board-hint">没有进行中或受阻的行动。</p>
          ) : (
            <ul className="board-list">
              {actions.shown.map((item) => (
                <li key={item.key}>
                  <span className={item.status === 'blocked' ? 'mini-tag danger' : 'mini-tag live'}>
                    {item.status === 'blocked' ? '受阻' : '进行中'}
                  </span>
                  <span className="grow">
                    <strong>{item.title}</strong>
                    {item.detail ? <span className="detail"> {item.detail}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {actions && actions.rest > 0 ? <p className="board-hint">还有 {formatCount(actions.rest)} 条在状态里。</p> : null}
          {actions && actions.done > 0 ? (
            <p className="board-hint">另有 {formatCount(actions.done)} 条已完成。</p>
          ) : null}
          {service.invites && service.invites.length > 0 ? (
            <p className="board-note">
              <span>{formatCount(service.invites.length)} 条分享还没接受。</span>
              <Link to={ROUTES.ops}>去处理</Link>
            </p>
          ) : null}
        </section>

        <section className="panel board-panel">
          <div className="panel-head">
            <div>
              <h2>库况</h2>
              <p className="sub">过期、索引、检索和精排。修复在治理页。</p>
            </div>
            <Link to={ROUTES.ops} className="board-more">
              去治理
            </Link>
          </div>
          {service.diagnose === null ? (
            <Hint loading={service.loading} />
          ) : service.diagnose.ok ? (
            <p className="health-line ok">没有需要处理的问题。</p>
          ) : (
            <ul className="health-list">
              {service.diagnose.problems.map((problem) => (
                <li key={problem.code} className="health-line">
                  <span>{problem.message}</span>
                  {problem.code === 'RERANK_NO_KEY' ? <Link to={ROUTES.settings}>去设置</Link> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="board-grid">
        <section className="panel board-panel">
          <div className="panel-head">
            <div>
              <h2>最近会话</h2>
              <p className="sub">按最后写入时间，最多五场。</p>
            </div>
            <Link to={ROUTES.sessions} className="board-more">
              全部
            </Link>
          </div>
          {service.sessions === null ? (
            <Hint loading={service.loading} />
          ) : service.sessions.length === 0 ? (
            <p className="board-hint">还没有会话。</p>
          ) : (
            <ul className="board-list">
              {service.sessions.slice(0, 5).map((session) => (
                <li key={session.sessionId}>
                  <span className="grow">
                    <span className="sid" title={session.sessionId}>
                      {session.sessionId}
                    </span>
                    {session.projects.length > 0 ? <span className="proj">{session.projects.join('、')}</span> : null}
                  </span>
                  <span className="tail">
                    {formatCount(session.memoryCount)} 条 · {formatTime(session.lastAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel board-panel">
          <div className="panel-head">
            <div>
              <h2>最近召回</h2>
              <p className="sub">最多 50 条，保留 30 天。比例和平均延迟与设置里的召回历史相同。</p>
            </div>
            <Link to={`${ROUTES.settings}#history`} className="board-more">
              历史
            </Link>
          </div>
          {recall === null ? (
            <Hint loading={service.loading} />
          ) : recall.total === 0 ? (
            <p className="board-hint">还没有召回记录。在记忆页搜索一次，或让代理发起召回。</p>
          ) : (
            <>
              <p className="recall-sum">
                <span>
                  <b>{formatCount(recall.total)}</b>次
                </span>
                <span>
                  <b>{recall.rerankRate}%</b>走了精排
                </span>
                <span>
                  <b>{formatCount(recall.avgLatency)}</b>毫秒
                </span>
                <span className={recall.rerankFailed > 0 ? 'bad' : ''}>
                  <b>{formatCount(recall.rerankFailed)}</b>次精排失败
                </span>
              </p>
              <ul className="board-list">
                {recall.recent.map((item) => (
                  <li key={item.id}>
                    <span className="grow">
                      <span className="query" title={item.query}>
                        {item.query}
                      </span>
                    </span>
                    <span className="tail">
                      {item.rerankFailed ? '精排失败 · ' : ''}
                      {formatCount(item.resultCount)} 条 · {formatCount(item.latencyMs)} 毫秒
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>

      <div className="board-grid">
        <section className="panel board-panel span-2">
          <div className="panel-head">
            <div>
              <h2>最近五条记忆</h2>
            </div>
            <Link to={ROUTES.memories} className="board-more">
              全部
            </Link>
          </div>
          {service.memories === null ? (
            <Hint loading={service.loading} />
          ) : service.memories.length === 0 ? (
            <p className="board-hint">记忆库是空的。</p>
          ) : (
            service.memories.map((memory) => (
              <article key={memory.id} className="memory-row">
                <div className="meta">
                  <span className={`mcard-tag ${memory.origin}`}>{ORIGIN_LABEL[memory.origin]}</span>
                  <span className="mcard-tag type">{TYPE_LABEL[memory.type]}</span>
                  {memory.project ? <span className="mini-tag">{memory.project}</span> : null}
                  <span className="when">{formatTime(memory.createdAt)}</span>
                </div>
                <MarkdownView content={memory.content} clamp />
              </article>
            ))
          )}
        </section>

        {projects.length > 0 ? (
          <section className="panel board-panel span-2">
            <div className="panel-head">
              <div>
                <h2>最近会话里的项目</h2>
                <p className="sub">按会话计。一场会话带多个项目时，每个项目各计一场，不是记忆条数。</p>
              </div>
            </div>
            <div className="project-line">
              {projects.map((project) => (
                <span key={project.name} className="mini-tag" title={formatTime(project.lastAt)}>
                  {project.name} · {formatCount(project.sessions)} 场
                </span>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </section>
  );
});

export default bindServices(BoardPage, [BoardService]);
