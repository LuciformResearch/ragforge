/**
 * Conversation Summarizer for Multi-Level Summarization
 * 
 * Generates hierarchical summaries (L1, L2) using the Summary format from types.ts
 * Ensures embeddings are generated with proper labels for vector index optimization
 */

import type { StructuredLLMExecutor } from '../llm/structured-llm-executor.js';
import type { LLMProvider } from '../reranking/llm-provider.js';
import type { GeminiEmbeddingProvider } from '../embedding/embedding-provider.js';
import type { Summary, SummaryContent, Message } from './types.js';
import * as crypto from 'crypto';
import * as path from 'path';

export interface ConversationTurn {
  userMessage: string;
  assistantMessage: string;
  toolResults: Array<{
    toolName: string;
    toolArgs?: Record<string, any>;
    toolResult: any;
    success: boolean;
    timestamp: string;  // ISO string with local timezone (via formatLocalDate)
  }>;
  timestamp: string;  // ISO string with local timezone (via formatLocalDate)
}

export interface FileMention {
  path: string;           // File path (as mentioned in conversation)
  isAbsolute: boolean;   // true if absolute path, false if relative
}

export interface SummaryWithFiles extends Summary {
  filesMentioned: FileMention[]; // Files mentioned in this summary (for creating MENTIONS_FILE relationships)
}

export interface SummarizerOptions {
  llmProvider: LLMProvider;
  executor: StructuredLLMExecutor;
  embeddingProvider?: GeminiEmbeddingProvider; // Optional, for generating embeddings
}

/**
 * Generate embedding text for a summary (used for vector search)
 * Combines conversation_summary and actions_summary for semantic search
 */
export function generateSummaryEmbeddingText(summary: Summary): string {
  const parts: string[] = [];
  
  if (summary.content.conversation_summary) {
    parts.push(summary.content.conversation_summary);
  }
  
  if (summary.content.actions_summary) {
    parts.push(summary.content.actions_summary);
  }
  
  return parts.join('\n\n');
}

export class ConversationSummarizer {
  private llmProvider: LLMProvider;
  private executor: StructuredLLMExecutor;
  private embeddingProvider?: GeminiEmbeddingProvider;

  constructor(options: SummarizerOptions) {
    this.llmProvider = options.llmProvider;
    this.executor = options.executor;
    this.embeddingProvider = options.embeddingProvider;
  }

