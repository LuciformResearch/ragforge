/**
 * ConversationStorage - Neo4j operations for conversations
 */

import type { Neo4jClient } from '../client/neo4j-client.js';
import { formatLocalDate, normalizeTimestamp } from '../utils/timestamp.js';
import { UniqueIDHelper } from '../utils/UniqueIDHelper.js';
import neo4j from 'neo4j-driver';
import * as path from 'path';
import * as fs from 'fs/promises';
import { glob } from 'glob';
import { distance as levenshtein } from 'fastest-levenshtein';
import type {
  ConversationMetadata,
  Message,
  ToolCall,
  Summary,
  ListConversationsOptions,
  GetMessagesOptions,
  StoreMessageOptions,
  SummarizationTrigger,
  ConversationConfig
} from './types.js';
import type { GeminiEmbeddingProvider } from '../embedding/embedding-provider.js';
import type { ConversationSummarizer, ConversationTurn, FileMention, SummaryWithFiles, NodeMention, SummaryWithMentions } from './summarizer.js';
import type { StructuredLLMExecutor } from '../llm/structured-llm-executor.js';
import type { LLMProvider } from '../reranking/llm-provider.js';
import type { BrainManager } from '../../brain/brain-manager.js';
import { generateFsTools, type FsToolsContext } from '../../tools/fs-tools.js';
import { generateBrainSearchTool, generateBrainSearchHandler, type BrainToolsContext } from '../../tools/brain-tools.js';
import { GeneratedToolExecutor } from '../agents/rag-agent.js';
import { CwdFileCache, getDefaultCwdFileCache, type CwdStats } from './cwd-file-cache.js';

export class ConversationStorage {
  private config?: ConversationConfig;
  private embeddingProvider?: GeminiEmbeddingProvider;
  private summarizer?: ConversationSummarizer;
  private brainManager?: BrainManager;
  private llmExecutor?: StructuredLLMExecutor;
  private llmProvider?: LLMProvider;
  private cwdFileCache: CwdFileCache = getDefaultCwdFileCache();

  constructor(
    private neo4j: Neo4jClient,
    config?: ConversationConfig,
    embeddingProvider?: GeminiEmbeddingProvider
  ) {
    this.config = config;
    this.embeddingProvider = embeddingProvider;
  }

  /**
   * Set embedding provider (for generating embeddings)
   */
  setEmbeddingProvider(provider: GeminiEmbeddingProvider): void {
    this.embeddingProvider = provider;
  }

  /**
   * Set summarizer instance (for generating summaries)
   */
  setSummarizer(summarizer: ConversationSummarizer): void {
    this.summarizer = summarizer;
  }

  /**
   * Set BrainManager instance (for checking if project is registered)
   */
  setBrainManager(brainManager: BrainManager): void {
    this.brainManager = brainManager;
  }

  /**
   * Set LLM executor and provider (for fuzzy search decision)
   */
  setLLMExecutor(executor: StructuredLLMExecutor, provider: LLMProvider): void {
    this.llmExecutor = executor;
    this.llmProvider = provider;
  }

  /**
   * Update configuration
   */
  setConfig(config: ConversationConfig): void {
    this.config = config;
  }

  /**
   * Get configuration
   */
  getConfig(): ConversationConfig | undefined {
    return this.config;
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  /**
   * Normalize Neo4j Integer to JavaScript number
   * Handles both Neo4j 4.x (Integer objects) and 5.x (native numbers)
   */
  private toNumber(value: any): number {
    if (typeof value === 'number') return value;
    if (value?.toNumber) return value.toNumber();
    return 0;
  }

  /**
   * Get maximum context characters (default: 100000)
   */
  private getMaxContextChars(): number {
    return this.config?.maxContextChars ?? 100000;
  }

  /**
   * Get L1 threshold in characters (default: 10% of max = 10k chars)
   */
  getL1Threshold(): number {
    const max = this.getMaxContextChars();
    const percent = this.config?.l1ThresholdPercent ?? 10;
    return Math.floor(max * (percent / 100));
  }

  /**
   * Get L2 threshold in characters (default: 10% of max = 10k chars)
   */
  getL2Threshold(): number {
    const max = this.getMaxContextChars();
    const percent = this.config?.l2ThresholdPercent ?? 10;
    return Math.floor(max * (percent / 100));
  }

  /**
   * Get maximum characters for Last User Queries (default: 5% of max = 5k chars)
   */
  getLastUserQueriesMaxChars(): number {
    const max = this.getMaxContextChars();
    const percent = this.config?.lastUserQueriesPercent ?? 5;
    return Math.floor(max * (percent / 100));
  }

  /**
   * Get maximum characters for Code Semantic Search (default: 10% of max = 10k chars)
   */
  getCodeSearchMaxChars(): number {
    const max = this.getMaxContextChars();
    const percent = this.config?.codeSearchPercent ?? 10;
    return Math.floor(max * (percent / 100));
  }

  /**
   * Get initial limit for Code Semantic Search (default: 100)
   */
  getCodeSearchInitialLimit(): number {
    return this.config?.codeSearchInitialLimit ?? 100;
  }

  // ==========================================================================
  // Conversation Operations
  // ==========================================================================

  async createConversation(data: ConversationMetadata): Promise<void> {
    const created_at = normalizeTimestamp(data.created_at);
    const updated_at = normalizeTimestamp(data.updated_at);

    await this.neo4j.run(
      `CREATE (c:Conversation {
        uuid: $uuid,
        title: $title,
        tags: $tags,
        created_at: datetime($created_at),
        updated_at: datetime($updated_at),
        message_count: $message_count,
        total_chars: $total_chars,
        status: $status
      })`,
      {
        uuid: data.uuid,
        title: data.title,
        tags: data.tags,
        created_at,
        updated_at,
        message_count: data.message_count,
        total_chars: 0,
        status: data.status
      }
    );
  }

  async getConversationMetadata(uuid: string): Promise<ConversationMetadata | null> {
    const result = await this.neo4j.run(
      `MATCH (c:Conversation {uuid: $uuid})
       RETURN c`,
      { uuid }
    );

    if (result.records.length === 0) {
      return null;
    }

    const props = result.records[0].get('c').properties;
    return {
      uuid: props.uuid,
      title: props.title,
      tags: props.tags || [],
      created_at: props.created_at,
      updated_at: props.updated_at,
      message_count: this.toNumber(props.message_count),
      total_chars: this.toNumber(props.total_chars),
      status: props.status
    };
  }

  async listConversations(options?: ListConversationsOptions): Promise<ConversationMetadata[]> {
    const filters: string[] = [];
    const params: Record<string, any> = {
      limit: neo4j.int(options?.limit || 50)
    };

    if (options?.status) {
      filters.push('c.status = $status');
      params.status = options.status;
    }

    if (options?.tags?.length) {
      filters.push('ANY(tag IN $tags WHERE tag IN c.tags)');
      params.tags = options.tags;
    }

    const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
    const orderBy = options?.orderBy === 'created' ? 'c.created_at' : 'c.updated_at';

    const result = await this.neo4j.run(
      `MATCH (c:Conversation)
       ${whereClause}
       RETURN c
       ORDER BY ${orderBy} DESC
       LIMIT $limit`,
      params
    );

    return result.records.map(r => {
      const props = r.get('c').properties;
      return {
        uuid: props.uuid,
        title: props.title,
        tags: props.tags || [],
        created_at: props.created_at,
        updated_at: props.updated_at,
        message_count: this.toNumber(props.message_count),
        total_chars: this.toNumber(props.total_chars),
        status: props.status
      };
    });
  }

  async updateConversationStatus(uuid: string, status: 'active' | 'archived'): Promise<void> {
    await this.neo4j.run(
      `MATCH (c:Conversation {uuid: $uuid})
       SET c.status = $status, c.updated_at = datetime()`,
      { uuid, status }
    );
  }

  async deleteConversation(uuid: string): Promise<void> {
    await this.neo4j.run(
      `MATCH (c:Conversation {uuid: $uuid})
       OPTIONAL MATCH (c)-[:HAS_MESSAGE]->(m:Message)
       OPTIONAL MATCH (m)-[:MADE_TOOL_CALL]->(t:ToolCall)
       OPTIONAL MATCH (t)-[:PRODUCED_RESULT]->(r:ToolResult)
       OPTIONAL MATCH (c)-[:HAS_SUMMARY]->(s:Summary)
       DETACH DELETE c, m, t, r, s`,
      { uuid }
    );
  }

  async incrementMessageCount(uuid: string, charCount: number): Promise<void> {
    await this.neo4j.run(
      `MATCH (c:Conversation {uuid: $uuid})
       SET c.message_count = c.message_count + 1,
           c.total_chars = c.total_chars + $charCount,
           c.updated_at = datetime()`,
      { uuid, charCount }
    );
  }

  // ==========================================================================
  // Message Operations
  // ==========================================================================

  async storeMessage(options: StoreMessageOptions): Promise<string> {
    let uuid = options.uuid;

    // Auto-generate deterministic UUID if not provided
    if (!uuid) {
      // Get current message count to determine the index
      const countResult = await this.neo4j.run(
        `MATCH (c:Conversation {uuid: $convId})-[:HAS_MESSAGE]->(m:Message)
         RETURN count(m) as messageCount`,
        { convId: options.conversation_id }
      );
      const messageCount = countResult.records[0]?.get('messageCount')?.toNumber?.() ??
                           countResult.records[0]?.get('messageCount') ?? 0;

      // Calculate turn index (each turn = 1 user + N assistant messages)
      // For simplicity, we use messageCount as a unique index within the conversation
      uuid = UniqueIDHelper.GenerateMessageUUID(
        options.conversation_id,
        messageCount,
        options.role
      );
    }

    const charCount = options.content.length + (options.reasoning?.length || 0);
    const timestamp = normalizeTimestamp(options.timestamp);

    await this.neo4j.run(
      `MATCH (c:Conversation {uuid: $conversation_id})
       CREATE (c)-[:HAS_MESSAGE]->(m:Message {
         uuid: $uuid,
         conversation_id: $conversation_id,
         role: $role,
         content: $content,
         reasoning: $reasoning,
         timestamp: datetime($timestamp),
         char_count: $char_count
       })`,
      {
        uuid,
        conversation_id: options.conversation_id,
        role: options.role,
        content: options.content,
        reasoning: options.reasoning || null,
        timestamp,
        char_count: charCount
      }
    );

    return uuid;
  }

  async getMessages(
    conversationId: string,
    options?: GetMessagesOptions
  ): Promise<Message[]> {
    const includeToolCalls = options?.includeToolCalls ?? true;

    const toolCallsQuery = includeToolCalls
      ? `OPTIONAL MATCH (m)-[:MADE_TOOL_CALL]->(t:ToolCall)-[:PRODUCED_RESULT]->(r:ToolResult)
         WITH m, collect({
           uuid: t.uuid,
           message_id: t.message_id,
           tool_name: t.tool_name,
           arguments: t.arguments,
           timestamp: t.timestamp,
           duration_ms: t.duration_ms,
           success: t.success,
           iteration: t.iteration,
           result: {
             uuid: r.uuid,
             tool_call_id: r.tool_call_id,
             success: r.success,
             result: r.result,
             error: r.error,
             timestamp: r.timestamp,
             result_size_bytes: r.result_size_bytes
           }
         }) as tool_calls`
      : 'WITH m, [] as tool_calls';

    const result = await this.neo4j.run(
      `MATCH (c:Conversation {uuid: $conversationId})-[:HAS_MESSAGE]->(m:Message)
       ${toolCallsQuery}
       RETURN m, tool_calls
       ORDER BY m.timestamp ASC
       LIMIT $limit`,
      {
        conversationId,
        limit: neo4j.int(options?.limit || 10000)
      }
    );

    return result.records.map(r => {
      const props = r.get('m').properties;
      const rawToolCalls = r.get('tool_calls').filter((tc: any) => tc.tool_name);
      
      // Normalize timestamps in tool calls
      const toolCalls = rawToolCalls.map((tc: any) => ({
        uuid: tc.uuid,
        message_id: tc.message_id,
        tool_name: tc.tool_name,
        arguments: tc.arguments,
        timestamp: normalizeTimestamp(tc.timestamp),
        duration_ms: tc.duration_ms,
        success: tc.success,
        iteration: tc.iteration,
        result: tc.result ? {
          uuid: tc.result.uuid,
          success: tc.result.success,
          result: tc.result.result,
          error: tc.result.error,
          timestamp: normalizeTimestamp(tc.result.timestamp),
          result_size_bytes: tc.result.result_size_bytes
        } : undefined
      }));

      return {
        uuid: props.uuid,
        conversation_id: props.conversation_id,
        role: props.role,
        content: props.content,
        reasoning: props.reasoning || undefined,
        timestamp: normalizeTimestamp(props.timestamp),
        token_count: props.token_count ? this.toNumber(props.token_count) : undefined,
        char_count: this.toNumber(props.char_count),
        embedding: props.embedding || undefined,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined
      };
    });
  }

  async updateMessageEmbedding(messageUuid: string, embedding: number[]): Promise<void> {
    await this.neo4j.run(
      `MATCH (m:Message {uuid: $uuid})
       SET m.embedding = $embedding`,
      { uuid: messageUuid, embedding }
    );
  }

  /**
   * Generate embedding text for a turn (L0) including user message, tool calls, and assistant message
   * This text is used to generate embeddings for semantic search
   * IMPORTANT: The Message node must have label "Message" for vector index "message_embedding_index" to work
   */
  private generateTurnEmbeddingText(
    userMessage: Message,
    assistantMessage: Message
  ): string {
    const parts: string[] = [];
    
    // User message
    if (userMessage.content) {
      parts.push(`User: ${userMessage.content}`);
    }
    
    // Tool calls (attached to assistant message)
    if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
      parts.push('Tools used:');
      for (const toolCall of assistantMessage.tool_calls) {
        // Tool name
        const toolName = toolCall.tool_name || 'unknown';
        
        // Arguments (truncated for embedding)
        let argsStr = '';
        if (toolCall.arguments) {
          const args = typeof toolCall.arguments === 'string'
            ? toolCall.arguments
            : JSON.stringify(toolCall.arguments);
          argsStr = args.substring(0, 200);
        }
        
        // Result (truncated for embedding)
        let resultStr = '';
        if (toolCall.result?.result) {
          const result = typeof toolCall.result.result === 'string'
            ? toolCall.result.result
            : JSON.stringify(toolCall.result.result);
          resultStr = result.substring(0, 200);
        }
        
        // Error if present
        if (toolCall.result?.error) {
          resultStr = `Error: ${String(toolCall.result.error).substring(0, 200)}`;
        }
        
        parts.push(`- ${toolName}${argsStr ? `(${argsStr}${argsStr.length >= 200 ? '...' : ''})` : ''}: ${resultStr}${resultStr.length >= 200 ? '...' : ''}`);
      }
    }
    
    // Assistant message
    if (assistantMessage.content) {
      parts.push(`Assistant: ${assistantMessage.content}`);
    }
    
    // Assistant reasoning (if present)
    if (assistantMessage.reasoning) {
      parts.push(`Reasoning: ${assistantMessage.reasoning}`);
    }
    
    return parts.join('\n');
  }

