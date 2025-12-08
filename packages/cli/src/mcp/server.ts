/**
 * RagForge MCP Server
 *
 * Exposes RagForge tools via Model Context Protocol.
 * Can be used with Claude Code or any MCP-compatible client.
 *
 * Usage:
 *   ragforge mcp-server [--project <path>]
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type ListToolsResult,
} from '@modelcontextprotocol/sdk/types.js';
import type { GeneratedToolDefinition } from '@luciformresearch/ragforge';
import { convertAllTools, getToolsBySection } from './tool-adapter.js';

/**
 * Configuration for the MCP server
 */
export interface McpServerConfig {
  /** Server name */
  name?: string;
  /** Server version */
  version?: string;
  /** Tools to expose */
  tools: GeneratedToolDefinition[];
  /** Tool handlers (name -> handler function) */
  handlers: Record<string, (args: any) => Promise<any>>;
  /** Sections to expose (all if not specified) */
  sections?: string[];
  /** Tools to exclude by name */
  excludeTools?: string[];
  /** Callback for logging */
  onLog?: (level: 'info' | 'error' | 'debug', message: string) => void;
  /** Callback before each tool call (for auto-init, auto-watch, etc.) */
  onBeforeToolCall?: (toolName: string, args: any) => Promise<void>;
}

/**
 * Start the RagForge MCP server
 */
export async function startMcpServer(config: McpServerConfig): Promise<void> {
  const {
    name = 'ragforge',
    version = '0.3.0',
    tools,
    handlers,
    sections,
    excludeTools = [],
    onLog = () => {},
    onBeforeToolCall,
  } = config;

  // Filter tools by section and exclusions
  let filteredTools = tools;

  if (sections && sections.length > 0) {
    const sectionSet = new Set(sections);
    filteredTools = filteredTools.filter(t => t.section && sectionSet.has(t.section));
  }

  if (excludeTools.length > 0) {
    const excludeSet = new Set(excludeTools);
    filteredTools = filteredTools.filter(t => !excludeSet.has(t.name));
  }

  // Convert to MCP format
  const mcpTools = convertAllTools(filteredTools);

  // Log tool summary
  const toolsBySection = getToolsBySection(filteredTools);
  onLog('info', `RagForge MCP Server starting with ${mcpTools.length} tools`);
  for (const [section, toolNames] of Object.entries(toolsBySection)) {
    onLog('debug', `  ${section}: ${toolNames.join(', ')}`);
  }

  // Create server
  const server = new Server(
    { name, version },
    { capabilities: { tools: {} } }
  );

  // Handle list_tools request
  server.setRequestHandler(ListToolsRequestSchema, async (): Promise<ListToolsResult> => {
    onLog('debug', 'Received list_tools request');
    return { tools: mcpTools };
  });

  // Handle call_tool request
  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const { name: toolName, arguments: args } = request.params;

    onLog('info', `Calling tool: ${toolName}`);
    onLog('debug', `Arguments: ${JSON.stringify(args)}`);

    // Find handler
    const handler = handlers[toolName];
    if (!handler) {
      onLog('error', `Unknown tool: ${toolName}`);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: `Unknown tool: ${toolName}`,
              available: mcpTools.map(t => t.name),
            }),
          },
        ],
        isError: true,
      };
    }

    try {
      // Pre-call hook (auto-init, auto-watch, etc.)
      if (onBeforeToolCall) {
        await onBeforeToolCall(toolName, args || {});
      }

      // Execute handler
      const result = await handler(args || {});

      onLog('debug', `Result: ${JSON.stringify(result).slice(0, 200)}...`);

      // Format result
      const resultText = typeof result === 'string'
        ? result
        : JSON.stringify(result, null, 2);

      return {
        content: [{ type: 'text', text: resultText }],
      };
    } catch (error: any) {
      onLog('error', `Error in ${toolName}: ${error.message}`);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: error.message,
              tool: toolName,
              stack: error.stack,
            }),
          },
        ],
        isError: true,
      };
    }
  });

  // Start server with stdio transport
  const transport = new StdioServerTransport();

  onLog('info', 'Connecting to stdio transport...');

  await server.connect(transport);

  onLog('info', 'RagForge MCP Server running');
}

/**
 * Create a minimal MCP server with just the specified tools
 * (for testing or simple use cases)
 */
export async function startMinimalMcpServer(
  tools: GeneratedToolDefinition[],
  handlers: Record<string, (args: any) => Promise<any>>
): Promise<void> {
  return startMcpServer({ tools, handlers });
}
