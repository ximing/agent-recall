import { bindServices, observer, useService } from '@rabjs/react';
import { useEffect } from 'react';
import { formatTime } from '@/utils/format';
import { COST_ROW_LABEL, COST_TITLES, CostService, formatCost, formatTokens } from './cost.service';
import './cost.css';
import '@/styles/ledger.css';

const CostPage = observer(function CostPage() {
  const service = useService(CostService);

  useEffect(() => {
    void service.load();
  }, [service]);

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1>调用成本</h1>
          <p className="desc">大模型、向量和精排各自的 token 与估算费用。三张卡片按全部调用合计。</p>
        </div>
        <p className="cost-total">
          合计 {formatCost(service.totalCost)} · {formatTokens(service.totalTokens)} token
        </p>
      </header>

      {service.error ? (
        <p className="form-error" role="alert">
          {service.error}
        </p>
      ) : null}

      <div className="cost-grid">
        {service.byCapability.map((row) => (
          <article className="panel cost-card" key={row.capability}>
            <div className="panel-head">
              <div>
                <h2>{COST_TITLES[row.capability]}</h2>
                <p className="sub">{formatTokens(row.calls)} 次调用</p>
              </div>
            </div>
            <p className="cost-figure">{formatCost(row.costEstimate)}</p>
            <dl className="cost-meta">
              <div>
                <dt>合计 token</dt>
                <dd>{formatTokens(row.totalTokens)}</dd>
              </div>
              <div>
                <dt>输入</dt>
                <dd>{formatTokens(row.promptTokens)}</dd>
              </div>
              <div>
                <dt>输出</dt>
                <dd>{formatTokens(row.completionTokens)}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>

      <div className="panel ledger-card">
        <div className="panel-head">
          <div>
            <h2>调用记录</h2>
            <p className="sub">最近 100 条。金额按公开单价估算，不是提供商账单。这里不保存提示词。</p>
          </div>
        </div>
        {!service.loaded ? null : service.logs.length === 0 ? (
          <div className="empty">
            <p className="empty-title">还没有调用</p>
            <p>写入记忆、召回或测试模型之后，这里会出现记录。</p>
          </div>
        ) : (
          <div className="ledger">
            <table>
              <thead>
                <tr>
                  <th>能力</th>
                  <th>模型</th>
                  <th>输入</th>
                  <th>输出</th>
                  <th>合计</th>
                  <th>估算</th>
                  <th>时间</th>
                </tr>
              </thead>
              <tbody>
                {service.logs.map((log) => (
                  <tr key={log.id}>
                    <td>{COST_ROW_LABEL[log.capability]}</td>
                    <td className="mono">
                      {log.provider}/{log.model}
                    </td>
                    <td className="time">{formatTokens(log.promptTokens)}</td>
                    <td className="time">{formatTokens(log.completionTokens)}</td>
                    <td className="time">{formatTokens(log.totalTokens)}</td>
                    <td className="time">{formatCost(log.costEstimate)}</td>
                    <td className="time">{formatTime(log.createdAt)}</td>
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

export default bindServices(CostPage, [CostService]);
