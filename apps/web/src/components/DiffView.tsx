import { useMemo } from 'react';
import { diffLines } from '@/utils/format';
import './diff.css';

/**
 * 行级 diff 视图：新增行绿色、删除行红色、未变行弱化。
 */
export function DiffView({ before, after }: { before: string; after: string }) {
  const lines = useMemo(() => diffLines(before, after), [before, after]);
  if (lines.length === 0) return <p className="composer-hint">内容为空</p>;
  return (
    <div className="diff">
      {lines.map((line, index) => (
        <div key={index} className={`diff-line ${line.kind}`}>
          <span className="diff-sign">{line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}</span>
          {line.text || ' '}
        </div>
      ))}
    </div>
  );
}
