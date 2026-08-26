import { observer, useService } from '@rabjs/react';
import { useEffect, useRef } from 'react';
import { MarkdownView } from '@/components/MarkdownView';
import { formatTime, isExpired } from '@/utils/format';
import { ORIGIN_LABEL, TYPE_LABEL } from '@/utils/labels';
import { MemoriesService } from '../memories.service';

export const MemoryList = observer(function MemoryList() {
  const service = useService(MemoriesService);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const showMore = !service.isRecalling && service.hasMore;

  // 触底自动加载：哨兵进入视口（提前 400px）即取下一页，按钮留作手动兜底
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !showMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void service.loadMore();
      },
      { rootMargin: '400px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [service, showMore, service.memories.length]);

  if (service.memories.length === 0 && !service.isRecalling && !service.hasActiveFilter && !service.loading) {
    return (
      <div className="empty">
        <p className="empty-title">还没有记忆</p>
        <p>写下第一条，或者接入 MCP 让代理替你记录。</p>
        <p style={{ marginTop: 16 }}>
          <button type="button" className="btn primary" onClick={() => service.openNew()}>
            新建记忆
          </button>
        </p>
      </div>
    );
  }

  if (service.visible.length === 0) {
    return (
      <div className="empty">
        <p className="empty-title">{service.isRecalling ? '没有召回结果' : '没有匹配的记忆'}</p>
        <p>{service.isRecalling ? '换个说法再试，召回按语义匹配。' : '换个筛选条件看看。'}</p>
      </div>
    );
  }

  return (
    <>
      <div className="mlist">
        {service.visible.map((memory) => {
          const confirming = service.pendingDeleteId === memory.id;
          const expired = isExpired(memory.expiresAt);
          return (
            <article
              key={memory.id}
              className={`mrow origin-${memory.origin}${confirming ? ' confirming' : ''}${expired ? ' expired' : ''}`}
              onClick={() => service.openView(memory)}
            >
              <div className="mrow-head">
                {service.isRecalling ? null : (
                  <input
                    type="checkbox"
                    className="mrow-check"
                    checked={service.isSelected(memory.id)}
                    onClick={(event) => event.stopPropagation()}
                    onChange={() => service.toggleSelect(memory.id)}
                    aria-label="选择这条记忆"
                  />
                )}
                <span className={`mcard-tag ${memory.origin}`}>{ORIGIN_LABEL[memory.origin]}</span>
                <span className="mcard-tag type">{TYPE_LABEL[memory.type]}</span>
                {expired ? <span className="mcard-tag expired">已过期</span> : null}
                {memory.project ? <span className="mini-tag">{memory.project}</span> : null}
                {memory.tags.slice(0, 4).map((tag) => (
                  <span key={tag} className="mini-tag">
                    #{tag}
                  </span>
                ))}
                {service.searchMode === 'smart' && service.scoreById[memory.id] !== undefined ? (
                  <span className="mini-tag">{service.scoreById[memory.id].toFixed(3)}</span>
                ) : null}
                <span className="mrow-time">{formatTime(memory.createdAt)}</span>
                <span className="mrow-actions">
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={(event) => {
                      event.stopPropagation();
                      service.openEdit(memory);
                    }}
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    className="btn ghost warn"
                    onClick={(event) => {
                      event.stopPropagation();
                      service.askDelete(memory.id);
                    }}
                  >
                    {memory.type === 'lesson' ? '删除经验' : '删除'}
                  </button>
                </span>
              </div>
              <MarkdownView content={memory.content} clamp />
              {confirming ? (
                <div className="confirm-row" onClick={(event) => event.stopPropagation()}>
                  确定删除这条记忆？整条版本链都会被删除。
                  <span className="spacer" />
                  <button type="button" className="btn danger" onClick={() => void service.confirmDelete()}>
                    确认删除
                  </button>
                  <button type="button" className="btn" onClick={() => service.cancelDelete()}>
                    取消
                  </button>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
      {showMore ? (
        <div className="pager" ref={sentinelRef}>
          <button type="button" className="btn" disabled={service.loading} onClick={() => void service.loadMore()}>
            {service.loading ? '加载中…' : '加载更多'}
          </button>
        </div>
      ) : null}
    </>
  );
});
