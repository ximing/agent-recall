import { bindServices, observer, useService } from '@rabjs/react';
import {
  Activity,
  BookUser,
  Box,
  CheckSquare,
  Hourglass,
  ListTodo,
  Radar,
  Repeat,
} from 'lucide-react';
import { useEffect } from 'react';
import { ActionsPanel } from './components/actions';
import { CheckpointsPanel } from './components/checkpoints';
import { LeasesPanel } from './components/leases';
import { ProfilePanel } from './components/profile';
import { RoutinesPanel } from './components/routines';
import { SentinelsPanel } from './components/sentinels';
import { SignalsPanel } from './components/signals';
import { SlotsPanel } from './components/slots';
import { StateService, type StateTab } from './state.service';
import './state.css';

const NAV_GROUPS: Array<{
  label: string;
  tabs: Array<{ key: StateTab; label: string; icon: typeof ListTodo }>;
}> = [
  {
    label: '工作项',
    tabs: [
      { key: 'actions', label: '行动', icon: ListTodo },
      { key: 'routines', label: '例程', icon: Repeat },
      { key: 'checkpoints', label: '检查点', icon: CheckSquare },
    ],
  },
  {
    label: '观察',
    tabs: [
      { key: 'signals', label: '信号', icon: Activity },
      { key: 'sentinels', label: '哨兵', icon: Radar },
    ],
  },
  {
    label: '数据',
    tabs: [
      { key: 'slots', label: '槽位', icon: Box },
      { key: 'profile', label: '档案', icon: BookUser },
      { key: 'leases', label: '租约', icon: Hourglass },
    ],
  },
];

const StatePage = observer(function StatePage() {
  const service = useService(StateService);

  useEffect(() => {
    void service.load();
  }, [service]);

  return (
    <section className="page flush">
      <header className="page-head">
        <div>
          <h1>状态</h1>
          <p className="desc">
            行动、信号、哨兵、槽位、档案、租约、例程和检查点。这些工作态存在同一张 KV 表里，按用途分组查看。
          </p>
        </div>
      </header>
      {service.error ? (
        <p className="form-error" role="alert">
          {service.error}
        </p>
      ) : null}
      {service.notice ? <p className="settings-saved" style={{ marginBottom: 14 }}>{service.notice}</p> : null}

      <div className="state-split">
        <nav className="state-nav" aria-label="状态分组">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="nav-group">{group.label}</p>
              {group.tabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    className={service.tab === tab.key ? 'active' : ''}
                    onClick={() => service.setTab(tab.key)}
                  >
                    <Icon size={14} strokeWidth={1.7} />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="state-content">
          {service.loading ? <p className="composer-hint" style={{ marginBottom: 12 }}>加载中…</p> : null}
          {service.tab === 'actions' ? <ActionsPanel /> : null}
          {service.tab === 'signals' ? <SignalsPanel /> : null}
          {service.tab === 'sentinels' ? <SentinelsPanel /> : null}
          {service.tab === 'slots' ? <SlotsPanel /> : null}
          {service.tab === 'profile' ? <ProfilePanel /> : null}
          {service.tab === 'leases' ? <LeasesPanel /> : null}
          {service.tab === 'routines' ? <RoutinesPanel /> : null}
          {service.tab === 'checkpoints' ? <CheckpointsPanel /> : null}
        </div>
      </div>
    </section>
  );
});

export default bindServices(StatePage, [StateService]);
