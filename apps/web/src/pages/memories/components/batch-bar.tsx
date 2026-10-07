import { observer, useService } from '@rabjs/react';
import { MemoriesService } from '../memories.service';

export const BatchBar = observer(function BatchBar() {
  const service = useService(MemoriesService);
  if (service.selectedCount === 0 || service.isRecalling) return null;
  return (
    <div className="quiet-batch">
      <span>已选 {service.selectedCount} 条</span>
      {service.batchPreview !== null ? (
        <>
          <span className="quiet-note">将删除 {service.batchPreview} 条，含整条版本链，不可恢复。</span>
          <button type="button" className="text-btn danger" disabled={service.batchBusy} onClick={() => void service.confirmBatchDelete()}>
            {service.batchBusy ? '删除中…' : '确认'}
          </button>
          <button type="button" className="text-btn" onClick={() => service.cancelBatchPreview()}>
            取消
          </button>
        </>
      ) : (
        <button type="button" className="text-btn muted" disabled={service.batchBusy} onClick={() => void service.previewBatchDelete()}>
          {service.batchBusy ? '检查中…' : '删除'}
        </button>
      )}
      <span className="spacer" />
      <button type="button" className="text-btn" onClick={() => service.clearSelection()}>
        取消选择
      </button>
    </div>
  );
});
