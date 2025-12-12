/**
 * Debug Tools for Conversation Memory
 *
 * Tools for inspecting, testing, and debugging the conversation memory system.
 * Includes both read-only inspection tools and write tools for simulation.
 *
 * @since 2025-12-12
 */

import type { GeneratedToolDefinition, ToolSection } from './types/index.js';
import type { ConversationStorage } from '../runtime/conversation/storage.js';
import type { Message, ToolCall } from '../runtime/conversation/types.js';
import type { ConversationTurn } from '../runtime/conversation/summarizer.js';
import { formatLocalDate } from '../runtime/utils/timestamp.js';
import { UniqueIDHelper } from '../runtime/utils/UniqueIDHelper.js';

// ============================================
// Types
// ============================================

export interface DebugToolsContext {
  /**
   * Conversation storage instance
   */
  conversationStorage: ConversationStorage;

  /**
   * Current working directory
   */
  cwd?: string | (() => string);

  /**
   * Project root directory
   */
  projectRoot?: string | (() => string | null);

  /**
   * Embedding lock for checking availability
   */
  embeddingLock?: { isLocked: () => boolean };

  /**
   * Ingestion lock for checking availability
   */
  ingestionLock?: { isLocked: () => boolean };
}

/**
 * Helper to resolve values from context (handles both value and getter)
 */
function resolveValue<T>(value: T | (() => T) | undefined): T | undefined {
  if (typeof value === 'function') {
    return (value as () => T)();
  }
  return value;
}

// ============================================
// Tool Definitions
// ============================================

const DEBUG_SECTION: ToolSection = 'context_ops';

export function generateDebugContextTool(): GeneratedToolDefinition {
  return {
    name: 'debug_context',
    section: DEBUG_SECTION,
    description: `Inspect the enriched context that would be injected into the agent's prompt.

Use this to understand what context the agent sees for a given query.

Parameters:
- conversation_id: The conversation to inspect
- query: Simulated user query for context retrieval
- show_raw: Include raw EnrichedContext object (default: false)
- show_formatted: Include formatted context string (default: true)
- show_sources: Show detailed source breakdown (default: true)
- show_scores: Include similarity scores (default: true)

Example: debug_context({ conversation_id: "abc-123", query: "how does auth work?" })`,
    inputSchema: {
      type: 'object',
      properties: {
        conversation_id: {
          type: 'string',
          description: 'The conversation ID to inspect',
        },
        query: {
          type: 'string',
          description: 'Simulated user query for context retrieval',
        },
        show_raw: {
          type: 'boolean',
          description: 'Include raw EnrichedContext object',
          default: false,
          optional: true,
        },
        show_formatted: {
          type: 'boolean',
          description: 'Include formatted context string for agent',
          default: true,
          optional: true,
        },
        show_sources: {
          type: 'boolean',
          description: 'Show detailed source breakdown',
          default: true,
          optional: true,
        },
        show_scores: {
          type: 'boolean',
          description: 'Include similarity scores',
          default: true,
          optional: true,
        },
      },
      required: ['conversation_id', 'query'],
    },
  };
}

export function generateDebugConversationSearchTool(): GeneratedToolDefinition {
  return {
    name: 'debug_conversation_search',
    section: DEBUG_SECTION,
    description: `Test semantic search on conversation history.

Search for relevant messages and summaries in a conversation.

Parameters:
- conversation_id: The conversation to search
- query: Search query
- min_score: Minimum similarity score (default: 0.3)
- limit: Maximum results (default: 20)
- level: Filter by level - "L0" (turns), "L1", "L2", or "all" (default: "all")

Example: debug_conversation_search({ conversation_id: "abc-123", query: "authentication error", level: "L0" })`,
    inputSchema: {
      type: 'object',
      properties: {
        conversation_id: {
          type: 'string',
          description: 'The conversation ID to search',
        },
        query: {
          type: 'string',
          description: 'Search query',
        },
        min_score: {
          type: 'number',
          description: 'Minimum similarity score (0-1)',
          default: 0.3,
          optional: true,
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results',
          default: 20,
          optional: true,
        },
        level: {
          type: 'string',
          enum: ['L0', 'L1', 'L2', 'all'],
          description: 'Filter by summary level',
          default: 'all',
          optional: true,
        },
      },
      required: ['conversation_id', 'query'],
    },
  };
}

