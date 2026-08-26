import type { KvEntryPublic } from '@agent-recall/dto';
import { observer, useService } from '@rabjs/react';
import type { ReactNode } from 'react';
import { StateService } from '../state.service';

export function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

export function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export const DeleteRow = observer(function DeleteRow({ entry }: { entry: KvEntryPublic }) {
  const service = useService(StateService);
  if (service.pendingKey !== entry.key) {
    return (
      <button type="button" className="btn ghost warn" onClick={() => service.askDelete(entry.key)}>
        删除
      </button>
    );
  }
  return (
    <span className="revoke-confirm">
      <button type="button" className="btn danger" onClick={() => void service.confirmDelete()}>
        确认删除
      </button>
      <button type="button" className="btn" onClick={() => service.cancelDelete()}>
        取消
      </button>
    </span>
  );
});

export const EntryList = observer(function EntryList({
  empty,
  rowClass = 'kv-row',
  render,
}: {
  empty: string;
  rowClass?: string;
  render: (entry: KvEntryPublic) => ReactNode;
}) {
  const service = useService(StateService);
  if (service.loading) return null;
  if (service.entries.length === 0) {
    return <p className="composer-hint" style={{ padding: '16px 22px 20px' }}>{empty}</p>;
  }
  return (
    <div className="kv-list">
      {service.entries.map((entry) => (
        <article key={entry.key} className={rowClass}>
          {render(entry)}
        </article>
      ))}
    </div>
  );
});
