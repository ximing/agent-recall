import { bindServices, observer, useService } from '@rabjs/react';
import { Fragment, useEffect, useState } from 'react';
import { formatTime } from '@/utils/format';
import { SettingsService } from './settings.service';
import './settings.css';
import '@/styles/ledger.css';

const ANCHORS = [
  { id: 'rerank', label: '召回精排' },
  { id: 'maintain', label: '记忆维护' },
  { id: 'history', label: '召回历史' },
] as const;

const SettingsPage = observer(function SettingsPage() {
  const service = useService(SettingsService);
  const [activeAnchor, setActiveAnchor] = useState<string>('rerank');

  useEffect(() => {
    void service.load();
  }, [service]);

  const settings = service.settings;

  return (
    <section className="page flush">
      <header className="page-head">
        <div>
          <h1>设置</h1>
          <p className="desc">检索策略、自动遗忘与召回历史。改动即时生效，不需要重启服务。</p>
        </div>
      </header>

      {service.error ? (
        <p className="form-error" role="alert">
          {service.error}
        </p>
      ) : null}

      <div className="settings-split">
        <nav className="anchor-nav" aria-label="设置分节">
          {ANCHORS.map((anchor) => (
            <a
              key={anchor.id}
              href={`#${anchor.id}`}
              className={activeAnchor === anchor.id ? 'active' : ''}
              onClick={() => setActiveAnchor(anchor.id)}
            >
              {anchor.label}
            </a>
          ))}
        </nav>

        <div>
          {/* 召回精排 */}
          <section className="panel setting-section" id="rerank">
            <div className="panel-head" style={{ alignItems: 'center' }}>
              <h2>召回精排</h2>
              <span className={`badge mode-badge${settings?.rerankEnabled ? ' on' : ''}`}>
                <span className="dot" />
                {settings?.rerankEnabled ? `RRF + ${settings.rerankModel} 精排` : 'RRF 融合排序'}
              </span>
            </div>
            <p className="section-desc">
              默认走 BM25 + 向量双路召回，RRF 融合排序。启用后，融合候选会再交给 rerank 模型精排，失败时自动回退 RRF 顺序。
            </p>

            <div className="setting-row">
              <div>
                <p className="setting-label">启用 rerank 精排</p>
                <p className="setting-hint">阿里云百炼（DashScope）text-rerank 接口</p>
              </div>
              <div className="control">
                <button
                  type="button"
                  role="switch"
                  aria-checked={service.rerankEnabled}
                  className={`switch${service.rerankEnabled ? ' on' : ''}`}
                  onClick={() => service.setRerankEnabled(!service.rerankEnabled)}
                >
                  <span className="switch-knob" />
                </button>
              </div>
            </div>

            {service.rerankEnabled ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void service.save();
                }}
              >
                <div className="setting-form">
                  <label>
                    <span>服务地址</span>
                    <input
                      className="field"
                      value={service.rerankBaseUrl}
                      onChange={(event) => service.setRerankBaseUrl(event.target.value)}
                      placeholder="https://dashscope.aliyuncs.com/api/v1"
                    />
                  </label>
                  <label>
                    <span>模型</span>
                    <input
                      className="field"
                      value={service.rerankModel}
                      onChange={(event) => service.setRerankModel(event.target.value)}
                      placeholder="gte-rerank-v2"
                    />
                  </label>
                  <label className="full">
                    <span>API Key</span>
                    <input
                      className="field"
                      type="password"
                      autoComplete="new-password"
                      value={service.rerankApiKey}
                      onChange={(event) => service.setRerankApiKey(event.target.value)}
                      placeholder={
                        settings?.hasRerankApiKey ? `已保存 ${settings.rerankApiKeyPreview}，留空保持不变` : 'sk-…'
                      }
                    />
                  </label>
                </div>
                <div className="setting-foot">
                  <button type="submit" className="btn primary" disabled={service.saving || !service.dirty}>
                    {service.saving ? '保存中…' : '保存设置'}
                  </button>
                  {settings?.hasRerankApiKey ? (
                    <button type="button" className="btn ghost warn" onClick={() => void service.clearApiKey()}>
                      清除已保存的 Key
                    </button>
                  ) : null}
                  {service.saved ? <span className="settings-saved">已保存</span> : null}
                </div>
              </form>
            ) : (
              <div className="setting-foot">
                <button
                  type="button"
                  className="btn primary"
                  disabled={service.saving || !service.dirty}
                  onClick={() => void service.save()}
                >
                  {service.saving ? '保存中…' : '保存设置'}
                </button>
                {service.saved ? <span className="settings-saved">已保存</span> : null}
              </div>
            )}
          </section>

          {/* 记忆维护 */}
          <section className="panel setting-section" id="maintain">
            <div className="panel-head" style={{ alignItems: 'center' }}>
              <h2>记忆维护</h2>
              <span className={`badge mode-badge${settings && settings.autoForgetDays > 0 ? ' on' : ''}`}>
                <span className="dot" />
                {settings && settings.autoForgetDays > 0 ? `自动遗忘 ${settings.autoForgetDays} 天` : '自动遗忘已禁用'}
              </span>
            </div>
            <p className="section-desc">
              钩子碎片（hook 来源）超过设定天数且从未被召回命中，会被自动清除。填 0 表示禁用；过期记忆不受此开关影响，始终会被清理。
            </p>

            <div className="setting-row">
              <div>
                <p className="setting-label">自动遗忘天数</p>
                <p className="setting-hint">0 = 禁用；范围 0 ~ 365 天</p>
              </div>
              <div className="control">
                <input
                  className="field"
                  type="number"
                  min={0}
                  max={365}
                  value={service.autoForgetDays}
                  onChange={(event) => service.setAutoForgetDays(event.target.value)}
                />
                <span className="composer-hint">天</span>
              </div>
            </div>

            <div className="setting-foot">
              <button type="button" className="btn primary" disabled={service.saving || !service.dirty} onClick={() => void service.save()}>
                {service.saving ? '保存中…' : '保存设置'}
              </button>
              {service.saved ? <span className="settings-saved">已保存</span> : null}
            </div>

            <div className="setting-row">
              <div>
                <p className="setting-label">立即执行自动遗忘</p>
                <p className="setting-hint">先预览将清除的数量，确认后才真正删除</p>
              </div>
              <div className="control">
                {service.afPreview === null ? (
                  <button type="button" className="btn" disabled={service.afBusy} onClick={() => void service.previewAutoForget()}>
                    {service.afBusy ? '检查中…' : '立即执行'}
                  </button>
                ) : (
                  <span className="revoke-confirm">
                    <button type="button" className="btn danger" disabled={service.afBusy} onClick={() => void service.confirmAutoForget()}>
                      {service.afBusy ? '执行中…' : '确认清除'}
                    </button>
                    <button type="button" className="btn" onClick={() => service.cancelAutoForget()}>
                      取消
                    </button>
                  </span>
                )}
              </div>
            </div>
            {service.afPreview !== null ? (
              <p className="section-desc" style={{ paddingBottom: 14 }}>
                预览：过期 {service.afPreview.expired} 条，长期未命中 {service.afPreview.stale} 条，共将删除{' '}
                {service.afPreview.deleted} 条。
              </p>
            ) : null}
            {service.afResult !== null ? (
              <p className="settings-saved" style={{ padding: '0 18px 14px', display: 'block' }}>
                已清除 {service.afResult.deleted} 条（过期 {service.afResult.expired}，未命中 {service.afResult.stale}）。
              </p>
            ) : null}
          </section>

          {/* 召回历史 */}
          <section className="panel setting-section" id="history">
            <div className="panel-head" style={{ alignItems: 'center' }}>
              <h2>召回历史</h2>
              <span className="badge mode-badge">
                <span className="dot" />
                保留近 30 天
              </span>
            </div>
            <p className="section-desc">每次召回的查询、策略、返回结果和耗时都会记录下来，点击行展开返回结果详情。</p>
            {service.recallLogs.length === 0 ? (
              <div className="empty" style={{ margin: '14px 18px 16px' }}>
                <p className="empty-title">还没有召回记录</p>
                <p>在记忆页搜索一次，或让代理发起召回，这里就会出现记录。</p>
              </div>
            ) : (
              <>
                <div className="summary-strip">
                  <div className="sum-item">
                    <p className="sum-num">{service.logSummary.total}</p>
                    <p className="sum-label">总召回次数</p>
                  </div>
                  <div className="sum-item">
                    <p className="sum-num">{service.logSummary.rerankRate}%</p>
                    <p className="sum-label">rerank 使用率</p>
                  </div>
                  <div className="sum-item">
                    <p className="sum-num">{service.logSummary.avgLatency} ms</p>
                    <p className="sum-label">平均延迟</p>
                  </div>
                  <div className="sum-item">
                    <p className={`sum-num${service.logSummary.rerankFailed > 0 ? ' bad' : ''}`}>
                      {service.logSummary.rerankFailed}
                    </p>
                    <p className="sum-label">rerank 失败</p>
                  </div>
                </div>
                <div className="ledger" style={{ marginTop: 12 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>查询</th>
                        <th>策略</th>
                        <th>结果</th>
                        <th>耗时</th>
                        <th>时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      {service.recallLogs.map((log) => {
                        const expanded = service.expandedLogId === log.id;
                        return (
                          <Fragment key={log.id}>
                            <tr className={`log-row${expanded ? ' expanded' : ''}`} onClick={() => service.toggleLog(log.id)}>
                              <td className="log-query">{log.query}</td>
                              <td>
                                {log.strategy === 'rrf+rerank' ? (
                                  <span
                                    className={`badge mode-badge${log.rerankApplied ? ' on' : ''}`}
                                    title={log.rerankApplied ? undefined : '精排失败，回退 RRF'}
                                  >
                                    <span className="dot" />
                                    {log.rerankApplied ? log.rerankModel : '精排失败 · RRF'}
                                  </span>
                                ) : (
                                  <span className="badge mode-badge">
                                    <span className="dot" />
                                    RRF
                                  </span>
                                )}
                              </td>
                              <td className="time">{log.resultCount} 条</td>
                              <td className="time">{log.latencyMs} ms</td>
                              <td className="time">{formatTime(log.createdAt)}</td>
                            </tr>
                            {expanded ? (
                              <tr className="log-detail">
                                <td colSpan={5}>
                                  {log.rerankError ? <p className="log-rerank-error">精排失败：{log.rerankError}</p> : null}
                                  {log.results.length === 0 ? (
                                    <p className="log-empty">本次召回没有返回结果</p>
                                  ) : (
                                    <ol className="log-results">
                                      {log.results.map((result, index) => (
                                        <li key={result.id}>
                                          <span className="log-rank">{index + 1}</span>
                                          <span className="log-content">{result.content}</span>
                                          {result.score !== null ? (
                                            <span className="log-score" title="精排相关度分数">
                                              {result.score.toFixed(3)}
                                            </span>
                                          ) : null}
                                        </li>
                                      ))}
                                    </ol>
                                  )}
                                </td>
                              </tr>
                            ) : null}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </section>
  );
});

export default bindServices(SettingsPage, [SettingsService]);