export function generateDebugInjectTurnTool(): GeneratedToolDefinition {
  return {
    name: 'debug_inject_turn',
    section: DEBUG_SECTION,
    description: `Inject a complete turn (user + tool calls + assistant) into a conversation.

Use this to simulate conversations for testing the memory system.

Parameters:
- conversation_id: Target conversation (created if doesn't exist with create_conversation=true)
- create_conversation: Create conversation if it doesn't exist (default: false)
- turn.user_message: The user's message/query
- turn.tool_calls: Array of tool calls with { tool_name, arguments, result, success? }
- turn.assistant_message: The assistant's final response
- turn.reasoning: Optional reasoning/thinking
- generate_embeddings: Generate embeddings for messages (default: true)
- trigger_summarization: Trigger L1 summary if threshold reached (default: false)

Example: debug_inject_turn({
  conversation_id: "test-conv",
  create_conversation: true,
  turn: {
    user_message: "Read config.ts",
    tool_calls: [{ tool_name: "read_file", arguments: { path: "/config.ts" }, result: "content..." }],
    assistant_message: "Here's the config file content..."
  }
})`,
    inputSchema: {
      type: 'object',
      properties: {
        conversation_id: {
          type: 'string',
          description: 'Target conversation ID',
        },
        create_conversation: {
          type: 'boolean',
          description: 'Create conversation if it doesn\'t exist',
          default: false,
          optional: true,
        },
        turn: {
          type: 'object',
          description: 'The turn to inject',
          properties: {
            user_message: {
              type: 'string',
              description: 'User message/query',
            },
            tool_calls: {
              type: 'array',
              description: 'Tool calls made by the assistant',
              items: {
                type: 'object',
                properties: {
                  tool_name: { type: 'string' },
                  arguments: { type: 'object' },
                  result: {},
                  success: { type: 'boolean', default: true },
                  duration_ms: { type: 'number', default: 100 },
                },
                required: ['tool_name', 'arguments', 'result'],
              },
              optional: true,
            },
            assistant_message: {
              type: 'string',
              description: 'Assistant\'s final response',
            },
            reasoning: {
              type: 'string',
              description: 'Optional reasoning/thinking',
              optional: true,
            },
          },
          required: ['user_message', 'assistant_message'],
        },
        generate_embeddings: {
          type: 'boolean',
          description: 'Generate embeddings for messages',
          default: true,
          optional: true,
        },
        trigger_summarization: {
          type: 'boolean',
          description: 'Trigger L1 summary if threshold reached',
          default: false,
          optional: true,
        },
      },
      required: ['conversation_id', 'turn'],
    },
  };
}

export function generateDebugListSummariesTool(): GeneratedToolDefinition {
  return {
    name: 'debug_list_summaries',
    section: DEBUG_SECTION,
    description: `List all summaries (L1 and L2) for a conversation.

Parameters:
- conversation_id: The conversation to inspect
- level: Filter by level - "L1", "L2", or "all" (default: "all")
- include_content: Include full summary content (default: false)

Example: debug_list_summaries({ conversation_id: "abc-123", level: "L1", include_content: true })`,
    inputSchema: {
      type: 'object',
      properties: {
        conversation_id: {
          type: 'string',
          description: 'The conversation ID to inspect',
        },
        level: {
          type: 'string',
          enum: ['L1', 'L2', 'all'],
          description: 'Filter by summary level',
          default: 'all',
          optional: true,
        },
        include_content: {
          type: 'boolean',
          description: 'Include full summary content',
          default: false,
          optional: true,
        },
      },
      required: ['conversation_id'],
    },
  };
}

