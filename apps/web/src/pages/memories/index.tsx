import { MEMORY_TYPES, type MemoryType, type Origin } from '@agent-recall/dto';
import { bindServices, observer, useService } from '@rabjs/react';
import { ChevronDown, Download, ListFilter, Plus, Search, Sparkles, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { TYPE_LABEL } from '@/utils/labels';
import { MemoryDrawer } from './MemoryDrawer';
import { BatchBar } from './components/batch-bar';
import { ContextPreview } from './components/context-preview';
import { FilterForgetBar } from './components/filter-forget-bar';
import { ImportPanel } from './components/import-panel';
import { MemoryList } from './components/memory-list';
import { StatsBar } from './components/stats-bar';
import { MemoriesService, type MemorySort, type SearchMode } from './memories.service';
import './memories.css';

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

const MemoriesPage = observer(function MemoriesPage() {
  const service = useService(MemoriesService);
  const [advOpen, setAdvOpen] = useState(false);

  useEffect(() => {
    void service.load();
    return () => service.clearSearch();
  }, [service]);

  const picked: Array<{ key: string; label: string; clear: () => void }> = [];
  if (service.typeFilter !== 'all') {
    const type = service.typeFilter;
    picked.push({ key: 'type', label: `类型：${TYPE_LABEL[type]}`, clear: () => service.setTypeFilter('all') });
  }
  if (service.projectFilter) {
    picked.push({ key: 'project', label: `项目：${service.projectFilter}`, clear: () => service.setProjectFilter('') });
  }
  if (service.sessionFilter) {
    picked.push({ key: 'session', label: `会话：${service.sessionFilter}`, clear: () => service.setSessionFilter('') });
  }
  if (service.tagsFilter) {
    picked.push({ key: 'tags', label: `标签：${service.tagsFilter}`, clear: () => service.setTagsFilter('') });
  }
  if (service.createdAfter) {
    picked.push({ key: 'after', label: `创建于 ${service.createdAfter.replace('T', ' ')} 之后`, clear: () => service.setCreatedAfter('') });
  }
  if (service.createdBefore) {
    picked.push({ key: 'before', label: `创建于 ${service.createdBefore.replace('T', ' ')} 之前`, clear: () => service.setCreatedBefore('') });
  }
  if (service.includeExpired) {
    picked.push({ key: 'expired', label: '含已过期', clear: () => service.setIncludeExpired(false) });
  }

  return (
    <section className="page">
      <header className="page-head">
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

      <StatsBar />
      <ImportPanel />

      <div className="search-hero">
        <div className="search-box">
          <Search size={15} strokeWidth={1.6} />
          <input
            placeholder={service.searchMode === 'smart' ? '精排搜索，候选再交给 rerank…' : '搜索记忆，走 BM25 + 向量召回…'}
            value={service.query}
            onChange={(event) => service.setQuery(event.target.value)}
          />
          <div className="mode-seg" role="group" aria-label="搜索模式">
            {(
              [
                ['recall', '召回'],
                ['smart', '精排'],
              ] as const satisfies ReadonlyArray<readonly [SearchMode, string]>
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                className={service.searchMode === mode ? 'active' : ''}
                onClick={() => service.setSearchMode(mode)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <button type="button" className="btn" disabled={service.contextBusy} onClick={() => void service.previewContext()}>
          {service.contextBusy ? '生成中…' : '预览注入'}
        </button>
      </div>

      <div className="filter-bar">
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
        <span className="spacer" />
        <button
          type="button"
          className={`filter-btn${advOpen || picked.length > 0 ? ' on' : ''}`}
          onClick={() => setAdvOpen(!advOpen)}
          aria-expanded={advOpen}
        >
          <ListFilter size={13} strokeWidth={1.8} />
          筛选
          {picked.length > 0 ? <span className="badge">{picked.length}</span> : null}
        </button>
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

      {advOpen ? (
        <div className="panel adv-panel">
          <div className="adv-group">
            <span className="adv-label">类型</span>
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
              <button
                type="button"
                className={`chip${service.includeExpired ? ' active' : ''}`}
                onClick={() => service.setIncludeExpired(!service.includeExpired)}
              >
                含已过期
              </button>
            </div>
          </div>
          <div className="adv-group">
            <span className="adv-label">范围与时间</span>
            <div className="adv-fields">
              <input
                className="field"
                placeholder="按项目筛选…"
                value={service.projectFilter}
                onChange={(event) => service.setProjectFilter(event.target.value)}
              />
              <input
                className="field"
                placeholder="按会话 ID 筛选…"
                value={service.sessionFilter}
                onChange={(event) => service.setSessionFilter(event.target.value)}
              />
              <input
                className="field"
                placeholder="标签，命中其一…"
                value={service.tagsFilter}
                onChange={(event) => service.setTagsFilter(event.target.value)}
              />
              <input
                className="field time"
                type="datetime-local"
                aria-label="创建于此后"
                value={service.createdAfter}
                onChange={(event) => service.setCreatedAfter(event.target.value)}
              />
              <input
                className="field time"
                type="datetime-local"
                aria-label="创建于此前"
                value={service.createdBefore}
                onChange={(event) => service.setCreatedBefore(event.target.value)}
              />
            </div>
          </div>
        </div>
      ) : null}

      {picked.length > 0 ? (
        <div className="picked-row">
          <span className="label">已选条件</span>
          {picked.map((item) => (
            <button key={item.key} type="button" className="chip picked" onClick={item.clear}>
              {item.label}
              <span className="x">✕</span>
            </button>
          ))}
          <button
            type="button"
            className="clear-all"
            onClick={() => {
              service.setTypeFilter('all');
              service.setProjectFilter('');
              service.setSessionFilter('');
              service.setTagsFilter('');
              service.setCreatedAfter('');
              service.setCreatedBefore('');
              service.setIncludeExpired(false);
            }}
          >
            全部清除
          </button>
        </div>
      ) : null}

      {service.isRecalling ? (
        <p className="recall-hint">
          <Sparkles size={13} strokeWidth={1.6} />
          {service.searching
            ? service.searchMode === 'smart'
              ? '正在精排…'
              : '正在召回…'
            : service.searchMode === 'smart'
              ? `精排结果 · ${service.strategy === 'rrf+rerank' ? 'RRF + rerank' : 'RRF'} · 已带上当前筛选`
              : '召回结果 · 按相关度排序（BM25 + 向量 + RRF）· 已带上当前筛选'}
          <button type="button" className="clear" onClick={() => service.clearSearch()}>
            清除搜索
          </button>
        </p>
      ) : null}

      <ContextPreview />
      <FilterForgetBar />
      <BatchBar />
      <MemoryList />
      <MemoryDrawer />
    </section>
  );
});

export default bindServices(MemoriesPage, [MemoriesService]);
