import { observer, useService } from '@rabjs/react';
import { StateService } from '../state.service';
import { DeleteRow, EntryList, pretty } from './kv';

export const SignalsPanel = observer(function SignalsPanel() {
  const service = useService(StateService);
  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>信号</h2>
          <p className="sub">一次性的通知载体：同名信号的数据会按时间追加，适合抛「某件事发生了」。</p>
        </div>
      </div>
      <form
        className="create-line"
        onSubmit={(event) => {
          event.preventDefault();
          void service.sendSignal();
        }}
      >
        <input
          className="field"
          placeholder="信号名"
          value={service.signalName}
          onChange={(event) => service.assign({ signalName: event.target.value })}
        />
        <input
          className="field"
          placeholder="这次携带的数据"
          value={service.signalData}
          onChange={(event) => service.assign({ signalData: event.target.value })}
        />
        <button type="submit" className="btn primary">
          追加
        </button>
      </form>
      <EntryList
        empty="还没有信号。"
        render={(entry) => (
          <>
            <span className="kv-key">{entry.key}</span>
            <pre className="kv-val">{pretty(entry.value)}</pre>
            <span className="row-actions">
              <DeleteRow entry={entry} />
            </span>
          </>
        )}
      />
    </div>
  );
});
