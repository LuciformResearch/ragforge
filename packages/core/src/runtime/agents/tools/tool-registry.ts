/**
 * Generic Tool Registry
 *
 * Auto-registers tools from ANY generated RagForge client.
 * Works with code, products, documents, or any custom entities.
 */

import type { Tool, ToolParameter } from '../../types/chat.js';

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  /**
   * Register a tool manually
   */
  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Get a tool by name
   */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * List all registered tools
   */
  list(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * List tools for a specific domain
   */
  listByDomain(domain: string): Tool[] {
    return this.list().filter((t) => t.domain === domain);
  }

  /**
   * Auto-register ALL query methods from a generated client entity
   *
   * This makes the registry completely generic and works with ANY entity.
   *
   * @example
   * ```typescript
   * const client = createRagClient(config);
   * const registry = new ToolRegistry();
   *
   * // Auto-register Scope entity tools
   * registry.autoRegisterFromClient(client, 'Scope');
   *
   * // Auto-register Product entity tools
   * registry.autoRegisterFromClient(client, 'Product');
   * ```
   */
  autoRegisterFromClient(client: any, entityName: string): void {
    // Get the query builder for this entity
    const builderFactory = client[entityName.toLowerCase()];
    if (!builderFactory) {
      throw new Error(
        `Entity "${entityName}" not found in client. Available: ${Object.keys(
          client
        ).join(', ')}`
      );
    }

    // Create a builder instance to introspect methods
    const builder = builderFactory();

    // Get all methods from the builder prototype
    const methods = this.getBuilderMethods(builder);

    // Create a tool for each method
    for (const method of methods) {
      const tool = this.createToolFromMethod(
        client,
        entityName,
        method,
        builder[method]
      );
      this.register(tool);
    }
  }

  /**
   * Get all queryable methods from a builder
   */
  private getBuilderMethods(builder: any): string[] {
    const methods: string[] = [];
    let obj = builder;

    // Walk the prototype chain
    while (obj && obj !== Object.prototype) {
      const props = Object.getOwnPropertyNames(obj);
      for (const prop of props) {
        if (
          typeof builder[prop] === 'function' &&
          !prop.startsWith('_') &&
          prop !== 'constructor' &&
          prop !== 'execute' &&
          !methods.includes(prop)
        ) {
          methods.push(prop);
        }
      }
      obj = Object.getPrototypeOf(obj);
    }

    return methods;
  }

  /**
   * Create a tool from a query builder method
   */
  private createToolFromMethod(
    client: any,
    entityName: string,
    methodName: string,
    method: Function
  ): Tool {
    const params = this.inferParameters(method);

    return {
      name: `generated.${entityName.toLowerCase()}.${methodName}`,
      description: this.generateDescription(entityName, methodName),
      parameters: params,
      execute: async (args) => {
        // Create a new builder instance
        const builder = client[entityName.toLowerCase()]();

        // Call the method with arguments
        const methodArgs = this.buildMethodArgs(params, args);
        const query = builder[methodName](...methodArgs);

        // Execute the query
        return await query.execute();
      },
    };
  }

  /**
   * Generate a human-readable description from method name
   */
  private generateDescription(entity: string, method: string): string {
    // Semantic search methods
    if (method.startsWith('semanticSearch')) {
      const field = method
        .replace('semanticSearchBy', '')
        .replace(/^[A-Z]/, (c) => c.toLowerCase());
      return `Search ${entity} by semantic similarity on ${field}`;
    }

    // Where filters
    if (method.startsWith('where')) {
      const field = method
        .replace('where', '')
        .replace(/^[A-Z]/, (c) => c.toLowerCase());
      return `Filter ${entity} by ${field}`;
    }

    // Relationship expansions
    if (method.startsWith('with')) {
      const rel = method.replace('with', '');
      return `Include ${rel} relationships for ${entity}`;
    }

    // Reranking
    if (method.includes('rerank') || method.includes('Rerank')) {
      return `Rerank ${entity} results using LLM`;
    }

    // Generic fallback
    return `Query ${entity} using ${method}`;
  }

  /**
   * Infer parameters from function signature
   */
  private inferParameters(method: Function): ToolParameter[] {
    const fnStr = method.toString();

    // Extract parameter list
    const match = fnStr.match(/\(([^)]*)\)/);
    if (!match || !match[1].trim()) return [];

    const paramStr = match[1];
    const params: ToolParameter[] = [];

    // Split by comma (handle objects)
    let depth = 0;
    let current = '';
    for (const char of paramStr) {
      if (char === '{' || char === '[') depth++;
      if (char === '}' || char === ']') depth--;

      if (char === ',' && depth === 0) {
        params.push(this.parseParameter(current.trim()));
        current = '';
      } else {
        current += char;
      }
    }

    if (current.trim()) {
      params.push(this.parseParameter(current.trim()));
    }

    return params;
  }

  /**
   * Parse a single parameter string
   */
  private parseParameter(paramStr: string): ToolParameter {
    // Extract name and type
    const [nameWithOptional, typeStr] = paramStr.split(':').map((s) => s.trim());
    const name = nameWithOptional.replace('?', '').trim();
    const required = !nameWithOptional.includes('?');

    // Infer type
    let type: ToolParameter['type'] = 'string';
    if (typeStr) {
      if (typeStr.includes('number')) type = 'number';
      else if (typeStr.includes('boolean')) type = 'boolean';
      else if (typeStr.includes('[]') || typeStr.includes('Array')) type = 'array';
      else if (typeStr.includes('{')) type = 'object';
    } else {
      // Infer from name
      if (name.includes('topK') || name.includes('limit')) type = 'number';
      if (name.includes('options')) type = 'object';
    }

    return {
      name,
      type,
      description: this.generateParamDescription(name, type),
      required,
    };
  }

  /**
   * Generate parameter description from name
   */
  private generateParamDescription(name: string, type: string): string {
    if (name === 'query') return 'Search query string';
    if (name === 'topK') return 'Number of results to return (default: 10)';
    if (name === 'threshold') return 'Minimum score threshold (0-1)';
    if (name === 'options') return 'Additional query options';
    if (name.includes('name')) return `${name} value`;

    return `Parameter: ${name} (${type})`;
  }

  /**
   * Build method arguments from tool parameters and user input
   */
  private buildMethodArgs(
    params: ToolParameter[],
    args: Record<string, any>
  ): any[] {
    return params.map((param) => {
      const value = args[param.name];

      // Use default or undefined if not provided
      if (value === undefined) {
        return param.default;
      }

      // Type coercion
      if (param.type === 'number' && typeof value === 'string') {
        return parseFloat(value);
      }

      return value;
    });
  }

  /**
   * Clear all registered tools
   */
  clear(): void {
    this.tools.clear();
  }

  /**
   * Check if a tool exists
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }
}
