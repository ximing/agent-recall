import { bindServices, observer, useService } from '@rabjs/react';
import { useEffect } from 'react';
import { MemoriesService, ORIGIN_LABEL } from './memories.service';

const MemoriesPage = observer(function MemoriesPage() {
  const service = useService(MemoriesService);

  useEffect(() => {
    void service.load();
  }, [service]);

  return (
    <section className="page">
      <header className="page-head">
        <h1>记忆</h1>
        <p>从网页写一条，或让代理和钩子替你写下。</p>
      </header>
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          void service.create();
        }}
      >
        <label>
          内容
          <textarea value={service.draft} onChange={(event) => service.setDraft(event.target.value)} rows={4} />
        </label>
        <button type="submit" className="primary">
          保存记忆
        </button>
      </form>
      {service.error ? (
        <p className="form-error" role="alert">
          {service.error}
        </p>
      ) : null}
      {service.memories.length === 0 ? <p className="empty">还没有记忆</p> : null}
      <ul className="stack">
        {service.memories.map((memory) => (
          <li key={memory.id} className={`card origin-${memory.origin}`}>
            <p className="meta">来源：{ORIGIN_LABEL[memory.origin]}</p>
            {service.editingId === memory.id ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void service.saveEdit();
                }}
              >
                <label>
                  编辑内容
                  <textarea
                    value={service.editDraft}
                    onChange={(event) => service.setEditDraft(event.target.value)}
                    rows={4}
                  />
                </label>
                <div className="row">
                  <button type="submit" className="primary">
                    保存修改
                  </button>
                  <button type="button" onClick={() => service.cancelEdit()}>
                    取消
                  </button>
                </div>
              </form>
            ) : (
              <p className="memory-text">{memory.content}</p>
            )}
            {service.editingId !== memory.id ? (
              <div className="row">
                <button type="button" onClick={() => service.startEdit(memory)}>
                  编辑
                </button>
                {service.pendingDeleteId === memory.id ? (
                  <>
                    <button type="button" className="danger" onClick={() => void service.confirmDelete()}>
                      确认删除
                    </button>
                    <button type="button" onClick={() => service.cancelDelete()}>
                      取消
                    </button>
                  </>
                ) : (
                  <button type="button" onClick={() => service.askDelete(memory.id)}>
                    删除
                  </button>
                )}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
});

export default bindServices(MemoriesPage, [MemoriesService]);
