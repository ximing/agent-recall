import { MEMORY_TYPES, type ImportStrategy, type MemoryType, type Origin } from '@agent-recall/dto';
import { bindServices, observer, useService } from '@rabjs/react';
import { ChevronDown, Download, Plus, Search, Sparkles, Upload } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { MarkdownView } from '@/components/MarkdownView';
import { formatTime, isExpired } from '@/utils/format';
import { ORIGIN_LABEL, TYPE_LABEL } from '@/utils/labels';
import { MemoryDrawer } from './MemoryDrawer';
import { MemoriesService, type MemorySort } from './memories.service';

const ORIGIN_FILTERS: Array<{ key: Origin | 'all'; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'web', label: '网页' },
  { key: 'agent', label: '代理' },
  { key: 'hook', label: '钩子' },
  { key: 'import', label: '导入' },
  { key: 'summary', label: '摘要' },
];

const SORT_OPTIONS: Array<{ key: MemorySort; label: string }> = [
  { key: 'created-desc', label: '最新创建' },
  { key: 'updated-desc', label: '最近更新' },
  { key: 'created-asc', label: '最早创建' },
];

const IMPORT_STRATEGIES: Array<{ key: ImportStrategy; label: string; hint: string }> = [
  { key: 'skip', label: '跳过', hint: '已存在的记忆保持不变' },
  { key: 'merge', label: '合并', hint: '已存在的生成新版本' },
  { key: 'replace', label: '替换', hint: '已存在的整条替换' },
];

const StatsBar = observer(function StatsBar({ service }: { service: MemoriesService }) {
  const stats = service.stats;
  if (!stats) return null;
  return (
    <div className="stats-grid">
      <div className="stat-card">
        <p className="stat-num">{stats.total}</p>
        <p className="stat-label">记忆总数</p>
      </div>
      <div className="stat-card">
        <p className="stat-num">{stats.createdLast7d}</p>
        <p className="stat-label">近 7 天新增</p>
      </div>
      <div className="stat-card">
        <p className="stat-num">{stats.expired}</p>
        <p className="stat-label">已过期</p>
      </div>
      <div className="stat-card">
        <p className="stat-num">{stats.sessions}</p>
        <p className="stat-label">会话数</p>
      </div>
      <div className="stat-card wide">
        <p className="stat-label">按类型</p>
        <p className="stat-chips">
          {MEMORY_TYPES.filter((type) => (stats.byType[type] ?? 0) > 0).map((type) => (
            <span key={type} className="mini-tag">
              {TYPE_LABEL[type]} {stats.byType[type]}
            </span>
          ))}
          {Object.keys(stats.byType).length === 0 ? <span className="composer-hint">暂无</span> : null}
        </p>
      </div>
    </div>
  );
});

