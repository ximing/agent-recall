import { observer, useService } from '@rabjs/react';
import { LlmService } from './llm.service';

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
