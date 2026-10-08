/** npm name users install. The publish token belongs to yeanzhi; @agent-recall is not on that account. */
export const MCP_NPM_PACKAGE = '@yeanzhi/agent-recall-mcp';

export function renderMcpConfig(baseUrl: string, secret: string, npmPackage = MCP_NPM_PACKAGE): string {
  return JSON.stringify(
    {
      mcpServers: {
        'agent-recall': {
          command: 'npx',
          args: ['-y', npmPackage],
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

/** Remote Streamable HTTP. Same token, no package, no local file tools. */
export function renderRemoteMcpConfig(baseUrl: string, secret: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        'agent-recall': {
          type: 'http',
          url: remoteMcpUrl(baseUrl),
          headers: {
            Authorization: `Bearer ${secret}`,
          },
        },
      },
    },
    null,
    2,
  );
}

export function remoteMcpUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, '')}/mcp`;
}
