import type { GraphEdge, GraphNode } from '@agent-recall/dto';
import { observer, useService } from '@rabjs/react';
import { useEffect, useMemo, useRef, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { GraphService } from '../graph.service';

/* 取两套主题中间档的明度，保证白底与炭灰底上都可读 */
export const KIND_COLOR: Record<GraphNode['kind'], string> = {
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

const KINDS = Object.keys(KIND_COLOR) as GraphNode['kind'][];

/* 逻辑坐标系：布局输出固定归一到这个空间，视口变换（缩放/平移）作用在 <g> transform 上 */
const VIEW_W = 1000;
const VIEW_H = 600;

/** 由 id 散列出确定性的初始位置，避免每次渲染布局抖动。 */
function hashOf(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return hash;
}

interface LayoutNode {
  node: GraphNode;
  x: number;
  y: number;
}

/** 轻量力导向布局：库仑斥力 + 边弹簧 + 向心引力，同步迭代后归一到逻辑坐标系。 */
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

  // 归一：把包围盒平移缩放到逻辑坐标系内
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

function edgeKey(edge: GraphEdge): string {
  return `${edge.from}|${edge.relation}|${edge.to}`;
}

interface ViewTransform {
  tx: number;
  ty: number;
  k: number;
}

type DragState =
  | { mode: 'pan'; pointerId: number; startX: number; startY: number; startTf: ViewTransform; moved: boolean }
  | {
      mode: 'node';
      pointerId: number;
      id: string;
      startX: number;
      startY: number;
      startWorld: { x: number; y: number };
      lastWorld: { x: number; y: number };
      moved: boolean;
    }
  | null;

export const GraphView = observer(function GraphView() {
  const service = useService(GraphService);
  const resetNonce = service.viewResetNonce;

  const svgRef = useRef<SVGSVGElement>(null);
  const viewportRef = useRef<SVGGElement>(null);
  const nodeRefs = useRef(new Map<string, SVGGElement>());
  const edgeRefs = useRef(new Map<string, SVGLineElement>());
  /* positionsRef 是节点坐标的唯一来源:布局写入、拖拽改写,渲染时实时读取 */
  const positionsRef = useRef(new Map<string, { x: number; y: number }>());
  const tfRef = useRef<ViewTransform>({ tx: 0, ty: 0, k: 1 });
  const dragRef = useRef<DragState>(null);
  const userMovedRef = useRef(false);
  const edgesRef = useRef<GraphEdge[]>([]);
  edgesRef.current = service.edges;

  /* 数据变化才重跑布局;已有 id 沿用拖拽后的坐标,避免位置跳动 */
  useMemo(() => {
    const laid = layoutGraph(service.nodes, service.edges);
    const prev = positionsRef.current;
    const next = new Map<string, { x: number; y: number }>();
    for (const entry of laid) {
      next.set(entry.node.id, prev.get(entry.node.id) ?? { x: entry.x, y: entry.y });
    }
    positionsRef.current = next;
  }, [service.nodes, service.edges]);

  const applyTransform = (): void => {
    const { tx, ty, k } = tfRef.current;
    viewportRef.current?.setAttribute('transform', `translate(${tx},${ty}) scale(${k})`);
  };

  const fitView = (): void => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;
    const k = Math.min(rect.width / VIEW_W, rect.height / VIEW_H) * 0.95;
    tfRef.current = { tx: (rect.width - VIEW_W * k) / 2, ty: (rect.height - VIEW_H * k) / 2, k };
    applyTransform();
  };

  /* 加载/空态时 svg 不存在, effect 必须等 svg 真正挂载后再跑 */
  const hasGraph = !service.loading && service.nodes.length > 0;

  /* 挂载与容器尺寸变化:用户没动过视图时保持 fit */
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const observer = new ResizeObserver(() => {
      if (!userMovedRef.current) fitView();
    });
    observer.observe(svg);
    fitView();
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasGraph]);

  /* 复位信号(双击空白/复位按钮):重算 fit */
  useEffect(() => {
    if (!hasGraph) return;
    userMovedRef.current = false;
    fitView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetNonce, hasGraph]);

  /* React 的 onWheel 是 passive,无法 preventDefault,必须原生监听 */
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      const tf = tfRef.current;
      const k2 = Math.min(5, Math.max(0.15, tf.k * Math.exp(-event.deltaY * 0.0015)));
      /* 指针下的世界点保持不动 */
      tf.tx = px - ((px - tf.tx) * k2) / tf.k;
      tf.ty = py - ((py - tf.ty) * k2) / tf.k;
      tf.k = k2;
      userMovedRef.current = true;
      applyTransform();
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasGraph]);

  /** 拖拽节点时让相连的边实时跟随,不经 React 重渲染 */
  const moveNode = (id: string, world: { x: number; y: number }): void => {
    nodeRefs.current.get(id)?.setAttribute('transform', `translate(${world.x},${world.y})`);
    for (const edge of edgesRef.current) {
      if (edge.from !== id && edge.to !== id) continue;
      const line = edgeRefs.current.get(edgeKey(edge));
      if (!line) continue;
      if (edge.from === id) {
        line.setAttribute('x1', String(world.x));
        line.setAttribute('y1', String(world.y));
      }
      if (edge.to === id) {
        line.setAttribute('x2', String(world.x));
        line.setAttribute('y2', String(world.y));
      }
    }
  };

  const onPointerDown = (event: PointerEvent<SVGSVGElement>): void => {
    if (event.button !== 0) return;
    const svg = svgRef.current;
    if (!svg) return;
    svg.setPointerCapture(event.pointerId);
    const nodeEl = (event.target as Element).closest('[data-node]');
    const nodeId = nodeEl?.getAttribute('data-node');
    if (nodeId) {
      const world = positionsRef.current.get(nodeId);
      if (!world) return;
      dragRef.current = {
        mode: 'node',
        pointerId: event.pointerId,
        id: nodeId,
        startX: event.clientX,
        startY: event.clientY,
        startWorld: { ...world },
        lastWorld: { ...world },
        moved: false,
      };
    } else {
      dragRef.current = {
        mode: 'pan',
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startTf: { ...tfRef.current },
        moved: false,
      };
      svg.classList.add('panning');
    }
  };

  const onPointerMove = (event: PointerEvent<SVGSVGElement>): void => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.hypot(dx, dy) > 4) drag.moved = true;
    if (!drag.moved) return;
    userMovedRef.current = true;
    if (drag.mode === 'pan') {
      tfRef.current = { ...drag.startTf, tx: drag.startTf.tx + dx, ty: drag.startTf.ty + dy };
      applyTransform();
    } else {
      const k = tfRef.current.k;
      const world = { x: drag.startWorld.x + dx / k, y: drag.startWorld.y + dy / k };
      drag.lastWorld = world;
      moveNode(drag.id, world);
    }
  };

  const onPointerUp = (event: PointerEvent<SVGSVGElement>): void => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    dragRef.current = null;
    svgRef.current?.classList.remove('panning');
    if (drag.mode === 'node') {
      if (drag.moved) {
        positionsRef.current.set(drag.id, drag.lastWorld);
      } else {
        service.select(drag.id === service.selectedId ? null : drag.id);
      }
    } else if (!drag.moved) {
      /* 空白点击:取消选中,收起抽屉 */
      service.select(null);
    }
  };

  const onDoubleClick = (event: MouseEvent<SVGSVGElement>): void => {
    if ((event.target as Element).closest('[data-node]')) return;
    service.resetView();
  };

  const selected = service.selected;
  const visibleNodes = service.visibleNodes;
  const visibleEdges = service.visibleEdges;
  const neighborIds = new Set<string>();
  if (selected) {
    for (const edge of service.edges) {
      if (edge.from === selected.id) neighborIds.add(edge.to);
      if (edge.to === selected.id) neighborIds.add(edge.from);
    }
  }

  let body: ReactNode;
  if (service.loading) {
    body = <p className="composer-hint">加载中…</p>;
  } else if (service.nodes.length === 0) {
    body = (
      <div className="empty">
        <p className="empty-title">没有匹配的节点</p>
        <p>关系从图上的项目、标签、会话和类型长出来,不另存一张表。</p>
      </div>
    );
  } else {
    body = (
      <>
        <svg
          ref={svgRef}
          role="img"
          aria-label="关系图"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={onDoubleClick}
        >
          <g ref={viewportRef}>
            {visibleEdges.map((edge) => {
              const from = positionsRef.current.get(edge.from);
              const to = positionsRef.current.get(edge.to);
              if (!from || !to) return null;
              const highlighted = selected !== null && (edge.from === selected.id || edge.to === selected.id);
              return (
                <line
                  key={edgeKey(edge)}
                  ref={(el) => {
                    if (el) edgeRefs.current.set(edgeKey(edge), el);
                    else edgeRefs.current.delete(edgeKey(edge));
                  }}
                  className="graph-edge"
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
            {visibleNodes.map((node) => {
              const position = positionsRef.current.get(node.id);
              if (!position) return null;
              const isSelected = node.id === service.selectedId;
              const dimmed = selected !== null && !isSelected && !neighborIds.has(node.id);
              const radius = KIND_RADIUS[node.kind];
              return (
                <g
                  key={node.id}
                  data-node={node.id}
                  ref={(el) => {
                    if (el) nodeRefs.current.set(node.id, el);
                    else nodeRefs.current.delete(node.id);
                  }}
                  className={`graph-node${isSelected ? ' selected' : ''}`}
                  opacity={dimmed ? 0.35 : 1}
                  transform={`translate(${position.x},${position.y})`}
                >
                  {isSelected ? <circle className="graph-halo" r={radius + 7} /> : null}
                  <circle className="graph-core" r={radius} fill={KIND_COLOR[node.kind]} />
                  <text y={radius + 13} textAnchor="middle" fontSize="10.5" fill="var(--ink-2)">
                    {truncate(node.name)}
                  </text>
                  <title>
                    {service.kindLabel(node.kind)} · {node.name}
                  </title>
                </g>
              );
            })}
          </g>
        </svg>
        <div className="graph-legend" role="group" aria-label="类型筛选">
          {KINDS.map((kind) => {
            const off = service.hiddenKinds.has(kind);
            return (
              <button
                key={kind}
                type="button"
                className={`legend-chip${off ? ' off' : ''}`}
                aria-pressed={!off}
                onClick={() => service.toggleKind(kind)}
              >
                <span className="dot" style={{ background: KIND_COLOR[kind] }} />
                {service.kindLabel(kind)}
              </button>
            );
          })}
        </div>
      </>
    );
  }

  return <div className="graph-canvas-wrap">{body}</div>;
});
