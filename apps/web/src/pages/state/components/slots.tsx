import { observer, useService } from '@rabjs/react';
import { StateService } from '../state.service';
import { DeleteRow, EntryList, pretty } from './kv';

export const SlotsPanel = observer(function SlotsPanel() {
  const service = useService(StateService);
  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>槽位</h2>
          <p className="sub">命名 JSON 插槽，代理启动时按名读取；「追加」把新值并进数组。</p>
        </div>
      </div>
      <div className="create-line">
        <input
          className="field"
          style={{ maxWidth: 220 }}
          placeholder="槽位名"
          value={service.slotName}
          onChange={(event) => service.assign({ slotName: event.target.value })}
        />
        <textarea
          className="field json-field"
          placeholder="JSON。追加时如果不是 JSON，会按字符串放进去。"
          value={service.slotJson}
          onChange={(event) => service.assign({ slotJson: event.target.value })}
        />
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn primary" onClick={() => void service.saveSlot(false)}>
            写入
          </button>
          <button type="button" className="btn" onClick={() => void service.saveSlot(true)}>
            追加
          </button>
        </div>
      </div>
      <EntryList
        empty="还没有槽位。"
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