export function generateDebugMessageTool(): GeneratedToolDefinition {
  return {
    name: 'debug_message',
    section: DEBUG_SECTION,
    description: `Inspect a specific message and its metadata.

Parameters:
- message_id: Message UUID (either this or conversation_id + turn_index)
- conversation_id: Conversation ID (with turn_index)
- turn_index: Turn index within conversation
- show_embedding: Show embedding vector preview (default: false)
- show_tool_calls: Include tool calls and results (default: true)
- show_neighbors: Show previous/next messages (default: false)

Example: debug_message({ conversation_id: "abc-123", turn_index: 5, show_tool_calls: true })`,
    inputSchema: {
      type: 'object',
      properties: {
        message_id: {
          type: 'string',
          description: 'Message UUID',
          optional: true,
        },
        conversation_id: {
          type: 'string',
          description: 'Conversation ID (with turn_index)',
          optional: true,
        },
        turn_index: {
          type: 'number',
          description: 'Turn index within conversation',
          optional: true,
        },
        show_embedding: {
          type: 'boolean',
          description: 'Show embedding vector preview',
          default: false,
          optional: true,
        },
        show_tool_calls: {
          type: 'boolean',
          description: 'Include tool calls and results',
          default: true,
          optional: true,
        },
        show_neighbors: {
          type: 'boolean',
          description: 'Show previous/next messages',
          default: false,
          optional: true,
        },
      },
      required: [],
    },
  };
}

// ============================================
// Handler Generators
// ============================================

export function generateDebugContextHandler(ctx: DebugToolsContext) {
  return async (args: {
    conversation_id: string;
    query: string;
    show_raw?: boolean;
    show_formatted?: boolean;
    show_sources?: boolean;
    show_scores?: boolean;
  }) => {
    const storage = ctx.conversationStorage;
    const startTime = Date.now();

    try {
      // Build enriched context
      const enrichedContext = await storage.buildEnrichedContext(
        args.conversation_id,
        args.query,
        {
          cwd: resolveValue(ctx.cwd),
          projectRoot: resolveValue(ctx.projectRoot) || undefined,
          embeddingLock: ctx.embeddingLock,
          ingestionLock: ctx.ingestionLock,
        }
      );

      const searchTimeMs = Date.now() - startTime;

      // Calculate stats
      const formattedContext = storage.formatContextForAgent(enrichedContext);
      const totalChars = formattedContext.length;

      // Build response
      const result: Record<string, any> = {
        stats: {
          total_chars: totalChars,
          budget_used_percent: Math.round((totalChars / 100000) * 100), // Assuming 100k default
          search_time_ms: searchTimeMs,
        },
      };

      // Sources breakdown
      if (args.show_sources !== false) {
        result.sources = {
          last_user_queries: {
            count: enrichedContext.lastUserQueries?.length || 0,
            chars: enrichedContext.lastUserQueries?.reduce((sum, q) => sum + q.userMessage.length, 0) || 0,
          },
          recent_turns: {
            count: enrichedContext.recentTurns?.length || 0,
            chars: enrichedContext.recentTurns?.reduce((sum, t) =>
              sum + t.userMessage.length + t.assistantMessage.length, 0) || 0,
          },
          code_results: {
            count: enrichedContext.codeSemanticResults?.length || 0,
          },
          l1_summaries: {
            count: enrichedContext.level1SummariesNotSummarized?.length || 0,
          },
        };
      }

      // Formatted context
      if (args.show_formatted !== false) {
        result.formatted_context = formattedContext;
      }

      // Raw context
      if (args.show_raw) {
        result.raw_context = enrichedContext;
      }

      // Scores detail
      if (args.show_scores && enrichedContext.codeSemanticResults) {
        result.code_search_scores = enrichedContext.codeSemanticResults.map(r => ({
          file: r.file,
          lines: `${r.startLine}-${r.endLine}`,
          score: r.score,
          confidence: r.confidence,
          name: r.name,
        }));
      }

      return result;
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
        conversation_id: args.conversation_id,
        query: args.query,
      };
    }
  };
}

