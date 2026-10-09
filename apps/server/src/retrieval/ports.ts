import type { AppConfig } from '../config.js';
import type { ModelUsageInput } from '../llm/usage.js';
import { createEmbeddingClient, type EmbeddingClient } from './embedding.js';
import { RetrievalError } from './http.js';
import { createMeiliClient, type MeiliClient } from './meili.js';
import { createQdrantClient, type QdrantClient } from './qdrant.js';

export interface RetrievalPorts {
  meili: MeiliClient;
  qdrant: QdrantClient;
  embeddings: EmbeddingClient;
  meiliIndex: string;
  qdrantCollection: string;
  /** 服务端 embedding 走 DashScope 多模态接口，成本记在这条记忆或这次查询的用户上。 */
  embeddingProvider: string;
  embeddingModel: string;
  recordUsage?: (entry: ModelUsageInput) => Promise<void>;
}

function disabled<T extends object>(label: string): T {
  const fail = async () => {
    throw new RetrievalError('NETWORK', `${label} is not configured`);
  };
  return new Proxy({} as T, {
    get(_target, prop) {
      if (prop === 'then') return undefined;
      return fail;
    },
  });
}

export function createRetrieval(config: AppConfig): RetrievalPorts {
  const meili = config.MEILI_URL
    ? createMeiliClient({ url: config.MEILI_URL, apiKey: config.MEILI_API_KEY || 'none' })
    : disabled<MeiliClient>('meilisearch');
  const qdrant = config.QDRANT_URL
    ? createQdrantClient({
        url: config.QDRANT_URL,
        apiKey: config.QDRANT_API_KEY,
        vectorSize: config.EMBEDDING_DIMENSIONS,
      })
    : disabled<QdrantClient>('qdrant');
  const embeddings = config.EMBEDDING_API_KEY
    ? createEmbeddingClient({
        apiKey: config.EMBEDDING_API_KEY,
        baseUrl: config.EMBEDDING_BASE_URL,
        model: config.EMBEDDING_MODEL,
        dimensions: config.EMBEDDING_DIMENSIONS,
      })
    : disabled<EmbeddingClient>('embeddings');
  return {
    meili,
    qdrant,
    embeddings,
    meiliIndex: config.MEILI_INDEX,
    qdrantCollection: config.QDRANT_COLLECTION,
    embeddingProvider: 'dashscope',
    embeddingModel: config.EMBEDDING_MODEL,
  };
}
