import { observer, useService } from '@rabjs/react';
import { OpsService } from '../ops.service';

export const DiagnosePanel = observer(function DiagnosePanel() {
  const service = useService(OpsService);
  const diagnose = service.diagnose;
  const problems = diagnose?.problems.length ?? 0;
  const tone = diagnose === null ? 'idle' : problems > 0 ? 'warn' : '';

  return (
    <>
      <div className={`health-strip${tone ? ` ${tone}` : ''}`}>
        <span className="pulse" />
        <div>
          <p className="title">
            {diagnose === null
              ? '还没有跑过诊断'
              : problems > 0
                ? `诊断发现 ${problems} 项问题`
                : '诊断通过，没有发现问题'}
          </p>
          <p className="sub">诊断会看未索引、过期记忆，以及检索服务有没有配上。自愈会补索引，并清除过期记忆和长期未命中的钩子碎片。</p>
        </div>
        <div className="head-actions">
          <button type="button" className="btn" onClick={() => void service.loadDiagnose()}>
            重新诊断
          </button>
          {service.healArmed ? (
            <>
              <button type="button" className="btn danger" onClick={() => void service.confirmHeal()}>
                确认自愈
              </button>
              <button type="button" className="btn" onClick={() => service.cancelHeal()}>
                取消
              </button>
            </>
          ) : (
            <button type="button" className="btn danger" onClick={() => service.armHeal()}>
              自愈
            </button>
          )}
        </div>
      </div>
      {service.healNote ? (
        <p className="settings-saved" style={{ marginBottom: 16 }}>
          {service.healNote}
        </p>
      ) : null}
      {diagnose && problems > 0 ? (
        <div className="ops-grid" style={{ marginBottom: 16 }}>
          <div className="panel ops-card full">
            <div className="ops-card-head">
              <h2>诊断详情</h2>
              <span className="status bad">{problems} 项待处理</span>
            </div>
            <ul className="problem-list">
              {diagnose.problems.map((problem) => (
                <li key={problem.code}>
                  {problem.message}
                  <p className="fix">{problem.fix}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </>
  );
});
