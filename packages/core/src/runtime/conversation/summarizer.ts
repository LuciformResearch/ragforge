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
import { UniqueIDHelper } from '../utils/UniqueIDHelper.js';
import { extractMentionsFromToolCalls, mergeMentions, type ToolResult } from './tool-mention-extractor.js';
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

/**
 * A node mentioned in conversation - can be any type of node in the knowledge graph
 * (scope, webpage, document, markdown section, etc.)
 */
export interface NodeMention {
  uuid: string;                    // UUID of the node in Neo4j
  name: string;                    // Name of the node (function name, page title, etc.)
  type: 'scope' | 'file' | 'webpage' | 'document' | 'markdown_section' | 'codeblock';
  subtype?: string;                // For scope: function, method, class, interface
  file?: string;                   // File path if applicable
  url?: string;                    // URL if WebPage
  reason?: string;                 // Why the LLM judged this node pertinent (optional)
  startLine?: number;
  endLine?: number;
}

/**
 * Result of extracting mentions from tool calls programmatically
 */
export interface ExtractedMentions {
  files: FileMention[];            // Legacy: file paths
  nodes: NodeMention[];            // NEW: all types of nodes with UUID
}

/**
 * Summary with both files and nodes mentioned - extends SummaryWithFiles for compatibility
 */
export interface SummaryWithMentions extends SummaryWithFiles {
  nodesMentioned: NodeMention[];   // NEW: nodes mentioned with UUIDs
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
   * Returns Summary format compatible with types.ts, plus filesMentioned and nodesMentioned arrays
   */
  async summarizeTurns(
    turns: ConversationTurn[],
    conversationId: string,
    startTurnIndex: number,
    endTurnIndex: number,
    charRangeStart: number,
    charRangeEnd: number
  ): Promise<SummaryWithMentions> {
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

    // PRE-EXTRACTION: Extract mentions programmatically from tool calls
    const allToolResults: ToolResult[] = turns.flatMap(t =>
      t.toolResults.map(tr => ({
        toolName: tr.toolName,
        toolArgs: tr.toolArgs,
        toolResult: tr.toolResult,
        success: tr.success
      }))
    );
    const programmaticMentions = extractMentionsFromToolCalls(allToolResults);

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

4. **Nodes Mentioned** (Important!):
   Look for UUIDs in tool results formatted as [scope:UUID], [node:UUID], [webpage:UUID], etc.
   Extract nodes that are CENTRAL to this conversation - functions/classes that were discussed, modified, or are key to understanding the context.
   For each node, briefly explain WHY it's important (1 sentence).
   Only include 3-5 most important nodes, not every single one mentioned.

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
          nodesMentioned: {
            type: 'array',
            description: 'The 3-5 most important nodes (code scopes, webpages, documents) discussed in this conversation. Look for UUIDs in format [scope:UUID] or [node:UUID] in tool results.',
            items: {
              type: 'object',
              description: 'A node mention with UUID and context',
              properties: {
                uuid: {
                  type: 'string',
                  description: 'The UUID extracted from [type:UUID] format in tool results',
                  required: true,
                },
                name: {
                  type: 'string',
                  description: 'Name of the node (function name, class name, page title, etc.)',
                  required: true,
                },
                type: {
                  type: 'string',
                  enum: ['scope', 'file', 'webpage', 'document', 'markdown_section', 'codeblock'],
                  description: 'Type of node',
                  required: true,
                },
                reason: {
                  type: 'string',
                  description: 'Why this node is important to the conversation (1 sentence)',
                  required: true,
                },
              },
            },
            required: false,
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
      uuid: UniqueIDHelper.GenerateSummaryUUID(conversationId, 1, startTurnIndex, endTurnIndex),
      conversation_id: conversationId,
      level: 1,
      content: summaryContent,
      start_turn_index: startTurnIndex,
      end_turn_index: endTurnIndex,
      char_range_start: charRangeStart,
      char_range_end: charRangeEnd,
      summary_char_count: summaryCharCount,
      created_at: new Date(),
      // embedding will be generated separately if embeddingProvider is available
    };

    // Extract files mentioned from LLM result
    const llmFilesMentioned: FileMention[] = Array.isArray(rawResult.filesMentioned)
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

    // Extract nodes mentioned from LLM result
    const llmNodesMentioned: NodeMention[] = Array.isArray(rawResult.nodesMentioned)
      ? rawResult.nodesMentioned
          .filter((n: any) => n && typeof n === 'object' && typeof n.uuid === 'string' && n.uuid.trim().length > 0)
          .map((n: any) => ({
            uuid: String(n.uuid).trim(),
            name: String(n.name || 'unnamed'),
            type: n.type || 'scope',
            reason: n.reason ? String(n.reason) : undefined
          } as NodeMention))
      : [];

    // MERGE: Combine programmatic extraction with LLM extraction
    const mergedMentions = mergeMentions(programmaticMentions, {
      files: llmFilesMentioned,
      nodes: llmNodesMentioned
    });

    // Generate embedding if provider is available
    if (this.embeddingProvider) {
      const embeddingText = generateSummaryEmbeddingText(summary);
      summary.embedding = await this.embeddingProvider.embedSingle(embeddingText);
    }

    // Return SummaryWithMentions format
    return {
      ...summary,
      filesMentioned: mergedMentions.files,
      nodesMentioned: mergedMentions.nodes
    };
  }