const ImportPanel = observer(function ImportPanel({ service }: { service: MemoriesService }) {
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

const BatchBar = observer(function BatchBar({ service }: { service: MemoriesService }) {
  if (service.selectedCount === 0 || service.isRecalling) return null;
  return (
    <div className="batch-bar">
      <span className="batch-count">已选 {service.selectedCount} 条</span>
      {service.batchPreview !== null ? (
        <>
          <span className="batch-danger-text">将删除 {service.batchPreview} 条记忆（整条版本链），不可恢复。</span>
          <button type="button" className="btn danger" disabled={service.batchBusy} onClick={() => void service.confirmBatchDelete()}>
            {service.batchBusy ? '删除中…' : '确认删除'}
          </button>
          <button type="button" className="btn" onClick={() => service.cancelBatchPreview()}>
            取消
          </button>
        </>
      ) : (
        <button type="button" className="btn danger" disabled={service.batchBusy} onClick={() => void service.previewBatchDelete()}>
          {service.batchBusy ? '检查中…' : '批量删除'}
        </button>
      )}
      <span className="spacer" />
      <button type="button" className="btn ghost" onClick={() => service.clearSelection()}>
        取消选择
      </button>
    </div>
  );
});

const MemoriesPage = observer(function MemoriesPage() {
  const service = useService(MemoriesService);

  useEffect(() => {
    void service.load();
    return () => service.clearSearch();
  }, [service]);

  return (
    <section className="page">
      <header className="page-head with-action">
        <div>
          <h1>记忆</h1>
          <p className="desc">从网页写一条，或让代理与钩子替你记录。所有记忆都会进入召回索引。</p>
        </div>
        <div className="head-actions">
          <button type="button" className="btn" disabled={service.exporting} onClick={() => void service.exportAll()}>
            <Download size={14} strokeWidth={1.8} />
            {service.exporting ? '导出中…' : '导出'}
          </button>
          <button
            type="button"
            className={`btn${service.importOpen ? ' primary' : ''}`}
            onClick={() => service.setImportOpen(!service.importOpen)}
          >
            <Upload size={14} strokeWidth={1.8} />
            导入
          </button>
          <button type="button" className="btn primary" onClick={() => service.openNew()}>
            <Plus size={14} strokeWidth={1.8} />
            新建记忆
          </button>
        </div>
      </header>

      {service.error ? (
        <p className="form-error" role="alert">
          {service.error}
        </p>
      ) : null}

      <StatsBar service={service} />
      <ImportPanel service={service} />

      <div className="toolbar">
        <div className="search">
          <Search size={14} strokeWidth={1.6} />
          <input
            className="field"
            placeholder="搜索记忆，走 BM25 + 向量召回…"
            value={service.query}
            onChange={(event) => service.setQuery(event.target.value)}
          />
        </div>
        {service.isRecalling ? null : (
          <div className="sort">
            <select value={service.sort} onChange={(event) => service.setSort(event.target.value as MemorySort)}>
              {SORT_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
            <ChevronDown size={12} strokeWidth={1.8} />
          </div>
        )}
      </div>

      <div className="filter-row">
        <div className="chips">
          {ORIGIN_FILTERS.map((filter) => (
            <button
              key={filter.key}
              type="button"
              className={`chip${service.originFilter === filter.key ? ' active' : ''}`}
              onClick={() => service.setOriginFilter(filter.key)}
            >
              {filter.label}
              <span className="n">{service.originCounts[filter.key]}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`chip${service.includeExpired ? ' active' : ''}`}
          onClick={() => service.setIncludeExpired(!service.includeExpired)}
        >
          含已过期
        </button>
      </div>

      <div className="filter-row">
        <div className="chips">
          <button
            type="button"
            className={`chip${service.typeFilter === 'all' ? ' active' : ''}`}
            onClick={() => service.setTypeFilter('all')}
          >
            全部类型
          </button>
          {MEMORY_TYPES.map((type: MemoryType) => (
            <button
              key={type}
              type="button"
              className={`chip${service.typeFilter === type ? ' active' : ''}`}
              onClick={() => service.setTypeFilter(service.typeFilter === type ? 'all' : type)}
            >
              {TYPE_LABEL[type]}
            </button>
          ))}
        </div>
        <input
          className="field mini"
          placeholder="按项目筛选…"
          value={service.projectFilter}
          onChange={(event) => service.setProjectFilter(event.target.value)}
        />
        <input
          className="field mini"
          placeholder="按会话 ID 筛选…"
          value={service.sessionFilter}
          onChange={(event) => service.setSessionFilter(event.target.value)}
        />
      </div>

      {service.isRecalling ? (
        <p className="recall-hint">
          <Sparkles size={13} strokeWidth={1.6} />
          {service.searching ? '正在召回…' : '召回结果 · 按相关度排序（BM25 + 向量 + RRF 融合）'}
          <button type="button" className="clear" onClick={() => service.clearSearch()}>
            清除搜索
          </button>
        </p>
      ) : null}

      <BatchBar service={service} />

      {service.memories.length === 0 && !service.isRecalling && !service.hasActiveFilter && !service.loading ? (
        <div className="empty">
          <p className="empty-title">还没有记忆</p>
          <p>写下第一条，或者接入 MCP 让代理替你记录。</p>
          <p style={{ marginTop: 16 }}>
            <button type="button" className="btn primary" onClick={() => service.openNew()}>
              新建记忆
            </button>
          </p>
        </div>
      ) : service.visible.length === 0 ? (
        <div className="empty">
          <p className="empty-title">{service.isRecalling ? '没有召回结果' : '没有匹配的记忆'}</p>
          <p>{service.isRecalling ? '换个说法再试，召回按语义匹配。' : '换个筛选条件看看。'}</p>
        </div>
      ) : (
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
                        删除
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
          {!service.isRecalling && service.hasMore ? (
            <div className="pager">
              <button type="button" className="btn" disabled={service.loading} onClick={() => void service.loadMore()}>
                {service.loading ? '加载中…' : '加载更多'}
              </button>
            </div>
          ) : null}
        </>
      )}

      <MemoryDrawer />
    </section>
  );
});

export default bindServices(MemoriesPage, [MemoriesService]);
