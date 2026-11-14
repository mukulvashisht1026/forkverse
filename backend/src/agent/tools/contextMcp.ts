import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { config } from '../../config.js';

let client: MultiServerMCPClient | null = null;

export async function getContextTools(): Promise<StructuredToolInterface[]> {
  if (!client) {
   
    client = new MultiServerMCPClient({
      mcpServers: {
        context: {
          transport: 'http',
          url: 'https://mcp.context.dev/mcp',
          headers: { 
            Authorization: `Bearer ${process.env.CONTEXT_DEV_API_KEY}` 
          },
        },
      },
      throwOnLoadError: false, 
      prefixToolNameWithServerName: true,
    });
  }
  return client.getTools();
}

export async function closeContextMcp() {
  await client?.close();
  client = null;
}