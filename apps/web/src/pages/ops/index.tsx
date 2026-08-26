import { bindServices, observer, useService } from '@rabjs/react';
import { useEffect } from 'react';
import { AuditPanel } from './components/audit';
import { ConsolidatePanel } from './components/consolidate';
import { DiagnosePanel } from './components/diagnose';
import { FeedPanel } from './components/feed';
import { MeshPanel } from './components/mesh';
import { ReflectPanel } from './components/reflect';
import { SnapshotsPanel } from './components/snapshots';
import { OpsService } from './ops.service';
import './ops.css';
import '@/styles/ledger.css';

const OpsPage = observer(function OpsPage() {
  const service = useService(OpsService);

  useEffect(() => {
    void service.load();
  }, [service]);

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1>治理</h1>
          <p className="desc">诊断、合并重复、反思、快照、审计、收到的分享，以及和另一台服务同步。自动遗忘仍在设置里。</p>
        </div>
      </header>
      {service.error ? (
        <p className="form-error" role="alert">
          {service.error}
        </p>
      ) : null}
      <DiagnosePanel />
      <div className="ops-grid">
        <ConsolidatePanel />
        <ReflectPanel />
        <SnapshotsPanel />
        <FeedPanel />
        <MeshPanel />
        <AuditPanel />
      </div>
    </section>
  );
});

export default bindServices(OpsPage, [OpsService]);
