import { bindServices, observer, useService } from '@rabjs/react';
import { TriangleAlert } from 'lucide-react';
import { useEffect } from 'react';
import { formatTime } from '@/utils/format';
import { TokensService } from './tokens.service';

const TokensPage = observer(function TokensPage() {
  const service = useService(TokensService);

  useEffect(() => {
    void service.load();
  }, [service]);

  return (
    <section className="page">
      <header className="page-head">
        <h1>令牌</h1>
        <p className="desc">完整令牌只在创建时出现一次，请立即抄写。列表里只保留预览。</p>
      </header>

      <form
        className="panel create-row"
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

      {service.tokens.length === 0 ? (
        <div className="empty">
          <p className="empty-title">还没有令牌</p>
          <p>创建一个令牌，用于脚本或 CI 调用召回接口。</p>
        </div>
      ) : (
        <div className="panel ledger">
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
                  <td>
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
    </section>
  );
});

export default bindServices(TokensPage, [TokensService]);
