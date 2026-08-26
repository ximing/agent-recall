import { MEMORY_TYPES } from '@agent-recall/dto';
import { observer, useService } from '@rabjs/react';
import { TYPE_LABEL } from '@/utils/labels';
import { MemoriesService } from '../memories.service';

export const StatsBar = observer(function StatsBar() {
  const service = useService(MemoriesService);
  const stats = service.stats;
  if (!stats) return null;
  return (
    <div className="stat-strip">
      <div className="stat-cell">
        <p className="num">{stats.total}</p>
        <p className="label">记忆总数</p>
      </div>
      <div className="stat-cell">
        <p className="num">
          {stats.createdLast7d}
          <small>近 7 天</small>
        </p>
        <p className="label">新增</p>
      </div>
      <div className="stat-cell">
        <p className="num">{stats.expired}</p>
        <p className="label">已过期</p>
      </div>
      <div className="stat-cell">
        <p className="num">{stats.sessions}</p>
        <p className="label">会话数</p>
      </div>
      <div className="stat-cell" style={{ flex: 2 }}>
        <p className="label" style={{ marginBottom: 2 }}>
          按类型
        </p>
        <div className="sub">
          {MEMORY_TYPES.filter((type) => (stats.byType[type] ?? 0) > 0).map((type) => (
            <span key={type} className="mini-tag">
              {TYPE_LABEL[type]} {stats.byType[type]}
            </span>
          ))}
          {Object.keys(stats.byType).length === 0 ? <span className="composer-hint">暂无</span> : null}
        </div>
      </div>
    </div>
  );
});
