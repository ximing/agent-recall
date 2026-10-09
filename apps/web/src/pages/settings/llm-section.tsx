import { observer, useService } from '@rabjs/react';
import { formatTime } from '@/utils/format';
import { formatCost, LlmService } from './llm.service';

const CAPABILITY_LABEL = { chat: '对话', embed: '向量', rerank: '精排' } as const;

export const LlmSection = observer(function LlmSection() {
  const service = useService(LlmService);
  return (
    <section className="panel setting-section" id="llm">
      <div className="panel-head">
        <h2>大模型</h2>
      </div>
      <p className="section-desc">
        配置后，确认合并记忆时会做语义合并。支持 OpenAI、DeepSeek、Claude、智谱和通义千问。密钥加密存在这台服务上，页面只显示预览。
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void service.create();
        }}
      >
        <div className="setting-form">
          <label>
            <span>提供商</span>
            <select className="field" value={service.provider} onChange={(event) => service.setProvider(event.target.value)}>
              {service.providers.map((provider) => (
                <option key={provider} value={provider}>
                  {service.labels[provider]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>模型</span>
            <input className="field" value={service.model} onChange={(event) => service.setModel(event.target.value)} />
          </label>
          <label className="full">
            <span>接口地址（可空，用默认地址）</span>
            <input
              className="field"
              value={service.baseUrl}
              placeholder={service.basePlaceholder()}
              onChange={(event) => service.setBaseUrl(event.target.value)}
            />
          </label>
          <label className="full">
            <span>API Key</span>
            <input
              className="field"
              type="password"
              autoComplete="new-password"
              value={service.apiKey}
              placeholder="sk-…"
              onChange={(event) => service.setApiKey(event.target.value)}
            />
          </label>
        </div>
        <div className="setting-foot">
          <label className="setting-check">
            <input
              type="checkbox"
              checked={service.makeDefault}
              onChange={(event) => service.setMakeDefault(event.target.checked)}
            />
            设为默认
          </label>
          <button type="submit" className="btn primary" disabled={service.saving}>
            {service.saving ? '保存中…' : '添加模型'}
          </button>
          {service.notice ? <span className="settings-saved">{service.notice}</span> : null}
        </div>
      </form>

      {service.configs.length === 0 ? (
        <div className="empty" style={{ margin: '0 18px 16px' }}>
          <p className="empty-title">还没有模型</p>
          <p>加上一把密钥后，语义合并才会运行。</p>
        </div>
      ) : (
        <div className="ledger">
          <table>
            <thead>
              <tr>
                <th>提供商</th>
                <th>模型</th>
                <th>密钥</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {service.configs.map((config) => (
                <tr key={config.id}>
                  <td>
                    {service.labels[config.provider]}
                    {config.isDefault ? <span className="badge mode-badge on">默认</span> : null}
                  </td>
                  <td className="mono">{config.model}</td>
                  <td className="mono">{config.apiKeyPreview}</td>
                  <td className="cell-actions">
                    {service.pendingDeleteId === config.id ? (
                      <span className="revoke-confirm">
                        <button type="button" className="btn danger" onClick={() => void service.confirmDelete()}>
                          确认删除
                        </button>
                        <button type="button" className="btn" onClick={() => service.cancelDelete()}>
                          取消
                        </button>
                      </span>
                    ) : (
                      <span className="revoke-confirm">
                        {config.isDefault ? null : (
                          <button type="button" className="btn" onClick={() => void service.makeDefaultConfig(config.id)}>
                            设为默认
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn"
                          disabled={service.testingId === config.id}
                          onClick={() => void service.test(config.id)}
                        >
                          {service.testingId === config.id ? '测试中…' : '测试'}
                        </button>
                        <button type="button" className="btn ghost warn" onClick={() => service.askDelete(config.id)}>
                          删除
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
});

export const UsageSection = observer(function UsageSection() {
  const service = useService(LlmService);
  return (
    <section className="panel setting-section" id="cost">
      <div className="panel-head" style={{ alignItems: 'center' }}>
        <h2>调用成本</h2>
        <span className="badge mode-badge">
          <span className="dot" />
          估算 {formatCost(service.totalCost)}
        </span>
      </div>
      <p className="section-desc">
        对话、向量和精排都会记一笔。金额是按公开单价估算的，不是提供商账单。这里不保存提示词。
      </p>
      <div className="summary-strip">
        <div className="sum-item">
          <p className="sum-num">{formatCost(service.totalCost)}</p>
          <p className="sum-label">累计估算</p>
        </div>
        <div className="sum-item">
          <p className="sum-num">{service.totalTokens}</p>
          <p className="sum-label">累计 token</p>
        </div>
        <div className="sum-item">
          <p className="sum-num">{service.logs.length}</p>
          <p className="sum-label">最近记录</p>
        </div>
      </div>
      {service.logs.length === 0 ? (
        <div className="empty" style={{ margin: '0 18px 16px' }}>
          <p className="empty-title">还没有调用</p>
          <p>写入记忆、召回或测试模型之后，这里会出现记录。</p>
        </div>
      ) : (
        <div className="ledger" style={{ marginTop: 12 }}>
          <table>
            <thead>
              <tr>
                <th>能力</th>
                <th>模型</th>
                <th>token</th>
                <th>估算</th>
                <th>时间</th>
              </tr>
            </thead>
            <tbody>
              {service.logs.map((log) => (
                <tr key={log.id}>
                  <td>{CAPABILITY_LABEL[log.capability]}</td>
                  <td className="mono">
                    {log.provider}/{log.model}
                  </td>
                  <td className="time">{log.totalTokens}</td>
                  <td className="time">{formatCost(log.costEstimate)}</td>
                  <td className="time">{formatTime(log.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
});
