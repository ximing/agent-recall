import { observer, useService } from '@rabjs/react';
import { History, X } from 'lucide-react';
import { Suspense, lazy, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { DiffView } from '@/components/DiffView';
import { MarkdownView } from '@/components/MarkdownView';
import { formatTime, isExpired } from '@/utils/format';
import { ORIGIN_LABEL, TYPE_LABEL } from '@/utils/labels';
import { MemoriesService } from './memories.service';

// TipTap + ProseMirror 体积大，仅在打开编辑器时加载
const MemoryEditor = lazy(() =>
  import('@/components/MemoryEditor').then((module) => ({ default: module.MemoryEditor })),
);

/** 版本历史折叠区：版本链 + 旧版本内容 / 与前一版的行级 diff */
const VersionHistory = observer(function VersionHistory() {
  const service = useService(MemoriesService);
  const memory = service.activeMemory;
  if (!memory) return null;

  return (
    <div className="vhistory">
      <button type="button" className="vhistory-toggle" onClick={() => void service.toggleVersions()}>
        <History size={13} strokeWidth={1.6} />
        版本历史 · v{memory.version}
        <span className="spacer" />
        {service.versionsOpen ? '收起' : '展开'}
      </button>
      {service.versionsOpen ? (
        <div className="vhistory-body">
          {service.versionsLoading ? (
            <p className="composer-hint">版本加载中…</p>
          ) : service.versions.length <= 1 ? (
            <p className="composer-hint">只有当前一个版本。</p>
          ) : (
            <>
              <ol className="vlist">
                {service.versions.map((version) => (
                  <li key={version.id}>
                    <button
                      type="button"
                      className={`vitem${service.selectedVersionId === version.id ? ' active' : ''}`}
                      onClick={() => service.selectVersion(version.id)}
                    >
                      <span className="vnum">v{version.version}</span>
                      <span className="mrow-time">{formatTime(version.createdAt)}</span>
                      {version.isLatest ? <span className="vcur">当前</span> : null}
                    </button>
                  </li>
                ))}
              </ol>
              {service.selectedVersionPair ? (
                <div className="vdetail">
                  <div className="vdetail-bar">
                    <span className="composer-hint">
                      v{service.selectedVersionPair.current.version}
                      {service.selectedVersionPair.previous
                        ? ` · 对比 v${service.selectedVersionPair.previous.version}`
                        : ' · 首个版本'}
                    </span>
                    <span className="spacer" />
                    {service.selectedVersionPair.previous ? (
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={() => service.setVersionShowDiff(!service.versionShowDiff)}
                      >
                        {service.versionShowDiff ? '查看完整内容' : '查看差异'}
                      </button>
                    ) : null}
                  </div>
                  {service.versionShowDiff && service.selectedVersionPair.previous ? (
                    <DiffView
                      before={service.selectedVersionPair.previous.content}
                      after={service.selectedVersionPair.current.content}
                    />
                  ) : (
                    <MarkdownView content={service.selectedVersionPair.current.content} />
                  )}
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
});

export const MemoryDrawer = observer(function MemoryDrawer() {
  const service = useService(MemoriesService);
  const mode = service.drawerMode;

  useEffect(() => {
    if (mode === 'closed') return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') service.closeDrawer();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [mode, service]);

  if (mode === 'closed') return null;
  const memory = service.activeMemory;

  // Portal 到 body：.page 的入场动画（fill-mode）会让 transform 常驻，
  // fixed 定位会被降级为相对 .page，抽屉无法铺满视口
  return createPortal(
    <>
      <div className="drawer-scrim" onClick={() => service.closeDrawer()} />
      <aside className="drawer" role="dialog" aria-modal="true">
        {mode === 'view' && memory ? (
          <>
            <div className="drawer-head">
              <span className={`mcard-tag ${memory.origin}`}>{ORIGIN_LABEL[memory.origin]}</span>
              <span className="mcard-tag type">{TYPE_LABEL[memory.type]}</span>
              {isExpired(memory.expiresAt) ? <span className="mcard-tag expired">已过期</span> : null}
              <span className="mrow-time">{formatTime(memory.createdAt)}</span>
              <button type="button" className="drawer-close" aria-label="关闭" onClick={() => service.closeDrawer()}>
                <X size={16} strokeWidth={1.8} />
              </button>
            </div>
            <div className="drawer-body">
              {memory.tags.length > 0 || memory.project || memory.sessionId || memory.expiresAt ? (
                <div className="mmeta">
                  {memory.project ? <span className="mini-tag">项目：{memory.project}</span> : null}
                  {memory.sessionId ? <span className="mini-tag mono">会话：{memory.sessionId}</span> : null}
                  {memory.tags.map((tag) => (
                    <span key={tag} className="mini-tag">
                        #{tag}
                    </span>
                  ))}
                  {memory.expiresAt ? (
                    <span className={`mini-tag${isExpired(memory.expiresAt) ? ' danger' : ''}`}>
                      {isExpired(memory.expiresAt) ? '已于' : '将于'} {formatTime(memory.expiresAt)} 过期
                    </span>
                  ) : null}
                  <span className="mini-tag">v{memory.version}</span>
                  {memory.accessCount > 0 ? <span className="mini-tag">召回命中 {memory.accessCount} 次</span> : null}
                </div>
              ) : null}
              <MarkdownView content={memory.content} />
              <VersionHistory />
            </div>
            <div className="drawer-foot">
              {service.pendingDeleteId === memory.id ? (
                <>
                  <span className="drawer-danger-text">确定删除这条记忆？整条版本链都会被删除。</span>
                  <span className="spacer" />
                  <button type="button" className="btn danger" onClick={() => void service.confirmDelete()}>
                    确认删除
                  </button>
                  <button type="button" className="btn" onClick={() => service.cancelDelete()}>
                    取消
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="btn primary" onClick={() => service.openEdit()}>
                    编辑
                  </button>
                  <button type="button" className="btn ghost warn" onClick={() => service.askDelete(memory.id)}>
                    删除
                  </button>
                </>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="drawer-head">
              <span className="drawer-title">{mode === 'new' ? '新建记忆' : '编辑记忆'}</span>
              <button type="button" className="drawer-close" aria-label="关闭" onClick={() => service.closeDrawer()}>
                <X size={16} strokeWidth={1.8} />
              </button>
            </div>
            <div className="drawer-body">
              {mode === 'edit' && !memory ? (
                <p className="composer-hint">这条记忆已不存在。</p>
              ) : (
                <>
                  {mode === 'edit' ? <p className="composer-hint" style={{ marginBottom: 12 }}>保存会生成一个新版本，旧版本保留在版本历史中。</p> : null}
                  <Suspense fallback={<p className="composer-hint">编辑器加载中…</p>}>
                    <MemoryEditor
                      key={`${mode}:${memory?.id ?? 'new'}`}
                      initialMarkdown={mode === 'edit' ? (memory?.content ?? '') : ''}
                      initialType={mode === 'edit' ? memory?.type : undefined}
                      initialTags={mode === 'edit' ? memory?.tags : undefined}
                      initialExpiresAt={mode === 'edit' ? memory?.expiresAt : undefined}
                      placeholder="写下一条记忆，支持 Markdown……"
                      submitLabel={mode === 'new' ? '保存记忆' : '保存为新版本'}
                      onSubmit={(markdown, meta) => {
                        if (mode === 'new') void service.create(markdown, meta);
                        else void service.saveEdit(markdown, meta);
                      }}
                      onCancel={() => service.closeDrawer()}
                    />
                  </Suspense>
                  {mode === 'edit' ? <VersionHistory /> : null}
                </>
              )}
            </div>
          </>
        )}
      </aside>
    </>,
    document.body,
  );
});
