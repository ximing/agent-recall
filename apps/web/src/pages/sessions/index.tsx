import { bindServices, observer, useService } from '@rabjs/react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect } from 'react';
import { MarkdownView } from '@/components/MarkdownView';
import { formatTime } from '@/utils/format';
import { ORIGIN_LABEL, TYPE_LABEL } from '@/utils/labels';
import { SessionsService } from './sessions.service';

const SessionsPage = observer(function SessionsPage() {
  const service = useService(SessionsService);

  useEffect(() => {
    void service.load();
  }, [service]);

  return (
    <section className="page">
      <header className="page-head">
        <h1>会话</h1>
        <p className="desc">按会话回看钩子与代理写下的记忆时间线，钩子碎片与摘要样式不同。</p>
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
        <div className="mlist">
          {service.sessions.map((session) => {
            const open = service.activeId === session.sessionId;
            return (
              <article key={session.sessionId} className={`srow${open ? ' open' : ''}`}>
                <header className="srow-head" onClick={() => void service.toggle(session.sessionId)}>
                  {open ? (
                    <ChevronDown size={14} strokeWidth={1.8} />
                  ) : (
                    <ChevronRight size={14} strokeWidth={1.8} />
                  )}
                  <span className="mono sid">{session.sessionId}</span>
                  <span className="mcard-tag web">{session.memoryCount} 条</span>
                  <span className="mrow-time">
                    {formatTime(session.firstAt)} ~ {formatTime(session.lastAt)}
                  </span>
                  <span className="srow-projects">
                    {session.projects.map((project) => (
                      <span key={project} className="mini-tag">
                        {project}
                      </span>
                    ))}
                  </span>
                </header>
                {open ? (
                  <div className="srow-body">
                    {service.detailLoading ? (
                      <p className="composer-hint">时间线加载中…</p>
                    ) : service.activeMemories.length === 0 ? (
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
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
});

export default bindServices(SessionsPage, [SessionsService]);
