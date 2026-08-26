import { observer, useService } from '@rabjs/react';
import { X } from 'lucide-react';
import { MarkdownView } from '@/components/MarkdownView';
import { formatTime, isExpired } from '@/utils/format';
import { ORIGIN_LABEL, TYPE_LABEL } from '@/utils/labels';
import { MemoriesService } from '../memories.service';
import { VersionHistory } from './version-history';

export const DrawerView = observer(function DrawerView() {
  const service = useService(MemoriesService);
  const memory = service.activeMemory;
  if (!memory) return null;

  return (
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
          ) : (
            <span className="mini-tag">不过期</span>
          )}
          <span className="mini-tag">{memory.isLatest ? `最新版 v${memory.version}` : `历史版 v${memory.version}`}</span>
          <span className="mini-tag">召回命中 {memory.accessCount} 次</span>
          {memory.lastAccessedAt ? <span className="mini-tag">最近命中 {formatTime(memory.lastAccessedAt)}</span> : null}
        </div>
        <MarkdownView content={memory.content} />
        {memory.tags.includes('sketch') ? (
          <div className="drawer-extra">
            <p className="composer-hint">这是一条草图，带有 sketch 标签。转正会去掉该标签并清除过期时间，同时生成新版本。</p>
            <button type="button" className="btn" onClick={() => void service.promoteSketch()}>
              草图转正
            </button>
          </div>
        ) : null}
        <div className="drawer-extra">
          <p style={{ fontWeight: 500 }}>分享给队友</p>
          <p className="composer-hint">复制一份到对方的库，并打上 shared 标签。隐私片段会先被抹掉。</p>
          <form
            style={{ display: 'flex', gap: 8, marginTop: 10 }}
            onSubmit={(event) => {
              event.preventDefault();
              void service.shareActive();
            }}
          >
            <input
              className="field"
              type="email"
              placeholder="对方邮箱"
              value={service.shareEmail}
              onChange={(event) => service.setShareEmail(event.target.value)}
            />
            <button type="submit" className="btn" disabled={service.shareBusy}>
              {service.shareBusy ? '分享中…' : '分享'}
            </button>
          </form>
          {service.shareNote ? <p className="settings-saved">{service.shareNote}</p> : null}
        </div>
        <div className="drawer-extra">
          <p style={{ fontWeight: 500 }}>相关记忆</p>
          {service.relatedLoading ? (
            <p className="composer-hint">正在按标签、项目、会话和类型找重叠…</p>
          ) : service.related.length === 0 ? (
            <p className="composer-hint">没有共享这些维度的其他记忆。</p>
          ) : (
            <ul className="related-list">
              {service.related.map((item) => (
                <li key={item.id}>
                  <button type="button" className="related-btn" onClick={() => service.openView(item)}>
                    <span className="mcard-tag type">{TYPE_LABEL[item.type]}</span>
                    <span>{item.content.replace(/\s+/g, ' ').trim().slice(0, 80)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
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
              {memory.type === 'lesson' ? '删除经验' : '删除'}
            </button>
          </>
        )}
      </div>
    </>
  );
});
