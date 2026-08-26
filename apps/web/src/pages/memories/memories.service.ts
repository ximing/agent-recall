import type {
  ImportStrategy,
  MemoryFilter,
  MemoryListQuery,
  MemoryPublic,
  MemoryStats,
  MemoryType,
  Origin,
} from '@agent-recall/dto';
import { Service } from '@rabjs/react';
import { api, errorMessage } from '@/api/client';

export type MemorySort = 'created-desc' | 'updated-desc' | 'created-asc';
export type DrawerMode = 'closed' | 'view' | 'new' | 'edit';
export type SearchMode = 'recall' | 'smart';

/** 编辑/新建时除内容外的元数据 */
export type MemoryMetaInput = {
  type?: MemoryType;
  tags?: string[];
  /** null = 清除过期时间（仅编辑时有意义） */
  expiresAt?: string | null;
  project?: string;
  sessionId?: string;
};

function splitTags(raw: string): string[] | undefined {
  const tags = raw
    .split(/[,，]/)
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
  return tags.length > 0 ? tags : undefined;
}

/** datetime-local 没有时区，转成带偏移的 ISO 再交给接口 */
function toOffsetIso(local: string): string | undefined {
  const trimmed = local.trim();
  if (!trimmed) return undefined;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

const PAGE_SIZE = 50;

const SORTERS: Record<MemorySort, (a: MemoryPublic, b: MemoryPublic) => number> = {
  'created-desc': (a, b) => b.createdAt.localeCompare(a.createdAt),
  'updated-desc': (a, b) => b.updatedAt.localeCompare(a.updatedAt),
  'created-asc': (a, b) => a.createdAt.localeCompare(b.createdAt),
};

export class MemoriesService extends Service {
  memories: MemoryPublic[] = [];
  hasMore = false;
  loading = false;
  error: string | null = null;

  stats: MemoryStats | null = null;

  query = '';
  originFilter: Origin | 'all' = 'all';
  typeFilter: MemoryType | 'all' = 'all';
  projectFilter = '';
  sessionFilter = '';
  tagsFilter = '';
  createdAfter = '';
  createdBefore = '';
  includeExpired = false;
  sort: MemorySort = 'created-desc';
  searchMode: SearchMode = 'recall';
  strategy: string | null = null;
  scoreById: Record<string, number> = {};
  private filterTimer: ReturnType<typeof setTimeout> | null = null;

  /** 非 null 表示处于召回模式，按相关度排序 */
  searchResults: MemoryPublic[] | null = null;
  searching = false;
  private recallTimer: ReturnType<typeof setTimeout> | null = null;
  private recallSeq = 0;

  /** 按当前筛选删除 */
  filterPreview: number | null = null;
  filterBusy = false;

  /** 注入预览，与插件 POST /api/hooks/context 同一套裁剪 */
  contextOpen = false;
  contextText = '';
  contextMemoryCount = 0;
  contextNote: string | null = null;
  contextBusy = false;

  /** 抽屉：分享、相关记忆 */
  shareEmail = '';
  shareNote: string | null = null;
  shareBusy = false;
  related: MemoryPublic[] = [];
  relatedLoading = false;
  private relatedSeq = 0;

  drawerMode: DrawerMode = 'closed';
  activeId: string | null = null;
  /** 当前打开的记忆。筛选把新版本滤掉时，抽屉仍用这份，不回退成空编辑器。 */
  opened: MemoryPublic | null = null;
  pendingDeleteId: string | null = null;

  /** 版本历史（抽屉内） */
  versions: MemoryPublic[] = [];
  versionsLoading = false;
  versionsOpen = false;
  selectedVersionId: string | null = null;
  versionShowDiff = true;

  /** 批量选择 / 批量删除 */
  selectedIds: string[] = [];
  batchPreview: number | null = null;
  batchBusy = false;

  /** 导入导出 */
  importOpen = false;
  importStrategy: ImportStrategy = 'skip';
  importResult: string | null = null;
  exporting = false;
  importing = false;

  get originCounts(): Record<Origin | 'all', number> {
    if (this.stats) {
      const by = this.stats.byOrigin;
      return {
        all: this.stats.total,
        web: by.web ?? 0,
        agent: by.agent ?? 0,
        hook: by.hook ?? 0,
        import: by.import ?? 0,
        summary: by.summary ?? 0,
      };
    }
    const counts: Record<Origin | 'all', number> = { all: this.memories.length, web: 0, agent: 0, hook: 0, import: 0, summary: 0 };
    for (const memory of this.memories) counts[memory.origin] += 1;
    return counts;
  }

  get isRecalling(): boolean {
    return this.searchResults !== null;
  }

  get hasActiveFilter(): boolean {
    return (
      this.originFilter !== 'all' ||
      this.typeFilter !== 'all' ||
      this.projectFilter.trim().length > 0 ||
      this.sessionFilter.trim().length > 0 ||
      this.tagsFilter.trim().length > 0 ||
      this.createdAfter.trim().length > 0 ||
      this.createdBefore.trim().length > 0 ||
      this.includeExpired
    );
  }

  get visible(): MemoryPublic[] {
    if (this.searchResults) {
      // 召回已经带上筛选，保持服务端的相关度顺序
      return this.searchResults;
    }
    // 列表模式：筛选已在服务端完成，排序只作用于已加载的页
    return [...this.memories].sort(SORTERS[this.sort]);
  }

  get activeMemory(): MemoryPublic | null {
    if (!this.activeId) return null;
    return (
      this.memories.find((m) => m.id === this.activeId) ??
      this.searchResults?.find((m) => m.id === this.activeId) ??
      (this.opened?.id === this.activeId ? this.opened : null)
    );
  }

  get selectedCount(): number {
    return this.selectedIds.length;
  }

  isSelected(id: string): boolean {
    return this.selectedIds.includes(id);
  }

  /* ---------- 筛选 ---------- */

  setOriginFilter(origin: Origin | 'all'): void {
    this.originFilter = origin;
    this.refreshFilters(true);
  }

  setTypeFilter(type: MemoryType | 'all'): void {
    this.typeFilter = type;
    this.refreshFilters(true);
  }

  setIncludeExpired(value: boolean): void {
    this.includeExpired = value;
    this.refreshFilters(true);
  }

  setProjectFilter(value: string): void {
    this.projectFilter = value;
    this.refreshFilters(false);
  }

  setSessionFilter(value: string): void {
    this.sessionFilter = value;
    this.refreshFilters(false);
  }

  setTagsFilter(value: string): void {
    this.tagsFilter = value;
    this.refreshFilters(false);
  }

  setCreatedAfter(value: string): void {
    this.createdAfter = value;
    this.refreshFilters(true);
  }

  setCreatedBefore(value: string): void {
    this.createdBefore = value;
    this.refreshFilters(true);
  }

  setSearchMode(mode: SearchMode): void {
    if (this.searchMode === mode) return;
    this.searchMode = mode;
    if (this.query.trim()) this.scheduleRecall();
  }

  setSort(sort: MemorySort): void {
    this.sort = sort;
  }

  /** 有搜索词时重跑召回（筛选随请求带上），否则刷新列表 */
  private refreshFilters(immediate: boolean): void {
    this.filterPreview = null;
    const query = this.query.trim();
    if (query) {
      if (immediate) {
        if (this.recallTimer) {
          clearTimeout(this.recallTimer);
          this.recallTimer = null;
        }
        void this.recall(query);
      } else {
        this.scheduleRecall();
      }
      return;
    }
    if (immediate) {
      void this.fetchList(0, false);
      return;
    }
    if (this.filterTimer) clearTimeout(this.filterTimer);
    this.filterTimer = setTimeout(() => void this.fetchList(0, false), 350);
  }

  /* ---------- 搜索（召回） ---------- */

  setQuery(value: string): void {
    this.query = value;
    this.scheduleRecall();
  }

  clearSearch(): void {
    this.query = '';
    this.cancelRecall();
    this.searchResults = null;
    this.searching = false;
    this.strategy = null;
    this.scoreById = {};
    // 召回期间可能写入过新记忆，退出搜索时静默同步一次
    void this.fetchList(0, false);
  }

  private cancelRecall(): void {
    if (this.recallTimer) {
      clearTimeout(this.recallTimer);
      this.recallTimer = null;
    }
    this.recallSeq += 1;
  }

  private scheduleRecall(): void {
    if (this.recallTimer) clearTimeout(this.recallTimer);
    const query = this.query.trim();
    if (!query) {
      this.cancelRecall();
      this.searchResults = null;
      this.searching = false;
      return;
    }
    this.searching = true;
    this.recallTimer = setTimeout(() => void this.recall(query), 350);
  }

  private async recall(query: string): Promise<void> {
    const seq = ++this.recallSeq;
    this.searching = true;
    try {
      const input = { query, limit: 50 as const, filter: this.buildFilter() };
      if (seq !== this.recallSeq || query !== this.query.trim()) return;
      if (this.searchMode === 'smart') {
        const result = await api.smartSearch(input);
        if (seq !== this.recallSeq || query !== this.query.trim()) return;
        this.searchResults = result.memories;
        this.strategy = result.strategy;
        const scores: Record<string, number> = {};
        result.memories.forEach((memory, index) => {
          const score = result.scores[index];
          if (typeof score === 'number') scores[memory.id] = score;
        });
        this.scoreById = scores;
      } else {
        const result = await api.recallMemories(input);
        if (seq !== this.recallSeq || query !== this.query.trim()) return;
        this.searchResults = result.memories;
        this.strategy = 'rrf';
        this.scoreById = {};
      }
    } catch (err) {
      if (seq !== this.recallSeq) return;
      this.error = errorMessage(err, '召回失败');
      this.searchResults = [];
      this.scoreById = {};
    } finally {
      if (seq === this.recallSeq) this.searching = false;
    }
  }

  /* ---------- 抽屉 ---------- */

  openNew(): void {
    this.drawerMode = 'new';
    this.activeId = null;
    this.opened = null;
    this.pendingDeleteId = null;
    this.resetVersions();
  }

  openView(memory: MemoryPublic): void {
    this.drawerMode = 'view';
    this.activeId = memory.id;
    this.opened = memory;
    this.pendingDeleteId = null;
    this.shareEmail = '';
    this.shareNote = null;
    this.resetVersions();
    void this.loadRelations(memory.id);
  }

  openEdit(memory?: MemoryPublic): void {
    if (memory) {
      this.activeId = memory.id;
      this.opened = memory;
    }
    this.drawerMode = 'edit';
    this.pendingDeleteId = null;
    this.resetVersions();
  }

  closeDrawer(): void {
    this.drawerMode = 'closed';
    this.activeId = null;
    this.opened = null;
    this.pendingDeleteId = null;
    this.shareEmail = '';
    this.shareNote = null;
    this.related = [];
    this.relatedSeq += 1;
    this.resetVersions();
  }

  /* ---------- 版本历史 ---------- */

  private resetVersions(): void {
    this.versions = [];
    this.versionsLoading = false;
    this.versionsOpen = false;
    this.selectedVersionId = null;
    this.versionShowDiff = true;
  }

  async toggleVersions(): Promise<void> {
    this.versionsOpen = !this.versionsOpen;
    if (this.versionsOpen && this.versions.length === 0) await this.loadVersions();
  }

  async loadVersions(): Promise<void> {
    if (!this.activeId) return;
    this.versionsLoading = true;
    try {
      const result = await api.listMemoryVersions(this.activeId);
      this.versions = result.versions;
      if (!this.selectedVersionId && result.versions.length > 0) {
        this.selectedVersionId = result.versions[result.versions.length - 1].id;
      }
    } catch (err) {
      this.error = errorMessage(err, '读取版本历史失败');
    } finally {
      this.versionsLoading = false;
    }
  }

  selectVersion(id: string): void {
    this.selectedVersionId = id;
  }

  setVersionShowDiff(value: boolean): void {
    this.versionShowDiff = value;
  }

  /** 选中版本与其前一版（用于 diff），按 version 升序排列 */
  get selectedVersionPair(): { current: MemoryPublic; previous: MemoryPublic | null } | null {
    if (!this.selectedVersionId) return null;
    const index = this.versions.findIndex((v) => v.id === this.selectedVersionId);
    if (index < 0) return null;
    return { current: this.versions[index], previous: index > 0 ? this.versions[index - 1] : null };
  }

  /* ---------- 删除 ---------- */

  askDelete(id: string): void {
    this.pendingDeleteId = id;
  }

  cancelDelete(): void {
    this.pendingDeleteId = null;
  }

  async confirmDelete(): Promise<void> {
    if (!this.pendingDeleteId) return;
    this.error = null;
    try {
      await api.deleteMemory(this.pendingDeleteId);
      if (this.activeId === this.pendingDeleteId) this.closeDrawer();
      this.pendingDeleteId = null;
      await this.load();
    } catch (err) {
      this.error = errorMessage(err, '删除记忆失败');
    }
  }

  /* ---------- 批量删除 ---------- */

  toggleSelect(id: string): void {
    this.selectedIds = this.isSelected(id) ? this.selectedIds.filter((x) => x !== id) : [...this.selectedIds, id];
    this.batchPreview = null;
  }

  clearSelection(): void {
    this.selectedIds = [];
    this.batchPreview = null;
  }

  async previewBatchDelete(): Promise<void> {
    if (this.selectedIds.length === 0) return;
    this.error = null;
    this.batchBusy = true;
    try {
      const result = await api.batchForget({ ids: this.selectedIds, dryRun: true });
      this.batchPreview = result.matched;
    } catch (err) {
      this.error = errorMessage(err, '预览批量删除失败');
    } finally {
      this.batchBusy = false;
    }
  }

  cancelBatchPreview(): void {
    this.batchPreview = null;
  }

  async confirmBatchDelete(): Promise<void> {
    if (this.selectedIds.length === 0) return;
    this.error = null;
    this.batchBusy = true;
    try {
      await api.batchForget({ ids: this.selectedIds });
      this.clearSelection();
      await this.load();
    } catch (err) {
      this.error = errorMessage(err, '批量删除失败');
    } finally {
      this.batchBusy = false;
    }
  }

  /* ---------- 导入导出 ---------- */

  setImportOpen(open: boolean): void {
    this.importOpen = open;
    if (!open) this.importResult = null;
  }

  setImportStrategy(strategy: ImportStrategy): void {
    this.importStrategy = strategy;
  }

  async exportAll(): Promise<void> {
    this.error = null;
    this.exporting = true;
    try {
      const result = await api.exportMemories();
      const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `agent-recall-export-${result.exportedAt.slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      this.error = errorMessage(err, '导出失败');
    } finally {
      this.exporting = false;
    }
  }

  async importFile(file: File): Promise<void> {
    this.error = null;
    this.importResult = null;
    this.importing = true;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      // 兼容导出格式 { memories: [...] } 与裸数组
      const memories = Array.isArray(parsed)
        ? parsed
        : (parsed as { memories?: unknown[] }).memories;
      if (!Array.isArray(memories)) {
        this.error = '文件格式不正确：需要导出产生的 JSON（含 memories 数组）';
        return;
      }
      const result = await api.importMemories({
        memories: memories as never,
        strategy: this.importStrategy,
      });
      this.importResult = `导入 ${result.imported} 条，跳过 ${result.skipped} 条，替换 ${result.replaced} 条`;
      await this.load();
    } catch (err) {
      this.error = err instanceof SyntaxError ? '文件不是合法的 JSON' : errorMessage(err, '导入失败');
    } finally {
      this.importing = false;
    }
  }

  /* ---------- 列表 / 统计 ---------- */

  private buildFilter(): MemoryFilter | undefined {
    const filter: MemoryFilter = {};
    if (this.originFilter !== 'all') filter.origin = [this.originFilter];
    if (this.typeFilter !== 'all') filter.type = [this.typeFilter];
    const project = this.projectFilter.trim();
    const sessionId = this.sessionFilter.trim();
    const tags = splitTags(this.tagsFilter);
    const createdAfter = toOffsetIso(this.createdAfter);
    const createdBefore = toOffsetIso(this.createdBefore);
    if (project) filter.project = project;
    if (sessionId) filter.sessionId = sessionId;
    if (tags) filter.tags = tags;
    if (createdAfter) filter.createdAfter = createdAfter;
    if (createdBefore) filter.createdBefore = createdBefore;
    if (this.includeExpired) filter.includeExpired = true;
    return Object.keys(filter).length > 0 ? filter : undefined;
  }

  private buildQuery(offset: number): MemoryListQuery {
    return {
      limit: PAGE_SIZE,
      offset,
      ...this.buildFilter(),
    };
  }

  private async fetchList(offset: number, append: boolean): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      const result = await api.listMemories(this.buildQuery(offset));
      this.memories = append ? [...this.memories, ...result.memories] : result.memories;
      this.hasMore = result.memories.length >= PAGE_SIZE;
      if (!append) this.clearSelection();
    } catch (err) {
      this.error = errorMessage(err, '读取记忆失败');
    } finally {
      this.loading = false;
    }
  }

  async loadMore(): Promise<void> {
    if (this.loading || !this.hasMore || this.isRecalling) return;
    await this.fetchList(this.memories.length, true);
  }

  async loadStats(): Promise<void> {
    try {
      const result = await api.getMemoryStats();
      this.stats = result.stats;
    } catch {
      // 统计失败不阻塞列表
    }
  }

  async load(): Promise<void> {
    await Promise.all([this.fetchList(0, false), this.loadStats()]);
  }

  /* ---------- 新建 / 编辑 ---------- */

  async create(content: string, meta: MemoryMetaInput): Promise<void> {
    this.error = null;
    if (!content.trim()) return;
    try {
      await api.createMemory({
        content,
        type: meta.type,
        tags: meta.tags?.length ? meta.tags : undefined,
        project: meta.project?.trim() || undefined,
        sessionId: meta.sessionId?.trim() || undefined,
        expiresAt: meta.expiresAt ?? undefined,
      });
      this.closeDrawer();
      await this.load();
    } catch (err) {
      this.error = errorMessage(err, '保存记忆失败');
    }
  }

  async saveEdit(content: string, meta: MemoryMetaInput): Promise<void> {
    if (!this.activeId) return;
    this.error = null;
    if (!content.trim()) {
      this.error = '记忆内容不能为空';
      return;
    }
    try {
      // 编辑 = 产生新版本
      await api.updateMemory(this.activeId, {
        content,
        type: meta.type,
        tags: meta.tags,
        expiresAt: meta.expiresAt,
      });
      this.closeDrawer();
      await this.load();
    } catch (err) {
      this.error = errorMessage(err, '更新记忆失败');
    }
  }

  /* ---------- 按筛选删除 ---------- */

  async previewFilterForget(): Promise<void> {
    const filter = this.buildFilter();
    if (!filter) {
      this.error = '先选一个筛选条件';
      return;
    }
    this.error = null;
    this.filterBusy = true;
    try {
      const result = await api.batchForget({ filter, dryRun: true });
      this.filterPreview = result.matched;
    } catch (err) {
      this.error = errorMessage(err, '预览筛选删除失败');
    } finally {
      this.filterBusy = false;
    }
  }

  cancelFilterForget(): void {
    this.filterPreview = null;
  }

  async confirmFilterForget(): Promise<void> {
    const filter = this.buildFilter();
    if (!filter) return;
    this.error = null;
    this.filterBusy = true;
    try {
      await api.batchForget({ filter });
      this.filterPreview = null;
      this.clearSearch();
      await this.load();
    } catch (err) {
      this.error = errorMessage(err, '按筛选删除失败');
    } finally {
      this.filterBusy = false;
    }
  }

  /* ---------- 注入预览 ---------- */

  async previewContext(): Promise<void> {
    const query = this.query.trim();
    this.contextOpen = true;
    if (!query) {
      this.contextText = '';
      this.contextMemoryCount = 0;
      this.contextNote = '先在搜索框写一句要注入的问题。';
      return;
    }
    this.contextBusy = true;
    this.contextNote = null;
    this.error = null;
    try {
      const result = await api.previewContext({
        query,
        tokenBudget: 2000,
        project: this.projectFilter.trim() || undefined,
      });
      this.contextText = result.context;
      this.contextMemoryCount = result.memories.length;
      this.contextNote = result.context ? null : '没有可注入的记忆。钩子碎片不参与注入。';
    } catch (err) {
      this.error = errorMessage(err, '预览注入失败');
    } finally {
      this.contextBusy = false;
    }
  }

  closeContext(): void {
    this.contextOpen = false;
  }

  /* ---------- 分享 / 相关 / 草图转正 ---------- */

  setShareEmail(value: string): void {
    this.shareEmail = value;
  }

  async shareActive(): Promise<void> {
    if (!this.activeId) return;
    const email = this.shareEmail.trim();
    if (!email) {
      this.error = '填写对方的邮箱';
      return;
    }
    this.shareBusy = true;
    this.shareNote = null;
    this.error = null;
    try {
      await api.shareMemory(this.activeId, email);
      this.shareNote = `已复制给 ${email}。对方库里会多一条带 shared 标签的记忆。`;
    } catch (err) {
      this.error = errorMessage(err, '分享失败');
    } finally {
      this.shareBusy = false;
    }
  }

  async loadRelations(id: string): Promise<void> {
    const seq = ++this.relatedSeq;
    this.relatedLoading = true;
    this.related = [];
    try {
      const result = await api.memoryRelations(id);
      if (seq !== this.relatedSeq) return;
      this.related = result.related;
    } catch (err) {
      if (seq !== this.relatedSeq) return;
      this.error = errorMessage(err, '读取相关记忆失败');
    } finally {
      if (seq === this.relatedSeq) this.relatedLoading = false;
    }
  }

  async promoteSketch(): Promise<void> {
    const memory = this.activeMemory;
    if (!memory || !memory.tags.includes('sketch')) return;
    this.error = null;
    try {
      const result = await api.updateMemory(memory.id, {
        content: memory.content,
        type: memory.type,
        tags: memory.tags.filter((tag) => tag !== 'sketch'),
        expiresAt: null,
      });
      this.opened = result.memory;
      this.activeId = result.memory.id;
      this.drawerMode = 'view';
      await this.load();
      if (this.query.trim()) await this.recall(this.query.trim());
      void this.loadRelations(result.memory.id);
    } catch (err) {
      this.error = errorMessage(err, '草图转正失败');
    }
  }
}
