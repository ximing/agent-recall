import { observer, useService } from '@rabjs/react';
import { StateService } from '../state.service';
import { DeleteRow, EntryList, recordOf } from './kv';

export const ActionsPanel = observer(function ActionsPanel() {
  const service = useService(StateService);
  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>行动</h2>
          <p className="sub">代理和你都能往这里写待办；状态只有进行中、完成、受阻三种。</p>
        </div>
      </div>
      <form
        className="create-line"
        onSubmit={(event) => {
          event.preventDefault();
          void service.createAction();
        }}
      >
        <input
          className="field"
          placeholder="行动标题"
          value={service.actionTitle}
          onChange={(event) => service.assign({ actionTitle: event.target.value })}
        />
        <input
          className="field"
          placeholder="补充说明，可空"
          value={service.actionDetail}
          onChange={(event) => service.assign({ actionDetail: event.target.value })}
        />
        <button type="submit" className="btn primary">
          新建行动
        </button>
      </form>
      <EntryList
        empty="还没有行动。"
        rowClass="task-row"
        render={(entry) => {
          const value = recordOf(entry.value);
          const status = value.status === 'done' || value.status === 'blocked' ? value.status : 'open';
          return (
            <>
              <div className="grow">
                <p className="title" style={status === 'done' ? { color: 'var(--ink-3)', textDecoration: 'line-through' } : undefined}>
                  {String(value.title ?? entry.key)}
                </p>
                {value.detail ? <p className="detail">{String(value.detail)}</p> : null}
              </div>
              <select
                className={`status-pill s-${status}`}
                value={status}
                aria-label="行动状态"
                onChange={(event) => void service.setActionStatus(entry, event.target.value as 'open' | 'done' | 'blocked')}
              >
                <option value="open">进行中</option>
                <option value="done">完成</option>
                <option value="blocked">受阻</option>
              </select>
              <DeleteRow entry={entry} />
            </>
          );
        }}
      />
    </div>
  );
});
