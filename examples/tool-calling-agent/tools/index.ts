/**
 * TOOL REGISTRY SETUP
 * 
 * Combines auto-generated database tools with custom tools
 */

import type { RagClient } from '@luciformresearch/ragforge-runtime';
import { ToolRegistry } from '@luciformresearch/ragforge-runtime';
import { DATABASE_TOOLS, attachDatabaseHandlers } from './database-tools.js';
import { CUSTOM_TOOLS, attachCustomHandlers } from './custom-tools.js';

/**
 * Setup tool registry with all available tools
 * 
 * @param ragClient - RAG client instance
 * @returns Configured ToolRegistry
 * 
 * @example
 * const registry = setupToolRegistry(ragClient);
 * const agent = new AgentRuntime({ registry });
 */
export function setupToolRegistry(ragClient: RagClient): ToolRegistry {
  const registry = new ToolRegistry();

  // Register database tools
  const dbHandlers = attachDatabaseHandlers(ragClient);
  for (const tool of DATABASE_TOOLS) {
    const handler = dbHandlers.get(tool.name);
    if (handler) {
      registry.registerTool(tool, handler);
    }
  }

  // Register custom tools
  const customHandlers = attachCustomHandlers(ragClient);
  for (const tool of CUSTOM_TOOLS) {
    const handler = customHandlers.get(tool.name);
    if (handler) {
      registry.registerTool(tool, handler);
    }
  }

  return registry;
}

// Re-export for convenience
export { DATABASE_TOOLS } from './database-tools.js';
export { CUSTOM_TOOLS } from './custom-tools.js';
