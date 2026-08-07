import { bindServices, observer, useService } from '@rabjs/react';
import { useEffect } from 'react';
import { McpService } from './mcp.service';

const McpPage = observer(function McpPage() {
  const service = useService(McpService);

  useEffect(() => {
    void service.load();
  }, [service]);

  return (
    <section className="page">
      <header className="page-head">
        <h1>MCP</h1>
        <p>注册一个客户端，把服务地址和令牌写进本地配置。</p>
      </header>
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          void service.create();
        }}
      >
        <label>
          客户端名称
          <input value={service.name} onChange={(event) => service.setName(event.target.value)} />
        </label>
        <button type="submit" className="primary">
          注册客户端
        </button>
      </form>
      {service.freshConfig ? (
        <aside className="secret-banner">
          <p>服务地址 {service.freshBaseUrl}</p>
          <p>客户端配置（含完整令牌，仅此一次）</p>
          <pre data-field="mcp-config">{service.freshConfig}</pre>
          <button type="button" onClick={() => service.dismissConfig()}>
            我已抄写
          </button>
        </aside>
      ) : null}
      {service.error ? (
        <p className="form-error" role="alert">
          {service.error}
        </p>
      ) : null}
      {service.clients.length === 0 ? <p className="empty">还没有 MCP 客户端</p> : null}
      <ul className="stack">
        {service.clients.map((client) => (
          <li key={client.id} className="card">
            <p className="meta">{client.name}</p>
            <p>
              令牌预览 <span data-field="mcp-token-preview">{client.tokenPreview}</span>
            </p>
            <p>{client.revokedAt ? '已吊销' : '有效'}</p>
            {client.revokedAt ? null : service.pendingRevokeId === client.id ? (
              <div className="row">
                <button type="button" className="danger" onClick={() => void service.confirmRevoke()}>
                  确认吊销
                </button>
                <button type="button" onClick={() => service.cancelRevoke()}>
                  取消
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => service.askRevoke(client.id)}>
                吊销客户端
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
});

export default bindServices(McpPage, [McpService]);
