import { observer, useService } from '@rabjs/react';
import { MemoriesService } from '../memories.service';

/** 放在筛选面板底部，默认只是一行灰色文字，点开后才出现确认。 */
export const FilterForgetBar = observer(function FilterForgetBar() {
  const service = useService(MemoriesService);
  if (!service.hasActiveFilter && service.filterPreview === null) return null;
  return (
    <div className="quiet-forget">
      {service.filterPreview !== null ? (
        <>
          <span className="quiet-note">将删除 {service.filterPreview} 条，含整条版本链，不可恢复。</span>
          <button
            type="button"
            className="text-btn danger"
            disabled={service.filterBusy || service.filterPreview === 0}
            onClick={() => void service.confirmFilterForget()}
          >
            {service.filterBusy ? '删除中…' : '确认'}
          </button>
          <button type="button" className="text-btn" onClick={() => service.cancelFilterForget()}>
            取消
          </button>
        </>
      ) : (
        <button type="button" className="text-btn muted" disabled={service.filterBusy} onClick={() => void service.previewFilterForget()}>
          {service.filterBusy ? '检查中…' : '删除匹配结果'}
        </button>
      )}
    </div>
  );
});
