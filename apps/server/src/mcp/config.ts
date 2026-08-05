import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function mcpEntryPath(): string {
  return path.resolve(fileURLToPath(new URL('../../../mcp/dist/index.js', import.meta.url)));
}

export function renderMcpConfig(baseUrl: string, secret: string, entry = mcpEntryPath()): string {
  return JSON.stringify(
    {
      mcpServers: {
        'agent-recall': {
          command: 'node',
          args: [entry],
          env: {
            AGENT_RECALL_URL: baseUrl,
            AGENT_RECALL_TOKEN: secret,
          },
        },
      },
    },
    null,
    2,
  );
}
