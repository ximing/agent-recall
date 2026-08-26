import { observer, useService } from '@rabjs/react';
import { StateService } from '../state.service';
import { DeleteRow, EntryList, recordOf } from './kv';

export const SentinelsPanel = observer(function SentinelsPanel() {
  const service = useService(StateService);
  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>哨兵</h2>
          <p className="sub">盯住一个条件的观察者；手动触发会记下一次 fire，可带备注。</p>
        </div>
      </div>
      <form
        className="create-line"
        onSubmit={(event) => {
          event.preventDefault();
          void service.createSentinel();
        }}
      >
        <input
          className="field"
          placeholder="哨兵名"
          value={service.sentinelName}
          onChange={(event) => service.assign({ sentinelName: event.target.value })}
        />
        <input
          className="field"
          placeholder="条件"
          value={service.sentinelCondition}
          onChange={(event) => service.assign({ sentinelCondition: event.target.value })}
        />
        <button type="submit" className="btn primary">
          创建
        </button>
      </form>
      <div className="create-line" style={{ marginTop: 0, borderTop: 'none' }}>
        <input
          className="field"
          placeholder="触发时的备注，可空"
          value={service.sentinelNote}
          onChange={(event) => service.assign({ sentinelNote: event.target.value })}
        />
      </div>
      <EntryList
        empty="还没有哨兵。"
        rowClass="task-row"
        render={(entry) => {
          const value = recordOf(entry.value);
          const fires = Array.isArray(value.fires) ? value.fires.length : 0;
          return (
            <>
              <div className="grow">
                <p className="title mono" style={{ fontSize: 13 }}>{entry.key}</p>
                <p className="detail">
                  {String(value.condition ?? '')} · 已触发 {fires} 次
                </p>
              </div>
              <button type="button" className="btn" onClick={() => void service.triggerSentinel(entry)}>
                触发
              </button>
              <DeleteRow entry={entry} />
            </>
          );
        }}
      />
    </div>
  );
});
