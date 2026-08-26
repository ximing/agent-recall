import { observer, useService } from '@rabjs/react';
import { MemoriesService } from '../memories.service';

export const ContextPreview = observer(function ContextPreview() {
  const service = useService(MemoriesService);
  if (!service.contextOpen) return null;
  return (
    <div className="panel context-panel">
      <div className="panel-head">
        <div>
          <h2>注入预览</h2>
          <p className="sub">
            与插件注入相同：只用网页、代理、摘要、导入来源。项目筛选会传给这次预览。钩子碎片不参与。
          </p>
        </div>
        <span className="badge mode-badge">
          <span className="dot" />
          {service.contextMemoryCount} 条 · 预算 2000 token
        </span>
      </div>
      <div className="panel-body">
        {service.contextNote ? <p className="composer-hint">{service.contextNote}</p> : null}
        {service.contextText ? <pre className="context-pre">{service.contextText}</pre> : null}
        <div style={{ marginTop: 12 }}>
          <button type="button" className="btn ghost" onClick={() => service.closeContext()}>
            收起
          </button>
        </div>
      </div>
    </div>
  );
});
