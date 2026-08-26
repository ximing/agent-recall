import { observer, useService } from '@rabjs/react';
import { formatTime } from '@/utils/format';
import { StateService } from '../state.service';
import { DeleteRow, EntryList, recordOf } from './kv';

export const LeasesPanel = observer(function LeasesPanel() {
  const service = useService(StateService);
  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>租约</h2>
          <p className="sub">带 TTL 的互斥锁：多个代理抢同一资源时，只有持有者应该继续。</p>
        </div>
      </div>
      <form
        className="create-line"
        onSubmit={(event) => {
          event.preventDefault();
          void service.acquireLease();
        }}
      >
        <input
          className="field"
          placeholder="租约名"
          value={service.leaseName}
          onChange={(event) => service.assign({ leaseName: event.target.value })}
        />
        <input
          className="field"
          placeholder="持有者"
          value={service.leaseHolder}
          onChange={(event) => service.assign({ leaseHolder: event.target.value })}
        />
        <input
          className="field mini"
          style={{ maxWidth: 100 }}
          type="number"
          min={1}
          aria-label="TTL 秒"
          value={service.leaseTtl}
          onChange={(event) => service.assign({ leaseTtl: event.target.value })}
        />
        <button type="submit" className="btn primary">
          获取
        </button>
      </form>
      <EntryList
        empty="没有未过期的租约。"
        rowClass="task-row"
        render={(entry) => {
          const holder = recordOf(entry.value).holder;
          return (
            <>
              <div className="grow">
                <p className="title mono" style={{ fontSize: 13 }}>{entry.key}</p>
                <p className="detail">
                  持有者 {String(holder ?? '')}
                  {entry.expiresAt ? ` · ${formatTime(entry.expiresAt)} 到期` : ''}
                </p>
              </div>
              <DeleteRow entry={entry} />
            </>
          );
        }}
      />
    </div>
  );
});
