import { observer, useService } from '@rabjs/react';
import { X } from 'lucide-react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { GraphService } from '../graph.service';
import { KIND_COLOR } from './graph-view';

function truncate(name: string, max = 24): string {
  return name.length > max ? `${name.slice(0, max)}…` : name;
}

export const NodeDrawer = observer(function NodeDrawer() {
  const service = useService(GraphService);
  const selected = service.selected;

  useEffect(() => {
    if (!selected) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') service.select(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selected, service]);

  if (!selected) return null;

  const related = service.edges
    .filter((edge) => edge.from === selected.id || edge.to === selected.id)
    .map((edge) => ({
      edge,
      otherId: edge.from === selected.id ? edge.to : edge.from,
      outgoing: edge.from === selected.id,
    }));

  /* 无 scrim:画布保持可交互,点空白处即收起;页面本身不滚动,不锁 body */
  return createPortal(
    <aside className="drawer graph-drawer" role="dialog" aria-label="节点详情">
      <div className="drawer-head">
        <span className="drawer-title">{selected.name}</span>
        <button type="button" className="drawer-close" aria-label="关闭" onClick={() => service.select(null)}>
          <X size={16} strokeWidth={1.8} />
        </button>
      </div>
      <div className="drawer-body">
        <div className="gnode-meta">
          <span className="mini-tag" style={{ color: KIND_COLOR[selected.kind] }}>
            {service.kindLabel(selected.kind)}节点
          </span>
          <span className="mini-tag mono">度数 {service.degreeOf(selected.id)}</span>
        </div>
        <h3>边 · {related.length}</h3>
        {related.length === 0 ? (
          <p className="composer-hint">这个节点还没有边。</p>
        ) : (
          <ul className="edge-list">
            {related.map(({ edge, otherId, outgoing }) => (
              <li key={`${edge.from}-${edge.relation}-${edge.to}`}>
                <span className="rel">
                  {outgoing ? `${service.relationLabel(edge.relation)} →` : `← ${service.relationLabel(edge.relation)}`}
                </span>
                <button type="button" className="related-btn" onClick={() => service.select(otherId)}>
                  {truncate(service.nodeName(otherId))}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>,
    document.body,
  );
});
