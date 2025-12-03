/**
 * Basic Tool Calling Test
 *
 * Demonstrates StructuredLLMExecutor with tool calling
 * using RagForge's codebase as the knowledge base.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import {
  StructuredLLMExecutor,
  BaseToolExecutor,
  GeminiAPIProvider,
  GeminiNativeToolProvider,
  type ToolCallRequest,
  type ToolDefinition,
  type LLMProvider,
  type NativeToolCallingProvider,
} from '@luciformresearch/ragforge-runtime';
import { createRagClient } from './client.js';

// Load environment
config({ path: resolve(process.cwd(), '.env') });

// Create RAG client for tool execution
const rag = createRagClient();

/**
 * Tool Executor that uses RAG queries.
 * Extends BaseToolExecutor for automatic parallel execution of multiple tool calls.
 */
class CodeSearchToolExecutor extends BaseToolExecutor {
  private llmProvider: LLMProvider;
  private executor: StructuredLLMExecutor;

  constructor(llmProvider: LLMProvider) {
    super();
    this.llmProvider = llmProvider;
    this.executor = new StructuredLLMExecutor();
  }

  async execute(toolCall: ToolCallRequest): Promise<any> {
    console.log(`   🔧 Executing: ${toolCall.tool_name}(${JSON.stringify(toolCall.arguments)})`);
    const result = await this._executeInternal(toolCall);
    console.log(`   📤 Result:`, JSON.stringify(result).substring(0, 200));
    return result;
  }

  private async _executeInternal(toolCall: ToolCallRequest): Promise<any> {

    switch (toolCall.tool_name) {
      case 'search_functions':
        return await this.searchFunctions(toolCall.arguments.query);

      case 'get_scope_details':
        return await this.getScopeDetails(toolCall.arguments.scopeName);

      case 'search_by_relationship':
        return await this.searchByRelationship(
          toolCall.arguments.scopeName,
          toolCall.arguments.relationship
        );

      case 'batch_analyze':
        return await this.batchAnalyze(
          toolCall.arguments.items,
          toolCall.arguments.task,
          toolCall.arguments.outputSchema
        );

      default:
        throw new Error(`Unknown tool: ${toolCall.tool_name}`);
    }
  }

  // Note: executeBatch is inherited from BaseToolExecutor and runs tools in parallel!

  /**
   * Search for code elements by name (exact or partial match)
   * Searches functions, methods, classes, and other code scopes
   */
  private async searchFunctions(query: string): Promise<any> {
    // Use server-side name filtering with 'contains'
    const results = await rag.scope()
      .where({ name: { contains: query } })
      .limit(10)
      .execute();

    return results.map((r: any) => ({
      name: r.entity.name,
      file: r.entity.file,
      type: r.entity.type,
      line_start: r.entity.line_start,
      line_end: r.entity.line_end,
    }));
  }

  /**
   * Get detailed information about a specific scope
   */
  private async getScopeDetails(scopeName: string): Promise<any> {
    const results = await rag.scope()
      .where({ name: scopeName })
      .limit(1)
      .execute();

    if (results.length === 0) {
      return { error: 'Scope not found' };
    }

    const entity = results[0].entity; // Access entity wrapper
    return {
      name: entity.name,
      type: entity.type,
      file: entity.file,
      line_start: entity.line_start,
      line_end: entity.line_end,
      source: entity.source?.substring(0, 500), // First 500 chars
      signature: entity.signature,
    };
  }

  /**
   * Search by relationships (e.g., what does this function call?)
   */
  private async searchByRelationship(scopeName: string, relationship: string): Promise<any> {
    // Get scope with expanded relationships
    const results = await rag.scope()
      .where({ name: scopeName })
      .withConsumes()  // Expand CONSUMES relationship
      .limit(1)
      .execute();

    if (results.length === 0) {
      return { error: 'Scope not found' };
    }

    const result = results[0];
    const entity = result.entity;
    // Expanded relationships are in context.related
    const related = result.context?.related || [];

    return {
      scope: scopeName,
      relationship,
      entity: {
        name: entity.name,
        type: entity.type,
        file: entity.file,
      },
      related: related.slice(0, 10).map((r: any) => ({
        name: r.name,
        type: r.type,
        file: r.file,
      })),
    };
  }

  /**
   * Meta-LLM tool: Analyze/transform items with structured LLM output
   *
   * This is the power tool - allows agent to use executeLLMBatch on results from other tools
   */
  private async batchAnalyze(
    items: any[],
    task: string,
    outputSchema: Record<string, any>
  ): Promise<any> {
    if (!items || items.length === 0) {
      return [];
    }

    console.log(`   🧠 Meta-LLM: Analyzing ${items.length} items with task: "${task}"`);

    // Determine input fields from first item
    const inputFields = Object.keys(items[0]);

    // Execute batch LLM analysis
    const results = await this.executor.executeLLMBatch(items, {
      inputFields,
      userTask: task,
      outputSchema,
      llmProvider: this.llmProvider,
      batchSize: 5, // Process 5 at a time
    });

    return Array.isArray(results) ? results : results.items;
  }
}

/**
 * Tool definitions for the LLM
 */
const TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'search_functions',
      description: 'Search for functions in the RagForge codebase by name. Returns matching functions with their location.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Function name to search for (partial match supported)',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_scope_details',
      description: 'Get detailed information about a specific function, class, or other scope by its exact name.',
      parameters: {
        type: 'object',
        properties: {
          scopeName: {
            type: 'string',
            description: 'Exact name of the scope to get details for',
          },
        },
        required: ['scopeName'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_by_relationship',
      description: 'Find what a scope consumes, calls, or depends on.',
      parameters: {
        type: 'object',
        properties: {
          scopeName: {
            type: 'string',
            description: 'Name of the scope to analyze',
          },
          relationship: {
            type: 'string',
            description: 'Type of relationship (consumes, defined_in, etc.)',
          },
        },
        required: ['scopeName', 'relationship'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'batch_analyze',
      description: 'Use LLM to analyze/transform a batch of items with structured output. Perfect for analyzing search results, generating suggestions, or extracting insights. This is a meta-tool that lets you apply structured LLM reasoning to results from other tools.',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            description: 'Array of items to analyze (typically from a previous tool call)',
            items: { type: 'object' },
          },
          task: {
            type: 'string',
            description: 'What to do with each item. Examples: "suggest refactoring improvements", "analyze complexity and identify issues", "extract key insights"',
          },
          outputSchema: {
            type: 'object',
            description: 'Schema for structured output per item. Define the fields you want extracted. Example: {suggestion: {type: "string"}, priority: {type: "string", enum: ["low","medium","high"]}}',
          },
        },
        required: ['items', 'task', 'outputSchema'],
      },
    },
  },
];

async function testGlobalMode() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 1: Global Mode - Analyze Multiple Functions');
  console.log('='.repeat(60));

  const executor = new StructuredLLMExecutor();

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not set');
  }

  const llmProvider: LLMProvider = new GeminiAPIProvider({
    apiKey,
    model: 'gemini-2.0-flash',
    temperature: 0.1,
  });

  // Create native tool provider for global mode
  const nativeToolProvider: NativeToolCallingProvider = new GeminiNativeToolProvider({
    apiKey,
    model: 'gemini-2.0-flash',
    temperature: 0.1,
  });

  // Questions about RagForge functions
  const questions = [
    { question: 'What does the executeLLMBatch function do?' },
    { question: 'Find information about the QueryBuilder class' },
    { question: 'What is StructuredLLMExecutor?' },
  ];

  try {
    const results = await executor.executeLLMBatchWithTools(
      questions,
      {
        inputFields: ['question'],
        systemPrompt: 'You are a code analysis assistant. Use the available tools to search the RagForge codebase and answer questions about it.',
        userTask: 'Answer each question by searching the codebase using the available tools.',
        outputSchema: {
          answer: {
            type: 'string',
            description: 'Your answer based on the code search results',
            required: true,
          },
          confidence: {
            type: 'string',
            description: 'Confidence level: high, medium, low',
            required: true,
          },
        },
        tools: TOOLS,
        toolMode: 'global',
        toolChoice: 'any', // Force at least one tool call
        nativeToolProvider, // Add native tool provider
        toolExecutor: new CodeSearchToolExecutor(llmProvider),
        llmProvider,
        batchSize: 10,
      }
    );

    console.log('\n📤 Results:\n');
    if (Array.isArray(results)) {
      results.forEach((r, i) => {
        console.log(`${i + 1}. Question: ${r.question}`);
        console.log(`   Answer: ${r.answer}`);
        console.log(`   Confidence: ${r.confidence}\n`);
      });
    }

    console.log('✅ Global mode test passed!\n');
  } catch (error) {
    console.error('❌ Global mode test failed:', error);
    throw error;
  }
}

async function testPerItemMode() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 2: Per-Item Mode - Deep Dive into Functions');
  console.log('='.repeat(60));

  const executor = new StructuredLLMExecutor();

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not set');
  }

  const llmProvider: LLMProvider = new GeminiAPIProvider({
    apiKey,
    model: 'gemini-2.0-flash',
    temperature: 0.1,
  });

  const tasks = [
    { task: 'Find what executeLLMBatch depends on (what it consumes)' },
  ];

  try {
    const results = await executor.executeLLMBatchWithTools(
      tasks,
      {
        inputFields: ['task'],
        systemPrompt: 'You are a code analysis assistant with access to the RagForge codebase.',
        userTask: 'Complete each task by using the search tools iteratively.',
        outputSchema: {
          findings: {
            type: 'string',
            description: 'What you discovered',
            required: true,
          },
          tools_used: {
            type: 'string',
            description: 'List of tools you called',
            required: false,
          },
        },
        tools: TOOLS,
        toolMode: 'per-item',
        maxIterationsPerItem: 5,
        toolExecutor: new CodeSearchToolExecutor(llmProvider),
        llmProvider,
      }
    );

    console.log('\n📤 Results:\n');
    if (Array.isArray(results)) {
      results.forEach((r, i) => {
        console.log(`${i + 1}. Task: ${r.task}`);
        console.log(`   Findings: ${r.findings}`);
        if (r.tools_used) {
          console.log(`   Tools Used: ${r.tools_used}`);
        }
        console.log();
      });
    }

    console.log('✅ Per-item mode test passed!\n');
  } catch (error) {
    console.error('❌ Per-item mode test failed:', error);
    throw error;
  }
}

async function main() {
  console.log('🧪 RagForge Tool Calling Tests\n');
  console.log('Using RagForge codebase as knowledge base');
  console.log('Database: 900+ functions, classes, and scopes\n');

  try {
    await testGlobalMode();
    await testPerItemMode();

    console.log('='.repeat(60));
    console.log('🎉 All tests passed!');
    console.log('='.repeat(60));
  } catch (error) {
    console.error('\n💥 Test suite failed:', error);
    process.exit(1);
  } finally {
    await rag.close();
  }
}

main();
