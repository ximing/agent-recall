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