export function generateDebugConversationSearchHandler(ctx: DebugToolsContext) {
  return async (args: {
    conversation_id: string;
    query: string;
    min_score?: number;
    limit?: number;
    level?: 'L0' | 'L1' | 'L2' | 'all';
  }) => {
    const storage = ctx.conversationStorage;
    const startTime = Date.now();

    try {
      // Determine which levels to search
      const levels: number[] = [];
      if (!args.level || args.level === 'all') {
        levels.push(0, 1, 2);
      } else if (args.level === 'L0') {
        levels.push(0);
      } else if (args.level === 'L1') {
        levels.push(1);
      } else if (args.level === 'L2') {
        levels.push(2);
      }

      // Search conversation history
      const results = await storage.searchConversationHistory(
        args.conversation_id,
        args.query,
        {
          semantic: true,
          includeTurns: true,
          levels,
          maxResults: args.limit || 20,
          minScore: args.min_score || 0.3,
        }
      );

      const searchTimeMs = Date.now() - startTime;

      return {
        query: args.query,
        level_filter: args.level || 'all',
        min_score: args.min_score || 0.3,
        search_time_ms: searchTimeMs,
        result_count: results.length,
        results: results.map((r: any) => ({
          level: r.level === 0 ? 'L0' : r.level === 1 ? 'L1' : 'L2',
          score: r.score,
          confidence: r.confidence,
          type: r.type,
          content_preview: typeof r.content === 'string'
            ? r.content.substring(0, 200) + (r.content.length > 200 ? '...' : '')
            : JSON.stringify(r.content).substring(0, 200),
          ...(r.message && {
            message: {
              role: r.message.role,
              content_preview: r.message.content?.substring(0, 150),
              tool_calls: r.message.tool_calls?.map((tc: any) => tc.tool_name),
            },
          }),
          ...(r.summary && {
            summary: {
              conversation_summary: r.summary.conversationSummary?.substring(0, 150),
              actions_summary: r.summary.actionsSummary?.substring(0, 150),
              files_mentioned: r.summary.filesMentioned,
            },
          }),
        })),
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
        conversation_id: args.conversation_id,
        query: args.query,
      };
    }
  };
}

