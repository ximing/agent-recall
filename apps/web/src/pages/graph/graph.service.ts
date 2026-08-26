import type { GraphEdge, GraphNode } from '@agent-recall/dto';
import { Service } from '@rabjs/react';
import { api, errorMessage } from '@/api/client';

const KIND_LABEL = {
  memory: '记忆',
  project: '项目',
  tag: '标签',
  session: '会话',
  type: '类型',
} as const;

const RELATION_LABEL = {
  has_tag: '标签',
  belongs_to: '属于项目',
  in_session: '属于会话',
  is_type: '类型',
} as const;

export class GraphService extends Service {
  query = '';
  nodes: GraphNode[] = [];
  edges: GraphEdge[] = [];
  loading = false;
  error: string | null = null;
  selectedId: string | null = null;

  get selected(): GraphNode | null {
    return this.nodes.find((node) => node.id === this.selectedId) ?? null;
  }

  select(id: string | null): void {
    this.selectedId = id;
  }

  kindLabel(kind: GraphNode['kind']): string {
    return KIND_LABEL[kind];
  }

  relationLabel(relation: GraphEdge['relation']): string {
    return RELATION_LABEL[relation];
  }

  nodeName(id: string): string {
    return this.nodes.find((node) => node.id === id)?.name ?? id;
  }

  setQuery(value: string): void {
    this.query = value;
  }

  async load(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      const result = await api.graphQuery(this.query.trim() || undefined, 80);
      this.nodes = result.nodes;
      this.edges = result.edges;
      if (this.selectedId && !result.nodes.some((node) => node.id === this.selectedId)) {
        this.selectedId = null;
      }
    } catch (err) {
      this.error = errorMessage(err, '读取关系失败');
    } finally {
      this.loading = false;
    }
  }
}