  /**
   * Store a turn (L0) with embedding generation
   * A turn consists of: user message + tool calls + assistant message
   * IMPORTANT: Messages are stored with label "Message" for vector index "message_embedding_index"
   */
  async storeTurnWithEmbedding(
    conversationId: string,
    userMessage: Message,
    assistantMessage: Message,
    options?: {
      generateEmbedding?: boolean; // Default: true if embeddingProvider is available
    }
  ): Promise<void> {
    // Messages should already be stored via storeMessage()
    // This method generates and stores embeddings for the turn
    
    const shouldGenerateEmbedding = options?.generateEmbedding !== false && this.embeddingProvider !== undefined;
    
    if (!shouldGenerateEmbedding) {
      return; // No embedding generation requested or provider not available
    }

    if (!this.embeddingProvider) {
      throw new Error('EmbeddingProvider not configured. Call setEmbeddingProvider() first.');
    }

    // Generate embedding text for the turn (user + tools + assistant)
    const embeddingText = this.generateTurnEmbeddingText(userMessage, assistantMessage);
    
    if (!embeddingText || embeddingText.trim().length < 10) {
      return; // Skip if text is too short
    }

    // Truncate if too long (Gemini has limits, but 4000 chars is safe)
    const truncatedText = embeddingText.length > 4000 
      ? embeddingText.substring(0, 4000) 
      : embeddingText;

    try {
      // Generate embedding using GeminiEmbeddingProvider (3072 dimensions)
      // This will use the "Message" label for vector index "message_embedding_index"
      const embedding = await this.embeddingProvider.embedSingle(truncatedText);
      
      // Store embedding on assistant message (represents the full turn)
      // The Message node has label "Message" which matches the vector index
      await this.updateMessageEmbedding(assistantMessage.uuid, embedding);
      
      // Optionally also store on user message for better search coverage
      // But typically we store on assistant message as it contains the full turn context
    } catch (error) {
      console.error('[ConversationStorage] Error generating turn embedding:', error);
      // Don't throw - embedding generation is non-critical
    }
  }

  // ==========================================================================
  // Tool Call Operations
  // ==========================================================================

  async storeToolCall(messageUuid: string, toolCall: any): Promise<void> {
    // Generate deterministic UUIDs based on message + tool + iteration
    const callIndex = toolCall.iteration ?? 0;
    const tcUuid = UniqueIDHelper.GenerateToolCallUUID(messageUuid, toolCall.tool_name, callIndex);
    const resultUuid = UniqueIDHelper.GenerateToolResultUUID(tcUuid);

    await this.neo4j.run(
      `MATCH (m:Message {uuid: $msgUuid})
       CREATE (m)-[:MADE_TOOL_CALL]->(t:ToolCall {
         uuid: $tcUuid,
         message_id: $msgUuid,
         tool_name: $toolName,
         arguments: $arguments,
         timestamp: datetime(),
         duration_ms: $duration,
         success: $success,
         iteration: $iteration
       })
       CREATE (t)-[:PRODUCED_RESULT]->(r:ToolResult {
         uuid: $resultUuid,
         tool_call_id: $tcUuid,
         success: $success,
         result: $result,
         error: $error,
         timestamp: datetime(),
         result_size_bytes: $resultSize
       })`,
      {
        msgUuid: messageUuid,
        tcUuid,
        resultUuid,
        toolName: toolCall.tool_name,
        arguments: JSON.stringify(toolCall.arguments || {}),
        duration: toolCall.duration_ms || 0,
        success: toolCall.success ?? true,
        iteration: toolCall.iteration || null,
        result: JSON.stringify(toolCall.result || {}),
        error: toolCall.error || null,
        resultSize: JSON.stringify(toolCall.result || {}).length
      }
    );
  }

  // ==========================================================================
  // Hierarchical Summaries
  // ==========================================================================

  async storeSummary(summary: Summary): Promise<void> {
    const created_at = normalizeTimestamp(summary.created_at);

    // IMPORTANT: Summary node must have label "Summary" for vector index "summary_embedding_index" to work
    await this.neo4j.run(
      `MATCH (c:Conversation {uuid: $conversation_id})
       CREATE (c)-[:HAS_SUMMARY]->(s:Summary {
         uuid: $uuid,
         conversation_id: $conversation_id,
         level: $level,
         conversation_summary: $conversation_summary,
         actions_summary: $actions_summary,
         start_turn_index: $start_turn_index,
         end_turn_index: $end_turn_index,
         char_range_start: $char_range_start,
         char_range_end: $char_range_end,
         summary_char_count: $summary_char_count,
         created_at: datetime($created_at),
         parent_summaries: $parent_summaries,
         embedding: $embedding
       })`,
      {
        uuid: summary.uuid,
        conversation_id: summary.conversation_id,
        level: summary.level,
        conversation_summary: summary.content.conversation_summary,
        actions_summary: summary.content.actions_summary,
        start_turn_index: summary.start_turn_index,
        end_turn_index: summary.end_turn_index,
        char_range_start: summary.char_range_start,
        char_range_end: summary.char_range_end,
        summary_char_count: summary.summary_char_count,
        created_at,
        parent_summaries: summary.parent_summaries || [],
        embedding: summary.embedding || null // Store embedding if present (for vector index)
      }
    );
  }

  async getSummaries(conversationId: string, level?: number): Promise<Summary[]> {
    const levelFilter = level !== undefined ? 'AND s.level = $level' : '';

    const result = await this.neo4j.run(
      `MATCH (c:Conversation {uuid: $conversationId})-[:HAS_SUMMARY]->(s:Summary)
       WHERE 1=1 ${levelFilter}
       RETURN s
       ORDER BY s.level ASC, s.char_range_start ASC`,
      { conversationId, level }
    );

    return result.records.map(r => {
      const props = r.get('s').properties;
      return {
        uuid: props.uuid,
        conversation_id: props.conversation_id,
        level: this.toNumber(props.level) || 1,
        content: {
          conversation_summary: props.conversation_summary || '',
          actions_summary: props.actions_summary || ''
        },
        start_turn_index: this.toNumber(props.start_turn_index) ?? 0,
        end_turn_index: this.toNumber(props.end_turn_index) ?? 0,
        char_range_start: this.toNumber(props.char_range_start),
        char_range_end: this.toNumber(props.char_range_end),
        summary_char_count: this.toNumber(props.summary_char_count),
        created_at: props.created_at,
        embedding: props.embedding || undefined,
        parent_summaries: props.parent_summaries || undefined
      };
    });
  }

  async getLatestSummaryByLevel(conversationId: string, level: number): Promise<Summary | null> {
    const result = await this.neo4j.run(
      `MATCH (c:Conversation {uuid: $conversationId})-[:HAS_SUMMARY]->(s:Summary)
       WHERE s.level = $level
       RETURN s
       ORDER BY s.created_at DESC
       LIMIT 1`,
      { conversationId, level }
    );

    if (result.records.length === 0) {
      return null;
    }

    const props = result.records[0].get('s').properties;
    return {
      uuid: props.uuid,
      conversation_id: props.conversation_id,
      level: props.level?.toNumber() || 1,
      content: {
        conversation_summary: props.conversation_summary || '',
        actions_summary: props.actions_summary || ''
      },
      start_turn_index: props.start_turn_index?.toNumber() ?? 0,
      end_turn_index: props.end_turn_index?.toNumber() ?? 0,
      char_range_start: props.char_range_start?.toNumber() || 0,
      char_range_end: props.char_range_end?.toNumber() || 0,
      summary_char_count: props.summary_char_count?.toNumber() || 0,
      created_at: props.created_at,
      embedding: props.embedding || undefined,
      parent_summaries: props.parent_summaries || undefined
    };
  }

  async updateSummaryEmbedding(summaryUuid: string, embedding: number[]): Promise<void> {
    // IMPORTANT: Summary node has label "Summary" which matches vector index "summary_embedding_index"
    await this.neo4j.run(
      `MATCH (s:Summary {uuid: $uuid})
       SET s.embedding = $embedding`,
      { uuid: summaryUuid, embedding }
    );
  }

  /**
   * Store a summary with embedding generation
   * IMPORTANT: Summary node has label "Summary" for vector index "summary_embedding_index"
   */
  async storeSummaryWithEmbedding(
    summary: Summary,
    embeddingProvider?: GeminiEmbeddingProvider
  ): Promise<void> {
    // Use provided provider or instance provider
    const provider = embeddingProvider || this.embeddingProvider;
    
    // Generate embedding if provider is available and summary doesn't have one yet
    if (provider && !summary.embedding) {
      // Import the helper function from summarizer
      const { generateSummaryEmbeddingText } = await import('./summarizer.js');
      const embeddingText = generateSummaryEmbeddingText(summary);
      
      if (embeddingText && embeddingText.trim().length >= 10) {
        // Truncate if too long (4000 chars is safe for Gemini)
        const truncatedText = embeddingText.length > 4000 
          ? embeddingText.substring(0, 4000) 
          : embeddingText;
        
        try {
          // Generate embedding using GeminiEmbeddingProvider (3072 dimensions)
          // This will use the "Summary" label for vector index "summary_embedding_index"
          summary.embedding = await provider.embedSingle(truncatedText);
        } catch (error) {
          console.error('[ConversationStorage] Error generating summary embedding:', error);
          // Continue without embedding - non-critical
        }
      }
    }
    
    // Store summary (with embedding if generated)
    await this.storeSummary(summary);
  }

  async getTotalSummaryChars(conversationId: string, level: number): Promise<number> {
    const summaries = await this.getSummaries(conversationId, level);
    return summaries.reduce((total, s) => total + s.summary_char_count, 0);
  }

