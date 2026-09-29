import type { GraphEdge, GraphNode } from '@agent-recall/dto';
import { observer, useService } from '@rabjs/react';
import { useMemo } from 'react';
import { GraphService } from '../graph.service';

/* 取两套主题中间档的明度，保证白底与炭灰底上都可读 */
const KIND_COLOR: Record<GraphNode['kind'], string> = {
  memory: '#7B68E6',
  project: '#1FA398',
  tag: '#B07E1F',
  session: '#C95CB0',
  type: '#4F7FD9',
};

const KIND_RADIUS: Record<GraphNode['kind'], number> = {
  memory: 10,
  project: 14,
  tag: 12,
  session: 13,
  type: 12,
};

const VIEW_W = 1000;
const VIEW_H = 600;

/** 由 id 散列出确定性的初始位置，避免每次渲染布局抖动。 */
function hashOf(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  }
  return hash;
}

interface LayoutNode {
  node: GraphNode;
  x: number;
  y: number;
}

/** 轻量力导向布局：库仑斥力 + 边弹簧 + 向心引力，同步迭代后归一到视口。 */
function layoutGraph(nodes: GraphNode[], edges: GraphEdge[]): LayoutNode[] {
  if (nodes.length === 0) return [];
  const positioned = nodes.map((node, index) => {
    const seed = hashOf(node.id);
    const angle = (seed % 360) * (Math.PI / 180);
    const radius = 120 + (seed % 140);
    return {
      node,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
      index,
    };
  });
  const byId = new Map(positioned.map((entry) => [entry.node.id, entry]));
  const links = edges
    .map((edge) => ({ source: byId.get(edge.from), target: byId.get(edge.to) }))
    .filter((link): link is { source: (typeof positioned)[number]; target: (typeof positioned)[number] } =>
      Boolean(link.source && link.target),
    );

  const ITERATIONS = 220;
  const REPULSION = 5200;
  const SPRING_LEN = 130;
  const SPRING_K = 0.02;
  const GRAVITY = 0.015;

  for (let step = 0; step < ITERATIONS; step += 1) {
    const cooling = 1 - step / ITERATIONS;
    for (let a = 0; a < positioned.length; a += 1) {
      for (let b = a + 1; b < positioned.length; b += 1) {
        const pa = positioned[a];
        const pb = positioned[b];
        let dx = pb.x - pa.x;
        let dy = pb.y - pa.y;
        let distSq = dx * dx + dy * dy;
        if (distSq < 1) {
          dx = (hashOf(pa.node.id) % 7) - 3;
          dy = (hashOf(pb.node.id) % 7) - 3;
          distSq = dx * dx + dy * dy + 0.01;
        }
        const force = (REPULSION / distSq) * cooling;
        const dist = Math.sqrt(distSq);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        pa.vx -= fx;
        pa.vy -= fy;
        pb.vx += fx;
        pb.vy += fy;
      }
    }
    for (const link of links) {
      const dx = link.target.x - link.source.x;
      const dy = link.target.y - link.source.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = (dist - SPRING_LEN) * SPRING_K;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      link.source.vx += fx;
      link.source.vy += fy;
      link.target.vx -= fx;
      link.target.vy -= fy;
    }
    for (const entry of positioned) {
      entry.vx -= entry.x * GRAVITY;
      entry.vy -= entry.y * GRAVITY;
      entry.x += entry.vx * 0.5;
      entry.y += entry.vy * 0.5;
      entry.vx *= 0.6;
      entry.vy *= 0.6;
    }
  }

  // 归一：把包围盒平移缩放到视口内
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const entry of positioned) {
    minX = Math.min(minX, entry.x);
    minY = Math.min(minY, entry.y);
    maxX = Math.max(maxX, entry.x);
    maxY = Math.max(maxY, entry.y);
  }
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const scale = Math.min((VIEW_W - 120) / spanX, (VIEW_H - 140) / spanY, 1.6);
  const offsetX = (VIEW_W - spanX * scale) / 2;
  const offsetY = (VIEW_H - spanY * scale) / 2;
  return positioned.map((entry) => ({
    node: entry.node,
    x: offsetX + (entry.x - minX) * scale,
    y: offsetY + (entry.y - minY) * scale,
  }));
}

function truncate(name: string, max = 14): string {
  return name.length > max ? `${name.slice(0, max)}…` : name;
}

