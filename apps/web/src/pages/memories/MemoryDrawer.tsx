import { observer, useService } from '@rabjs/react';
import { X } from 'lucide-react';
import { Suspense, lazy, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { MemoriesService } from './memories.service';
import { DrawerView } from './components/drawer-view';
import { VersionHistory } from './components/version-history';
import './drawer.css';

// TipTap + ProseMirror 体积大，仅在打开编辑器时加载
const MemoryEditor = lazy(() =>
  import('@/components/MemoryEditor').then((module) => ({ default: module.MemoryEditor })),
);

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
        {mode === 'view' ? (
          memory ? (
            <DrawerView />
          ) : (
            <>
              <div className="drawer-head">
                <span className="drawer-title">记忆</span>
                <button type="button" className="drawer-close" aria-label="关闭" onClick={() => service.closeDrawer()}>
                  <X size={16} strokeWidth={1.8} />
                </button>
              </div>
              <div className="drawer-body">
                <p className="composer-hint">这条记忆已不在当前结果里。</p>
              </div>
            </>
          )
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
                  {mode === 'edit' ? (
                    <p className="composer-hint" style={{ marginBottom: 12 }}>
                      保存会生成一个新版本，旧版本保留在版本历史中。
                    </p>
                  ) : null}
                  <Suspense fallback={<p className="composer-hint">编辑器加载中…</p>}>
                    <MemoryEditor
                      key={`${mode}:${memory?.id ?? 'new'}`}
                      initialMarkdown={mode === 'edit' ? (memory?.content ?? '') : ''}
                      initialType={mode === 'edit' ? memory?.type : undefined}
                      initialTags={mode === 'edit' ? memory?.tags : undefined}
                      initialExpiresAt={mode === 'edit' ? memory?.expiresAt : undefined}
                      allowPlacement={mode === 'new'}
                      belowMeta={mode === 'edit' ? <VersionHistory /> : null}
                      placeholder="写下一条记忆，支持 Markdown……"
                      submitLabel={mode === 'new' ? '保存记忆' : '保存为新版本'}
                      onSubmit={(markdown, meta) => {
                        if (mode === 'new') void service.create(markdown, meta);
                        else void service.saveEdit(markdown, meta);
                      }}
                      onCancel={() => service.closeDrawer()}
                    />
                  </Suspense>
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
