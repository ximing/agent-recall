import { observer, useService } from '@rabjs/react';
import { StateService } from '../state.service';
import { DeleteRow, EntryList, pretty } from './kv';

export const RoutinesPanel = observer(function RoutinesPanel() {
  const service = useService(StateService);
  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>例程</h2>
          <p className="sub">一段可重复执行的步骤定义，写在 KV 里，代理按名运行。</p>
        </div>
      </div>
      <div className="create-form">
        <div className="row">
          <input
            className="field"
            placeholder="例程名"
            value={service.routineName}
            onChange={(event) => service.assign({ routineName: event.target.value })}
          />
          <span className="row-actions-inline">
            <button type="button" className="btn primary" onClick={() => void service.saveRoutine()}>
              写入
            </button>
          </span>
        </div>
        <textarea
          className="field json-field"
          placeholder='JSON，例如 {"steps":["build","test"]}'
          value={service.routineJson}
          onChange={(event) => service.assign({ routineJson: event.target.value })}
        />
      </div>
      {service.routineOutput ? (
        <div style={{ padding: '12px 18px 0' }}>
          <pre className="context-pre">{service.routineOutput}</pre>
        </div>
      ) : null}
      <EntryList
        empty="还没有例程。"
        render={(entry) => (
          <>
            <span className="kv-key">{entry.key}</span>
            <pre className="kv-val">{pretty(entry.value)}</pre>
            <span className="row-actions">
              <button type="button" className="btn" onClick={() => void service.runRoutine(entry.key)}>
                运行
              </button>
              <DeleteRow entry={entry} />
            </span>
          </>
        )}
      />
    </div>
  );
});
