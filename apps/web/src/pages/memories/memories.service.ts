import type {
  ImportStrategy,
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

/** 编辑/新建时除内容外的元数据 */
export type MemoryMetaInput = {
  type?: MemoryType;
  tags?: string[];
  /** null = 清除过期时间（仅编辑时有意义） */
  expiresAt?: string | null;
};

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
  includeExpired = false;
  sort: MemorySort = 'created-desc';
  private filterTimer: ReturnType<typeof setTimeout> | null = null;

  /** 非 null 表示处于召回模式，按相关度排序 */
  searchResults: MemoryPublic[] | null = null;
  searching = false;
  private recallTimer: ReturnType<typeof setTimeout> | null = null;
  private recallSeq = 0;

  drawerMode: DrawerMode = 'closed';
  activeId: string | null = null;
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
      this.includeExpired
    );
  }

  get visible(): MemoryPublic[] {
    if (this.searchResults) {
      // 召回结果保持相关度顺序，来源/类型筛选在客户端叠加
      return this.searchResults.filter(
        (m) =>
          (this.originFilter === 'all' || m.origin === this.originFilter) &&
          (this.typeFilter === 'all' || m.type === this.typeFilter),
      );
    }
    // 列表模式：筛选已在服务端完成，排序只作用于已加载的页
    return [...this.memories].sort(SORTERS[this.sort]);
  }

  get activeMemory(): MemoryPublic | null {
    if (!this.activeId) return null;
    return (
      this.memories.find((m) => m.id === this.activeId) ??
      this.searchResults?.find((m) => m.id === this.activeId) ??
      null
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
    if (!this.isRecalling) void this.fetchList(0, false);
  }

  setTypeFilter(type: MemoryType | 'all'): void {
    this.typeFilter = type;
    if (!this.isRecalling) void this.fetchList(0, false);
  }

  setIncludeExpired(value: boolean): void {
    this.includeExpired = value;
    if (!this.isRecalling) void this.fetchList(0, false);
  }

  setProjectFilter(value: string): void {
    this.projectFilter = value;
    this.scheduleReload();
  }

  setSessionFilter(value: string): void {
    this.sessionFilter = value;
    this.scheduleReload();
  }

  setSort(sort: MemorySort): void {
    this.sort = sort;
  }

  private scheduleReload(): void {
    if (this.isRecalling) return;
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
    try {
      const result = await api.recallMemories(query);
      if (seq !== this.recallSeq || query !== this.query.trim()) return;
      this.searchResults = result.memories;
    } catch (err) {
      if (seq !== this.recallSeq) return;
      this.error = errorMessage(err, '召回失败');
      this.searchResults = [];
    } finally {
      if (seq === this.recallSeq) this.searching = false;
    }
  }

  /* ---------- 抽屉 ---------- */

  openNew(): void {
    this.drawerMode = 'new';
    this.activeId = null;
    this.pendingDeleteId = null;
    this.resetVersions();
  }

  openView(memory: MemoryPublic): void {
    this.drawerMode = 'view';
    this.activeId = memory.id;
    this.pendingDeleteId = null;
    this.resetVersions();
  }

  openEdit(memory?: MemoryPublic): void {
    if (memory) this.activeId = memory.id;
    this.drawerMode = 'edit';
    this.pendingDeleteId = null;
    this.resetVersions();
  }

  closeDrawer(): void {
    this.drawerMode = 'closed';
    this.activeId = null;
    this.pendingDeleteId = null;
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

  private buildQuery(offset: number): MemoryListQuery {
    return {
      limit: PAGE_SIZE,
      offset,
      origin: this.originFilter === 'all' ? undefined : [this.originFilter],
      type: this.typeFilter === 'all' ? undefined : [this.typeFilter],
      project: this.projectFilter.trim() || undefined,
      sessionId: this.sessionFilter.trim() || undefined,
      includeExpired: this.includeExpired || undefined,
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
}
