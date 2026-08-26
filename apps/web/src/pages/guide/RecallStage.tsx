/**
 * Hero 可视化：「召回瞬间」。
 * 记忆库里的相关记忆亮起，沿光流注入当前会话的上下文卡片，
 * token 预算条随之填充。入场动画在 landing.css 里编排。
 */
export function RecallStage() {
  return (
    <div className="recall-stage rise" style={{ animationDelay: '.3s' }}>
      <div className="stage-head">
        <span className="lights">
          <i />
          <i />
          <i />
        </span>
        <code>POST /api/hooks/context</code>
      </div>
      <svg
        className="recall-svg"
        viewBox="0 0 560 400"
        fill="none"
        role="img"
        aria-label="记忆库中的相关记忆被抽出，注入当前会话的上下文"
      >
        <defs>
          <radialGradient id="nodeGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#F2B04E" stopOpacity=".9" />
            <stop offset="100%" stopColor="#F2B04E" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="flowGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#F2B04E" stopOpacity=".9" />
            <stop offset="100%" stopColor="#A99CFF" stopOpacity=".9" />
          </linearGradient>
        </defs>

        {/* 记忆库标签 */}
        <text
          x="36"
          y="42"
          fontFamily="JetBrains Mono, monospace"
          fontSize="11"
          fill="#5C6188"
          className="rise"
          style={{ animationDelay: '.5s' }}
        >
          记忆库 · 12,438 条
        </text>

        {/* 底层连线 */}
        <g stroke="#232748" strokeWidth="1" opacity=".55">
          <line x1="72" y1="96" x2="140" y2="150" />
          <line x1="140" y1="150" x2="92" y2="224" />
          <line x1="140" y1="150" x2="196" y2="110" />
          <line x1="92" y1="224" x2="160" y2="286" />
          <line x1="196" y1="110" x2="216" y2="206" />
          <line x1="216" y1="206" x2="160" y2="286" />
          <line x1="160" y1="286" x2="110" y2="340" />
          <line x1="216" y1="206" x2="92" y2="224" />
        </g>

        {/* 休眠记忆节点 */}
        <g fill="#F2B04E">
          <circle className="mem-node" style={{ animationDelay: '.55s' }} cx="72" cy="96" r="3.5" opacity=".4" />
          <circle className="mem-node" style={{ animationDelay: '.62s' }} cx="196" cy="110" r="3" opacity=".35" />
          <circle className="mem-node" style={{ animationDelay: '.69s' }} cx="48" cy="180" r="2.5" opacity=".3" />
          <circle className="mem-node" style={{ animationDelay: '.76s' }} cx="160" cy="286" r="3" opacity=".35" />
          <circle className="mem-node" style={{ animationDelay: '.83s' }} cx="110" cy="340" r="2.5" opacity=".3" />
          <circle className="mem-node" style={{ animationDelay: '.9s' }} cx="216" cy="290" r="2.5" opacity=".28" />
        </g>

        {/* 被召回的记忆节点 */}
        <g>
          <circle className="mem-node pulse" style={{ animationDelay: '.7s' }} cx="140" cy="150" r="12" fill="url(#nodeGlow)" />
          <circle className="mem-node" style={{ animationDelay: '.7s' }} cx="140" cy="150" r="5" fill="#FFD08A" />
          <circle className="mem-node pulse" style={{ animationDelay: '.85s' }} cx="92" cy="224" r="12" fill="url(#nodeGlow)" />
          <circle className="mem-node" style={{ animationDelay: '.85s' }} cx="92" cy="224" r="5" fill="#FFD08A" />
          <circle className="mem-node pulse" style={{ animationDelay: '1s' }} cx="216" cy="206" r="12" fill="url(#nodeGlow)" />
          <circle className="mem-node" style={{ animationDelay: '1s' }} cx="216" cy="206" r="5" fill="#FFD08A" />
        </g>

        {/* 节点标注 */}
        <g fontSize="11" fill="#9298BC" fontFamily="PingFang SC, sans-serif">
          <text className="mem-node" style={{ animationDelay: '1.1s' }} x="152" y="136">
            架构决定 · Postgres
          </text>
          <text className="mem-node" style={{ animationDelay: '1.2s' }} x="60" y="252">
            坑 · RRF 权重
          </text>
          <text className="mem-node" style={{ animationDelay: '1.3s' }} x="186" y="236">
            偏好 · 中文回复
          </text>
        </g>

        {/* 光流 */}
        <g stroke="url(#flowGrad)" strokeWidth="1.6" fill="none">
          <path className="flow-line" style={{ animationDelay: '1.15s' }} d="M146 146 C 240 120, 280 128, 332 138" />
          <path className="flow-line" style={{ animationDelay: '1.35s' }} d="M98 220 C 200 210, 260 200, 332 192" />
          <path className="flow-line" style={{ animationDelay: '1.55s' }} d="M222 210 C 270 226, 300 238, 332 246" />
        </g>

        {/* 流动脉冲 */}
        <g fill="#FFD08A">
          <circle r="3" className="pulse">
            <animateMotion dur="2.6s" repeatCount="indefinite" begin="2s" path="M146 146 C 240 120, 280 128, 332 138" />
          </circle>
          <circle r="3" className="pulse">
            <animateMotion dur="2.9s" repeatCount="indefinite" begin="2.4s" path="M98 220 C 200 210, 260 200, 332 192" />
          </circle>
          <circle r="3" className="pulse">
            <animateMotion dur="3.2s" repeatCount="indefinite" begin="2.8s" path="M222 210 C 270 226, 300 238, 332 246" />
          </circle>
        </g>

        {/* 上下文卡片 */}
        <g>
          <rect x="332" y="84" width="196" height="218" rx="12" fill="#11142A" stroke="#3A3470" strokeWidth="1.2" />
          <rect x="332" y="84" width="196" height="218" rx="12" fill="none" stroke="#7C6CFF" strokeOpacity=".25" strokeWidth="4" />
          <text x="348" y="110" fontSize="12" fill="#E9EBF8" fontWeight="600" fontFamily="PingFang SC, sans-serif">
            当前会话
          </text>
          <text x="528" y="110" textAnchor="end" fontFamily="JetBrains Mono, monospace" fontSize="10" fill="#5C6188">
            context
          </text>

          <g fontFamily="PingFang SC, sans-serif">
            <g className="ctx-chip" style={{ animationDelay: '1.7s' }}>
              <rect x="348" y="126" width="164" height="34" rx="8" fill="#1B1F3C" stroke="#3A3470" />
              <circle cx="362" cy="143" r="3" fill="#F2B04E" />
              <text x="372" y="147" fontSize="11" fill="#C9CEEA">
                默认数据库用 Postgres
              </text>
            </g>
            <g className="ctx-chip" style={{ animationDelay: '1.9s' }}>
              <rect x="348" y="168" width="164" height="34" rx="8" fill="#1B1F3C" stroke="#3A3470" />
              <circle cx="362" cy="185" r="3" fill="#F2B04E" />
              <text x="372" y="189" fontSize="11" fill="#C9CEEA">
                RRF 权重别动 k=60
              </text>
            </g>
            <g className="ctx-chip" style={{ animationDelay: '2.1s' }}>
              <rect x="348" y="210" width="164" height="34" rx="8" fill="#1B1F3C" stroke="#3A3470" />
              <circle cx="362" cy="227" r="3" fill="#F2B04E" />
              <text x="372" y="231" fontSize="11" fill="#C9CEEA">
                回复一律用中文
              </text>
            </g>
          </g>

          <text x="348" y="272" fontFamily="JetBrains Mono, monospace" fontSize="10" fill="#5C6188">
            token 预算 2000
          </text>
          <text x="512" y="272" textAnchor="end" fontFamily="JetBrains Mono, monospace" fontSize="10" fill="#A99CFF">
            1240
          </text>
          <rect x="348" y="280" width="164" height="5" rx="2.5" fill="#1B1F3C" />
          <rect className="budget-fill" style={{ animationDelay: '2.2s' }} x="348" y="280" height="5" rx="2.5" fill="url(#flowGrad)" />
        </g>
      </svg>
      <div className="stage-foot">
        <span>会话开始 · 插件注入相关记忆</span>
        <code>超时 2s · 失败落本地 spool</code>
      </div>
    </div>
  );
}