export const GraphView = observer(function GraphView() {
  const service = useService(GraphService);

  const layout = useMemo(() => layoutGraph(service.nodes, service.edges), [service.nodes, service.edges]);
  const positionById = useMemo(() => new Map(layout.map((entry) => [entry.node.id, entry])), [layout]);

  if (service.loading) return <p className="composer-hint">加载中…</p>;
  if (service.nodes.length === 0) {
    return (
      <div className="empty">
        <p className="empty-title">没有匹配的节点</p>
        <p>关系从图上的项目、标签、会话和类型长出来，不另存一张表。</p>
      </div>
    );
  }

  const selected = service.selected;
  const related: Array<{ edge: GraphEdge; otherId: string; outgoing: boolean }> = selected
    ? service.edges
        .filter((edge) => edge.from === selected.id || edge.to === selected.id)
        .map((edge) => ({
          edge,
          otherId: edge.from === selected.id ? edge.to : edge.from,
          outgoing: edge.from === selected.id,
        }))
    : [];

  return (
    <div className="graph-split">
      <div className="graph-canvas-wrap">
        <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="img" aria-label="关系图">
          {service.edges.map((edge) => {
            const from = positionById.get(edge.from);
            const to = positionById.get(edge.to);
            if (!from || !to) return null;
            const highlighted = selected !== null && (edge.from === selected.id || edge.to === selected.id);
            return (
              <line
                key={`${edge.from}-${edge.relation}-${edge.to}`}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke={highlighted ? 'var(--accent)' : 'var(--line-strong)'}
                strokeWidth={highlighted ? 1.8 : 1.1}
                strokeOpacity={selected === null || highlighted ? 0.9 : 0.35}
              >
                <title>{service.relationLabel(edge.relation)}</title>
              </line>
            );
          })}
          {layout.map((entry) => {
            const isSelected = entry.node.id === service.selectedId;
            const dimmed = selected !== null && !isSelected && !related.some((rel) => rel.otherId === entry.node.id);
            return (
              <g
                key={entry.node.id}
                className="graph-node"
                opacity={dimmed ? 0.35 : 1}
                onClick={() => service.select(isSelected ? null : entry.node.id)}
              >
                <circle
                  cx={entry.x}
                  cy={entry.y}
                  r={KIND_RADIUS[entry.node.kind]}
                  fill={KIND_COLOR[entry.node.kind]}
                  stroke={isSelected ? 'var(--accent)' : 'transparent'}
                  strokeWidth={isSelected ? 6 : 0}
                  strokeOpacity={isSelected ? 0.3 : 0}
                />
                <text
                  x={entry.x}
                  y={entry.y + KIND_RADIUS[entry.node.kind] + 13}
                  textAnchor="middle"
                  fontSize="10.5"
                  fill="var(--ink-2)"
                >
                  {truncate(entry.node.name)}
                </text>
                <title>
                  {service.kindLabel(entry.node.kind)} · {entry.node.name}
                </title>
              </g>
            );
          })}
        </svg>
        <div className="graph-legend">
          {(Object.keys(KIND_COLOR) as GraphNode['kind'][]).map((kind) => (
            <span key={kind}>
              <span className="dot" style={{ background: KIND_COLOR[kind] }} />
              {service.kindLabel(kind)}
            </span>
          ))}
        </div>
      </div>

      <aside className="node-panel">
        {!selected ? (
          <div className="node-panel-body">
            <p className="composer-hint">点击图上的节点，这里会列出它的边和一步邻居。再点一次取消选中。</p>
          </div>
        ) : (
          <>
            <div className="node-panel-head">
              <div className="kind">
                <span className="mini-tag" style={{ color: KIND_COLOR[selected.kind] }}>
                  {service.kindLabel(selected.kind)}节点
                </span>
              </div>
              <p className="name">{selected.name}</p>
            </div>
            <div className="node-panel-body">
              <h3>边 · {related.length}</h3>
              {related.length === 0 ? (
                <p className="composer-hint">这个节点还没有边。</p>
              ) : (
                <ul className="edge-list">
                  {related.map(({ edge, otherId, outgoing }) => (
                    <li key={`${edge.from}-${edge.relation}-${edge.to}`}>
                      <span className="rel">{outgoing ? `${service.relationLabel(edge.relation)} →` : `← ${service.relationLabel(edge.relation)}`}</span>
                      <button
                        type="button"
                        className="related-btn"
                        style={{ width: 'auto', padding: 0 }}
                        onClick={() => service.select(otherId)}
                      >
                        {truncate(service.nodeName(otherId), 24)}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
});