  /**
   * Find File node in Neo4j by file path (with normalization and multiple matching strategies)
   * Used for creating MENTIONS_FILE relationships
   */
  private async findFileNode(
    filePath: string,
    projectRoot?: string
  ): Promise<{ uuid: string; path: string } | null> {
    // Normalize the path (remove ./ and ../)
    const normalized = path.normalize(filePath).replace(/^\.\//, '');
    
    // Try multiple matching formats
    const candidates = [
      normalized,                    // Exact format
      normalized.replace(/^\//, ''), // Without leading slash
      path.relative(projectRoot || '', normalized), // Relative to project
    ];
    
    // Search in Neo4j
    for (const candidate of candidates) {
      const result = await this.neo4j.run(
        `MATCH (f:File)
         WHERE f.path = $path OR f.path ENDS WITH $path
         RETURN f.uuid AS uuid, f.path AS path
         LIMIT 1`,
        { path: candidate }
      );
      
      if (result.records.length > 0) {
        return {
          uuid: result.records[0].get('uuid'),
          path: result.records[0].get('path')
        };
      }
    }
    
    return null; // File not found in brain
  }

  /**
   * Create MENTIONS_FILE relationships from Summary to File nodes
   */
  private async createFileRelations(
    summaryUuid: string,
    filesMentioned: FileMention[],
    projectRoot?: string
  ): Promise<void> {
    for (const fileMention of filesMentioned) {
      const fileNode = await this.findFileNode(fileMention.path, projectRoot);
      
      if (fileNode) {
        // Create relation Summary → File
        // IMPORTANT: Summary node has label "Summary", File node has label "File"
        await this.neo4j.run(
          `MATCH (s:Summary {uuid: $summaryUuid})
           MATCH (f:File {uuid: $fileUuid})
           MERGE (s)-[:MENTIONS_FILE]->(f)`,
          {
            summaryUuid,
            fileUuid: fileNode.uuid
          }
        );
      }
    }
  }

  /**
   * Create MENTIONS_NODE relationships from Summary to any node type
   * Works for Scope, WebPage, Document, MarkdownSection, CodeBlock, etc.
   */
  private async createNodeRelations(
    summaryUuid: string,
    nodesMentioned: NodeMention[]
  ): Promise<void> {
    for (const node of nodesMentioned) {
      // Use generic match by UUID - works for any node type
      // Store reason if provided by LLM
      await this.neo4j.run(
        `MATCH (s:Summary {uuid: $summaryUuid})
         MATCH (n {uuid: $nodeUuid})
         MERGE (s)-[r:MENTIONS_NODE]->(n)
         SET r.reason = $reason`,
        {
          summaryUuid,
          nodeUuid: node.uuid,
          reason: node.reason || null
        }
      );
    }
  }

  /**
   * Create SUMMARIZES relationships from Summary to Messages (for L1 summaries)
   */
  private async createSummarizesRelations(
    summaryUuid: string,
    messageUuids: string[]
  ): Promise<void> {
    if (messageUuids.length === 0) return;

    // Create SUMMARIZES relationships to all messages in the range
    // IMPORTANT: Summary node has label "Summary", Message node has label "Message"
    await this.neo4j.run(
      `MATCH (s:Summary {uuid: $summaryUuid})
       UNWIND $messageUuids AS msgUuid
       MATCH (m:Message {uuid: msgUuid})
       MERGE (s)-[:SUMMARIZES]->(m)`,
      {
        summaryUuid,
        messageUuids
      }
    );
  }

  /**
   * Convert Messages to ConversationTurn format for summarizer
   */
  private messagesToTurns(messages: Message[]): ConversationTurn[] {
    const turns: ConversationTurn[] = [];

    // Group messages into turns (user + ALL assistant messages until next user)
    // This captures intermediate tool calls from multi-iteration agent responses
    let i = 0;
    while (i < messages.length) {
      const userMsg = messages[i];
      if (userMsg.role !== 'user') {
        i++;
        continue;
      }

      // Collect ALL assistant messages until next user message
      const allToolResults: Array<{
        toolName: string;
        toolArgs?: Record<string, any>;
        toolResult: any;
        success: boolean;
        timestamp: string;
      }> = [];
      let finalAssistantContent = '';
      let finalReasoning = '';
      let lastTimestamp = userMsg.timestamp;

      let j = i + 1;
      while (j < messages.length && messages[j].role !== 'user') {
        const msg = messages[j];
        if (msg.role === 'assistant') {
          // Accumulate tool calls from each assistant message
          if (msg.tool_calls && msg.tool_calls.length > 0) {
            for (const tc of msg.tool_calls) {
              // Parse arguments if stringified JSON
              let toolArgs: Record<string, any> | undefined;
              if (tc.arguments) {
                try {
                  toolArgs = typeof tc.arguments === 'string'
                    ? JSON.parse(tc.arguments)
                    : tc.arguments;
                } catch {
                  toolArgs = undefined;
                }
              }

              // Parse result if stringified JSON
              let toolResult: any;
              if (tc.result?.result) {
                try {
                  toolResult = typeof tc.result.result === 'string'
                    ? JSON.parse(tc.result.result)
                    : tc.result.result;
                } catch {
                  toolResult = tc.result.result;
                }
              }

              // Normalize timestamp - use tool call timestamp or fallback to message timestamp
              const toolTimestamp = normalizeTimestamp(tc.timestamp || msg.timestamp);

              allToolResults.push({
                toolName: tc.tool_name || 'unknown',
                toolArgs,
                toolResult,
                success: tc.result?.success ?? tc.success ?? true,
                timestamp: toolTimestamp
              });
            }
          }

          // The last assistant message with content is the final response
          if (msg.content && msg.content.trim()) {
            finalAssistantContent = msg.content;
            finalReasoning = msg.reasoning || '';
          }
          lastTimestamp = msg.timestamp;
        }
        j++;
      }

      // Create turn only if we have an assistant response
      if (finalAssistantContent || allToolResults.length > 0) {
        const timestamp = normalizeTimestamp(lastTimestamp);

        turns.push({
          userMessage: userMsg.content,
          assistantMessage: finalAssistantContent + (finalReasoning ? `\n\nReasoning: ${finalReasoning}` : ''),
          toolResults: allToolResults,
          timestamp
        });
      }

      i = j; // Jump to next user message
    }

    return turns;
  }

  /**
   * Generate and store L1 summary automatically if threshold is reached
   * Returns the created summary or null if no summary was created
   */
  async generateL1SummaryIfNeeded(
    conversationId: string,
    options?: {
      projectRoot?: string; // For finding File nodes
      summarizer?: ConversationSummarizer; // Optional, uses instance summarizer if not provided
    }
  ): Promise<Summary | null> {
    if (!this.summarizer && !options?.summarizer) {
      throw new Error('ConversationSummarizer not configured. Call setSummarizer() first or provide in options.');
    }

    const summarizer = options?.summarizer || this.summarizer!;

    // Check if L1 summary should be created
    const shouldCreate = await this.shouldCreateL1Summary(conversationId);
    
    if (!shouldCreate.shouldCreate) {
      return null; // No summary needed
    }

    // Convert messages to turns format
    const turns = this.messagesToTurns(shouldCreate.messagesToSummarize);
    
    if (turns.length === 0) {
      return null; // No turns to summarize
    }

    // Generate summary using ConversationSummarizer
    const summaryWithFiles = await summarizer.summarizeTurns(
      turns,
      conversationId,
      shouldCreate.startTurnIndex,
      shouldCreate.endTurnIndex,
      shouldCreate.charRangeStart,
      shouldCreate.charRangeEnd
    );

    // Store summary with embedding (uses Summary label for vector index)
    await this.storeSummaryWithEmbedding(summaryWithFiles, this.embeddingProvider);

    // Create SUMMARIZES relationships to messages
    const messageUuids = shouldCreate.messagesToSummarize.map(m => m.uuid);
    await this.createSummarizesRelations(summaryWithFiles.uuid, messageUuids);

    // Create MENTIONS_FILE relationships
    if (summaryWithFiles.filesMentioned && summaryWithFiles.filesMentioned.length > 0) {
      await this.createFileRelations(
        summaryWithFiles.uuid,
        summaryWithFiles.filesMentioned,
        options?.projectRoot
      );
    }

    // Create MENTIONS_NODE relationships (for scopes, webpages, documents, etc.)
    if (summaryWithFiles.nodesMentioned && summaryWithFiles.nodesMentioned.length > 0) {
      await this.createNodeRelations(
        summaryWithFiles.uuid,
        summaryWithFiles.nodesMentioned
      );
    }

    return summaryWithFiles;
  }

  /**
   * Generate and store L2 summary automatically if threshold is reached
   * Returns the created summary or null if no summary was created
   *
   * IMPORTANT:
   * - Summary node has label "Summary" for vector index "summary_embedding_index"
   * - L2 summaries summarize L1 summaries (not messages directly)
   */
  async generateL2SummaryIfNeeded(
    conversationId: string,
    options?: {
      projectRoot?: string; // For finding File nodes
      summarizer?: ConversationSummarizer; // Optional, uses instance summarizer if not provided
    }
  ): Promise<Summary | null> {
    if (!this.summarizer && !options?.summarizer) {
      throw new Error('ConversationSummarizer not configured. Call setSummarizer() first or provide in options.');
    }

    const summarizer = options?.summarizer || this.summarizer!;

    // Check if L2 summary should be created
    const shouldCreate = await this.shouldCreateL2Summary(conversationId);
    
    if (!shouldCreate.shouldCreate) {
      return null; // No summary needed
    }

    if (shouldCreate.summariesToSummarize.length < 2) {
      return null; // Need at least 2 L1 summaries to create L2
    }

    // Generate L2 summary from L1 summaries using ConversationSummarizer
    const summaryWithFiles = await summarizer.summarizeSummaries(
      shouldCreate.summariesToSummarize,
      conversationId,
      shouldCreate.startTurnIndex,
      shouldCreate.endTurnIndex,
      shouldCreate.charRangeStart,
      shouldCreate.charRangeEnd,
      2 // Target level: L2
    );

    // Store summary with embedding (uses Summary label for vector index)
    await this.storeSummaryWithEmbedding(summaryWithFiles, this.embeddingProvider);

    // Create SUMMARIZES relationships to L1 summaries (not to messages)
    // For L2, we summarize L1 summaries, so we create Summary -> Summary relationships
    const l1SummaryUuids = shouldCreate.summariesToSummarize.map(s => s.uuid);
    await this.neo4j.run(
      `MATCH (s2:Summary {uuid: $summaryUuid})
       UNWIND $l1SummaryUuids AS l1Uuid
       MATCH (s1:Summary {uuid: l1Uuid})
       MERGE (s2)-[:SUMMARIZES]->(s1)`,
      {
        summaryUuid: summaryWithFiles.uuid,
        l1SummaryUuids
      }
    );

    // Create MENTIONS_FILE relationships
    // Merge files from all L1 summaries being summarized
    if (summaryWithFiles.filesMentioned && summaryWithFiles.filesMentioned.length > 0) {
      await this.createFileRelations(
        summaryWithFiles.uuid,
        summaryWithFiles.filesMentioned,
        options?.projectRoot
      );
    }

    // Create MENTIONS_NODE relationships (for scopes, webpages, documents, etc.)
    if (summaryWithFiles.nodesMentioned && summaryWithFiles.nodesMentioned.length > 0) {
      await this.createNodeRelations(
        summaryWithFiles.uuid,
        summaryWithFiles.nodesMentioned
      );
    }

    return summaryWithFiles;
  }

  // ==========================================================================
  // Semantic Search Multi-Level
  // ==========================================================================

  /**
   * Generate embedding for a query string
   * Used for semantic search across conversation history
   */
  private async generateQueryEmbedding(query: string): Promise<number[]> {
    if (!this.embeddingProvider) {
      throw new Error('EmbeddingProvider not configured. Call setEmbeddingProvider() first.');
    }
    return await this.embeddingProvider.embedSingle(query);
  }

  /**
   * Search conversation history across multiple levels (L0, L1, L2) using semantic search
   * Uses vector indexes for optimization: message_embedding_index and summary_embedding_index
   * 
   * IMPORTANT:
   * - Message nodes have label "Message" for vector index "message_embedding_index"
   * - Summary nodes have label "Summary" for vector index "summary_embedding_index"
   */
  async searchConversationHistory(
    conversationId: string,
    query: string,
    options: {
      semantic?: boolean;        // Default: true
      maxResults?: number;        // Default: 20
      minScore?: number;         // Default: 0.3
      includeTurns?: boolean;    // Default: true (include L0)
      levels?: number[];         // Default: [0, 1, 2] (all levels)
    } = {}
  ): Promise<Array<{
    type: 'turn' | 'summary';
    turn?: Message;
    summary?: Summary;
    score: number;
  }>> {
    const {
      semantic = true,
      maxResults = 20,
      minScore = 0.3,
      includeTurns = true,
      levels = [0, 1, 2]
    } = options;

    if (!semantic) {
      // Text search not implemented yet - return empty for now
      return [];
    }

    if (!this.embeddingProvider) {
      // If embedding provider not configured, return empty results instead of throwing
      // This allows fuzzy search to work even without embeddings
      console.log('[ConversationStorage] searchConversationHistory: EmbeddingProvider not configured, skipping semantic search');
      return [];
    }

    // Generate query embedding
    const queryEmbedding = await this.generateQueryEmbedding(query);
    
    // If embedding generation failed, return empty results (provider not configured)
    if (!queryEmbedding || queryEmbedding.length === 0) {
      console.log('[ConversationStorage] searchConversationHistory: Empty embedding returned, skipping semantic search');
      return [];
    }

    const results: Array<{
      type: 'turn' | 'summary';
      turn?: Message;
      summary?: Summary;
      score: number;
    }> = [];

    // Build UNION query for multiple levels
    const queries: string[] = [];
    const params: Record<string, any> = {
      conversationId,
      queryEmbedding,
      minScore,
      maxResults: neo4j.int(maxResults)
    };

    // L0: Search in Messages (turns) if requested
    if (includeTurns && levels.includes(0)) {
      // Try vector index first (fast)
      // Note: All UNION queries must return columns in the same order: type, turn, summary, score
      const l0Query = `
        CALL db.index.vector.queryNodes('message_embedding_index', $requestTopK, $queryEmbedding)
        YIELD node AS m, score
        MATCH (c:Conversation {uuid: $conversationId})-[:HAS_MESSAGE]->(m)
        WHERE score >= $minScore
        RETURN 'turn' AS type, m AS turn, null AS summary, score
        ORDER BY score DESC
        LIMIT $maxResults
      `;
      queries.push(l0Query);
      params.requestTopK = neo4j.int(Math.min(maxResults * 3, 100));
    }

    // L1: Search in Summaries level 1 if requested
    // Note: All UNION queries must return columns in the same order: type, turn, summary, score
    if (levels.includes(1)) {
      const l1Query = `
        CALL db.index.vector.queryNodes('summary_embedding_index', $requestTopK, $queryEmbedding)
        YIELD node AS s, score
        MATCH (c:Conversation {uuid: $conversationId})-[:HAS_SUMMARY]->(s)
        WHERE s.level = 1 AND score >= $minScore
        RETURN 'summary' AS type, null AS turn, s AS summary, score
        ORDER BY score DESC
        LIMIT $maxResults
      `;
      queries.push(l1Query);
    }

    // L2: Search in Summaries level 2 if requested
    // Note: All UNION queries must return columns in the same order: type, turn, summary, score
    if (levels.includes(2)) {
      const l2Query = `
        CALL db.index.vector.queryNodes('summary_embedding_index', $requestTopK, $queryEmbedding)
        YIELD node AS s, score
        MATCH (c:Conversation {uuid: $conversationId})-[:HAS_SUMMARY]->(s)
        WHERE s.level = 2 AND score >= $minScore
        RETURN 'summary' AS type, null AS turn, s AS summary, score
        ORDER BY score DESC
        LIMIT $maxResults
      `;
      queries.push(l2Query);
    }

    if (queries.length === 0) {
      return []; // No levels requested
    }

    // Execute UNION query
    const unionQuery = queries.join('\nUNION\n');

    try {
      const result = await this.neo4j.run(unionQuery, params);

      for (const record of result.records) {
        const type = record.get('type') as 'turn' | 'summary';
        const score = record.get('score') as number;

        if (type === 'turn') {
          const m = record.get('turn'); // Changed from 'm' to 'turn' to match RETURN clause
          if (m) {
            const props = m.properties;
            // Get tool calls if needed
            const toolCallsResult = await this.neo4j.run(
              `MATCH (m:Message {uuid: $uuid})-[:MADE_TOOL_CALL]->(t:ToolCall)-[:PRODUCED_RESULT]->(r:ToolResult)
               RETURN collect({
                 uuid: t.uuid,
                 message_id: t.message_id,
                 tool_name: t.tool_name,
                 arguments: t.arguments,
                 timestamp: t.timestamp,
                 duration_ms: t.duration_ms,
                 success: t.success,
                 iteration: t.iteration,
                 result: {
                   uuid: r.uuid,
                   tool_call_id: r.tool_call_id,
                   success: r.success,
                   result: r.result,
                   error: r.error,
                   timestamp: r.timestamp,
                   result_size_bytes: r.result_size_bytes
                 }
               }) AS tool_calls`,
              { uuid: props.uuid }
            );

            const rawToolCalls = toolCallsResult.records[0]?.get('tool_calls') || [];
            
            // Normalize timestamps in tool calls
            const toolCalls = rawToolCalls.map((tc: any) => ({
              uuid: tc.uuid,
              message_id: tc.message_id,
              tool_name: tc.tool_name,
              arguments: tc.arguments,
              timestamp: normalizeTimestamp(tc.timestamp),
              duration_ms: tc.duration_ms,
              success: tc.success,
              iteration: tc.iteration,
              result: tc.result ? {
                uuid: tc.result.uuid,
                success: tc.result.success,
                result: tc.result.result,
                error: tc.result.error,
                timestamp: normalizeTimestamp(tc.result.timestamp),
                result_size_bytes: tc.result.result_size_bytes
              } : undefined
            }));

            results.push({
              type: 'turn',
              turn: {
                uuid: props.uuid,
                conversation_id: props.conversation_id,
                role: props.role,
                content: props.content,
                reasoning: props.reasoning || undefined,
                timestamp: normalizeTimestamp(props.timestamp),
                token_count: props.token_count ? this.toNumber(props.token_count) : undefined,
                char_count: this.toNumber(props.char_count),
                embedding: props.embedding || undefined,
                tool_calls: toolCalls.length > 0 ? toolCalls : undefined
              },
              score
            });
          }
        } else if (type === 'summary') {
          const s = record.get('summary');
          if (s) {
            const props = s.properties;
            results.push({
              type: 'summary',
              summary: {
                uuid: props.uuid,
                conversation_id: props.conversation_id,
                level: this.toNumber(props.level) || 1,
                content: {
                  conversation_summary: props.conversation_summary || '',
                  actions_summary: props.actions_summary || ''
                },
                start_turn_index: this.toNumber(props.start_turn_index) || 0,
                end_turn_index: this.toNumber(props.end_turn_index) || 0,
                char_range_start: this.toNumber(props.char_range_start),
                char_range_end: this.toNumber(props.char_range_end),
                summary_char_count: this.toNumber(props.summary_char_count),
                created_at: props.created_at,
                embedding: props.embedding || undefined,
                parent_summaries: props.parent_summaries || undefined
              },
              score
            });
          }
        }
      }
    } catch (error: any) {
      // Vector indexes might not exist yet, fall back to manual cosine similarity
      if (error.message?.includes('does not exist') || error.message?.includes('no such vector')) {
        console.debug('[ConversationStorage] Vector indexes not found, using manual cosine similarity');
        return await this.searchConversationHistoryFallback(conversationId, queryEmbedding, {
          maxResults,
          minScore,
          includeTurns,
          levels
        });
      }
      throw error;
    }

    // Add confidence based on level
    for (const result of results) {
      if (result.type === 'turn') {
        (result as any).confidence = 1.0; // L0: highest confidence
      } else if (result.summary) {
        if (result.summary.level === 1) {
          (result as any).confidence = 0.7; // L1: good confidence
        } else if (result.summary.level === 2) {
          (result as any).confidence = 0.5; // L2: medium confidence
        }
      }
    }

    // Sort all results by score DESC and limit
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, maxResults);
  }

  /**
   * Fallback semantic search using manual cosine similarity (when vector indexes don't exist)
   * IMPORTANT: Uses labels Message and Summary for filtering
   */
  private async searchConversationHistoryFallback(
    conversationId: string,
    queryEmbedding: number[],
    options: {
      maxResults: number;
      minScore: number;
      includeTurns: boolean;
      levels: number[];
    }
  ): Promise<Array<{
    type: 'turn' | 'summary';
    turn?: Message;
    summary?: Summary;
    score: number;
  }>> {
    const { maxResults, minScore, includeTurns, levels } = options;
    const results: Array<{
      type: 'turn' | 'summary';
      turn?: Message;
      summary?: Summary;
      score: number;
    }> = [];

    // Helper to compute cosine similarity
    const cosineSimilarity = (a: number[], b: number[]): number => {
      if (a.length !== b.length) return 0;
      let dotProduct = 0;
      let normA = 0;
      let normB = 0;
      for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
      }
      return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    };

    // L0: Search in Messages
    if (includeTurns && levels.includes(0)) {
      const messagesResult = await this.neo4j.run(
        `MATCH (c:Conversation {uuid: $conversationId})-[:HAS_MESSAGE]->(m:Message)
         WHERE m.embedding IS NOT NULL
         RETURN m`,
        { conversationId }
      );

      for (const record of messagesResult.records) {
        const m = record.get('m').properties;
        if (!m.embedding || !Array.isArray(m.embedding)) continue;

        const score = cosineSimilarity(queryEmbedding, m.embedding);
        if (score < minScore) continue;

        // Get tool calls
        const toolCallsResult = await this.neo4j.run(
          `MATCH (m:Message {uuid: $uuid})-[:MADE_TOOL_CALL]->(t:ToolCall)-[:PRODUCED_RESULT]->(r:ToolResult)
           RETURN collect({
             uuid: t.uuid,
             message_id: t.message_id,
             tool_name: t.tool_name,
             arguments: t.arguments,
             timestamp: t.timestamp,
             duration_ms: t.duration_ms,
             success: t.success,
             iteration: t.iteration,
             result: {
               uuid: r.uuid,
               tool_call_id: r.tool_call_id,
               success: r.success,
               result: r.result,
               error: r.error,
               timestamp: r.timestamp,
               result_size_bytes: r.result_size_bytes
             }
           }) AS tool_calls`,
          { uuid: m.uuid }
        );

        const rawToolCalls = toolCallsResult.records[0]?.get('tool_calls') || [];
        
        // Normalize timestamps in tool calls
        const toolCalls = rawToolCalls.map((tc: any) => ({
          uuid: tc.uuid,
          message_id: tc.message_id,
          tool_name: tc.tool_name,
          arguments: tc.arguments,
          timestamp: normalizeTimestamp(tc.timestamp),
          duration_ms: tc.duration_ms,
          success: tc.success,
          iteration: tc.iteration,
          result: tc.result ? {
            uuid: tc.result.uuid,
            success: tc.result.success,
            result: tc.result.result,
            error: tc.result.error,
            timestamp: normalizeTimestamp(tc.result.timestamp),
            result_size_bytes: tc.result.result_size_bytes
          } : undefined
        }));

        results.push({
          type: 'turn',
          turn: {
            uuid: m.uuid,
            conversation_id: m.conversation_id,
            role: m.role,
            content: m.content,
            reasoning: m.reasoning || undefined,
            timestamp: normalizeTimestamp(m.timestamp),
            token_count: m.token_count ? this.toNumber(m.token_count) : undefined,
            char_count: this.toNumber(m.char_count),
            embedding: m.embedding,
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined
          },
          score
        });
      }
    }

    // L1 and L2: Search in Summaries
    if (levels.includes(1) || levels.includes(2)) {
      const levelFilter = levels.length === 2 
        ? '' 
        : `AND s.level = ${levels.includes(1) ? 1 : 2}`;

      const summariesResult = await this.neo4j.run(
        `MATCH (c:Conversation {uuid: $conversationId})-[:HAS_SUMMARY]->(s:Summary)
         WHERE s.embedding IS NOT NULL ${levelFilter}
         RETURN s`,
        { conversationId }
      );

      for (const record of summariesResult.records) {
        const s = record.get('s').properties;
        if (!s.embedding || !Array.isArray(s.embedding)) continue;

        const score = cosineSimilarity(queryEmbedding, s.embedding);
        if (score < minScore) continue;

        results.push({
          type: 'summary',
          summary: {
            uuid: s.uuid,
            conversation_id: s.conversation_id,
            level: this.toNumber(s.level) || 1,
            content: {
              conversation_summary: s.conversation_summary || '',
              actions_summary: s.actions_summary || ''
            },
            start_turn_index: this.toNumber(s.start_turn_index) || 0,
            end_turn_index: this.toNumber(s.end_turn_index) || 0,
            char_range_start: this.toNumber(s.char_range_start),
            char_range_end: this.toNumber(s.char_range_end),
            summary_char_count: this.toNumber(s.summary_char_count),
            created_at: s.created_at,
            embedding: s.embedding,
            parent_summaries: s.parent_summaries || undefined
          },
          score
        });
      }
    }

    // Add confidence based on level
    for (const result of results) {
      if (result.type === 'turn') {
        (result as any).confidence = 1.0; // L0: highest confidence
      } else if (result.summary) {
        if (result.summary.level === 1) {
          (result as any).confidence = 0.7; // L1: good confidence
        } else if (result.summary.level === 2) {
          (result as any).confidence = 0.5; // L2: medium confidence
        }
      }
    }

    // Sort by score DESC and limit
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, maxResults);
  }

  /**
   * Search content semantically using adaptive node types based on directory content
   * - Code-heavy dirs (>=70% code): searches Scope nodes only
   * - Document-heavy dirs (>=70% docs): searches Scope + MarkdownSection + PDFDocument + etc.
   * - Mixed dirs: searches Scope + MarkdownSection + MarkdownDocument
   *
   * IMPORTANT: Only searches if cwd is a subdirectory of projectRoot and embedding lock is available
   * Uses brainManager.search() which handles EmbeddingChunk normalization
   */
  async searchCodeSemantic(
    query: string,
    options: {
      cwd: string;                    // Current working directory
      projectRoot: string;            // Racine du projet (pour filtrer sous-répertoire)
      initialLimit?: number;          // Default: 100 résultats initiaux
      maxChars?: number;              // Default: 10% du contexte max = 10k chars
      minScore?: number;              // Default: 0.3
      embeddingLockAvailable?: boolean; // Default: true (must be checked by caller)
      ingestionLockAvailable?: boolean; // Default: true (must be checked by caller)
      statsPaths?: string[];          // Paths to use for aggregated stats (when cwd contains multiple projects)
    }
  ): Promise<Array<{
    scopeId: string;
    name: string;
    file: string;
    startLine: number;               // CRITIQUE : Ligne de début pour édition directe
    endLine: number;                 // CRITIQUE : Ligne de fin pour édition directe
    content: string;
    score: number;
    charCount: number;
    confidence: number;               // Always 0.5 for code semantic search
    matchedRange?: {                 // For chunked content: where the match occurred
      startLine: number;
      endLine: number;
    };
  }>> {
    const {
      cwd,
      projectRoot,
      initialLimit = 100,
      maxChars = this.getCodeSearchMaxChars(),
      minScore = 0.3,
      embeddingLockAvailable = true,
      ingestionLockAvailable = true
    } = options;

    // Check conditions: must be subdirectory OR cwd must be a parent of projectRoot (cwd contains projectRoot) OR cwd IS projectRoot
    const relativePath = path.relative(projectRoot, cwd);
    const isSubdirectory = relativePath !== '' && relativePath !== '.' && !relativePath.startsWith('..');
    // Check if cwd IS the project root (same directory)
    const isAtProjectRoot = relativePath === '' || relativePath === '.';

    // Also check if cwd contains projectRoot (inverse relationship)
    const cwdToProjectPath = path.relative(cwd, projectRoot);
    const cwdContainsProject = cwdToProjectPath !== '' && cwdToProjectPath !== '.' && !cwdToProjectPath.startsWith('..');

    // CRITICAL: Both locks must be available for code semantic search
    // This ensures data consistency (no ingestion in progress) and embeddings are ready
    // Allow semantic search if: (cwd IS projectRoot) OR (cwd is subdirectory of projectRoot) OR (cwd contains projectRoot)
    if ((!isAtProjectRoot && !isSubdirectory && !cwdContainsProject) || !embeddingLockAvailable || !ingestionLockAvailable) {
      return []; // Return empty if conditions not met
    }

    // Use brainManager.search() for centralized search with EmbeddingChunk normalization
    if (!this.brainManager) {
      console.debug('[ConversationStorage] BrainManager not available for code search');
      return [];
    }

    // Build glob pattern for path filtering
    // If cwd contains projectRoot, search entire project (no glob filter)
    // Otherwise filter to the relative path subdirectory
    const normalizedRelativePath = cwdContainsProject ? '' : relativePath.replace(/\\/g, '/');
    const globPattern = normalizedRelativePath ? `${normalizedRelativePath}/**/*` : '**/*';

    // Get stats to determine which node types to search
    // Priority: 1) statsPaths if provided (for aggregated multi-project stats)
    //           2) projectRoot if cwd is a parent directory containing the project
    //           3) cwd (current working directory)
    let cwdStats;
    let statsSource: string;
    if (options.statsPaths && options.statsPaths.length > 0) {
      cwdStats = await this.cwdFileCache.getAggregatedStats(options.statsPaths);
      statsSource = `aggregated(${options.statsPaths.length} projects)`;
    } else {
      const statsPath = cwdContainsProject ? projectRoot : cwd;
      cwdStats = await this.cwdFileCache.getStats(statsPath);
      statsSource = statsPath;
    }
    console.log('[ConversationStorage] searchCodeSemantic: Directory stats', {
      statsSource,
      dominantType: cwdStats.dominantType,
      codeRatio: cwdStats.codeRatio.toFixed(2)
    });

    // Type boost factors: prioritize methods/functions over classes/interfaces
    const typeBoostFactors: Record<string, number> = {
      'method': 1.15,      // Methods are most actionable
      'function': 1.15,    // Functions are most actionable
      'arrow_function': 1.10,
      'class': 1.05,       // Classes provide context but less actionable
      'interface': 1.0,    // Interfaces are reference only
      'type': 1.0,
      'variable': 0.95,    // Variables are less important
      'property': 0.90,
    };

    try {
      console.log('[ConversationStorage] searchCodeSemantic: Calling brainManager.search...', {
        query: query.substring(0, 50),
        globPattern,
        limit: initialLimit,
        minScore
      });
      const searchStartTime = Date.now();
      // No nodeTypes filter - search all types and re-score by type
      const searchResult = await this.brainManager.search(query, {
        semantic: true,
        embeddingType: 'content',
        // No nodeTypes filter - we'll re-score by type instead
        glob: globPattern,
        limit: initialLimit * 2, // Fetch more to account for re-scoring
        minScore: minScore * 0.8, // Lower threshold, we'll filter after re-scoring
      });
      console.log('[ConversationStorage] searchCodeSemantic: brainManager.search completed', {
        resultCount: searchResult.results.length,
        durationMs: Date.now() - searchStartTime
      });

      const results: Array<{
        scopeId: string;
        name: string;
        file: string;
        startLine: number;
        endLine: number;
        content: string;
        score: number;
        charCount: number;
        confidence: number;
        nodeType?: string;
        matchedRange?: { startLine: number; endLine: number };
      }> = [];

      for (const result of searchResult.results) {
        const node = result.node;

        // Skip nodes without line info (required for code context)
        if (node.startLine == null || node.endLine == null) continue;

        const content = node.source || '';
        const charCount = content.length;
        const nodeType = node.type || 'unknown';

        // Apply type boost to score
        const typeBoost = typeBoostFactors[nodeType] ?? 1.0;
        const boostedScore = Math.min(1.0, result.score * typeBoost);

        // Skip if boosted score is below original threshold
        if (boostedScore < minScore) continue;

        results.push({
          scopeId: node.uuid,
          name: node.name || '',
          file: node.file || '',
          startLine: this.toNumber(node.startLine),
          endLine: this.toNumber(node.endLine),
          content,
          score: boostedScore,
          charCount,
          confidence: 0.5, // Code semantic search: medium confidence
          nodeType,
          // Include matchedRange if this result came from a chunk match
          matchedRange: result.matchedRange ? {
            startLine: result.matchedRange.startLine,
            endLine: result.matchedRange.endLine,
          } : undefined,
        });
      }

      // Sort by boosted score DESC
      results.sort((a, b) => b.score - a.score);

      // Limit to original requested limit
      const limitedByCount = results.slice(0, initialLimit);

      // Apply character limit: take results with highest scores until maxChars
      const limitedResults: typeof results = [];
      let cumulativeChars = 0;

      for (const result of limitedByCount) {
        if (cumulativeChars + result.charCount <= maxChars) {
          limitedResults.push(result);
          cumulativeChars += result.charCount;
        } else {
          // Check if we can fit a truncated version
          const remainingChars = maxChars - cumulativeChars;
          if (remainingChars > 100) { // Only if at least 100 chars remaining
            limitedResults.push({
              ...result,
              content: result.content.substring(0, remainingChars) + '...',
              charCount: remainingChars
            });
          }
          break;
        }
      }

      return limitedResults;
    } catch (error: any) {
      console.debug(`[ConversationStorage] Brain search failed for code: ${error.message}`);
      return [];
    }
  }

  // ==========================================================================
  // Summary Creation Helpers
  // ==========================================================================

  /**
   * Calculate total character count for a message including tool calls and their results
   * This represents the full "turn" content (user message + tool calls + assistant message)
   */
  private calculateMessageCharCountWithToolCalls(message: Message): number {
    let charCount = message.char_count; // Base: content + reasoning
    
    // Add tool calls char count if present (arguments + results)
    if (message.tool_calls && message.tool_calls.length > 0) {
      for (const toolCall of message.tool_calls) {
        // Add tool name
        charCount += (toolCall.tool_name?.length || 0);
        // Add arguments (JSON stringified)
        if (toolCall.arguments) {
          const argsStr = typeof toolCall.arguments === 'string' 
            ? toolCall.arguments 
            : JSON.stringify(toolCall.arguments);
          charCount += argsStr.length;
        }
        // Add result (JSON stringified)
        if (toolCall.result?.result) {
          const resultStr = typeof toolCall.result.result === 'string'
            ? toolCall.result.result
            : JSON.stringify(toolCall.result.result);
          charCount += resultStr.length;
        }
        // Add error if present
        if (toolCall.result?.error) {
          charCount += String(toolCall.result.error).length;
        }
      }
    }
    
    return charCount;
  }

  /**
   * Check if L1 summary should be created based on character threshold
   * Returns information about which messages to summarize
   */
  async shouldCreateL1Summary(conversationId: string): Promise<{
    shouldCreate: boolean;
    startTurnIndex: number;
    endTurnIndex: number;
    charRangeStart: number;
    charRangeEnd: number;
    messagesToSummarize: Message[];
    currentCharCount: number;
    threshold: number;
  }> {
    try {
      // Validate conversation exists
      const conversation = await this.getConversationMetadata(conversationId);
      if (!conversation) {
        return {
          shouldCreate: false,
          startTurnIndex: 0,
          endTurnIndex: 0,
          charRangeStart: 0,
          charRangeEnd: 0,
          messagesToSummarize: [],
          currentCharCount: 0,
          threshold: 0
        };
      }

      // Get threshold (10% of max context)
      const threshold = this.getL1Threshold();
      if (threshold <= 0) {
        return {
          shouldCreate: false,
          startTurnIndex: 0,
          endTurnIndex: 0,
          charRangeStart: 0,
          charRangeEnd: 0,
          messagesToSummarize: [],
          currentCharCount: 0,
          threshold
        };
      }

      // Get latest L1 summary to know where we left off
      const latestL1Summary = await this.getLatestSummaryByLevel(conversationId, 1);
      const lastSummarizedCharEnd = latestL1Summary?.char_range_end || 0;
      const lastSummarizedTurnEnd = latestL1Summary?.end_turn_index ?? -1;

      // Get all messages ordered by timestamp
      // A "turn" is a pair of user + assistant messages
      const allMessages = await this.getMessages(conversationId, {
        includeToolCalls: true,
        limit: 10000 // Large limit to get all messages
      });

      // Calculate cumulative char positions for each message
      // IMPORTANT: A "turn" includes user message + tool calls + assistant message
      // We need to calculate char_count including tool calls for each message
      let cumulativeChars = 0;
      let currentTurnIndex = -1; // Incremented when we see a user message
      const messagesToSummarize: Message[] = [];
      let charRangeStart = lastSummarizedCharEnd;
      let charRangeEnd = lastSummarizedCharEnd;
      let startTurnIndex = lastSummarizedTurnEnd + 1;
      let endTurnIndex = lastSummarizedTurnEnd;

      // Process each message and calculate char count including tool calls
      for (const message of allMessages) {
        const messageStart = cumulativeChars;

        // Track turn index (user message starts a new turn)
        if (message.role === 'user') {
          currentTurnIndex++;
        }

        // Calculate char count for this message including tool calls
        const messageCharCount = this.calculateMessageCharCountWithToolCalls(message);

        cumulativeChars += messageCharCount;
        const messageEnd = cumulativeChars;

        // If this message (with tool calls) overlaps with or is after the last summarized position
        if (messageEnd > lastSummarizedCharEnd) {
          if (messagesToSummarize.length === 0) {
            // Start range from the last summarized position (or start of this message if it's before)
            charRangeStart = Math.max(lastSummarizedCharEnd, messageStart);
            startTurnIndex = currentTurnIndex;
          }
          messagesToSummarize.push(message);
          charRangeEnd = messageEnd;
          endTurnIndex = currentTurnIndex;

          // Stop if we've reached the threshold
          if (charRangeEnd - charRangeStart >= threshold) {
            break;
          }
        }
      }

      // Calculate current char count of non-summarized messages (including tool calls)
      const currentCharCount = charRangeEnd - charRangeStart;

      // Check if threshold is reached
      const shouldCreate = currentCharCount >= threshold && messagesToSummarize.length > 0;

      return {
        shouldCreate,
        startTurnIndex,
        endTurnIndex,
        charRangeStart,
        charRangeEnd,
        messagesToSummarize,
        currentCharCount,
        threshold
      };
    } catch (error) {
      console.error('[ConversationStorage] Error in shouldCreateL1Summary:', error);
      return {
        shouldCreate: false,
        startTurnIndex: 0,
        endTurnIndex: 0,
        charRangeStart: 0,
        charRangeEnd: 0,
        messagesToSummarize: [],
        currentCharCount: 0,
        threshold: 0
      };
    }
  }

  /**
   * Check if L2 summary should be created based on character threshold of L1 summaries
   * Returns information about which L1 summaries to summarize
   */
  async shouldCreateL2Summary(conversationId: string): Promise<{
    shouldCreate: boolean;
    summariesToSummarize: Summary[];
    startTurnIndex: number;
    endTurnIndex: number;
    charRangeStart: number;
    charRangeEnd: number;
    currentCharCount: number;
    threshold: number;
  }> {
    try {
      // Validate conversation exists
      const conversation = await this.getConversationMetadata(conversationId);
      if (!conversation) {
        return {
          shouldCreate: false,
          summariesToSummarize: [],
          startTurnIndex: 0,
          endTurnIndex: 0,
          charRangeStart: 0,
          charRangeEnd: 0,
          currentCharCount: 0,
          threshold: 0
        };
      }

      // Get threshold (10% of max context)
      const threshold = this.getL2Threshold();
      if (threshold <= 0) {
        return {
          shouldCreate: false,
          summariesToSummarize: [],
          startTurnIndex: 0,
          endTurnIndex: 0,
          charRangeStart: 0,
          charRangeEnd: 0,
          currentCharCount: 0,
          threshold
        };
      }

      // Get latest L2 summary to know where we left off
      const latestL2Summary = await this.getLatestSummaryByLevel(conversationId, 2);
      const lastSummarizedCharEnd = latestL2Summary?.char_range_end || 0;

      // Get all L1 summaries not yet summarized (L1 summaries not linked to L2)
      const allL1Summaries = await this.getSummaries(conversationId, 1);
      
      // Filter L1 summaries that haven't been summarized to L2 yet
      // A summary is "summarized" if it's in the parent_summaries of an L2 summary
      const l2Summaries = await this.getSummaries(conversationId, 2);
      const summarizedL1Uuids = new Set<string>();
      for (const l2 of l2Summaries) {
        if (l2.parent_summaries) {
          for (const parentUuid of l2.parent_summaries) {
            summarizedL1Uuids.add(parentUuid);
          }
        }
      }

      // Get L1 summaries not yet summarized, sorted by char_range_start
      const l1SummariesNotSummarized = allL1Summaries
        .filter(s => !summarizedL1Uuids.has(s.uuid))
        .sort((a, b) => a.char_range_start - b.char_range_start);

      // Need at least 2 L1 summaries to create an L2 summary
      if (l1SummariesNotSummarized.length < 2) {
        return {
          shouldCreate: false,
          summariesToSummarize: [],
          startTurnIndex: 0,
          endTurnIndex: 0,
          charRangeStart: 0,
          charRangeEnd: 0,
          currentCharCount: 0,
          threshold
        };
      }

      // Calculate cumulative summary_char_count from L1 summaries
      let cumulativeChars = lastSummarizedCharEnd;
      const summariesToSummarize: Summary[] = [];
      let charRangeStart = lastSummarizedCharEnd;
      let charRangeEnd = lastSummarizedCharEnd;
      let startTurnIndex = 0;
      let endTurnIndex = 0;

      for (const summary of l1SummariesNotSummarized) {
        if (summariesToSummarize.length === 0) {
          charRangeStart = summary.char_range_start;
          startTurnIndex = summary.start_turn_index;
        }
        summariesToSummarize.push(summary);
        cumulativeChars += summary.summary_char_count;
        charRangeEnd = cumulativeChars;
        endTurnIndex = summary.end_turn_index;

        // Stop if we've reached the threshold
        if (cumulativeChars - lastSummarizedCharEnd >= threshold) {
          break;
        }
      }

      // Calculate current char count of non-summarized L1 summaries
      const currentCharCount = cumulativeChars - lastSummarizedCharEnd;

      // Check if threshold is reached and we have at least 2 summaries
      const shouldCreate = currentCharCount >= threshold && summariesToSummarize.length >= 2;

      return {
        shouldCreate,
        summariesToSummarize,
        startTurnIndex,
        endTurnIndex,
        charRangeStart,
        charRangeEnd,
        currentCharCount,
        threshold
      };
    } catch (error) {
      console.error('[ConversationStorage] Error in shouldCreateL2Summary:', error);
      return {
        shouldCreate: false,
        summariesToSummarize: [],
        startTurnIndex: 0,
        endTurnIndex: 0,
        charRangeStart: 0,
        charRangeEnd: 0,
        currentCharCount: 0,
        threshold: 0
      };
    }
  }

  /**
   * Get L1 summaries that haven't been summarized to L2 yet
   */
  async getLevel1SummariesNotSummarized(
    conversationId: string,
    limit?: number
  ): Promise<Summary[]> {
    // Get all L1 summaries
    const allL1Summaries = await this.getSummaries(conversationId, 1);
    
    // Get all L2 summaries to find which L1 summaries are already summarized
    const l2Summaries = await this.getSummaries(conversationId, 2);
    const summarizedL1Uuids = new Set<string>();
    for (const l2 of l2Summaries) {
      if (l2.parent_summaries) {
        for (const parentUuid of l2.parent_summaries) {
          summarizedL1Uuids.add(parentUuid);
        }
      }
    }

    // Filter L1 summaries not yet summarized, sorted by char_range_start
    const notSummarized = allL1Summaries
      .filter(s => !summarizedL1Uuids.has(s.uuid))
      .sort((a, b) => a.char_range_start - b.char_range_start);

    return limit ? notSummarized.slice(0, limit) : notSummarized;
  }

  /**
   * Get recent L1 summaries (even if already summarized to L2) up to maxChars
   * This is the PRIMARY method for displaying L1 summaries to the LLM (10% of context max)
   * Always shows recent L1 summaries regardless of consolidation status
   * 
   * Note: For L2 threshold calculation, use getLevel1SummariesNotSummarized() instead
   * which excludes already-consolidated summaries
   * 
   * Returns summaries sorted by most recent first (char_range_start DESC)
   */
  async getRecentL1Summaries(
    conversationId: string,
    maxChars: number
  ): Promise<Summary[]> {
    // Get all L1 summaries, sorted by most recent first (char_range_start DESC)
    const allL1Summaries = await this.getSummaries(conversationId, 1);
    const sortedByRecent = allL1Summaries
      .sort((a, b) => b.char_range_start - a.char_range_start); // Most recent first

    // Take summaries up to maxChars limit
    const results: Summary[] = [];
    let cumulativeChars = 0;

    for (const summary of sortedByRecent) {
      const summaryChars = summary.summary_char_count;
      if (cumulativeChars + summaryChars <= maxChars) {
        results.push(summary);
        cumulativeChars += summaryChars;
      } else {
        // Check if we can fit a truncated version
        const remainingChars = maxChars - cumulativeChars;
        if (remainingChars > 100) { // Only if at least 100 chars remaining
          // Note: We don't truncate summaries, we just stop
          break;
        }
      }
    }

    return results;
  }

  // ==========================================================================
  // Context Building
  // ==========================================================================

  /**
   * Get last user queries (user messages only) up to maxChars
   * Returns array with userMessage, timestamp, and turnIndex
   */
  async getLastUserQueries(
    conversationId: string,
    maxChars: number
  ): Promise<Array<{
    userMessage: string;
    timestamp: string;
    turnIndex: number;
  }>> {
    const allMessages = await this.getMessages(conversationId, {
      limit: 10000, // Large limit to get all messages
      includeToolCalls: false
    });

    // Filter user messages only, go backwards from most recent
    const userMessages = allMessages.filter(m => m.role === 'user').reverse();
    
    const results: Array<{
      userMessage: string;
      timestamp: string;
      turnIndex: number;
    }> = [];
    
    let cumulativeChars = 0;
    let turnIndex = userMessages.length; // Start from highest turn index

    for (const msg of userMessages) {
      const msgChars = msg.content.length;
      if (cumulativeChars + msgChars > maxChars) {
        break;
      }
      
      results.unshift({ // Add to beginning to maintain chronological order
        userMessage: msg.content,
        timestamp: normalizeTimestamp(msg.timestamp),
        turnIndex: turnIndex--
      });
      
      cumulativeChars += msgChars;
    }

    return results;
  }

  /**
   * Get recent turns (user + assistant pairs) up to maxChars (5% of context max)
   * This is the PRIMARY method for displaying L0 turns to the LLM
   * Always shows recent turns regardless of summarization status (even if already summarized to L1)
   * 
   * Note: For L1 threshold calculation, use shouldCreateL1Summary() instead
   * which uses a stack that resets to 0 when an L1 summary is created
   * 
   * Returns ConversationTurn[] format, sorted by most recent first
   */
  async getRecentTurns(
    conversationId: string,
    maxChars: number,
    limit?: number
  ): Promise<ConversationTurn[]> {
    // Get all messages (including those already summarized to L1)
    const allMessages = await this.getMessages(conversationId, {
      limit: limit || 1000,
      includeToolCalls: true
    });

    // Convert to turns format
    const turns = this.messagesToTurns(allMessages);

    // Filter by character count, taking from most recent (even if already summarized)
    const results: ConversationTurn[] = [];
    let cumulativeChars = 0;

    // Go backwards from most recent turns
    for (let i = turns.length - 1; i >= 0; i--) {
      const turn = turns[i];
      
      // Calculate precise char count for turn (user + assistant + tool results)
      // This matches the logic used in calculateMessageCharCountWithToolCalls()
      const turnChars = turn.userMessage.length + turn.assistantMessage.length +
        turn.toolResults.reduce((sum, tr) => {
          const argsStr = tr.toolArgs ? JSON.stringify(tr.toolArgs) : '';
          const resultStr = typeof tr.toolResult === 'string'
            ? tr.toolResult
            : JSON.stringify(tr.toolResult);
          return sum + argsStr.length + resultStr.length;
        }, 0);

      if (cumulativeChars + turnChars > maxChars) {
        break;
      }

      results.unshift(turn); // Add to beginning to maintain chronological order
      cumulativeChars += turnChars;
    }

    return results;
  }

  /**
   * Build enriched context for agent with all components
   * Launches semantic searches in parallel for optimal performance
   */
  /**
   * Get recent messages from conversation (fast, no semantic search)
   * Useful for quick context without expensive searches
   */
  async getRecentMessages(
    conversationId: string,
    limit: number = 10
  ): Promise<Array<{ role: string; content: string; timestamp: Date | string }>> {
    const messages = await this.getMessages(conversationId, {
      limit,
      includeToolCalls: false
    });

    // Take last N messages and reverse to chronological order
    return messages
      .slice(-limit)
      .map(m => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp
      }));
  }

  /**
   * Get recent context for agent (fast, no semantic search)
   * Returns both recent turns (with tool calls) and recent L1 summaries
   * This is the PRIMARY method for providing conversation context to agents
   */
  async getRecentContextForAgent(
    conversationId: string,
    options?: {
      turnsMaxChars?: number;     // Default: 5000 (5% context)
      l1MaxChars?: number;        // Default: 10000 (10% context)
      turnsLimit?: number;        // Max turns
      l1Limit?: number;           // Max L1 summaries
    }
  ): Promise<{
    recentTurns: ConversationTurn[];
    recentL1Summaries: Summary[];
  }> {
    const [recentTurns, recentL1Summaries] = await Promise.all([
      this.getRecentTurns(conversationId, options?.turnsMaxChars ?? 5000, options?.turnsLimit),
      this.getRecentL1Summaries(conversationId, options?.l1MaxChars ?? 10000)
    ]);

    return {
      recentTurns,
      recentL1Summaries: options?.l1Limit
        ? recentL1Summaries.slice(0, options.l1Limit)
        : recentL1Summaries
    };
  }

  async buildEnrichedContext(
    conversationId: string,
    userMessage: string,
    options?: {
      recentMaxChars?: number;
      recentLimit?: number;
      lastUserQueriesMaxChars?: number;  // Default: 5% du contexte max = 5k chars
      codeSearchMaxChars?: number;       // Default: 10% du contexte max = 10k chars
      codeSearchInitialLimit?: number;   // Default: 100 résultats
      semanticMaxResults?: number;
      semanticMinScore?: number;
      level1SummariesLimit?: number;
      cwd?: string;                      // Current working directory pour détecter sous-répertoire
      projectRoot?: string;              // Project root for code search filtering
      skipCodeSearch?: boolean;          // Skip code search (for simple questions)
      skipHistorySearch?: boolean;       // Skip deep history search (for simple questions)
      // Note: locks are now automatically fetched from brainManager and waited for (like brain_search)
    }
  ): Promise<{
    lastUserQueries: Array<{
      userMessage: string;
      timestamp: Date | string;
      turnIndex: number;
    }>;
    recentTurns: ConversationTurn[];
    codeSemanticResults?: Array<{
      scopeId: string;
      name: string;
      file: string;
      startLine: number;
      endLine: number;
      content: string;
      score: number;
      charCount: number;
      confidence: number;
      fileLineCount?: number; // Total lines in file (for agent read strategy)
    }>;
    semanticResults: Array<{
      type: 'turn' | 'summary';
      turn?: Message;
      summary?: Summary;
      score: number;
      confidence?: number;
    }>;
    level1SummariesNotSummarized: Summary[];
  }> {
    // 1. Get last user queries (5% of context max)
    const lastUserQueriesMaxChars = options?.lastUserQueriesMaxChars ?? this.getLastUserQueriesMaxChars();
    const lastUserQueries = await this.getLastUserQueries(conversationId, lastUserQueriesMaxChars);

    // 2. Get recent turns (raw content) - 5% of context max, always shown even if already summarized
    const recentMaxChars = options?.recentMaxChars ?? this.getLastUserQueriesMaxChars(); // 5% of context max (same as last user queries)
    const recentTurns = await this.getRecentTurns(conversationId, recentMaxChars, options?.recentLimit);

    // 3. Launch semantic searches in parallel (skip if flags are set)
    const [semanticResults, codeSemanticResults] = await Promise.all([
      // Conversation semantic search (L0, L1, L2) - skip if skipHistorySearch is true
      options?.skipHistorySearch
        ? Promise.resolve([])
        : this.searchConversationHistory(conversationId, userMessage, {
            semantic: true,
            includeTurns: true,
            levels: [0, 1, 2],
            maxResults: options?.semanticMaxResults ?? 20,
            minScore: options?.semanticMinScore ?? 0.3
          }),
      // Code search: semantic (if project known) + fuzzy search (always available) - skip if skipCodeSearch is true
      options?.skipCodeSearch
        ? Promise.resolve([])
        : (async () => {
        // Resolve projectRoot and cwd (ensure they're strings)
        const projectRoot = options?.projectRoot || options?.cwd;
        const cwd = options?.cwd || projectRoot;
        
        console.log('[ConversationStorage] buildEnrichedContext: Starting code search', {
          projectRoot,
          cwd,
          hasProjectRoot: !!options?.projectRoot,
          hasCwd: !!options?.cwd
        });
        
        if (!projectRoot || !cwd) {
          // No project root or cwd: skip code search
          console.log('[ConversationStorage] buildEnrichedContext: Skipping code search (no projectRoot or cwd)');
          return [];
        }

        // 1. Check if project is known (registered in brain)
        const isProjectKnown = await this.isProjectKnown(projectRoot);

        // 2. Get locks from brainManager (like brain_search does)
        let embeddingLock: { isLocked: () => boolean; waitForUnlock: (timeout: number) => Promise<boolean>; getDescription?: () => string } | undefined;
        let ingestionLock: { isLocked: () => boolean; waitForUnlock: (timeout: number) => Promise<boolean>; getDescription?: () => string } | undefined;

        if (this.brainManager) {
          try {
            embeddingLock = this.brainManager.getEmbeddingLock();
            ingestionLock = this.brainManager.getIngestionLock();
          } catch (err) {
            console.debug('[ConversationStorage] buildEnrichedContext: Could not get locks from brainManager:', err);
          }
        }

        // brainManager available means we can wait for locks (no need to check if available)
        const hasBrainManager = !!this.brainManager;

        // Check if cwd is a subdirectory of projectRoot
        const relativePath = path.relative(projectRoot, cwd);
        const isSubdirectory = relativePath !== '' && relativePath !== '.' && !relativePath.startsWith('..');
        // Check if cwd IS the project root (user is at project root)
        const isAtProjectRoot = relativePath === '' || relativePath === '.';

        // Check if cwd contains registered projects (alternative condition for semantic search)
        const projectsInCwd = await this.getProjectsInCwd(cwd);
        const hasProjectsInCwd = projectsInCwd.length > 0;

        console.log('[ConversationStorage] buildEnrichedContext: Code search conditions', {
          isProjectKnown,
          hasBrainManager,
          isSubdirectory,
          isAtProjectRoot,
          relativePath,
          hasProjectsInCwd,
          projectsInCwdCount: projectsInCwd.length
        });

        // Build available projects list for the agent
        // Include: current project (if known) + all projects in cwd
        const availableProjects: Array<{ id: string; path: string; type: string }> = [];

        if (isProjectKnown && this.brainManager) {
          const project = this.brainManager.findProjectByPath(projectRoot);
          if (project) {
            availableProjects.push({ id: project.id, path: project.path, type: project.type });
          }
        }

        // Add projects in cwd (if different from current project)
        if (hasProjectsInCwd && this.brainManager) {
          for (const projectPath of projectsInCwd) {
            const project = this.brainManager.findProjectByPath(projectPath);
            if (project && !availableProjects.find(p => p.id === project.id)) {
              availableProjects.push({ id: project.id, path: project.path, type: project.type });
            }
          }
        }

        console.log('[ConversationStorage] buildEnrichedContext: Running search agent', {
          availableProjects: availableProjects.length,
          hasBrainManager
        });

        // Run the search agent (it has access to brain_search and grep_files)
        // The agent decides what to search based on the query
        const agentResults = await this.searchCodeFuzzyWithLLM(userMessage, {
          cwd,
          projectRoot,
          maxChars: options?.codeSearchMaxChars ?? this.getCodeSearchMaxChars(),
          recentTurns: recentTurns.slice(0, 3), // Pass last 3 turns for context
          availableProjects: availableProjects.length > 0 ? availableProjects : undefined
        });

        console.log('[ConversationStorage] buildEnrichedContext: Search agent returned', {
          resultCount: agentResults.length
        });

        return agentResults;
      })()
    ]);

    // 4. Get recent L1 summaries for display (10% of context max)
    // Always show recent L1 summaries to LLM, even if they're already consolidated to L2
    // This provides recent context regardless of consolidation status
    const recentL1MaxChars = this.getL1Threshold(); // 10% of context max (fixed, not configurable via recentMaxChars)
    const level1SummariesForDisplay = await this.getRecentL1Summaries(conversationId, recentL1MaxChars);
    
    // Limit to reasonable number if specified
    const level1SummariesNotSummarized = options?.level1SummariesLimit
      ? level1SummariesForDisplay.slice(0, options.level1SummariesLimit)
      : level1SummariesForDisplay;

    // 5. Return enriched context
    return {
      lastUserQueries,
      recentTurns,
      codeSemanticResults: codeSemanticResults.length > 0 ? codeSemanticResults : undefined,
      semanticResults,
      level1SummariesNotSummarized
    };
  }

  /**
   * Format enriched context for agent consumption
   * Organizes results by confidence (highest first) for optimal prioritization
   * 
   * @param enrichedContext - The enriched context to format
   * @param options - Optional: cwd and projectRoot for normalizing file paths
   */
  formatContextForAgent(
    enrichedContext: {
    lastUserQueries: Array<{
      userMessage: string;
      timestamp: Date | string;
      turnIndex: number;
    }>;
    recentTurns: ConversationTurn[];
    codeSemanticResults?: Array<{
      scopeId: string;
      name: string;
      file: string;
      startLine: number;
      endLine: number;
      content: string;
      score: number;
      charCount: number;
      confidence: number;
      fileLineCount?: number; // Total lines in file (for agent read strategy)
    }>;
    semanticResults: Array<{
      type: 'turn' | 'summary';
      turn?: Message;
      summary?: Summary;
      score: number;
      confidence?: number;
    }>;
    level1SummariesNotSummarized: Summary[];
  },
    options?: {
      cwd?: string;
      projectRoot?: string;
    }
  ): string {
    const sections: string[] = [];

    // 1. Last User Queries (Recent Intentions) - Highest priority context
    if (enrichedContext.lastUserQueries.length > 0) {
      sections.push('## Last User Queries (Recent Intentions)');
      enrichedContext.lastUserQueries.forEach((q, i) => {
        sections.push(`[Query ${i + 1} - Turn ${q.turnIndex}]`);
        sections.push(q.userMessage);
        sections.push(''); // Empty line for readability
      });
    }

    // 2. Recent Conversation (Raw) - High confidence (L0 equivalent)
    if (enrichedContext.recentTurns.length > 0) {
      sections.push('## Recent Conversation (Raw)');
      enrichedContext.recentTurns.forEach((turn, i) => {
        sections.push(`[Turn ${i + 1}]`);
        sections.push(`User: ${turn.userMessage}`);
        sections.push(`Assistant: ${turn.assistantMessage}`);
        if (turn.toolResults.length > 0) {
          sections.push(`Tools: ${turn.toolResults.map(t => t.toolName).join(', ')}`);
        }
        sections.push(''); // Empty line
      });
    }

    // 3. Relevant Past Context - Organized by confidence (highest first)
    // Sort semantic results by confidence DESC, then by score DESC
    const sortedSemanticResults = [...enrichedContext.semanticResults].sort((a, b) => {
      const confA = a.confidence ?? 0.5;
      const confB = b.confidence ?? 0.5;
      if (confB !== confA) {
        return confB - confA; // Higher confidence first
      }
      return b.score - a.score; // Then by score
    });

    // L0 Turns (confidence = 1.0)
    const l0Turns = sortedSemanticResults.filter(r => r.type === 'turn' && r.turn && (r.confidence ?? 0.5) >= 0.9);
    if (l0Turns.length > 0) {
      sections.push('## Relevant Past Context (Semantic Search - L0 Turns, Confidence: 1.0)');
      l0Turns.forEach(result => {
        if (result.turn) {
          const msg = result.turn;
          sections.push(`[${msg.role === 'user' ? 'User' : 'Assistant'} Message - Relevance: ${(result.score * 100).toFixed(0)}%, Confidence: ${((result.confidence ?? 0.5) * 100).toFixed(0)}%]`);
          sections.push(msg.content);
          if (msg.reasoning) {
            sections.push(`Reasoning: ${msg.reasoning}`);
          }
          if (msg.tool_calls && msg.tool_calls.length > 0) {
            const toolNames = msg.tool_calls.map(tc => tc.tool_name).join(', ');
            sections.push(`Tools used: ${toolNames}`);
          }
          sections.push('');
        }
      });
    }

    // L1 Summaries (confidence = 0.7)
    const l1Summaries = sortedSemanticResults.filter(r => 
      r.type === 'summary' && r.summary && r.summary.level === 1 && (r.confidence ?? 0.5) >= 0.6 && (r.confidence ?? 0.5) < 0.9
    );
    if (l1Summaries.length > 0) {
      sections.push('## Relevant Past Context (Semantic Search - L1 Summaries, Confidence: 0.7)');
      l1Summaries.forEach(result => {
        if (result.summary) {
          sections.push(`[Level 1 Summary - Relevance: ${(result.score * 100).toFixed(0)}%, Confidence: ${((result.confidence ?? 0.5) * 100).toFixed(0)}%]`);
          sections.push(result.summary.content.conversation_summary);
          sections.push(result.summary.content.actions_summary);
          
          // Files mentioned (if available as FileMention[])
          const filesMentioned = (result.summary as any).filesMentioned;
          if (filesMentioned && Array.isArray(filesMentioned)) {
            const filePaths = filesMentioned.map((fm: any) => fm.path || fm).join(', ');
            sections.push(`Files mentioned: ${filePaths || 'N/A'}`);
          }
          
          sections.push('');
        }
      });
    }

    // L2 Summaries (confidence = 0.5)
    const l2Summaries = sortedSemanticResults.filter(r => 
      r.type === 'summary' && r.summary && r.summary.level === 2 && (r.confidence ?? 0.5) < 0.6
    );
    if (l2Summaries.length > 0) {
      sections.push('## Relevant Past Context (Semantic Search - L2 Summaries, Confidence: 0.5)');
      l2Summaries.forEach(result => {
        if (result.summary) {
          sections.push(`[Level 2 Summary - Relevance: ${(result.score * 100).toFixed(0)}%, Confidence: ${((result.confidence ?? 0.5) * 100).toFixed(0)}%]`);
          sections.push(result.summary.content.conversation_summary);
          sections.push(result.summary.content.actions_summary);
          
          // Files mentioned (if available as FileMention[])
          const filesMentioned = (result.summary as any).filesMentioned;
          if (filesMentioned && Array.isArray(filesMentioned)) {
            const filePaths = filesMentioned.map((fm: any) => fm.path || fm).join(', ');
            sections.push(`Files mentioned: ${filePaths || 'N/A'}`);
          }
          
          sections.push('');
        }
      });
    }

    // 4. Code Semantic Search (confidence = 0.5)
    if (enrichedContext.codeSemanticResults && enrichedContext.codeSemanticResults.length > 0) {
      sections.push('## Relevant Code Context (Semantic Search, Confidence: 0.5)');
      
      // Determine project root for path normalization
      const projectRoot = options?.projectRoot;
      const cwd = options?.cwd;
      
      enrichedContext.codeSemanticResults.forEach((code, i) => {
        // Normalize file path: make it relative to cwd if possible
        let displayPath = code.file;
        let pathPrefix = '';
        
        if (projectRoot && cwd) {
          try {
            // code.file is relative to projectRoot, convert to relative to cwd
            const absoluteFilePath = path.resolve(projectRoot, code.file);
            const relativeToCwd = path.relative(cwd, absoluteFilePath);
            
            // If the file is within cwd, use relative path
            if (!relativeToCwd.startsWith('..')) {
              displayPath = relativeToCwd || code.file;
            } else {
              // File is outside cwd, show project reference
              const projectName = path.basename(projectRoot);
              displayPath = code.file;
              pathPrefix = `[Project: ${projectName}] `;
            }
          } catch (error) {
            // If path resolution fails, use original path
            displayPath = code.file;
          }
        }
        
        // Include full scope content with clear line range for editing
        // Show file size to help agent decide read strategy (full file vs line range)
        // Include scopeId (UUID) so agent can use explore_scope() to navigate relationships
        const fileSizeInfo = code.fileLineCount ? `, File: ${code.fileLineCount} lines` : '';
        const scopeRef = code.scopeId ? ` [scope:${code.scopeId}]` : '';
        sections.push(`${pathPrefix}[${displayPath}:${code.startLine}-${code.endLine}] ${code.name}${scopeRef} (Relevance: ${(code.score * 100).toFixed(0)}%${fileSizeInfo})`);
        // Full scope content (no truncation - agent needs complete context for accurate edits)
        sections.push(code.content);
        sections.push('');
      });
    }

    // 5. Recent Level 1 Summaries (Not Yet Summarized to Level 2)
    if (enrichedContext.level1SummariesNotSummarized.length > 0) {
      sections.push('## Recent Level 1 Summaries (Not Yet Summarized to Level 2)');
      enrichedContext.level1SummariesNotSummarized.forEach(summary => {
        sections.push('[Level 1 Summary]');
        sections.push(summary.content.conversation_summary);
        sections.push(summary.content.actions_summary);
        
        // Files mentioned (if available as FileMention[])
        const filesMentioned = (summary as any).filesMentioned;
        if (filesMentioned && Array.isArray(filesMentioned)) {
          const filePaths = filesMentioned.map((fm: any) => fm.path || fm).join(', ');
          sections.push(`Files mentioned: ${filePaths || 'N/A'}`);
        }
        
        sections.push('');
      });
    }

    return sections.join('\n');
  }

  async getRecentContext(
    conversationId: string,
    limit: number
  ): Promise<{ messages: Message[]; message_count: number }> {
    const messages = await this.getMessages(conversationId, {
      limit,
      includeToolCalls: true
    });

    // Take last N messages
    const recentMessages = messages.slice(-limit);

    return {
      messages: recentMessages,
      message_count: recentMessages.length
    };
  }

  async getRAGContext(
    conversationId: string,
    queryEmbedding: number[],
    options: {
      maxSummaries: number;
      minScore: number;
      levelBoost: Record<number, number>;
      recencyBoost: boolean;
      recencyDecayDays: number;
    }
  ): Promise<Array<Summary & { score: number }>> {
    try {
      const result = await this.neo4j.run(
        `MATCH (c:Conversation {uuid: $conversationId})-[:HAS_SUMMARY]->(s:Summary)
         WHERE s.embedding IS NOT NULL
         WITH s, vector.similarity.cosine(s.embedding, $queryEmbedding) AS similarity
         WHERE similarity > $minScore
         RETURN s, similarity
         ORDER BY similarity DESC`,
        {
          conversationId,
          queryEmbedding,
          minScore: options.minScore
        }
      );

      const summaries = result.records.map(r => {
        const props = r.get('s').properties;
        const similarity = r.get('similarity');

        const summary: Summary = {
          uuid: props.uuid,
          conversation_id: props.conversation_id,
          level: this.toNumber(props.level) || 1,
          content: {
            conversation_summary: props.conversation_summary || '',
            actions_summary: props.actions_summary || ''
          },
          start_turn_index: this.toNumber(props.start_turn_index) || 0,
          end_turn_index: this.toNumber(props.end_turn_index) || 0,
          char_range_start: props.char_range_start?.toNumber() || 0,
          char_range_end: props.char_range_end?.toNumber() || 0,
          summary_char_count: props.summary_char_count?.toNumber() || 0,
          created_at: props.created_at,
          embedding: props.embedding || undefined,
          parent_summaries: props.parent_summaries || undefined
        };

        // Calculate final score with boosts
        let score = similarity;

        // Level boost (higher levels = more abstract = more useful)
        const levelBoost = options.levelBoost[summary.level] || 1.0;
        score *= levelBoost;

        // Recency boost (more recent = more relevant)
        if (options.recencyBoost) {
          const createdAt = new Date(summary.created_at);
          const ageInDays = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
          const recencyBoost = Math.exp(-ageInDays / options.recencyDecayDays);
          score *= (0.5 + 0.5 * recencyBoost);  // Between 0.5x and 1.0x
        }

        return { ...summary, score };
      });

      // Sort by final score and take top N
      summaries.sort((a, b) => b.score - a.score);
      return summaries.slice(0, options.maxSummaries);
    } catch (error) {
      console.warn('RAG context search failed (requires Neo4j 5.15+):', error);
      return [];
    }
  }

  // ==========================================================================
  // Vector Search (for RAG on history)
  // ==========================================================================

  async findSimilarConversations(
    embedding: number[],
    options: { limit: number; minScore: number }
  ): Promise<Array<ConversationMetadata & { similarity: number }>> {
    try {
      const result = await this.neo4j.run(
        `MATCH (c:Conversation)-[:HAS_SUMMARY]->(s:Summary)
         WHERE s.embedding IS NOT NULL
         WITH c, s, vector.similarity.cosine(s.embedding, $embedding) AS score
         WHERE score > $minScore
         RETURN DISTINCT c, max(score) as max_score
         ORDER BY max_score DESC
         LIMIT $limit`,
        {
          embedding,
          minScore: options.minScore,
          limit: neo4j.int(options.limit)
        }
      );

      return result.records.map(r => {
        const props = r.get('c').properties;
        return {
          uuid: props.uuid,
          title: props.title,
          tags: props.tags || [],
          created_at: props.created_at,
          updated_at: props.updated_at,
          message_count: props.message_count?.toNumber() || 0,
          total_chars: props.total_chars?.toNumber() || 0,
          status: props.status,
          similarity: r.get('max_score')
        };
      });
    } catch (error) {
      console.warn('Vector search failed (requires Neo4j 5.15+):', error);
      return [];
    }
  }

  async findSimilarMessages(
    conversationId: string,
    embedding: number[],
    options: { limit: number; minScore: number }
  ): Promise<Array<Message & { similarity: number }>> {
    try {
      const result = await this.neo4j.run(
        `MATCH (c:Conversation {uuid: $conversationId})-[:HAS_MESSAGE]->(m:Message)
         WHERE m.embedding IS NOT NULL
         WITH m, vector.similarity.cosine(m.embedding, $embedding) AS score
         WHERE score > $minScore
         RETURN m, score
         ORDER BY score DESC
         LIMIT $limit`,
        {
          conversationId,
          embedding,
          minScore: options.minScore,
          limit: options.limit
        }
      );

      return result.records.map(r => {
        const props = r.get('m').properties;
        return {
          uuid: props.uuid,
          conversation_id: props.conversation_id,
          role: props.role,
          content: props.content,
          reasoning: props.reasoning || undefined,
          timestamp: normalizeTimestamp(props.timestamp),
          char_count: this.toNumber(props.char_count),
          embedding: props.embedding || undefined,
          similarity: r.get('score')
        };
      });
    } catch (error) {
      console.warn('Vector search failed (requires Neo4j 5.15+):', error);
      return [];
    }
  }

  /**
   * Check if a project is known (registered in brain)
   */
  private async isProjectKnown(projectRoot: string): Promise<boolean> {
    if (!this.brainManager) {
      return false;
    }

    try {
      const absolutePath = path.resolve(projectRoot);
      const projects = this.brainManager.listProjects();
      
      // Check if projectRoot matches any registered project path
      for (const project of projects) {
        if (project.path === absolutePath || absolutePath.startsWith(project.path + path.sep)) {
          return true;
        }
      }
      
      return false;
    } catch (error) {
      console.debug('[ConversationStorage] Error checking if project is known:', error);
      return false;
    }
  }

  /**
   * Check if the current working directory contains one or more registered projects
   * Returns the list of project paths that are subdirectories of cwd
   */
  private async getProjectsInCwd(cwd: string): Promise<string[]> {
    if (!this.brainManager) {
      return [];
    }

    try {
      const absoluteCwd = path.resolve(cwd);
      const projects = this.brainManager.listProjects();
      const matchingProjects: string[] = [];
      
      // Check if any registered project is a subdirectory of cwd
      for (const project of projects) {
        const projectPath = path.resolve(project.path);
        const relativePath = path.relative(absoluteCwd, projectPath);
        
        // If project is a subdirectory of cwd (not outside, not same level)
        if (relativePath !== '' && relativePath !== '.' && !relativePath.startsWith('..')) {
          matchingProjects.push(projectPath);
        }
      }
      
      return matchingProjects;
    } catch (error) {
      console.debug('[ConversationStorage] Error checking projects in cwd:', error);
      return [];
    }
  }

  /**
   * LLM-guided fuzzy search on files (fallback when project not known or locks unavailable)
   * Uses StructuredLLMExecutor to perform fuzzy search with adaptive file patterns.
   * - Code-heavy dirs (>=70% code): focuses on code file extensions
   * - Document-heavy dirs (>=70% docs): includes document file extensions
   * - Mixed dirs: searches both code and document files
   */
  private async searchCodeFuzzyWithLLM(
    userMessage: string,
    options: {
      cwd: string;
      projectRoot: string;
      maxChars: number;
      recentTurns?: ConversationTurn[]; // Recent conversation turns for context
      availableProjects?: Array<{ id: string; path: string; type: string }>; // Projects the agent can search
    }
  ): Promise<Array<{
    scopeId: string;
    name: string;
    file: string;
    startLine: number;
    endLine: number;
    content: string;
    score: number;
    charCount: number;
    confidence: number;
  }>> {
    // If LLM executor/provider not available, skip fuzzy search
    if (!this.llmExecutor || !this.llmProvider) {
      console.log('[ConversationStorage] searchCodeFuzzyWithLLM: LLM executor/provider not available');
      return [];
    }
    
    console.log('[ConversationStorage] searchCodeFuzzyWithLLM: Starting fuzzy search', {
      userMessage: userMessage.substring(0, 100),
      cwd: options.cwd,
      projectRoot: options.projectRoot,
      maxChars: options.maxChars
    });

    try {
      // 0. Get cwd stats to determine dominant file type (code vs documents)
      const cwdStats = await this.cwdFileCache.getStats(options.cwd);
      const recommendedPattern = this.cwdFileCache.getRecommendedGlobPattern(cwdStats);
      console.log('[ConversationStorage] searchCodeFuzzyWithLLM: CwdStats', {
        dominantType: cwdStats.dominantType,
        codeRatio: cwdStats.codeRatio.toFixed(2),
        documentRatio: cwdStats.documentRatio.toFixed(2),
        recommendedPattern
      });

      // 0.5. Build conversation context from recent turns (if available)
      let conversationContext = '';
      if (options.recentTurns && options.recentTurns.length > 0) {
        const turnsForContext = options.recentTurns.slice(0, 3); // Max 3 turns
        conversationContext = turnsForContext.map((turn, i) => {
          let turnStr = `[Turn ${i + 1}]\nUser: ${turn.userMessage.substring(0, 300)}`;

          // Include tool results summary (truncated)
          if (turn.toolResults && turn.toolResults.length > 0) {
            const toolsSummary = turn.toolResults
              .slice(0, 3) // Max 3 tool results per turn
              .map(tr => {
                const resultPreview = typeof tr.toolResult === 'string'
                  ? tr.toolResult.substring(0, 150)
                  : JSON.stringify(tr.toolResult).substring(0, 150);
                return `  - ${tr.toolName}: ${resultPreview}...`;
              })
              .join('\n');
            turnStr += `\nTools used:\n${toolsSummary}`;
          }

          // Include assistant response (truncated)
          if (turn.assistantMessage) {
            turnStr += `\nAssistant: ${turn.assistantMessage.substring(0, 200)}...`;
          }

          return turnStr;
        }).join('\n\n');

        console.log('[ConversationStorage] searchCodeFuzzyWithLLM: Including conversation context', {
          turnsCount: turnsForContext.length,
          contextLength: conversationContext.length
        });
      }

      // 1. Create FsToolsContext for file system tools
      const fsToolsContext: FsToolsContext = {
        projectRoot: options.projectRoot,
      };

      // 2. Generate file system search tools (grep_files for text search, list/glob for exploration)
      const fsTools = generateFsTools(fsToolsContext);

      // Filter to only include search tools (no modification tools, no fuzzy search_files)
      const fsSearchToolNames = ['grep_files', 'list_directory', 'glob_files'];
      const searchGeneratedTools = fsTools.tools.filter(tool => fsSearchToolNames.includes(tool.name));

      // 3. Add brain_search tool for semantic search (if brainManager available)
      const brainSearchTool = this.brainManager ? generateBrainSearchTool() : null;
      const brainSearchHandler = this.brainManager ? generateBrainSearchHandler({ brain: this.brainManager }) : null;

      // Convert GeneratedToolDefinition[] to ToolDefinition[] format
      const searchTools: Array<{
        type: 'function';
        function: {
          name: string;
          description: string;
          parameters: Record<string, any>;
        };
      }> = searchGeneratedTools.map(tool => ({
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      }));

      // Add brain_search if available
      if (brainSearchTool) {
        searchTools.push({
          type: 'function' as const,
          function: {
            name: brainSearchTool.name,
            description: brainSearchTool.description,
            parameters: brainSearchTool.inputSchema,
          },
        });
      }

      const searchHandlers: Record<string, (args: Record<string, any>) => Promise<any>> = {};
      for (const toolName of fsSearchToolNames) {
        if (fsTools.handlers[toolName]) {
          searchHandlers[toolName] = fsTools.handlers[toolName];
        }
      }
      // Add brain_search handler (wrap to match Record<string, any> signature)
      // Normalize args: force use_reranking=false (too expensive) and restrict to available projects
      if (brainSearchHandler) {
        const availableProjectIds = options.availableProjects?.map(p => p.id) || [];
        console.log('[ConversationStorage] searchCodeFuzzyWithLLM: brain_search handler setup', {
          availableProjectIds,
          availableProjects: options.availableProjects,
        });
        searchHandlers['brain_search'] = (args: Record<string, any>) => {
          const normalizedArgs = {
            ...args,
            use_reranking: false,
            // Force projects to available ones (ignore agent's choice if any)
            ...(availableProjectIds.length > 0 && { projects: availableProjectIds }),
          };
          console.log('[ConversationStorage] searchCodeFuzzyWithLLM: brain_search normalized call', {
            originalArgs: args,
            normalizedArgs,
            forcedProjects: availableProjectIds.length > 0 ? availableProjectIds : 'none (search all)',
          });
          return brainSearchHandler(normalizedArgs as any);
        };
      }

      // 3. Create tool executor and collect tool results
      const toolResults: Array<{
        tool_name: string;
        success: boolean;
        result: any;
        error?: string;
      }> = [];

      const toolExecutor = new GeneratedToolExecutor(
        searchHandlers,
        false, // verbose
        undefined, // logger
        [], // executionOrder (no special ordering needed for search tools) - ALL tools run in parallel via Promise.all()
        {
          onToolResult: (toolName: string, result: any, success: boolean, durationMs: number) => {
            console.log(`[ConversationStorage] searchCodeFuzzyWithLLM: Tool ${toolName} completed in ${durationMs}ms`, {
              success,
              resultCount: result?.matches?.length ?? (result?.files?.length ?? 'N/A')
            });
            toolResults.push({
              tool_name: toolName,
              success,
              result,
            });
          }
        }
      );

      // 4. Call LLM with tools - LLM will make multiple tool calls in a single response
      const requestId = `fuzzy-search-decision-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      await this.llmExecutor.executeSingle<{
        done: boolean;
      }>({
        llmProvider: this.llmProvider!,
        requestId,
        maxIterations: 1, // Single LLM call only
        maxToolCallRounds: 1, // Only one round - LLM makes all tool calls in one response
        tools: searchTools,
        toolExecutor,
        input: {
          userQuery: userMessage,
          maxChars: options.maxChars,
          projectRoot: options.projectRoot,
          cwd: options.cwd
        },
        inputFields: [
          {
            name: 'userQuery',
            maxLength: 1000
          }
        ],
        outputSchema: {
          done: {
            type: 'boolean',
            description: 'Set to true when done (this field is not used, tools are executed directly)',
            required: false
          }
        },
        systemPrompt: `You are a code search assistant. Your task is to search for relevant code and content that matches the user's query.

**Available Tools:**
${this.brainManager ? `- brain_search: **SEMANTIC SEARCH** - finds conceptually related content using embeddings. Use semantic=true for best results.
  **IMPORTANT**: Use boost_keywords to boost specific function/class names you suspect are relevant!
  Example: brain_search({ query: "how authentication works", semantic: true, limit: 20, boost_keywords: ["auth", "login", "authenticate"] })
  The boost_keywords use fuzzy matching (Levenshtein) - results containing these keywords get higher scores.
  ${options.availableProjects && options.availableProjects.length > 0 ? `Can search specific projects: brain_search({ query: "...", projects: ["project-id"], semantic: true })` : ''}` : ''}
- grep_files: Search for **EXACT text patterns** in files (regex supported, powered by ripgrep)
  Example: grep_files({ pattern: "${recommendedPattern}", regex: "handleAuth|authenticate" })
- list_directory: List files and directories
- glob_files: Find files matching a glob pattern
${options.availableProjects && options.availableProjects.length > 0 ? `
**Available Projects for brain_search:**
${options.availableProjects.map(p => `- ${p.id} (${p.type}): ${p.path}`).join('\n')}
` : ''}${conversationContext ? `
**Recent Conversation Context:**
Use this context to understand what the user is working on and search for related terms.
${conversationContext}
` : ''}
**Directory Analysis:**
This directory is ${cwdStats.dominantType === 'code' ? 'primarily code files' : cwdStats.dominantType === 'documents' ? 'primarily document files' : 'a mix of code and document files'}.
- Code files: ${cwdStats.codeCount} (${(cwdStats.codeRatio * 100).toFixed(0)}%)
- Document files: ${cwdStats.documentCount} (${(cwdStats.documentRatio * 100).toFixed(0)}%)
- Top file extensions: ${Object.entries(cwdStats.extensions).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([ext, count]) => `${ext}(${count})`).join(', ')}
- Recommended glob pattern: "${recommendedPattern}"

**Instructions:**
1. **Use brain_search with semantic=true** for conceptual queries (e.g., "how does authentication work", "error handling logic")
   - **Always include boost_keywords** with 2-4 terms you extract OR guess from the query
   - Extract: key nouns, verbs, technical terms from the user's message
   - Guess: likely function/class names based on the domain (e.g., "auth" → ["authenticate", "login", "session", "token"])
2. **Use grep_files** for exact patterns (function names, class names, specific strings)
3. Extract meaningful terms from the user query and search for related concepts
4. Make 2-4 tool calls in parallel to maximize coverage
5. **USE THE RECOMMENDED GLOB PATTERN** for grep_files - it's based on actual files in this directory!

**Important:**
- Make ALL your tool calls in a single response (don't wait for results)
- brain_search returns absolute file paths in the 'filePath' field
- grep_files returns relative paths from projectRoot
- This is for initial context gathering - maximize results coverage!`,
        userTask: `Search files for: "${userMessage.substring(0, 200)}". Use MULTIPLE file system tool calls to find relevant content. Make all tool calls in parallel.`
      });

      console.log('[ConversationStorage] searchCodeFuzzyWithLLM: Tool execution completed', {
        toolCallsCount: toolResults.length,
        successfulCalls: toolResults.filter(r => r.success).length
      });

      // 5. Extract results from tool results (grep_files and search_files return matches)
      const formattedResults: Array<{
        scopeId: string;
        name: string;
        file: string;
        startLine: number;
        endLine: number;
        content: string;
        score: number;
        charCount: number;
        confidence: number;
      }> = [];

      let cumulativeChars = 0;

      for (const toolResult of toolResults) {
        if (!toolResult.success || !toolResult.result) continue;

        const result = toolResult.result;
        
        // Handle grep_files result
        if (toolResult.tool_name === 'grep_files' && result.matches) {
          for (const match of result.matches) {
            if (cumulativeChars >= options.maxChars) break;
            
            const charCount = match.content?.length || 0;
            if (cumulativeChars + charCount > options.maxChars) {
              const remainingChars = options.maxChars - cumulativeChars;
              if (remainingChars > 100) {
                formattedResults.push({
                  scopeId: `fuzzy-${match.file}-${match.line}`,
                  name: `Line ${match.line}${match.match ? ` (matched: ${match.match})` : ''}`,
                  file: match.file,
                  startLine: match.line,
                  endLine: match.line,
                  content: (match.content || '').substring(0, remainingChars) + '...',
                  score: 0.8, // High score for exact grep matches
                  charCount: remainingChars,
                  confidence: 0.3
                });
              }
              break;
            }

            formattedResults.push({
              scopeId: `fuzzy-${match.file}-${match.line}`,
              name: `Line ${match.line}${match.match ? ` (matched: ${match.match})` : ''}`,
              file: match.file,
              startLine: match.line,
              endLine: match.line,
              content: match.content || '',
              score: 0.8, // High score for exact grep matches
              charCount,
              confidence: 0.3
            });

            cumulativeChars += charCount;
          }
        }
        
        // Handle brain_search result (semantic search)
        if (toolResult.tool_name === 'brain_search' && result.results) {
          for (const searchResult of result.results) {
            if (cumulativeChars >= options.maxChars) break;

            const node = searchResult.node;
            const content = node.source || node.content || '';
            const charCount = content.length;
            const score = searchResult.score || 0.5;

            // Use filePath (absolute) from brain_search result
            const filePath = searchResult.filePath || node.file || '';
            const startLine = node.startLine || 1;
            const endLine = node.endLine || startLine;

            // Get file line count from brain_search result
            const fileLineCount = searchResult.fileLineCount;

            if (cumulativeChars + charCount > options.maxChars) {
              const remainingChars = options.maxChars - cumulativeChars;
              if (remainingChars > 100) {
                formattedResults.push({
                  scopeId: node.uuid || `semantic-${filePath}-${startLine}`,
                  name: node.name || `${node.type || 'scope'} at line ${startLine}`,
                  file: filePath, // Absolute path from brain_search
                  startLine,
                  endLine,
                  content: content.substring(0, remainingChars) + '...',
                  score,
                  charCount: remainingChars,
                  confidence: 0.5, // Higher confidence for semantic search
                  ...(fileLineCount && { fileLineCount })
                });
              }
              break;
            }

            formattedResults.push({
              scopeId: node.uuid || `semantic-${filePath}-${startLine}`,
              name: node.name || `${node.type || 'scope'} at line ${startLine}`,
              file: filePath, // Absolute path from brain_search
              startLine,
              endLine,
              content,
              score,
              charCount,
              confidence: 0.5, // Higher confidence for semantic search
              ...(fileLineCount && { fileLineCount })
            });

            cumulativeChars += charCount;
          }
        }
      }

      // Sort by score (best first) and deduplicate by file+line
      const seen = new Set<string>();
      const deduplicated = formattedResults.filter(r => {
        const key = `${r.file}:${r.startLine}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      deduplicated.sort((a, b) => b.score - a.score);

      console.log('[ConversationStorage] searchCodeFuzzyWithLLM: Results extracted', {
        totalResults: deduplicated.length,
        totalChars: cumulativeChars
      });

      return deduplicated;
    } catch (error) {
      console.debug('[ConversationStorage] Error in LLM-guided fuzzy search:', error);
      return [];
    }
  }

  // ==========================================================================
  // Dependency Hierarchy Extraction
  // ==========================================================================

  /**
   * Extract dependency hierarchy for a scope found at file:line
   * Used to enrich search results with their dependency context
   */
  async extractDependencyHierarchy(
    file: string,
    line: number,
    options: {
      depth?: number;
      direction?: 'both' | 'consumes' | 'consumed_by' | 'inherits';
      include_inheritance?: boolean;
      max_nodes?: number;
      include_code_snippets?: boolean;
      code_snippet_lines?: number;
    } = {}
  ): Promise<{
    root: {
      uuid: string;
      name: string;
      type: string;
      file: string;
      startLine: number;
      endLine: number;
    } | null;
    dependencies: Array<{
      uuid: string;
      name: string;
      type: string;
      file: string;
      startLine: number;
      endLine: number;
      depth: number;
      relationType: string;
    }>;
    consumers: Array<{
      uuid: string;
      name: string;
      type: string;
      file: string;
      startLine: number;
      endLine: number;
      depth: number;
      relationType: string;
    }>;
    code_snippets: Record<string, string>;
    error?: string;
  }> {
    if (!this.brainManager) {
      return {
        root: null,
        dependencies: [],
        consumers: [],
        code_snippets: {},
        error: 'BrainManager not available',
      };
    }

    try {
      const neo4jClient = this.brainManager.getNeo4jClient();
      if (!neo4jClient) {
        return {
          root: null,
          dependencies: [],
          consumers: [],
          code_snippets: {},
          error: 'Neo4j client not available',
        };
      }

      const {
        depth = 1, // Default depth=1 for automatic enrichment (shallow)
        direction = 'both',
        include_inheritance = false,
        max_nodes = 20, // Lower limit for automatic enrichment
        include_code_snippets = true,
        code_snippet_lines = 10,
      } = options;

      // 1. Find scope at file:line
      const scopeResult = await neo4jClient.run(
        `MATCH (s:Scope)
         WHERE s.file = $file
           AND s.startLine IS NOT NULL
           AND s.endLine IS NOT NULL
           AND s.startLine <= $line
           AND s.endLine >= $line
           AND NOT s:MarkdownSection
           AND NOT s:WebPage
           AND NOT s:DocumentFile
         RETURN s.uuid AS uuid, s.name AS name, s.type AS type, 
                s.startLine AS startLine, s.endLine AS endLine,
                s.file AS file
         ORDER BY (s.endLine - s.startLine) ASC
         LIMIT 1`,
        { file, line: neo4j.int(line) }
      );

      if (scopeResult.records.length === 0) {
        return {
          root: null,
          dependencies: [],
          consumers: [],
          code_snippets: {},
          error: `No scope found at ${file}:${line}`,
        };
      }

      const rootRecord = scopeResult.records[0];
      const rootUuid = rootRecord.get('uuid') as string;
      const rootName = rootRecord.get('name') as string;
      const rootType = rootRecord.get('type') as string;
      const rootStartLine = this.toNumber(rootRecord.get('startLine'));
      const rootEndLine = this.toNumber(rootRecord.get('endLine'));

      // 2. Build Cypher query for hierarchy extraction
      let cypher = '';
      const queryParams: Record<string, any> = {
        rootUuid,
        depth: neo4j.int(depth),
        maxNodes: neo4j.int(max_nodes),
      };

      if (direction === 'both' || direction === 'consumes') {
        cypher += `
        MATCH path = (root:Scope {uuid: $rootUuid})-[:CONSUMES*1..${depth}]->(dep:Scope)
        WHERE NOT dep.uuid = $rootUuid
        WITH root, dep, length(path) AS depth_level
        ORDER BY depth_level, dep.name
        LIMIT $maxNodes
        RETURN DISTINCT dep.uuid AS uuid, dep.name AS name, dep.type AS type,
               dep.file AS file, dep.startLine AS startLine, dep.endLine AS endLine,
               depth_level AS depth, 'CONSUMES' AS relationType
        `;
      }

      if (direction === 'both') {
        cypher += '\nUNION\n';
      }

      if (direction === 'both' || direction === 'consumed_by') {
        cypher += `
        MATCH path = (consumer:Scope)-[:CONSUMES*1..${depth}]->(root:Scope {uuid: $rootUuid})
        WHERE NOT consumer.uuid = $rootUuid
        WITH root, consumer, length(path) AS depth_level
        ORDER BY depth_level, consumer.name
        LIMIT $maxNodes
        RETURN DISTINCT consumer.uuid AS uuid, consumer.name AS name, consumer.type AS type,
               consumer.file AS file, consumer.startLine AS startLine, consumer.endLine AS endLine,
               depth_level AS depth, 'CONSUMED_BY' AS relationType
        `;
      }

      if (include_inheritance || direction === 'inherits') {
        if (cypher.length > 0) {
          cypher += '\nUNION\n';
        }
        cypher += `
        MATCH path = (root:Scope {uuid: $rootUuid})-[:INHERITS_FROM*1..${depth}]->(parent:Scope)
        WHERE NOT parent.uuid = $rootUuid
        WITH root, parent, length(path) AS depth_level
        ORDER BY depth_level, parent.name
        LIMIT $maxNodes
        RETURN DISTINCT parent.uuid AS uuid, parent.name AS name, parent.type AS type,
               parent.file AS file, parent.startLine AS startLine, parent.endLine AS endLine,
               depth_level AS depth, 'INHERITS_FROM' AS relationType
        
        UNION
        
        MATCH path = (child:Scope)-[:INHERITS_FROM*1..${depth}]->(root:Scope {uuid: $rootUuid})
        WHERE NOT child.uuid = $rootUuid
        WITH root, child, length(path) AS depth_level
        ORDER BY depth_level, child.name
        LIMIT $maxNodes
        RETURN DISTINCT child.uuid AS uuid, child.name AS name, child.type AS type,
               child.file AS file, child.startLine AS startLine, child.endLine AS endLine,
               depth_level AS depth, 'INHERITED_BY' AS relationType
        `;
      }

      const hierarchyResult = await neo4jClient.run(cypher, queryParams);

      // 3. Parse results
      const dependencies: Array<{
        uuid: string;
        name: string;
        type: string;
        file: string;
        startLine: number;
        endLine: number;
        depth: number;
        relationType: string;
      }> = [];

      const consumers: Array<{
        uuid: string;
        name: string;
        type: string;
        file: string;
        startLine: number;
        endLine: number;
        depth: number;
        relationType: string;
      }> = [];

      const codeSnippets: Record<string, string> = {};

      for (const record of hierarchyResult.records) {
        const uuid = record.get('uuid') as string;
        const name = record.get('name') as string;
        const type = record.get('type') as string;
        const file = record.get('file') as string;
        const startLine = this.toNumber(record.get('startLine'));
        const endLine = this.toNumber(record.get('endLine'));
        const depth = this.toNumber(record.get('depth'));
        const relationType = record.get('relationType') as string;

        if (uuid === rootUuid) continue;

        const node = { uuid, name, type, file, startLine, endLine, depth, relationType };

        if (relationType === 'CONSUMES' || relationType === 'INHERITS_FROM') {
          dependencies.push(node);
        } else if (relationType === 'CONSUMED_BY' || relationType === 'INHERITED_BY') {
          consumers.push(node);
        }

        // Extract code snippet if requested
        if (include_code_snippets) {
          const sourceResult = await neo4jClient.run(
            `MATCH (s:Scope {uuid: $uuid}) RETURN s.source AS source`,
            { uuid }
          );
          if (sourceResult.records.length > 0) {
            const source = sourceResult.records[0].get('source') as string | null;
            if (source) {
              const lines = source.split('\n');
              const snippet = lines.slice(0, Math.min(code_snippet_lines, lines.length)).join('\n');
              codeSnippets[uuid] = snippet;
            }
          }
        }
      }

      // Extract root snippet
      if (include_code_snippets) {
        const rootSourceResult = await neo4jClient.run(
          `MATCH (s:Scope {uuid: $uuid}) RETURN s.source AS source`,
          { uuid: rootUuid }
        );
        if (rootSourceResult.records.length > 0) {
          const source = rootSourceResult.records[0].get('source') as string | null;
          if (source) {
            const lines = source.split('\n');
            const snippet = lines.slice(0, Math.min(code_snippet_lines, lines.length)).join('\n');
            codeSnippets[rootUuid] = snippet;
          }
        }
      }

      return {
        root: {
          uuid: rootUuid,
          name: rootName,
          type: rootType,
          file,
          startLine: rootStartLine,
          endLine: rootEndLine,
        },
        dependencies: dependencies.sort((a, b) => a.depth - b.depth),
        consumers: consumers.sort((a, b) => a.depth - b.depth),
        code_snippets: codeSnippets,
      };
    } catch (error: any) {
      console.debug(`[ConversationStorage] Error extracting dependency hierarchy: ${error.message}`);
      return {
        root: null,
        dependencies: [],
        consumers: [],
        code_snippets: {},
        error: error.message,
      };
    }
  }
}
