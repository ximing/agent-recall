import { observer, useService } from '@rabjs/react';
import { StateService } from '../state.service';
import { DeleteRow, EntryList, pretty } from './kv';

export const ProfilePanel = observer(function ProfilePanel() {
  const service = useService(StateService);
  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>档案</h2>
          <p className="sub">关于使用者的长期事实：口味、习惯、约束。键值形式，代理写入前先读一遍。</p>
        </div>
      </div>
      <form
        className="create-line"
        onSubmit={(event) => {
          event.preventDefault();
          void service.saveProfile();
        }}
      >
        <input
          className="field"
          placeholder="键"
          value={service.profileKey}
          onChange={(event) => service.assign({ profileKey: event.target.value })}
        />
        <input
          className="field"
          placeholder="值"
          value={service.profileValue}
          onChange={(event) => service.assign({ profileValue: event.target.value })}
        />
        <button type="submit" className="btn primary">
          写入
        </button>
      </form>
      <EntryList
        empty="档案是空的。"
        render={(entry) => (
          <>
            <span className="kv-key">{entry.key}</span>
            <pre className="kv-val">{typeof entry.value === 'string' ? entry.value : pretty(entry.value)}</pre>
            <span className="row-actions">
              <DeleteRow entry={entry} />
            </span>
          </>
        )}
      />
    </div>
  );
});
