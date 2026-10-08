import { bindServices, observer, useService } from '@rabjs/react';
import { TriangleAlert } from 'lucide-react';
import { useEffect } from 'react';
import { formatTime } from '@/utils/format';
import { McpService } from './mcp.service';
import '@/styles/ledger.css';

const McpPage = observer(function McpPage() {
  const service = useService(McpService);

  useEffect(() => {
    void service.load();
  }, [service]);

  return (
    <section className="page narrow">
      <header className="page-head">
        <div>
          <h1>MCP 客户端</h1>
          <p className="desc">
            注册一个客户端，令牌只显示一次。远程 HTTPS 不用安装包，没有本机文件工具。本机 stdio 用 npx，full 档多三个本机文件工具。
          </p>
        </div>
      </header>

      {service.freshConfig ? (
        <aside className="secret-banner">
          <p className="sb-title">
            <TriangleAlert size={14} strokeWidth={1.6} />
            客户端配置（含完整令牌，仅此一次）
          </p>
          {service.freshBaseUrl ? (
            <p className="sb-base">
              服务地址 <code>{service.freshBaseUrl}</code>
            </p>
          ) : null}
          <p className="sb-label">远程 HTTPS</p>
          <p className="sb-hint">把地址交给支持 HTTP MCP 的客户端。不含 memory_compress_file、memory_claude_bridge_sync、memory_obsidian_export。要缩小工具面，在地址后加 ?profile=core 或 standard。</p>
          <pre className="sb-value">{service.freshRemoteConfig}</pre>
          <div className="sb-foot">
            <button type="button" className="btn primary" onClick={() => void service.copyConfig('remote')}>
              {service.copied === 'remote' ? '已复制' : '复制远程配置'}
            </button>
          </div>
          <p className="sb-label">本机 stdio</p>
          <p className="sb-hint">需要 Node.js 22。npx 拉起官方包，本机文件工具在本地执行，其余工具转发到这台服务。</p>
          <pre className="sb-value">{service.freshConfig}</pre>
          <div className="sb-foot">
            <button type="button" className="btn" onClick={() => void service.copyConfig('stdio')}>
              {service.copied === 'stdio' ? '已复制' : '复制 stdio 配置'}
            </button>
            <button type="button" className="btn" onClick={() => service.dismissConfig()}>
              我已抄写
            </button>
          </div>
        </aside>
      ) : null}

      {service.error ? (
        <p className="form-error" role="alert">
          {service.error}
        </p>
      ) : null}

      <div className="panel ledger-card">
        <div className="panel-head">
          <div>
            <h2>已注册客户端</h2>
            <p className="sub">吊销后对应令牌立即失效。</p>
          </div>
        </div>
        <form
          className="create-line"
          onSubmit={(event) => {
            event.preventDefault();
            void service.create();
          }}
        >
          <input
            className="field"
            placeholder="客户端名称，例如：Claude Desktop"
            value={service.name}
            onChange={(event) => service.setName(event.target.value)}
          />
          <button type="submit" className="btn primary">
            注册客户端
          </button>
        </form>

        {service.clients.length === 0 ? (
          <div className="empty">
            <p className="empty-title">还没有 MCP 客户端</p>
            <p>注册一个客户端，让 Claude Code、Claude Desktop 等代理连上召回。</p>
          </div>
        ) : (
          <div className="ledger">
            <table>
              <thead>
                <tr>
                  <th>客户端</th>
                  <th>令牌预览</th>
                  <th>状态</th>
                  <th>注册时间</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {service.clients.map((client) => (
                  <tr key={client.id} className={client.revokedAt ? 'revoked' : ''}>
                    <td className="name">{client.name}</td>
                    <td className="mono">{client.tokenPreview}</td>
                    <td>
                      {client.revokedAt ? (
                        <span className="status revoked">已吊销</span>
                      ) : (
                        <span className="status ok">有效</span>
                      )}
                    </td>
                    <td className="time">{formatTime(client.createdAt)}</td>
                    <td className="cell-actions">
                      {client.revokedAt ? null : service.pendingRevokeId === client.id ? (
                        <span className="revoke-confirm">
                          <button type="button" className="btn danger" onClick={() => void service.confirmRevoke()}>
                            确认吊销
                          </button>
                          <button type="button" className="btn" onClick={() => service.cancelRevoke()}>
                            取消
                          </button>
                        </span>
                      ) : (
                        <button type="button" className="btn ghost warn" onClick={() => service.askRevoke(client.id)}>
                          吊销客户端
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
});

export default bindServices(McpPage, [McpService]);
