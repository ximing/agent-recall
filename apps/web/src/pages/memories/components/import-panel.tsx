import type { ImportStrategy } from '@agent-recall/dto';
import { observer, useService } from '@rabjs/react';
import { Upload } from 'lucide-react';
import { useRef } from 'react';
import { MemoriesService } from '../memories.service';

const IMPORT_STRATEGIES: Array<{ key: ImportStrategy; label: string; hint: string }> = [
  { key: 'skip', label: '跳过', hint: '已存在的记忆保持不变' },
  { key: 'merge', label: '合并', hint: '已存在的生成新版本' },
  { key: 'replace', label: '替换', hint: '已存在的整条替换' },
];

export const ImportPanel = observer(function ImportPanel() {
  const service = useService(MemoriesService);
  const fileRef = useRef<HTMLInputElement>(null);
  if (!service.importOpen) return null;
  return (
    <div className="panel import-panel">
      <div className="chips">
        {IMPORT_STRATEGIES.map((strategy) => (
          <button
            key={strategy.key}
            type="button"
            title={strategy.hint}
            className={`chip${service.importStrategy === strategy.key ? ' active' : ''}`}
            onClick={() => service.setImportStrategy(strategy.key)}
          >
            {strategy.label}已存在
          </button>
        ))}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void service.importFile(file);
          event.target.value = '';
        }}
      />
      <button type="button" className="btn primary" disabled={service.importing} onClick={() => fileRef.current?.click()}>
        <Upload size={14} strokeWidth={1.8} />
        {service.importing ? '导入中…' : '选择 JSON 文件'}
      </button>
      {service.importResult ? <span className="settings-saved">{service.importResult}</span> : null}
      <span className="spacer" />
      <button type="button" className="btn ghost" onClick={() => service.setImportOpen(false)}>
        收起
      </button>
    </div>
  );
});