export function generateDebugInjectTurnHandler(ctx: DebugToolsContext) {
  return async (args: {
    conversation_id: string;
    create_conversation?: boolean;
    turn: {
      user_message: string;
      tool_calls?: Array<{
        tool_name: string;
        arguments: Record<string, any>;
        result: any;
        success?: boolean;
        duration_ms?: number;
      }>;
      assistant_message: string;
      reasoning?: string;
    };
    generate_embeddings?: boolean;
    trigger_summarization?: boolean;
  }) => {
    const storage = ctx.conversationStorage;

    try {
      // Check if conversation exists
      const existingConv = await storage.getConversationMetadata(args.conversation_id);

      if (!existingConv && !args.create_conversation) {
        return {
          error: `Conversation ${args.conversation_id} not found. Set create_conversation: true to create it.`,
          conversation_id: args.conversation_id,
        };
      }

      // Create conversation if needed
      if (!existingConv) {
        const now = new Date();
        await storage.createConversation({
          uuid: args.conversation_id,
          title: `Debug conversation ${args.conversation_id}`,
          tags: ['debug', 'test'],
          created_at: now,
          updated_at: now,
          message_count: 0,
          total_chars: 0,
          status: 'active',
        });
      }

      const createdMessages: Array<{ uuid: string; role: string; char_count: number; has_embedding: boolean }> = [];
      const createdToolCalls: Array<{ uuid: string; tool_name: string; message_id: string }> = [];

      // 1. Store user message
      const userMsgId = await storage.storeMessage({
        conversation_id: args.conversation_id,
        role: 'user',
        content: args.turn.user_message,
        timestamp: new Date(),
      });

      createdMessages.push({
        uuid: userMsgId,
        role: 'user',
        char_count: args.turn.user_message.length,
        has_embedding: args.generate_embeddings !== false,
      });

      // 2. Store intermediate assistant messages with tool calls (if any)
      if (args.turn.tool_calls && args.turn.tool_calls.length > 0) {
        for (const tc of args.turn.tool_calls) {
          // Create an assistant message for each tool call
          const assistantMsgId = await storage.storeMessage({
            conversation_id: args.conversation_id,
            role: 'assistant',
            content: '', // Empty content for intermediate messages
            timestamp: new Date(),
          });

          createdMessages.push({
            uuid: assistantMsgId,
            role: 'assistant',
            char_count: 0,
            has_embedding: false,
          });

          // Store the tool call
          await storage.storeToolCall(assistantMsgId, {
            tool_name: tc.tool_name,
            arguments: JSON.stringify(tc.arguments),
            result: { result: JSON.stringify(tc.result), success: tc.success !== false },
            success: tc.success !== false,
            duration_ms: tc.duration_ms || 100,
          });

          createdToolCalls.push({
            uuid: assistantMsgId, // Use message ID as reference
            tool_name: tc.tool_name,
            message_id: assistantMsgId,
          });
        }
      }

      // 3. Store final assistant message
      const finalAssistantMsgId = await storage.storeMessage({
        conversation_id: args.conversation_id,
        role: 'assistant',
        content: args.turn.assistant_message,
        reasoning: args.turn.reasoning,
        timestamp: new Date(),
      });

      createdMessages.push({
        uuid: finalAssistantMsgId,
        role: 'assistant',
        char_count: args.turn.assistant_message.length,
        has_embedding: false, // Will be updated below
      });

      // 3b. Generate embeddings if requested
      let embeddingGenerated = false;
      if (args.generate_embeddings !== false) {
        try {
          // Build Message objects for storeTurnWithEmbedding
          const userMsg = {
            uuid: userMsgId,
            conversation_id: args.conversation_id,
            role: 'user' as const,
            content: args.turn.user_message,
            timestamp: new Date(),
            char_count: args.turn.user_message.length,
          };

          const assistantMsg = {
            uuid: finalAssistantMsgId,
            conversation_id: args.conversation_id,
            role: 'assistant' as const,
            content: args.turn.assistant_message,
            reasoning: args.turn.reasoning,
            timestamp: new Date(),
            char_count: args.turn.assistant_message.length,
            tool_calls: args.turn.tool_calls?.map((tc, idx) => ({
              uuid: createdToolCalls[idx]?.uuid || crypto.randomUUID(),
              message_id: createdToolCalls[idx]?.message_id || finalAssistantMsgId,
              tool_name: tc.tool_name,
              arguments: JSON.stringify(tc.arguments),
              timestamp: new Date(),
              duration_ms: tc.duration_ms || 100,
              success: tc.success !== false,
              iteration: idx,
              result: {
                uuid: crypto.randomUUID(),
                tool_call_id: createdToolCalls[idx]?.uuid || crypto.randomUUID(),
                success: tc.success !== false,
                result: typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result),
                timestamp: new Date(),
                result_size_bytes: 0,
              },
            })),
          };

          await storage.storeTurnWithEmbedding(args.conversation_id, userMsg, assistantMsg, {
            generateEmbedding: true,
          });
          embeddingGenerated = true;

          // Update the tracking
          createdMessages[createdMessages.length - 1].has_embedding = true;
          createdMessages[0].has_embedding = true; // User message also gets embedding via turn
        } catch (e) {
          console.error('[debug_inject_turn] Error generating embeddings:', e);
          // Don't fail - embedding generation is non-critical
        }
      }

      // 4. Trigger summarization if requested
      let summarizationResult: any;
      if (args.trigger_summarization) {
        try {
          const summary = await storage.generateL1SummaryIfNeeded(args.conversation_id, {
            projectRoot: resolveValue(ctx.projectRoot) || undefined,
          });
          summarizationResult = {
            l1_created: !!summary,
            summary_uuid: summary?.uuid,
          };
        } catch (e) {
          summarizationResult = {
            l1_created: false,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      }

      // 5. Get conversation stats
      const conv = await storage.getConversationMetadata(args.conversation_id);
      const messages = await storage.getMessages(args.conversation_id, { includeToolCalls: false });

      return {
        success: true,
        conversation_id: args.conversation_id,
        created_messages: createdMessages,
        created_tool_calls: createdToolCalls,
        conversation_stats: {
          total_messages: messages.length,
          total_chars: conv?.total_chars || 0,
          total_turns: Math.floor(messages.filter(m => m.role === 'user').length),
        },
        ...(summarizationResult && { summarization_triggered: summarizationResult }),
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
        conversation_id: args.conversation_id,
      };
    }
  };
}

export function generateDebugListSummariesHandler(ctx: DebugToolsContext) {
  return async (args: {
    conversation_id: string;
    level?: 'L1' | 'L2' | 'all';
    include_content?: boolean;
  }) => {
    const storage = ctx.conversationStorage;

    try {
      // Get conversation info
      const conv = await storage.getConversationMetadata(args.conversation_id);
      if (!conv) {
        return {
          error: `Conversation ${args.conversation_id} not found`,
          conversation_id: args.conversation_id,
        };
      }

      // Get summaries using Cypher query
      const session = (storage as any).neo4j?.session();
      if (!session) {
        return {
          error: 'Neo4j session not available',
          conversation_id: args.conversation_id,
        };
      }

      try {
        const l1Summaries: any[] = [];
        const l2Summaries: any[] = [];

        // Get L1 summaries
        if (!args.level || args.level === 'all' || args.level === 'L1') {
          const l1Result = await session.run(`
            MATCH (c:Conversation {uuid: $conversationId})-[:HAS_SUMMARY]->(s:Summary)
            WHERE s.level = 1
            RETURN s
            ORDER BY s.created_at DESC
          `, { conversationId: args.conversation_id });

          for (const record of l1Result.records) {
            const s = record.get('s').properties;
            l1Summaries.push({
              uuid: s.uuid,
              level: 'L1',
              created_at: s.created_at,
              char_count: s.char_count || 0,
              turns_covered: s.turns_covered,
              ...(args.include_content && {
                content: {
                  conversation_summary: s.conversation_summary,
                  actions_summary: s.actions_summary,
                  files_mentioned: s.files_mentioned,
                },
              }),
              has_embedding: !!s.embedding,
            });
          }
        }

        // Get L2 summaries
        if (!args.level || args.level === 'all' || args.level === 'L2') {
          const l2Result = await session.run(`
            MATCH (c:Conversation {uuid: $conversationId})-[:HAS_SUMMARY]->(s:Summary)
            WHERE s.level = 2
            OPTIONAL MATCH (s)-[:CONSOLIDATES]->(l1:Summary)
            RETURN s, collect(l1.uuid) as consolidated_l1s
            ORDER BY s.created_at DESC
          `, { conversationId: args.conversation_id });

          for (const record of l2Result.records) {
            const s = record.get('s').properties;
            const consolidatedL1s = record.get('consolidated_l1s');
            l2Summaries.push({
              uuid: s.uuid,
              level: 'L2',
              created_at: s.created_at,
              char_count: s.char_count || 0,
              consolidated_l1_count: consolidatedL1s?.length || 0,
              ...(args.include_content && {
                content: {
                  consolidated_summary: s.consolidated_summary || s.conversation_summary,
                },
              }),
              has_embedding: !!s.embedding,
            });
          }
        }

        return {
          conversation_id: args.conversation_id,
          conversation_info: {
            title: conv.title,
            total_messages: conv.message_count,
            total_chars: conv.total_chars,
            created_at: conv.created_at,
          },
          summaries: {
            l1: l1Summaries,
            l2: l2Summaries,
          },
          stats: {
            l1_count: l1Summaries.length,
            l2_count: l2Summaries.length,
          },
        };
      } finally {
        await session.close();
      }
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
        conversation_id: args.conversation_id,
      };
    }
  };
}

