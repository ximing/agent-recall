import { observer, useService } from '@rabjs/react';
import { MemoriesService } from '../memories.service';

export const FilterForgetBar = observer(function FilterForgetBar() {
  const service = useService(MemoriesService);
  if (!service.hasActiveFilter) return null;
  return (
    <div className="batch-bar">
      <span className="batch-count">当前筛选</span>
      {service.filterPreview !== null ? (
        <>
          <span className="batch-danger-text">
            将删除 {service.filterPreview} 条记忆（整条版本链），不可恢复。
          </span>
          <button
            type="button"
            className="btn danger"
            disabled={service.filterBusy || service.filterPreview === 0}
            onClick={() => void service.confirmFilterForget()}
          >
            {service.filterBusy ? '删除中…' : '确认删除'}
          </button>
          <button type="button" className="btn" onClick={() => service.cancelFilterForget()}>
            取消
          </button>
        </>
      ) : (
        <button type="button" className="btn danger" disabled={service.filterBusy} onClick={() => void service.previewFilterForget()}>
          {service.filterBusy ? '检查中…' : '按当前筛选删除'}
        </button>
      )}
    </div>
  );
});
