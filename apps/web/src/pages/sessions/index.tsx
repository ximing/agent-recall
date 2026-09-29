import { bindServices, observer, useService } from '@rabjs/react';
import { useEffect, useState } from 'react';
import { MarkdownView } from '@/components/MarkdownView';
import { formatTime } from '@/utils/format';
import { ORIGIN_LABEL, TYPE_LABEL } from '@/utils/labels';
import { SessionsService } from './sessions.service';
import './sessions.css';

const SessionsPage = observer(function SessionsPage() {
  const service = useService(SessionsService);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    void service.load();
  }, [service]);

  const keyword = filter.trim().toLowerCase();
  const visible = keyword
    ? service.sessions.filter(
        (session) =>
          session.sessionId.toLowerCase().includes(keyword) ||
          session.projects.some((project) => project.toLowerCase().includes(keyword)),
      )
    : service.sessions;

  const active = service.sessions.find((session) => session.sessionId === service.activeId) ?? null;
  const hookCount = service.activeMemories.filter((memory) => memory.origin === 'hook').length;
  const summaryCount = service.activeMemories.filter((memory) => memory.origin === 'summary').length;

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1>会话</h1>
          <p className="desc">按会话回看钩子与代理写下的记忆时间线，钩子碎片与摘要样式不同。</p>
        </div>
      </header>

      {service.error ? (
        <p className="form-error" role="alert">
          {service.error}
        </p>
      ) : null}

      {service.sessions.length === 0 && !service.loading ? (
        <div className="empty">
          <p className="empty-title">还没有会话</p>
          <p>接入钩子或 MCP 后，代理工作过程中产生的记忆会按会话归组到这里。</p>
        </div>
      ) : (
        <div className="md-split">
          <div className="sess-list">
            <div className="sess-list-head">
              <input
                placeholder="按会话 ID 或项目筛选…"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
            </div>
            <div className="sess-scroll">
              {visible.length === 0 ? (
                <p className="composer-hint" style={{ padding: '14px' }}>
                  没有匹配的会话。
                </p>
              ) : (
                visible.map((session) => (
                  <button
                    key={session.sessionId}
                    type="button"
                    className={`sess-item${service.activeId === session.sessionId ? ' active' : ''}`}
                    onClick={() => void service.select(session.sessionId)}
                  >
                    <span className="sid">{session.sessionId}</span>
                    <span className="meta">
                      <span className="mcard-tag web">{session.memoryCount} 条</span>
                      <span>{formatTime(session.lastAt)}</span>
                      {session.projects.slice(0, 2).map((project) => (
                        <span key={project} className="proj">
                          {project}
                        </span>
                      ))}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="sess-detail">
            {!active ? (
              <div className="empty">
                <p className="empty-title">选择一个会话</p>
                <p>从左侧列表挑一个会话，右侧会展开它的完整记忆时间线。</p>
              </div>
            ) : (
              <>
                <div className="sess-detail-head">
                  <div>
                    <span className="sid">{active.sessionId}</span>
                    <div className="meta">
                      {active.projects.map((project) => (
                        <span key={project} className="mini-tag">
                          {project}
                        </span>
                      ))}
                      <span className="composer-hint">
                        {formatTime(active.firstAt)} ~ {formatTime(active.lastAt)}
                      </span>
                      {!service.detailLoading ? (
                        <span className="composer-hint">
                          {service.activeMemories.length} 条记忆 · {hookCount} 钩子观察 · {summaryCount} 摘要
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="head-actions">
                    <button
                      type="button"
                      className="btn"
                      title="把本会话的钩子观察收成一条摘要。同一小时内重复结晶不会再写一条。"
                      disabled={service.crystallizing}
                      onClick={() => void service.crystallize(active.sessionId)}
                    >
                      {service.crystallizing ? '结晶中…' : '结晶为摘要'}
                    </button>
                  </div>
                </div>
                {service.crystalMessage ? (
                  <p className="settings-saved" style={{ marginBottom: 14 }}>
                    {service.crystalMessage}
                  </p>
                ) : null}

                {service.detailLoading ? (
                  <p className="composer-hint">时间线加载中…</p>
                ) : (
                  <>
                    {service.activeMemories.length === 0 ? (
                      <p className="composer-hint">这个会话没有记忆。</p>
                    ) : (
                      <div className="tl">
                        {service.activeMemories.map((memory) => (
                          <div key={memory.id} className={`tl-item origin-${memory.origin}`}>
                            <div className="tl-head">
                              <span className="mrow-time">{formatTime(memory.createdAt)}</span>
                              <span className={`mcard-tag ${memory.origin}`}>{ORIGIN_LABEL[memory.origin]}</span>
                              <span className="mcard-tag type">{TYPE_LABEL[memory.type]}</span>
                              {memory.tags.map((tag) => (
                                <span key={tag} className="mini-tag">
                                  #{tag}
                                </span>
                              ))}
                            </div>
                            <MarkdownView content={memory.content} />
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
});

export default bindServices(SessionsPage, [SessionsService]);
