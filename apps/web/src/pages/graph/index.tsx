import { bindServices, observer, useService } from '@rabjs/react';
import { Search } from 'lucide-react';
import { useEffect } from 'react';
import { GraphView } from './components/graph-view';
import { GraphService } from './graph.service';
import './graph.css';

const GraphPage = observer(function GraphPage() {
  const service = useService(GraphService);

  useEffect(() => {
    void service.load();
  }, [service]);

  return (
    <section className="page wide">
      <header className="page-head">
        <div>
          <h1>关系</h1>
          <p className="desc">节点和边都从最新、未过期的记忆里推导。点击节点看它的边，搜索会带上一步之内的邻居。</p>
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
      </form>
      <GraphView />
    </section>
  );
});

export default bindServices(GraphPage, [GraphService]);
