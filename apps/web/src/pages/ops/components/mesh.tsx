import type { ImportStrategy } from '@agent-recall/dto';
import { observer, useService } from '@rabjs/react';
import { OpsService } from '../ops.service';

const STRATEGIES: Array<{ key: ImportStrategy; label: string }> = [
  { key: 'skip', label: '跳过已存在' },
  { key: 'merge', label: '合并为新版本' },
  { key: 'replace', label: '替换已存在' },
];

export const MeshPanel = observer(function MeshPanel() {
  const service = useService(OpsService);
  return (
    <div className="panel ops-card">
      <div className="ops-card-head">
        <h2>Mesh 同步</h2>
      </div>
      <p className="desc">从另一台召回服务拉取导出再导入。对端主机必须是本机或私网地址。</p>
      <form
        className="ops-card-foot"
        style={{ marginBottom: 10 }}
        onSubmit={(event) => {
          event.preventDefault();
          void service.meshSync();
        }}
      >
        <input
          className="field"
          placeholder="http://127.0.0.1:8787"
          value={service.peerUrl}
          onChange={(event) => service.assign({ peerUrl: event.target.value })}
        />
        <input
          className="field"
          type="password"
          autoComplete="new-password"
          placeholder="对端令牌"
          value={service.peerToken}
          onChange={(event) => service.assign({ peerToken: event.target.value })}
        />
        <button type="submit" className="btn primary">
          同步
        </button>
      </form>
      <div className="chips" style={{ marginBottom: 4 }}>
        {STRATEGIES.map((strategy) => (
          <button
            key={strategy.key}
            type="button"
            className={`chip${service.meshStrategy === strategy.key ? ' active' : ''}`}
            onClick={() => service.assign({ meshStrategy: strategy.key })}
          >
            {strategy.label}
          </button>
        ))}
      </div>
      {service.meshNote ? <p className="settings-saved" style={{ marginTop: 8 }}>{service.meshNote}</p> : null}
    </div>
  );
});
