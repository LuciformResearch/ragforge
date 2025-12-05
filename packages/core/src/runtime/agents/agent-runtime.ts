/**
 * Generic Agent Runtime with Tool Loop Pattern
 *
 * Executes agents for ANY domain configured in RagForge.
 * Completely domain-agnostic - works with code, products, documents, etc.
 *
 * Pattern (inspired by LlamaIndex llm.exec but fully custom):
 * 1. Call LLM with current context + available tools
 * 2. If LLM returns tool_calls → execute them
 * 3. Add tool results to context
 * 4. Loop back to step 1
 * 5. Exit when LLM returns answer (no tool_calls)
 *
 * Uses StructuredLLMExecutor for robust parsing.
 */

import { StructuredLLMExecutor } from '../llm/structured-llm-executor.js';
import type { LLMProvider } from '../reranking/llm-provider.js';
import type { ToolRegistry } from './tools/tool-registry.js';
import type { ChatSessionManager } from '../chat/session-manager.js';
import type { Message, AgentConfig, ToolCall, Tool } from '../types/chat.js';
import { v4 as uuidv4 } from 'uuid';
import {
  GeminiNativeToolProvider,
  type ToolDefinition,
  type Message as NativeMessage,
} from '../llm/native-tool-calling/index.js';

// ============================================
// Types for Agent Loop
// ============================================

/**
 * Conversation context accumulated through loop iterations
 */
interface ConversationContext {
  history: Message[];
  userQuery: string;
  toolExecutions: ToolExecution[];
}

/**
 * Single tool execution (one iteration)
 */
interface ToolExecution {
  iteration: number;
  reasoning: string;
  toolCalls: ToolCallRequest[];
  results: ToolResult[];
}

/**
 * Tool call request from LLM
 */
interface ToolCallRequest {
  tool_name: string;
  arguments: Record<string, any>;
}

/**
 * Tool execution result
 */
interface ToolResult {
  tool_name: string;
  success: boolean;
  result?: any;
  error?: string;
}

/**
 * LLM response from StructuredLLMExecutor
 */
interface LLMResponse {
  reasoning: string;
  tool_calls?: ToolCallRequest[];
  answer?: string;
  // NEW: Tool feedback (only when debug mode enabled)
  tool_feedback?: import('../types/chat.js').ToolFeedback;
}

// ============================================
// Agent Runtime with Tool Loop
// ============================================

/**
 * Agent Runtime
 *
 * Implements an iterative loop pattern:
 * - Calls LLM with context and tools
 * - Executes any requested tools
 * - Adds results to context
 * - Loops until LLM provides final answer
 */
export class AgentRuntime {
  private executor: StructuredLLMExecutor;
  private nativeToolProvider?: GeminiNativeToolProvider;
  private MAX_ITERATIONS = 10; // Safety limit

  constructor(
    private config: AgentConfig,
    private llmProvider: LLMProvider,
    private tools: ToolRegistry,
    private sessionManager: ChatSessionManager
  ) {
    this.executor = new StructuredLLMExecutor();

    // Setup finalResponse for debug mode if enabled
    if (this.isDebugModeEnabled() && !this.config.finalResponse) {
      this.setupDebugModeFinalResponse();
    }

    // Try to initialize native tool calling provider
    this.initializeNativeToolProvider();
  }

