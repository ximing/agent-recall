import { observer, useService } from '@rabjs/react';
import { OpsService } from '../ops.service';

export const ConsolidatePanel = observer(function ConsolidatePanel() {
  const service = useService(OpsService);
  const preview = service.consolidatePreview;
  return (
    <div className="panel ops-card">
      <div className="ops-card-head">
        <h2>近重复合并</h2>
      </div>
      <p className="desc">内容哈希相同、又分属不同版本链的记忆，只保留最新一条链。</p>
      {preview ? (
        <div className="result danger-text">
          {preview.groups} 组重复，将去掉 {preview.merged} 条链。
        </div>
      ) : null}
      <div className="ops-card-foot">
        {preview ? (
          <>
            <button
              type="button"
              className="btn danger"
              disabled={preview.merged === 0}
              onClick={() => void service.confirmConsolidate()}
            >
              确认合并
            </button>
            <button type="button" className="btn" onClick={() => service.cancelConsolidate()}>
              取消
            </button>
          </>
        ) : (
          <button type="button" className="btn" onClick={() => void service.previewConsolidate()}>
            预览
          </button>
        )}
        {service.consolidateNote ? <span className="settings-saved">{service.consolidateNote}</span> : null}
      </div>
    </div>
  );
});