  /**
   * Summarize summaries (create L2+ summary from L1 summaries)
   * Returns Summary format compatible with types.ts, plus filesMentioned and nodesMentioned arrays
   *
   * Note: Input summaries can be Summary[] or SummaryWithMentions[] - nodesMentioned is optional
   * and will be merged if present on input summaries
   */
  async summarizeSummaries(
    summaries: (Summary & Partial<Pick<SummaryWithMentions, 'filesMentioned' | 'nodesMentioned'>>)[],
    conversationId: string,
    startTurnIndex: number,
    endTurnIndex: number,
    charRangeStart: number,
    charRangeEnd: number,
    targetLevel: number
  ): Promise<SummaryWithMentions> {
    if (summaries.length === 0) {
      throw new Error('Cannot summarize empty summaries array');
    }

    // PRE-EXTRACTION: Collect all nodes from input summaries
    const collectedNodes: NodeMention[] = [];
    const seenNodeUuids = new Set<string>();
    for (const s of summaries) {
      if (s.nodesMentioned) {
        for (const node of s.nodesMentioned) {
          if (!seenNodeUuids.has(node.uuid)) {
            seenNodeUuids.add(node.uuid);
            collectedNodes.push(node);
          }
        }
      }
    }

    // Format summaries for LLM
    const formattedSummaries = summaries.map((s, i) => {
      const nodesInfo = s.nodesMentioned && s.nodesMentioned.length > 0
        ? `\nNodes: ${s.nodesMentioned.map(n => `[${n.type}:${n.uuid}] ${n.name}`).join(', ')}`
        : '';
      return `Summary ${i + 1} (Level ${s.level}, ${s.summary_char_count} chars):
Conversation: ${s.content.conversation_summary}
Actions: ${s.content.actions_summary}${nodesInfo}`;
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

4. **Nodes Mentioned** (Important!):
   Merge nodes from all input summaries - look for [type:UUID] patterns.
   Select the 5-7 MOST IMPORTANT nodes across all summaries.
   For each node, explain why it's important to the overall conversation.

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
          nodesMentioned: {
            type: 'array',
            description: 'The 5-7 most important nodes (code scopes, webpages, documents) across all summaries. Look for UUIDs in format [scope:UUID] or [node:UUID]. Merge and prioritize nodes from all input summaries.',
            items: {
              type: 'object',
              description: 'A node mention with UUID and context',
              properties: {
                uuid: {
                  type: 'string',
                  description: 'The UUID extracted from [type:UUID] format',
                  required: true,
                },
                name: {
                  type: 'string',
                  description: 'Name of the node (function name, class name, page title, etc.)',
                  required: true,
                },
                type: {
                  type: 'string',
                  enum: ['scope', 'file', 'webpage', 'document', 'markdown_section', 'codeblock'],
                  description: 'Type of node',
                  required: true,
                },
                reason: {
                  type: 'string',
                  description: 'Why this node is important to the overall conversation (1 sentence)',
                  required: true,
                },
              },
            },
            required: false,
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

    // Extract files mentioned from LLM result
    // Validate and normalize isAbsolute using path.isAbsolute() to handle Windows/Unix/Mac correctly
    const llmFilesMentioned: FileMention[] = Array.isArray(rawResult.filesMentioned)
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

    // Extract nodes mentioned from LLM result
    const llmNodesMentioned: NodeMention[] = Array.isArray(rawResult.nodesMentioned)
      ? rawResult.nodesMentioned
          .filter((n: any) => n && typeof n === 'object' && typeof n.uuid === 'string' && n.uuid.trim().length > 0)
          .map((n: any) => ({
            uuid: String(n.uuid).trim(),
            name: String(n.name || 'unnamed'),
            type: n.type || 'scope',
            reason: n.reason ? String(n.reason) : undefined
          } as NodeMention))
      : [];

    // MERGE: Combine collected nodes with LLM extraction
    // collectedNodes already contains deduplicated nodes from all input summaries
    const mergedMentions = mergeMentions(
      { files: [], nodes: collectedNodes },
      { files: llmFilesMentioned, nodes: llmNodesMentioned }
    );

    // Also collect files from input summaries for completeness
    const collectedFiles: FileMention[] = [];
    const seenFilePaths = new Set<string>();
    for (const s of summaries) {
      if (s.filesMentioned) {
        for (const file of s.filesMentioned) {
          if (!seenFilePaths.has(file.path)) {
            seenFilePaths.add(file.path);
            collectedFiles.push(file);
          }
        }
      }
    }

    // Merge collected files with LLM extracted files
    const allFiles = mergeMentions(
      { files: collectedFiles, nodes: [] },
      { files: llmFilesMentioned, nodes: [] }
    );

    // Calculate summary char count
    const summaryCharCount =
      summaryContent.conversation_summary.length + summaryContent.actions_summary.length;

    // Calculate parent summaries UUIDs
    const parentSummaries = summaries.map(s => s.uuid);

    const summary: Summary = {
      uuid: UniqueIDHelper.GenerateSummaryUUID(conversationId, targetLevel, startTurnIndex, endTurnIndex),
      conversation_id: conversationId,
      level: targetLevel,
      content: summaryContent,
      start_turn_index: startTurnIndex,
      end_turn_index: endTurnIndex,
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

    // Return SummaryWithMentions format
    return {
      ...summary,
      filesMentioned: allFiles.files,
      nodesMentioned: mergedMentions.nodes
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
