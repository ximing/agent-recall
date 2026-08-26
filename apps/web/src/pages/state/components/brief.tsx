import { observer, useService } from '@rabjs/react';
import { MarkdownView } from '@/components/MarkdownView';
import { formatTime } from '@/utils/format';
import { StateService } from '../state.service';
import { recordOf } from './kv';

export const Brief = observer(function Brief() {
  const service = useService(StateService);
  return (
    <div className="panel">
      <div className="brief-section">
        <h3>未完成的行动</h3>
        {service.openActions.length === 0 ? (
          <p className="composer-hint">没有状态为 open 的行动。</p>
        ) : (
          <ul className="brief-list">
            {service.openActions.map((entry) => {
              const value = recordOf(entry.value);
              return (
                <li key={entry.key}>
                  <span className="dot" />
                  <span>
                    <strong>{String(value.title ?? entry.key)}</strong>
                    {value.detail ? <span className="composer-hint"> {String(value.detail)}</span> : null}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="brief-section">
        <h3>最近的会话</h3>
        {service.latestSession ? (
          <ul className="brief-list">
            <li>
              <span className="dot" />
              <span className="mono" style={{ fontSize: 13 }}>
                {service.latestSession.sessionId}
              </span>
              <span className="tail">
                {service.latestSession.memoryCount} 条 · {formatTime(service.latestSession.lastAt)}
              </span>
            </li>
          </ul>
        ) : (
          <p className="composer-hint">还没有会话。</p>
        )}
      </div>
      <div className="brief-section">
        <h3>最近五条记忆</h3>
        {service.recentMemories.length === 0 ? (
          <p className="composer-hint">记忆库是空的。</p>
        ) : (
          service.recentMemories.map((memory) => <MarkdownView key={memory.id} content={memory.content} clamp />)
        )}
      </div>
    </div>
  );
});