  /**
   * Summarize conversation turns into L1 summary
   * Returns Summary format compatible with types.ts, plus filesMentioned array
   */
  async summarizeTurns(
    turns: ConversationTurn[],
    conversationId: string,
    charRangeStart: number,
    charRangeEnd: number
  ): Promise<SummaryWithFiles> {
    if (turns.length === 0) {
      throw new Error('Cannot summarize empty turns array');
    }

    // Format turns for LLM
    const formattedTurns = turns.map((turn, i) => {
      const toolsInfo = turn.toolResults.length > 0
        ? `\nTools used:\n${turn.toolResults.map(tr => {
            const argsStr = tr.toolArgs ? `(${JSON.stringify(tr.toolArgs).substring(0, 100)}...)` : '';
            const resultStr = typeof tr.toolResult === 'string'
              ? tr.toolResult.substring(0, 200)
              : JSON.stringify(tr.toolResult).substring(0, 200);
            return `- ${tr.toolName}${argsStr}: ${resultStr}${resultStr.length >= 200 ? '...' : ''}`;
          }).join('\n')}`
        : '';

      return `Turn ${i + 1}:
User: ${turn.userMessage}
Assistant: ${turn.assistantMessage}${toolsInfo}`;
    }).join('\n\n');

    // Generate structured summary with LLM
    const result = await this.executor.executeLLMBatch(
      [{ conversation: formattedTurns }],
      {
        inputFields: ['conversation'],
        systemPrompt: `You are analyzing a conversation between a user and an AI assistant.
Extract structured information and create two distinct summaries:
1. Conversation Summary: What the user asked and what the assistant answered
2. Actions Summary: What tools were called and their results, linked with reasoning`,
        userTask: `Summarize this conversation segment into two distinct parts:

1. **Conversation Summary** (3-4 lines max):
   Focus on what the user asked and what you answered.
   Format: "The user asked X, so I answered Y..."
   
2. **Actions Summary** (3-4 lines max):
   Focus on the tools you called and their results, linked with your reasoning.
   Format: "I used tool_name(args) which returned X, then..."

3. **Files Mentioned**:
   Extract ALL file paths mentioned anywhere in the conversation:
   - From tool arguments (e.g., file paths in read_file, edit_file, etc.)
   - From tool results (e.g., file paths returned by grep_files, list_directory, etc.)
   - From user messages (e.g., "can you check src/index.ts")
   - From assistant messages (e.g., "I modified packages/core/src/file.ts")
   
   For each file path, indicate if it is:
   - **Absolute path**: starts with "/" (e.g., "/home/user/project/src/index.ts")
   - **Relative path**: does not start with "/" (e.g., "src/index.ts", "./src/index.ts")
   
   Be thorough - extract every file path you see, even if mentioned multiple times (you can deduplicate later).

Be factual and preserve critical details.`,
        outputSchema: {
          conversation_summary: {
            type: 'string',
            description: 'Summary of user questions and assistant responses (3-4 lines)',
            required: true,
          },
          actions_summary: {
            type: 'string',
            description: 'Summary of tool calls and their results (3-4 lines)',
            required: true,
          },
          filesMentioned: {
            type: 'array',
            description: 'All file paths mentioned in the conversation (extract from tool args, results, user messages, assistant messages). Be thorough - files might be mentioned anywhere. For each file, indicate if it is an absolute path or relative path. Absolute paths: on Unix/Mac start with "/", on Windows start with a drive letter like "C:\\" or "C:/". Relative paths: everything else.',
            items: {
              type: 'object',
              description: 'A file mention with path and type',
              properties: {
                path: {
                  type: 'string',
                  description: 'The file path as mentioned in the conversation (keep original format)',
                  required: true,
                },
                isAbsolute: {
                  type: 'boolean',
                  description: 'true if the path is absolute (Unix/Mac: starts with "/", Windows: starts with drive letter like "C:\\" or "C:/"), false if relative',
                  required: true,
                },
              },
            },
            required: true,
          },
        },
        llmProvider: this.llmProvider,
        batchSize: 1,
      }
    );

    const rawResult: any = Array.isArray(result) ? result[0] : result;

    const summaryContent: SummaryContent = {
      conversation_summary: String(rawResult.conversation_summary || ''),
      actions_summary: String(rawResult.actions_summary || '')
    };

    // Calculate summary char count
    const summaryCharCount =
      summaryContent.conversation_summary.length + summaryContent.actions_summary.length;

    const summary: Summary = {
      uuid: crypto.randomUUID(),
      conversation_id: conversationId,
      level: 1,
      content: summaryContent,
      char_range_start: charRangeStart,
      char_range_end: charRangeEnd,
      summary_char_count: summaryCharCount,
      created_at: new Date(),
      // embedding will be generated separately if embeddingProvider is available
    };

    // Extract files mentioned
    const filesMentioned: FileMention[] = Array.isArray(rawResult.filesMentioned)
      ? rawResult.filesMentioned
          .filter((f: any) => f && typeof f === 'object' && typeof f.path === 'string' && f.path.trim().length > 0)
          .map((f: any) => {
            const filePath = String(f.path).trim();
            const isAbsolute = typeof f.isAbsolute === 'boolean' 
              ? f.isAbsolute 
              : path.isAbsolute(filePath);
            return {
              path: filePath,
              isAbsolute
            };
          })
      : [];

    // Generate embedding if provider is available
    if (this.embeddingProvider) {
      const embeddingText = generateSummaryEmbeddingText(summary);
      summary.embedding = await this.embeddingProvider.embedSingle(embeddingText);
    }

    // Return SummaryWithFiles format
    return {
      ...summary,
      filesMentioned: filesMentioned
    };
  }

