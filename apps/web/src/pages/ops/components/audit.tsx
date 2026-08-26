import { observer, useService } from '@rabjs/react';
import { formatTime } from '@/utils/format';
import { OpsService } from '../ops.service';

function detailText(detail: unknown): string {
  if (detail === null || detail === undefined) return '';
  const text = typeof detail === 'string' ? detail : JSON.stringify(detail);
  return text.length > 180 ? `${text.slice(0, 180)}…` : text;
}

export const AuditPanel = observer(function AuditPanel() {
  const service = useService(OpsService);
  return (
    <div className="panel ops-card full">
      <div className="ops-card-head">
        <h2>审计</h2>
        <span className="mini-tag">{service.audit.length} 条</span>
      </div>
      <p className="desc">谁在什么时间通过哪个令牌写、改、删了记忆，全量留痕。</p>
      {service.audit.length === 0 ? (
        <p className="composer-hint">还没有审计记录。</p>
      ) : (
        <div className="ledger" style={{ margin: '0 -20px -16px' }}>
          <table>
            <thead>
              <tr>
                <th>动作</th>
                <th>详情</th>
                <th>时间</th>
              </tr>
            </thead>
            <tbody>
              {service.audit.map((entry) => (
                <tr key={entry.id}>
                  <td className="mono">{entry.action}</td>
                  <td>{detailText(entry.detail)}</td>
                  <td className="time">{formatTime(entry.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
});
