import { bindServices, observer, useService } from '@rabjs/react';
import { useEffect } from 'react';
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
        <p>完整令牌只在创建时出现一次。列表里只保留预览。</p>
      </header>
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          void service.create();
        }}
      >
        <label>
          名称
          <input value={service.name} onChange={(event) => service.setName(event.target.value)} />
        </label>
        <button type="submit" className="primary">
          创建令牌
        </button>
      </form>
      {service.freshSecret ? (
        <aside className="secret-banner">
          <p>完整令牌（仅此一次）</p>
          <p className="secret" data-field="token-secret">
            {service.freshSecret}
          </p>
          <button type="button" onClick={() => service.dismissSecret()}>
            我已抄写
          </button>
        </aside>
      ) : null}
      {service.error ? (
        <p className="form-error" role="alert">
          {service.error}
        </p>
      ) : null}
      {service.tokens.length === 0 ? <p className="empty">还没有令牌</p> : null}
      <ul className="stack">
        {service.tokens.map((token) => (
          <li key={token.id} className="card">
            <p className="meta">{token.name}</p>
            <p>
              预览 <span data-field="token-preview">{token.preview}</span>
            </p>
            <p>{token.revokedAt ? '已吊销' : '有效'}</p>
            {token.revokedAt ? null : service.pendingRevokeId === token.id ? (
              <div className="row">
                <button type="button" className="danger" onClick={() => void service.confirmRevoke()}>
                  确认吊销
                </button>
                <button type="button" onClick={() => service.cancelRevoke()}>
                  取消
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => service.askRevoke(token.id)}>
                吊销
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
});

export default bindServices(TokensPage, [TokensService]);
