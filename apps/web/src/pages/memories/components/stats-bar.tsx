import { MEMORY_TYPES } from '@agent-recall/dto';
import { observer, useService } from '@rabjs/react';
import { TYPE_LABEL } from '@/utils/labels';
import { MemoriesService } from '../memories.service';

export const StatsBar = observer(function StatsBar() {
  const service = useService(MemoriesService);
  const stats = service.stats;
  if (!stats) return null;
  return (
    <div className="stats-inline">
      <span>
        <b>{stats.total}</b> 总数
      </span>
      <span>
        <b>{stats.createdLast7d}</b> 近 7 天
      </span>
      <span>
        <b>{stats.expired}</b> 已过期
      </span>
      <span>
        <b>{stats.sessions}</b> 会话
      </span>
      <span className="types">
        {MEMORY_TYPES.filter((type) => (stats.byType[type] ?? 0) > 0).map((type) => (
          <span key={type} className="mini-tag">
            {TYPE_LABEL[type]} {stats.byType[type]}
          </span>
        ))}
      </span>
    </div>
  );
});