export function generateDebugMessageHandler(ctx: DebugToolsContext) {
  return async (args: {
    message_id?: string;
    conversation_id?: string;
    turn_index?: number;
    show_embedding?: boolean;
    show_tool_calls?: boolean;
    show_neighbors?: boolean;
  }) => {
    const storage = ctx.conversationStorage;

    try {
      let messages: Message[] = [];
      let targetMessage: Message | undefined;

      if (args.message_id) {
        // Find by message ID - need to search in conversation
        // For now, return error as we need conversation_id
        return {
          error: 'message_id lookup requires conversation_id. Please provide both or use turn_index.',
        };
      } else if (args.conversation_id && args.turn_index !== undefined) {
        // Get messages and find by turn index
        messages = await storage.getMessages(args.conversation_id, {
          includeToolCalls: args.show_tool_calls !== false,
        });

        // Find user messages to calculate turns
        let turnCount = 0;
        for (const msg of messages) {
          if (msg.role === 'user') {
            if (turnCount === args.turn_index) {
              targetMessage = msg;
              break;
            }
            turnCount++;
          }
        }
      } else {
        return {
          error: 'Please provide either message_id or (conversation_id + turn_index)',
        };
      }

      if (!targetMessage) {
        return {
          error: `Message not found at turn_index ${args.turn_index}`,
          conversation_id: args.conversation_id,
          turn_index: args.turn_index,
        };
      }

      // Build response
      const result: Record<string, any> = {
        message: {
          uuid: targetMessage.uuid,
          conversation_id: targetMessage.conversation_id,
          role: targetMessage.role,
          content: targetMessage.content,
          reasoning: targetMessage.reasoning,
          timestamp: targetMessage.timestamp,
          char_count: targetMessage.char_count,
        },
      };

      // Embedding info
      if (args.show_embedding && targetMessage.embedding) {
        result.embedding = {
          exists: true,
          dimensions: targetMessage.embedding.length,
          vector_preview: targetMessage.embedding.slice(0, 10),
        };
      } else {
        result.embedding = {
          exists: !!targetMessage.embedding,
          dimensions: targetMessage.embedding?.length,
        };
      }

      // Tool calls
      if (args.show_tool_calls !== false && targetMessage.tool_calls) {
        result.tool_calls = targetMessage.tool_calls.map(tc => ({
          uuid: tc.uuid,
          tool_name: tc.tool_name,
          arguments: tc.arguments,
          success: tc.success,
          duration_ms: tc.duration_ms,
          result: tc.result ? {
            success: tc.result.success,
            result_preview: typeof tc.result.result === 'string'
              ? tc.result.result.substring(0, 200)
              : JSON.stringify(tc.result.result).substring(0, 200),
            error: tc.result.error,
          } : undefined,
        }));
      }

      // Neighbors
      if (args.show_neighbors && messages.length > 0) {
        const msgIndex = messages.findIndex(m => m.uuid === targetMessage!.uuid);
        if (msgIndex > 0) {
          const prev = messages[msgIndex - 1];
          result.neighbors = {
            ...result.neighbors,
            previous: {
              uuid: prev.uuid,
              role: prev.role,
              preview: prev.content?.substring(0, 100),
            },
          };
        }
        if (msgIndex < messages.length - 1) {
          const next = messages[msgIndex + 1];
          result.neighbors = {
            ...result.neighbors,
            next: {
              uuid: next.uuid,
              role: next.role,
              preview: next.content?.substring(0, 100),
            },
          };
        }
      }

      return result;
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };
}

// ============================================
// Export all tools and handlers
// ============================================

export function generateAllDebugTools(): GeneratedToolDefinition[] {
  return [
    generateDebugContextTool(),
    generateDebugConversationSearchTool(),
    generateDebugInjectTurnTool(),
    generateDebugListSummariesTool(),
    generateDebugMessageTool(),
  ];
}

export function generateAllDebugHandlers(ctx: DebugToolsContext): Record<string, (args: any) => Promise<any>> {
  return {
    debug_context: generateDebugContextHandler(ctx),
    debug_conversation_search: generateDebugConversationSearchHandler(ctx),
    debug_inject_turn: generateDebugInjectTurnHandler(ctx),
    debug_list_summaries: generateDebugListSummariesHandler(ctx),
    debug_message: generateDebugMessageHandler(ctx),
  };
}
