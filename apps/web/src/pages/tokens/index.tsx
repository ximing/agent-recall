import { bindServices, observer, useService } from '@rabjs/react';
import { TriangleAlert } from 'lucide-react';
import { useEffect } from 'react';
import { formatTime } from '@/utils/format';
import { TokensService } from './tokens.service';
import '@/styles/ledger.css';

const TokensPage = observer(function TokensPage() {
  const service = useService(TokensService);

  useEffect(() => {
    void service.load();
  }, [service]);

  return (
    <section className="page narrow">
      <header className="page-head">
        <div>
          <h1>令牌</h1>
          <p className="desc">钩子、MCP 客户端和脚本都拿令牌访问服务。完整令牌只在创建时出现一次，请立即抄写。</p>
        </div>
      </header>

      {service.freshSecret ? (
        <aside className="secret-banner">
          <p className="sb-title">
            <TriangleAlert size={14} strokeWidth={1.6} />
            完整令牌，仅此一次显示
          </p>
          <p className="sb-value">{service.freshSecret}</p>
          <div className="sb-foot">
            <button type="button" className="btn primary" onClick={() => void service.copySecret()}>
              {service.copied ? '已复制' : '复制'}
            </button>
            <button type="button" className="btn" onClick={() => service.dismissSecret()}>
              我已抄写
            </button>
            <span className="sb-note">关闭后将无法再次查看完整令牌</span>
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
            <h2>访问令牌</h2>
            <p className="sub">按用途命名，吊销立即生效，已发出的令牌无法找回。</p>
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
            placeholder="令牌名称，例如：我的 MacBook"
            value={service.name}
            onChange={(event) => service.setName(event.target.value)}
          />
          <button type="submit" className="btn primary">
            创建令牌
          </button>
        </form>

        {service.tokens.length === 0 ? (
          <div className="empty">
            <p className="empty-title">还没有令牌</p>
            <p>创建一个令牌，用于脚本或 CI 调用召回接口。</p>
          </div>
        ) : (
          <div className="ledger">
            <table>
              <thead>
                <tr>
                  <th>名称</th>
                  <th>预览</th>
                  <th>状态</th>
                  <th>创建时间</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {service.tokens.map((token) => (
                  <tr key={token.id} className={token.revokedAt ? 'revoked' : ''}>
                    <td className="name">{token.name}</td>
                    <td className="mono">{token.preview}</td>
                    <td>
                      {token.revokedAt ? (
                        <span className="status revoked">已吊销</span>
                      ) : (
                        <span className="status ok">有效</span>
                      )}
                    </td>
                    <td className="time">{formatTime(token.createdAt)}</td>
                    <td className="cell-actions">
                      {token.revokedAt ? null : service.pendingRevokeId === token.id ? (
                        <span className="revoke-confirm">
                          <button type="button" className="btn danger" onClick={() => void service.confirmRevoke()}>
                            确认吊销
                          </button>
                          <button type="button" className="btn" onClick={() => service.cancelRevoke()}>
                            取消
                          </button>
                        </span>
                      ) : (
                        <button type="button" className="btn ghost warn" onClick={() => service.askRevoke(token.id)}>
                          吊销
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

export default bindServices(TokensPage, [TokensService]);
