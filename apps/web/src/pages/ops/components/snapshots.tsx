import type { ImportStrategy } from '@agent-recall/dto';
import { observer, useService } from '@rabjs/react';
import { formatTime } from '@/utils/format';
import { OpsService } from '../ops.service';

const STRATEGIES: Array<{ key: ImportStrategy; label: string }> = [
  { key: 'skip', label: '跳过已存在' },
  { key: 'merge', label: '合并为新版本' },
  { key: 'replace', label: '替换已存在' },
];

export const SnapshotsPanel = observer(function SnapshotsPanel() {
  const service = useService(OpsService);
  return (
    <div className="panel ops-card">
      <div className="ops-card-head">
        <h2>快照</h2>
        <span className="mini-tag">{service.snapshots.length} 份</span>
      </div>
      <p className="desc">保存当时的全部记忆。列表只显示备注和条数，正文留在库里。治理操作前建议先打一份。</p>
      <form
        className="ops-card-foot"
        style={{ marginBottom: 10 }}
        onSubmit={(event) => {
          event.preventDefault();
          void service.createSnapshot();
        }}
      >
        <input
          className="field"
          placeholder="备注，可空"
          value={service.snapshotNote}
          onChange={(event) => service.assign({ snapshotNote: event.target.value })}
        />
        <button type="submit" className="btn primary">
          创建快照
        </button>
      </form>
      <div className="chips" style={{ marginBottom: 12 }}>
        {STRATEGIES.map((strategy) => (
          <button
            key={strategy.key}
            type="button"
            className={`chip${service.restoreStrategy === strategy.key ? ' active' : ''}`}
            onClick={() => service.assign({ restoreStrategy: strategy.key })}
          >
            {strategy.label}
          </button>
        ))}
      </div>
      {service.snapshotMessage ? <p className="settings-saved" style={{ marginBottom: 10 }}>{service.snapshotMessage}</p> : null}
      {service.snapshots.length === 0 ? (
        <p className="composer-hint">还没有快照。</p>
      ) : (
        <div className="kv-list">
          {service.snapshots.map((snapshot) => (
            <div key={snapshot.id} className="kv-row">
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{snapshot.note || '未命名快照'}</strong>
                <p className="composer-hint">
                  {snapshot.memoryCount} 条 · {formatTime(snapshot.createdAt)}
                </p>
              </div>
              {service.restoreId === snapshot.id ? (
                <span className="revoke-confirm">
                  <button type="button" className="btn danger" onClick={() => void service.confirmRestore()}>
                    确认恢复
                  </button>
                  <button type="button" className="btn" onClick={() => service.cancelRestore()}>
                    取消
                  </button>
                </span>
              ) : (
                <button type="button" className="btn" onClick={() => service.armRestore(snapshot.id)}>
                  恢复
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
