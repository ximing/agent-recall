import { observer, useService } from '@rabjs/react';
import { History } from 'lucide-react';
import { DiffView } from '@/components/DiffView';
import { MarkdownView } from '@/components/MarkdownView';
import { formatTime } from '@/utils/format';
import { MemoriesService } from '../memories.service';

/** 版本历史折叠区：版本链 + 旧版本内容 / 与前一版的行级 diff */
export const VersionHistory = observer(function VersionHistory() {
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
