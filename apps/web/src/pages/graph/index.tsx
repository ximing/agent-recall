import { bindServices, observer, useService } from '@rabjs/react';
import { Maximize, Search } from 'lucide-react';
import { useEffect } from 'react';
import { GraphView } from './components/graph-view';
import { NodeDrawer } from './components/node-drawer';
import { GraphService } from './graph.service';
import './graph.css';

const GraphPage = observer(function GraphPage() {
  const service = useService(GraphService);

  useEffect(() => {
    void service.load();
  }, [service]);

  return (
    <section className="page flush graph-page">
      <header className="page-head">
        <div>
          <h1>关系</h1>
          <p className="desc">
            节点和边都从最新、未过期的记忆里推导。滚轮缩放、拖拽平移,双击空白复位;点击节点看它的边。
          </p>
        </div>
        <div className="graph-stats">
          <span className="mini-tag mono">
            节点 {service.visibleNodes.length}/{service.nodes.length}
          </span>
          <span className="mini-tag mono">
            边 {service.visibleEdges.length}/{service.edges.length}
          </span>
        </div>
      </header>
      {service.error ? (
        <p className="form-error" role="alert">
          {service.error}
        </p>
      ) : null}
      <form
        className="graph-toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          void service.load();
        }}
      >
        <div className="search-box">
          <Search size={14} strokeWidth={1.6} />
          <input
            placeholder="项目、标签、会话或记忆摘要…"
            value={service.query}
            onChange={(event) => service.setQuery(event.target.value)}
          />
        </div>
        <button type="submit" className="btn primary">
          查询
        </button>
        <button
          type="button"
          className="btn"
          title="复位视图"
          aria-label="复位视图"
          onClick={() => service.resetView()}
        >
          <Maximize size={14} strokeWidth={1.6} />
          复位
        </button>
      </form>
      <GraphView />
      <NodeDrawer />
    </section>
  );
});

export default bindServices(GraphPage, [GraphService]);
