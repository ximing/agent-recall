import { observer, useService } from '@rabjs/react';
import { OpsService } from '../ops.service';

export const ReflectPanel = observer(function ReflectPanel() {
  const service = useService(OpsService);
  return (
    <div className="panel ops-card">
      <div className="ops-card-head">
        <h2>反思</h2>
      </div>
      <p className="desc">把近几天的经验、模式和问题抽成一条模式记忆。同一天再跑不会重复写。</p>
      <form
        className="ops-card-foot"
        onSubmit={(event) => {
          event.preventDefault();
          void service.reflect();
        }}
      >
        <input
          className="field mini"
          type="number"
          min={1}
          max={90}
          aria-label="天数"
          value={service.reflectDays}
          onChange={(event) => service.assign({ reflectDays: event.target.value })}
        />
        <input
          className="field"
          placeholder="项目，可空"
          value={service.reflectProject}
          onChange={(event) => service.assign({ reflectProject: event.target.value })}
        />
        <button type="submit" className="btn primary">
          生成反思
        </button>
        {service.reflectNote ? <span className="settings-saved">{service.reflectNote}</span> : null}
      </form>
    </div>
  );
});
