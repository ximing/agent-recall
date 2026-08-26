import { observer, useService } from '@rabjs/react';
import { StateService } from '../state.service';
import { DeleteRow, EntryList, pretty } from './kv';

export const CheckpointsPanel = observer(function CheckpointsPanel() {
  const service = useService(StateService);
  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>检查点</h2>
          <p className="sub">给当前工作态拍一个命名快照，随时可以回看或按名恢复。</p>
        </div>
      </div>
      <div className="create-line">
        <input
          className="field"
          style={{ maxWidth: 220 }}
          placeholder="检查点名"
          value={service.checkpointName}
          onChange={(event) => service.assign({ checkpointName: event.target.value })}
        />
        <textarea
          className="field json-field"
          placeholder="状态 JSON"
          value={service.checkpointJson}
          onChange={(event) => service.assign({ checkpointJson: event.target.value })}
        />
        <button type="button" className="btn primary" onClick={() => void service.saveCheckpoint()}>
          写入
        </button>
      </div>
      <EntryList
        empty="还没有检查点。"
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