  /**
   * Setup finalResponse configuration for debug mode
   * Automatically configures tool feedback schema
   */
  private setupDebugModeFinalResponse(): void {
    const feedbackConfig = this.config.debug?.tool_feedback;

    this.config.finalResponse = {
      fieldName: 'tool_feedback',
      format: 'xml',
      prompt: `You just completed answering a user query. Please provide structured feedback about your experience.`,
      schema: {
        tool_feedback: {
          type: 'object',
          description: 'Structured feedback about tool usage',
          required: true,
          properties: {
            tools_used: {
              type: 'array',
              description: 'List of tools you used',
              required: true,
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'Tool name', required: true },
                  purpose: { type: 'string', description: 'Why you used this tool', required: true },
                  success: { type: 'boolean', description: 'Whether the tool succeeded', required: true },
                  result_quality: { type: 'string', description: 'Quality of results', required: false }
                }
              }
            },
            limitations: {
              type: 'array',
              description: 'Limitations you encountered',
              required: false,
              items: {
                type: 'object',
                properties: {
                  description: { type: 'string', description: 'What limitation you faced', required: true },
                  impact: { type: 'string', description: 'Impact severity', required: true },
                  missing_capability: { type: 'string', description: 'Type of missing capability', required: false }
                }
              }
            },
            suggestions: {
              type: 'array',
              description: 'Suggestions for improving the tools',
              required: false,
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string', description: 'Type of suggestion', required: true },
                  priority: { type: 'string', description: 'Priority level', required: true },
                  description: { type: 'string', description: 'Detailed suggestion', required: true },
                  tool_spec: {
                    type: 'object',
                    description: 'Specification for a new tool',
                    required: false,
                    properties: {
                      name: { type: 'string', required: false },
                      purpose: { type: 'string', required: false },
                      parameters: { type: 'array', required: false, items: { type: 'string' } }
                    }
                  }
                }
              }
            },
            answer_quality: {
              type: 'object',
              description: 'Self-assessment of answer quality',
              required: true,
              properties: {
                completeness: { type: 'number', description: 'Completeness (0-100)', required: true },
                confidence: { type: 'number', description: 'Confidence level (0-100)', required: true },
                notes: { type: 'string', description: 'Additional notes', required: false }
              }
            }
          }
        }
      }
    };
  }

  /**
   * Initialize native tool calling provider if supported
   */
  private initializeNativeToolProvider(): void {
    // Check if using Gemini via environment or config
    const apiKey = process.env.GEMINI_API_KEY;
    const model = this.config.model;

    // Only initialize if we have Gemini credentials and a Gemini model
    if (apiKey && model && (model.includes('gemini') || model.includes('models/'))) {
      try {
        this.nativeToolProvider = new GeminiNativeToolProvider({
          apiKey,
          model,
          temperature: this.config.temperature,
          maxOutputTokens: this.config.maxTokens,
        });
        console.log(`✅ Native tool calling enabled for ${model}`);
      } catch (error) {
        console.warn('⚠️  Failed to initialize native tool calling, falling back to StructuredLLMExecutor');
      }
    }
  }

  /**
   * Process a user message with tool loop
   *
   * Main entry point for agent execution.
   * Loops until agent provides a final answer or max iterations reached.
   */
  async processMessage(
    sessionId: string,
    userMessage: Message
  ): Promise<Message> {
    // 1. Get chat history
    const history = await this.sessionManager.getMessages(sessionId, 10);

    // 2. Initialize conversation context
    const context: ConversationContext = {
      history,
      userQuery: userMessage.content,
      toolExecutions: [],
    };

    // 3. Agent loop: iterate until we get a final answer
    let iteration = 0;
    let finalAnswer: string | null = null;
    let lastToolFeedback: import('../types/chat.js').ToolFeedback | undefined = undefined;

    console.log(`\n🤖 Agent starting (session: ${sessionId})`);
    console.log(`   Query: "${userMessage.content}"`);
    console.log(`   Max iterations: ${this.MAX_ITERATIONS}\n`);

    while (!finalAnswer && iteration < this.MAX_ITERATIONS) {
      iteration++;
      console.log(`\n${'='.repeat(60)}`);
      console.log(`Iteration ${iteration}`);
      console.log('='.repeat(60));

      // Call LLM with current context
      const llmResponse = await this.callLLMWithTools(context);

      console.log(`Reasoning: ${llmResponse.reasoning}`);

      // Capture tool_feedback if present (from debug mode)
      if (llmResponse.tool_feedback) {
        lastToolFeedback = llmResponse.tool_feedback;
        if (this.config.debug?.verbose_logging) {
          console.log(`🐛 Tool feedback received`);
        }
      }

      if (llmResponse.tool_calls && llmResponse.tool_calls.length > 0) {
        // LLM requested tool calls
        console.log(
          `Tool calls requested: ${llmResponse.tool_calls.map((tc) => tc.tool_name).join(', ')}`
        );

        // Execute tools
        const toolResults = await this.executeTools(llmResponse.tool_calls);

        // Add to context for next iteration
        context.toolExecutions.push({
          iteration,
          reasoning: llmResponse.reasoning,
          toolCalls: llmResponse.tool_calls,
          results: toolResults,
        });

        console.log(
          `Tools executed: ${toolResults.filter((r) => r.success).length}/${toolResults.length} successful`
        );
      } else if (llmResponse.answer) {
        // LLM provided final answer
        finalAnswer = llmResponse.answer;
        console.log(`Final answer provided (${finalAnswer.length} chars)`);
      } else {
        // No tool calls and no answer - something went wrong
        console.warn('⚠️  LLM returned neither tool_calls nor answer');
        finalAnswer = llmResponse.reasoning || 'Unable to generate response';
      }
    }

    if (iteration >= this.MAX_ITERATIONS && !finalAnswer) {
      console.warn(`⚠️  Max iterations (${this.MAX_ITERATIONS}) reached`);
      finalAnswer = `Unable to complete request after ${this.MAX_ITERATIONS} iterations`;
    }

    console.log(`\n✅ Agent complete (${iteration} iterations, ${context.toolExecutions.length} tool executions)\n`);

    // 4. Generate final structured response if configured
    if (this.config.finalResponse && finalAnswer) {
      const finalResponseData = await this.generateFinalResponse(userMessage.content, finalAnswer, context);

      // Extract tool_feedback if it's the debug mode field
      if (this.config.finalResponse.fieldName === 'tool_feedback' && finalResponseData) {
        lastToolFeedback = finalResponseData.tool_feedback || finalResponseData;
      }
    }

    // 5. Create agent message with all tool executions and feedback
    return this.createAgentMessage(sessionId, finalAnswer!, context.toolExecutions, lastToolFeedback);
  }

  // ============================================
  // LLM Call with Tools
  // ============================================

  /**
   * Call LLM with current context and available tools
   *
   * Uses native tool calling if available, otherwise falls back to StructuredLLMExecutor
   * NOTE: Debug mode feedback is now handled via the 'respond' tool, so native tool calling works in all modes
   */
  private async callLLMWithTools(
    context: ConversationContext
  ): Promise<LLMResponse> {
    // Try native tool calling first (works for both normal and debug mode with 'respond' tool)
    if (this.nativeToolProvider) {
      try {
        return await this.callLLMWithNativeTools(context);
      } catch (error) {
        console.warn('⚠️  Native tool calling failed, falling back to StructuredLLMExecutor:', error);
      }
    }

    // Fallback to StructuredLLMExecutor (XML-based)
    return this.callLLMWithStructuredExecutor(context);
  }

  /**
   * Call LLM using native tool calling (Gemini)
   */
  private async callLLMWithNativeTools(
    context: ConversationContext
  ): Promise<LLMResponse> {
    if (!this.nativeToolProvider) {
      throw new Error('Native tool provider not initialized');
    }

    // Convert context to messages
    const messages = this.buildMessagesFromContext(context);

    // Get tool definitions
    const toolDefinitions = this.getToolDefinitions();

    // Call native provider
    const response = await this.nativeToolProvider.generateWithTools(
      messages,
      toolDefinitions,
      {
        toolChoice: "auto",
        temperature: this.config.temperature,
        maxTokens: this.config.maxTokens,
      }
    );

    // Convert to our LLMResponse format
    return {
      reasoning: response.content || "Using native tool calling",
      tool_calls: response.toolCalls?.map(tc => ({
        tool_name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments),
      })),
      answer: response.toolCalls ? undefined : response.content,
    };
  }

  /**
   * Call LLM using StructuredLLMExecutor (XML-based, fallback)
   */
  private async callLLMWithStructuredExecutor(
    context: ConversationContext
  ): Promise<LLMResponse> {
    // Build system prompt with tools
    const systemPrompt = this.buildSystemPromptWithTools();

    // Build user task with full context
    const userTask = this.buildUserTaskWithContext(context);

    // Call StructuredLLMExecutor with dynamic schema (includes tool_feedback in debug mode)
    const result = await this.executor.executeLLMBatch<any, LLMResponse>(
      [{ context: 'see_task' }], // Placeholder, context is in userTask
      {
        inputFields: ['context'],
        systemPrompt,
        userTask,
        outputSchema: this.buildOutputSchema(),
        outputFormat: 'xml',
        llmProvider: this.llmProvider,
        batchSize: 1,
      }
    );

    return Array.isArray(result) ? result[0] : result.items[0];
  }

  /**
   * Build output schema (includes tool_feedback when debug mode enabled)
   */
  private buildOutputSchema(): any {
    const schema: any = {
      reasoning: {
        type: 'string',
        description: 'Your reasoning about the next step',
        required: true,
      },
      tool_calls: {
        type: 'array',
        description: 'Tools to execute (if you need more information)',
        required: false,
        items: {
          type: 'object',
          description: 'Tool call',
          properties: {
            tool_name: {
              type: 'string',
              description: 'Name of the tool to call',
              required: true,
            },
            arguments: {
              type: 'object',
              description: 'Tool arguments as key-value pairs',
              required: true,
            },
          },
        },
      },
      answer: {
        type: 'string',
        description: 'Final answer (if you have enough information)',
        required: false,
      },
    };

    // Add tool_feedback field if debug mode is enabled
    if (this.isDebugModeEnabled()) {
      schema.tool_feedback = {
        type: 'object',
        description: 'Structured feedback about tool usage, limitations, and suggestions',
        required: false,
        properties: {
          tools_used: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', required: true },
                purpose: { type: 'string', required: true },
                success: { type: 'boolean', required: true },
                result_quality: { type: 'string', required: false }
              }
            }
          },
          tools_considered: {
            type: 'array',
            required: false,
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', required: true },
                reason_not_used: { type: 'string', required: true }
              }
            }
          },
          limitations: {
            type: 'array',
            required: false,
            items: {
              type: 'object',
              properties: {
                description: { type: 'string', required: true },
                impact: { type: 'string', required: true },
                missing_capability: { type: 'string', required: false }
              }
            }
          },
          suggestions: {
            type: 'array',
            required: false,
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', required: true },
                priority: { type: 'string', required: true },
                description: { type: 'string', required: true },
                tool_spec: { type: 'object', required: false },
                config_change: { type: 'object', required: false }
              }
            }
          },
          alternatives: {
            type: 'array',
            required: false,
            items: {
              type: 'object',
              properties: {
                approach: { type: 'string', required: true },
                pros: { type: 'array', required: true },
                cons: { type: 'array', required: true },
                requires: { type: 'array', required: false }
              }
            }
          },
          answer_quality: {
            type: 'object',
            required: true,
            properties: {
              completeness: { type: 'number', required: true },
              confidence: { type: 'number', required: true },
              notes: { type: 'string', required: false }
            }
          }
        }
      };
    }

    return schema;
  }

  /**
   * Build system prompt with tool descriptions
   */
  private buildSystemPromptWithTools(): string {
    const tools = this.config.tools
      .map((name) => this.tools.get(name))
      .filter((t): t is Tool => t !== undefined);

    let prompt = `${this.config.systemPrompt}

Available Tools:
${tools.map((t) => this.formatToolDescription(t)).join('\n\n')}

Instructions:
- Use reasoning to explain your thought process in every response
- If you need more information, call tools to gather data
- You can call multiple tools in one iteration
- Once you have enough information, provide the final answer
- Keep iterating until you can provide a complete answer`;

    return prompt;
  }

  /**
   * Generate final structured response after tool loop completes
   * Uses StructuredLLMExecutor with configured schema
   */
  private async generateFinalResponse(
    userQuery: string,
    finalAnswer: string,
    context: ConversationContext
  ): Promise<any> {
    if (!this.config.finalResponse) return undefined;

    const config = this.config.finalResponse;

    // Build context description
    const toolExecutionsSummary = context.toolExecutions.map((exec, i) => {
      return `Iteration ${exec.iteration}:
- Tools called: ${exec.toolCalls.map(tc => tc.tool_name).join(', ')}
- Results: ${exec.results.map((r, j) =>
  `${exec.toolCalls[j].tool_name}: ${r.success ? 'success' : 'failed'}`
).join(', ')}`;
    }).join('\n\n');

    const userTask = `${config.prompt}

USER QUERY:
"${userQuery}"

YOUR FINAL ANSWER:
"${finalAnswer}"

TOOL EXECUTIONS:
${toolExecutionsSummary || '(No tools were used)'}

AVAILABLE TOOLS:
${this.config.tools.join(', ')}

Please provide your analysis in the requested structured format.`;

    console.log(`🔄 Generating final structured response...`);

    const result = await this.executor.executeLLMBatch<any, any>(
      [{ context: 'final_response' }],
      {
        inputFields: ['context'],
        userTask,
        outputSchema: config.schema,
        outputFormat: config.format || 'xml',
        llmProvider: this.llmProvider,
        batchSize: 1,
      }
    );

    const response = Array.isArray(result) ? result[0] : result.items[0];
    console.log(`✅ Final structured response generated`);

    return response;
  }

  /**
   * Check if debug mode is enabled
   */
  private isDebugModeEnabled(): boolean {
    return this.config.debug?.enabled === true &&
           this.config.debug?.tool_feedback?.enabled === true;
  }

  /**
   * Get debug mode instructions to append to system prompt
   */
  private getDebugModeInstructions(): string {
    const feedbackConfig = this.config.debug?.tool_feedback;

    return `

## 🐛 DEBUG MODE ACTIVE

In addition to answering the query, provide structured feedback about your tool usage.

Include these sections in your response:

${feedbackConfig?.include_reasoning !== false ? `
### Tools Used
For each tool you called, explain:
- name: Tool name
- purpose: Why you chose this tool
- success: Did it work as expected?
- result_quality: How good were the results? (excellent/good/partial/failed)
` : ''}

${feedbackConfig?.include_limitations !== false ? `
### Limitations
If you encountered any limitations, describe:
- description: What you couldn't do
- impact: How critical is this? (critical/high/medium/low)
- missing_capability: What's missing? (tool/field/operator/relationship)

Be specific. For example:
❌ "I need better tools"
✅ "Cannot filter by line_count - no numeric comparison operators available"
` : ''}

${feedbackConfig?.include_suggestions !== false ? `
### Suggestions
Recommend specific improvements:
- type: What kind of improvement? (new_tool/expose_field/add_relationship/improve_existing)
- priority: How important? (critical/high/medium/low)
- description: Detailed explanation
- tool_spec (if new_tool): {name, purpose, parameters}
- config_change (if expose_field): {entity, change, example}

For example:
✅ "A number_range_search tool would allow filtering by line_count with operators: gt, lt, between, approximately"
` : ''}

${feedbackConfig?.include_alternatives !== false ? `
### Alternatives (optional)
If there are other ways to answer the query:
- approach: Description
- pros: Advantages
- cons: Disadvantages
- requires: What would be needed
` : ''}

### Answer Quality
Assess your answer:
- completeness: 0-100% (how complete is the answer?)
- confidence: 0-100% (how confident are you?)
- notes: Additional context

IMPORTANT:
1. Always provide the BEST answer possible with current tools
2. Then add feedback to explain limitations and suggest improvements
3. Be honest about what you can and cannot do
4. Make suggestions specific and actionable`;
  }

  /**
   * Build user task with accumulated context
   */
  private buildUserTaskWithContext(context: ConversationContext): string {
    let task = `User Query: "${context.userQuery}"
`;

    // Add conversation history if present
    if (context.history.length > 0) {
      task += `\nConversation History:\n`;
      context.history.forEach((m) => {
        task += `${m.role}: ${m.content}\n`;
      });
    }

    // Add previous tool executions if any
    if (context.toolExecutions.length > 0) {
      task += `\n\nPrevious Tool Executions:\n`;
      context.toolExecutions.forEach((exec) => {
        task += `\nIteration ${exec.iteration}:`;
        task += `\n  Reasoning: ${exec.reasoning}`;
        task += `\n  Tools Called: ${exec.toolCalls.map((tc) => tc.tool_name).join(', ')}`;
        task += `\n  Results:`;

        exec.results.forEach((result, i) => {
          const tc = exec.toolCalls[i];
          task += `\n    - ${tc.tool_name}(${JSON.stringify(tc.arguments)})`;
          if (result.success) {
            const resultStr = JSON.stringify(result.result);
            task += `: ${resultStr.length > 200 ? resultStr.substring(0, 200) + '...' : resultStr}`;
          } else {
            task += `: ERROR - ${result.error}`;
          }
        });
      });
    }

    task += `\n\nNow decide your next step:
- Do you need more information? → Provide tool_calls array
- Can you answer the user's query? → Provide answer

Important:
- Always provide reasoning
- Be concise in your reasoning (2-3 sentences)
- Reference specific entities/results in your answer`;

    return task;
  }

  /**
   * Format tool description for LLM prompt
   */
  private formatToolDescription(tool: Tool): string {
    const requiredParams = tool.parameters.filter((p) => p.required);
    const optionalParams = tool.parameters.filter((p) => !p.required);

    let desc = `Tool: ${tool.name}
Description: ${tool.description}`;

    if (requiredParams.length > 0) {
      desc += `\nRequired Parameters:`;
      requiredParams.forEach((p) => {
        desc += `\n  - ${p.name} (${p.type}): ${p.description}`;
      });
    }

    if (optionalParams.length > 0) {
      desc += `\nOptional Parameters:`;
      optionalParams.forEach((p) => {
        desc += `\n  - ${p.name} (${p.type}): ${p.description}`;
        if (p.default !== undefined) {
          desc += ` [default: ${p.default}]`;
        }
      });
    }

    return desc;
  }

  // ============================================
  // Tool Execution
  // ============================================

  /**
   * Execute tools and return results
   */
  private async executeTools(
    toolCalls: ToolCallRequest[]
  ): Promise<ToolResult[]> {
    return Promise.all(
      toolCalls.map(async (tc) => {
        const tool = this.tools.get(tc.tool_name);
        if (!tool) {
          return {
            tool_name: tc.tool_name,
            success: false,
            error: `Tool not found: ${tc.tool_name}`,
          };
        }

        try {
          const result = await tool.execute(tc.arguments);
          return {
            tool_name: tc.tool_name,
            success: true,
            result,
          };
        } catch (error: any) {
          console.error(`   ❌ Tool ${tc.tool_name} failed:`, error.message);
          return {
            tool_name: tc.tool_name,
            success: false,
            error: error.message,
          };
        }
      })
    );
  }

  // ============================================
  // Helper Methods for Native Tool Calling
  // ============================================

  /**
   * Build messages from conversation context for native tool calling
   */
  private buildMessagesFromContext(context: ConversationContext): NativeMessage[] {
    const messages: NativeMessage[] = [];

    // Add chat history
    for (const msg of context.history) {
      messages.push({
        role: msg.role as any,
        content: msg.content,
        toolCalls: msg.toolCalls?.map(tc => ({
          id: uuidv4(),
          type: "function",
          function: {
            name: tc.toolName,
            arguments: JSON.stringify(tc.arguments),
          },
        })),
      });
    }

    // Add current user query
    messages.push({
      role: "user",
      content: context.userQuery,
    });

    // Add tool execution results
    for (const exec of context.toolExecutions) {
      // Add agent's reasoning and tool calls
      messages.push({
        role: "agent",
        content: exec.reasoning,
        toolCalls: exec.toolCalls.map(tc => ({
          id: uuidv4(),
          type: "function",
          function: {
            name: tc.tool_name,
            arguments: JSON.stringify(tc.arguments),
          },
        })),
      });

      // Add tool results
      for (let i = 0; i < exec.results.length; i++) {
        const result = exec.results[i];
        const toolCall = exec.toolCalls[i];

        messages.push({
          role: "tool",
          content: result.success
            ? JSON.stringify(result.result)
            : `Error: ${result.error}`,
          name: toolCall.tool_name,
        });
      }
    }

    return messages;
  }

  /**
   * Get tool definitions in OpenAI format for native tool calling
   */
  private getToolDefinitions(): ToolDefinition[] {
    return this.config.tools.map(toolName => {
      const tool = this.tools.get(toolName);
      if (!tool) {
        throw new Error(`Tool not found: ${toolName}`);
      }

      // Convert to OpenAI-style tool definition
      // Use inputSchema if available (for complex schemas with arrays/objects)
      // Otherwise fall back to simple parameter conversion
      const parameters = tool.inputSchema || {
        type: "object",
        properties: Object.fromEntries(
          tool.parameters.map(p => [
            p.name,
            {
              type: p.type,
              description: p.description,
              ...(p.default !== undefined ? { default: p.default } : {}),
            },
          ])
        ),
        required: tool.parameters.filter(p => p.required).map(p => p.name),
      };

      return {
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters,
        },
      };
    });
  }

  // ============================================
  // Message Creation
  // ============================================

  /**
   * Create agent message with tool execution history
   */
  private createAgentMessage(
    sessionId: string,
    content: string,
    toolExecutions: ToolExecution[],
    toolFeedback?: import('../types/chat.js').ToolFeedback
  ): Message {
    // Flatten all tool calls from all iterations
    const allToolCalls: ToolCall[] = toolExecutions.flatMap((exec) =>
      exec.toolCalls.map((tc, i) => ({
        toolName: tc.tool_name,
        arguments: tc.arguments,
        result: exec.results[i].result,
      }))
    );

    return {
      messageId: uuidv4(),
      sessionId,
      content,
      role: 'agent',
      sentBy: this.config.id,
      timestamp: new Date(),
      toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
      tool_feedback: toolFeedback, // Include feedback when debug mode enabled
    };
  }

  // ============================================
  // Public API
  // ============================================

  /**
   * Get agent configuration
   */
  getConfig(): AgentConfig {
    return this.config;
  }

  /**
   * Set max iterations (for testing or special cases)
   */
  setMaxIterations(max: number): void {
    this.MAX_ITERATIONS = max;
  }
}