  /**
   * Summarize summaries (create L2+ summary from L1 summaries)
   * Returns Summary format compatible with types.ts, plus filesMentioned array
   */
  async summarizeSummaries(
    summaries: Summary[],
    conversationId: string,
    charRangeStart: number,
    charRangeEnd: number,
    targetLevel: number
  ): Promise<SummaryWithFiles> {
    if (summaries.length === 0) {
      throw new Error('Cannot summarize empty summaries array');
    }

    // Format summaries for LLM
    const formattedSummaries = summaries.map((s, i) => {
      return `Summary ${i + 1} (Level ${s.level}, ${s.summary_char_count} chars):
Conversation: ${s.content.conversation_summary}
Actions: ${s.content.actions_summary}`;
    }).join('\n\n');

    // Generate structured summary of summaries
    const result = await this.executor.executeLLMBatch(
      [{ summaries: formattedSummaries }],
      {
        inputFields: ['summaries'],
        systemPrompt: `You are analyzing multiple conversation summaries to create a higher-level summary.
Synthesize the information, merge duplicate information, and create a coherent overview.`,
        userTask: `Analyze these conversation summaries and create a synthesized higher-level summary:

1. **Conversation Summary** (4-5 lines max):
   Synthesize what users asked and what was answered across all summaries.
   Focus on main themes and patterns.
   
2. **Actions Summary** (4-5 lines max):
   Synthesize the tools used and results across all summaries.
   Focus on key actions and their outcomes.

3. **Files Mentioned**:
   Merge and deduplicate ALL file paths mentioned across all input summaries.
   Include every unique file path from all summaries.
   For each file path, indicate if it is:
   - **Absolute path**: starts with "/" (e.g., "/home/user/project/src/index.ts")
   - **Relative path**: does not start with "/" (e.g., "src/index.ts", "./src/index.ts")

Be thorough in synthesizing information while keeping it concise.`,
        outputSchema: {
          conversation_summary: {
            type: 'string',
            description: 'Synthesized summary of all summaries (4-5 lines)',
            required: true,
          },
          actions_summary: {
            type: 'string',
            description: 'Synthesized actions summary across all summaries (4-5 lines)',
            required: true,
          },
          filesMentioned: {
            type: 'array',
            description: 'All unique file paths mentioned across all summaries (merge and deduplicate from all input summaries). For each file, indicate if it is an absolute path or relative path. Absolute paths: on Unix/Mac start with "/", on Windows start with a drive letter like "C:\\" or "C:/". Relative paths: everything else.',
            items: {
              type: 'object',
              description: 'A file mention with path and type',
              properties: {
                path: {
                  type: 'string',
                  description: 'The file path as mentioned in the conversation (keep original format)',
                  required: true,
                },
                isAbsolute: {
                  type: 'boolean',
                  description: 'true if the path is absolute (Unix/Mac: starts with "/", Windows: starts with drive letter like "C:\\" or "C:/"), false if relative',
                  required: true,
                },
              },
            },
            required: true,
          },
        },
        llmProvider: this.llmProvider,
        batchSize: 1,
      }
    );

    const rawResult: any = Array.isArray(result) ? result[0] : result;

    const summaryContent: SummaryContent = {
      conversation_summary: String(rawResult.conversation_summary || ''),
      actions_summary: String(rawResult.actions_summary || '')
    };

    // Extract files mentioned (merge from all input summaries)
    // Validate and normalize isAbsolute using path.isAbsolute() to handle Windows/Unix/Mac correctly
    const filesMentioned: FileMention[] = Array.isArray(rawResult.filesMentioned)
      ? rawResult.filesMentioned
          .filter((f: any) => f && typeof f === 'object' && typeof f.path === 'string' && f.path.trim().length > 0)
          .map((f: any) => {
            const filePath = String(f.path).trim();
            // Use path.isAbsolute() to correctly detect absolute paths on Windows/Unix/Mac
            // This handles: "/path" (Unix/Mac), "C:\\path" (Windows), "C:/path" (Windows)
            const isAbsolute = typeof f.isAbsolute === 'boolean' 
              ? f.isAbsolute 
              : path.isAbsolute(filePath);
            return {
              path: filePath,
              isAbsolute
            };
          })
      : [];

    // Calculate summary char count
    const summaryCharCount =
      summaryContent.conversation_summary.length + summaryContent.actions_summary.length;

    // Calculate parent summaries UUIDs
    const parentSummaries = summaries.map(s => s.uuid);

    const summary: Summary = {
      uuid: crypto.randomUUID(),
      conversation_id: conversationId,
      level: targetLevel,
      content: summaryContent,
      char_range_start: charRangeStart,
      char_range_end: charRangeEnd,
      summary_char_count: summaryCharCount,
      created_at: new Date(),
      parent_summaries: parentSummaries,
      // embedding will be generated separately if embeddingProvider is available
    };

    // Generate embedding if provider is available
    if (this.embeddingProvider) {
      const embeddingText = generateSummaryEmbeddingText(summary);
      summary.embedding = await this.embeddingProvider.embedSingle(embeddingText);
    }

    // Return SummaryWithFiles format
    return {
      ...summary,
      filesMentioned: filesMentioned
    };
  }

  /**
   * Generate embedding for a summary (if not already generated)
   * Uses the Summary label for vector index optimization
   */
  async generateEmbedding(summary: Summary): Promise<number[]> {
    if (!this.embeddingProvider) {
      throw new Error('EmbeddingProvider not configured');
    }

    const embeddingText = generateSummaryEmbeddingText(summary);
    return await this.embeddingProvider.embedSingle(embeddingText);
  }
}
