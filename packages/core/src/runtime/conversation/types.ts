/**
 * Conversation Agent Types
 */

import type { Neo4jClient } from '../client/neo4j-client.js';
import type { LLMProvider } from '../reranking/llm-provider.js';
import type { ToolDefinition } from '../llm/native-tool-calling/index.js';
import type { ToolExecutor } from '../llm/structured-llm-executor.js';

// ============================================================================
// Configuration
// ============================================================================

export interface ConversationConfig {
  // Recent context (non-summarized)
  recentContextMaxChars?: number;       // Max chars in recent context
  recentContextMaxTurns?: number;       // Max number of turns (user+assistant pairs)

  // RAG context (on summaries)
  ragMaxSummaries?: number;             // Top N most relevant summaries
  ragMinScore?: number;                 // Minimum similarity score
  ragLevelBoost?: Record<number, number>; // Boost by level {1: 1.0, 2: 1.1, 3: 1.2}
  ragRecencyBoost?: boolean;            // Boost for recent summaries
  ragRecencyDecayDays?: number;         // Decay over N days

  // Hierarchical summarization (ALL levels based on characters!)
  enableSummarization?: boolean;
  summarizeEveryNChars?: number;        // Trigger summary every N chars (for ALL levels)
  summaryLevels?: number;               // Max hierarchy depth (1, 2, 3...)

  // Embeddings (for RAG on history)
  embedMessages?: boolean;
  embeddingProvider?: any;              // EmbeddingProvider type

  // Export for debugging
  exportToFiles?: boolean;
  exportPath?: string;
  exportFormat?: 'json' | 'markdown';
  exportOnEveryMessage?: boolean;

  // Multi-level summarization with percentage-based thresholds
  maxContextChars?: number;             // Default: 100000 (contexte max)
  l1ThresholdPercent?: number;          // Default: 10 (10% du max = 10k chars)
  l2ThresholdPercent?: number;          // Default: 10 (10% du max = 10k chars)
  lastUserQueriesPercent?: number;      // Default: 5 (5% du max = 5k chars)
  codeSearchPercent?: number;           // Default: 10 (10% du max = 10k chars)
  codeSearchInitialLimit?: number;      // Default: 100 résultats initiaux
}

export interface ConversationAgentOptions {
  neo4j: Neo4jClient;
  llmProvider: LLMProvider;
  tools?: ToolDefinition[];
  toolExecutor?: ToolExecutor;
  config?: ConversationConfig;
}

// ============================================================================
// Core Entities
// ============================================================================

export interface ConversationMetadata {
  uuid: string;
  title: string;
  tags: string[];
  created_at: Date | string;
  updated_at: Date | string;
  message_count: number;
  total_chars: number;                  // NEW: total characters in conversation
  status: 'active' | 'archived';
}

export interface Message {
  uuid: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  reasoning?: string;
  timestamp: Date | string;
  token_count?: number;
  char_count: number;                   // NEW: character count for this message
  embedding?: number[];
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  uuid: string;
  message_id: string;
  tool_name: string;
  arguments: string;                    // JSON stringified
  timestamp: Date | string;
  duration_ms: number;
  success: boolean;
  iteration?: number;
  result?: ToolResult;
}

export interface ToolResult {
  uuid: string;
  tool_call_id: string;
  success: boolean;
  result: string;                       // JSON stringified
  error?: string;
  timestamp: Date | string;
  result_size_bytes: number;
}

// ============================================================================
// Hierarchical Summaries
// ============================================================================

export interface SummaryContent {
  conversation_summary: string;         // 3-4 lines: user questions + assistant responses
  actions_summary: string;              // 3-4 lines: tool calls + reasoning (linked together)
}

export interface Summary {
  uuid: string;
  conversation_id: string;
  level: number;                        // 1, 2, 3... (l1, l2, l3)
  content: SummaryContent;              // Structured summary
  start_turn_index: number;             // First turn covered by this summary (for deterministic UUID)
  end_turn_index: number;               // Last turn covered by this summary (for deterministic UUID)
  char_range_start: number;             // Start position in conversation (chars of original messages or L(n-1) summaries)
  char_range_end: number;               // End position
  summary_char_count: number;           // Char count of THIS summary (for L2+ triggering)
  created_at: Date | string;
  embedding?: number[];                 // Embedding of combined summary text
  parent_summaries?: string[];          // UUIDs of summaries this one summarizes (for l2+)
}

// ============================================================================
// Context Building
// ============================================================================

export interface RecentContext {
  messages: Message[];                  // Last N turns (non-summarized)
  total_chars: number;
  turn_count: number;
}

export interface RAGContext {
  summaries: Array<Summary & { score: number }>; // Top N most relevant summaries with scores
  max_score: number;
  min_score: number;
}

export interface ConversationContext {
  recent: RecentContext;                // Recent non-summarized turns
  rag: RAGContext;                      // RAG on summaries
  message_count: number;
  total_chars: number;
}

// ============================================================================
// Responses
// ============================================================================

export interface AssistantResponse {
  content: string;
  reasoning?: string;
  tool_calls: ToolCall[];
  context_used: ConversationContext;
}

// ============================================================================
// Full Data (for export)
// ============================================================================

export interface ConversationFullData extends ConversationMetadata {
  messages: Message[];
  summaries?: Summary[];
}

// ============================================================================
// Storage Options
// ============================================================================

export interface ListConversationsOptions {
  limit?: number;
  status?: 'active' | 'archived';
  tags?: string[];
  orderBy?: 'created' | 'updated';
}

export interface GetMessagesOptions {
  limit?: number;
  includeToolCalls?: boolean;
  includeReasoning?: boolean;
}

export interface StoreMessageOptions {
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  reasoning?: string;
  timestamp: Date;
  /** Optional UUID - if not provided, a random one will be generated */
  uuid?: string;
}

// ============================================================================
// Summarization
// ============================================================================

export interface SummarizationTrigger {
  shouldSummarize: boolean;
  currentChars: number;
  threshold: number;
  level: number;                        // Which level to create (1, 2, 3...)
  charRangeStart: number;
  charRangeEnd: number;
}
