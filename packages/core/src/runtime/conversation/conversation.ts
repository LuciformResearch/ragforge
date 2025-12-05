/**
 * Conversation - Manages a single conversation with sophisticated hierarchical summarization
 *
 * Features:
 * - Character-based hierarchical summaries (L1, L2, L3...)
 * - Dual context (recent non-summarized + RAG on summaries)
 * - Structured summaries (conversation + actions)
 * - Tool calls formatted with reasoning
 */

import type { ConversationAgent } from './agent.js';
import type {
  Message,
  ToolCall,
  AssistantResponse,
  ConversationContext,
  ConversationFullData,
  GetMessagesOptions,
  Summary,
  SummaryContent,
  RecentContext,
  RAGContext
} from './types.js';
import { StructuredLLMExecutor } from '../llm/structured-llm-executor.js';

export class Conversation {
  private uuid: string;
  private agent: ConversationAgent;
  private executor: StructuredLLMExecutor;

  constructor(uuid: string, agent: ConversationAgent) {
    this.uuid = uuid;
    this.agent = agent;
    this.executor = new StructuredLLMExecutor();
  }

  /**
   * Send a message in the conversation
   */
  async sendMessage(userMessage: string): Promise<AssistantResponse> {
    const storage = this.agent.getStorage();
    const config = this.agent.getConfig();

    console.log(`\n💬 Processing message: "${userMessage.substring(0, 60)}..."`);

    // 1. Store user message
    const userMsgUuid = await storage.storeMessage({
      conversation_id: this.uuid,
      role: 'user',
      content: userMessage,
      timestamp: new Date()
    });

    // Update conversation char count
    await storage.incrementMessageCount(this.uuid, userMessage.length);

    // Export immediately after user message (non-blocking, for real-time debugging)
    if (config.exportToFiles && config.exportOnEveryMessage) {
      this.exportToFileAsync().catch(err =>
        console.error('Export failed (non-critical):', err.message)
      );
    }

    // 2. Build dual context (recent + RAG)
    const context = await this.buildDualContext(userMessage);

    // 3. Execute with tools (if provided)
    const tools = this.agent.getTools();
    const toolExecutor = this.agent.getToolExecutor();
    const llmProvider = this.agent.getLLMProvider();

    let response: any;
    let toolCalls: any[] = [];

    if (tools.length > 0 && toolExecutor) {
      // With tools
      const result = await this.executor.executeLLMBatchWithTools(
        [{ user_message: userMessage }],
        {
          inputFields: ['user_message'],
          systemPrompt: this.buildSystemPrompt(context),
          userTask: 'Answer the user message using available tools if needed',
          outputSchema: {
            response: { type: 'string', description: 'Your response to the user' },
            reasoning: { type: 'string', description: 'Your thinking process' }
          },
          tools,
          toolMode: 'per-item',
          maxIterationsPerItem: 5,
          toolExecutor,
          llmProvider,
          batchSize: 1
        }
      );

      response = Array.isArray(result) ? result[0] : result;
      toolCalls = response._metadata?.tool_calls || [];
    } else {
      // Without tools - simple LLM call
      const result = await this.executor.executeLLMBatch(
        [{ user_message: userMessage }],
        {
          inputFields: ['user_message'],
          systemPrompt: this.buildSystemPrompt(context),
          userTask: 'Answer the user message based on the context provided',
          outputSchema: {
            response: { type: 'string', description: 'Your response to the user' },
            reasoning: { type: 'string', description: 'Your thinking process' }
          },
          llmProvider,
          batchSize: 1
        }
      );

      response = Array.isArray(result) ? result[0] : result;
    }

    // 4. Store assistant message
    const assistantContent = response.response || '';
    const assistantReasoning = response.reasoning || '';

    const assistantMsgUuid = await storage.storeMessage({
      conversation_id: this.uuid,
      role: 'assistant',
      content: assistantContent,
      reasoning: assistantReasoning,
      timestamp: new Date()
    });

    // Update conversation char count
    await storage.incrementMessageCount(
      this.uuid,
      assistantContent.length + assistantReasoning.length
    );

    // 5. Store tool calls
    for (const tc of toolCalls) {
      await storage.storeToolCall(assistantMsgUuid, tc);
    }

    // Export immediately after assistant message (non-blocking, for real-time debugging)
    if (config.exportToFiles && config.exportOnEveryMessage) {
      this.exportToFileAsync().catch(err =>
        console.error('Export failed (non-critical):', err.message)
      );
    }

    // 6. Check if hierarchical summarization needed (character-based for ALL levels!)
    await this.checkHierarchicalSummarization();

    // Export after summarization (non-blocking)
    if (config.exportToFiles && config.exportOnEveryMessage) {
      this.exportToFileAsync().catch(err =>
        console.error('Export failed (non-critical):', err.message)
      );
    }

    // 7. Generate embeddings for messages if enabled
    if (config.embedMessages && config.embeddingProvider) {
      // Async, non-blocking
      Promise.all([
        this.generateMessageEmbedding(userMsgUuid, userMessage),
        this.generateMessageEmbedding(assistantMsgUuid, assistantContent)
      ]).catch(console.error);
    }

    return {
      content: assistantContent,
      reasoning: assistantReasoning,
      tool_calls: toolCalls,
      context_used: context
    };
  }

  // ==========================================================================
  // Dual Context Building (Recent + RAG)
  // ==========================================================================

  /**
   * Build dual context: Recent turns + RAG on summaries
   */
  private async buildDualContext(currentUserMessage: string): Promise<ConversationContext> {
    const config = this.agent.getConfig();
    const storage = this.agent.getStorage();
    const metadata = await storage.getConversationMetadata(this.uuid);

    // Build recent context (non-summarized)
    const recent = await this.buildRecentContext();

    // Build RAG context (on summaries) if embeddings enabled
    let rag: RAGContext = {
      summaries: [],
      max_score: 0,
      min_score: 0
    };

    if (config.embedMessages && config.embeddingProvider) {
      rag = await this.buildRAGContext(currentUserMessage);
    }

    return {
      recent,
      rag,
      message_count: metadata?.message_count || 0,
      total_chars: metadata?.total_chars || 0
    };
  }

  /**
   * Build recent context (last N turns, non-summarized)
   */
  private async buildRecentContext(): Promise<RecentContext> {
    const config = this.agent.getConfig();
    const storage = this.agent.getStorage();

    const maxChars = config.recentContextMaxChars || 5000;
    const maxTurns = config.recentContextMaxTurns || 10;

    // Get all messages (we'll filter to last N)
    const allMessages = await storage.getMessages(this.uuid, {
      limit: 1000,
      includeToolCalls: true
    });

    // Take last messages until we hit char or turn limit
    const recentMessages: Message[] = [];
    let totalChars = 0;
    let turnCount = 0;

    // Go backwards from most recent
    for (let i = allMessages.length - 1; i >= 0; i--) {
      const msg = allMessages[i];

      // Count turns (user+assistant pair)
      if (msg.role === 'user') {
        turnCount++;
      }

      if (totalChars + msg.char_count > maxChars || turnCount > maxTurns) {
        break;
      }

      recentMessages.unshift(msg);
      totalChars += msg.char_count;
    }

    return {
      messages: recentMessages,
      total_chars: totalChars,
      turn_count: turnCount
    };
  }

  /**
   * Build RAG context (vector search on summaries)
   */
  private async buildRAGContext(query: string): Promise<RAGContext> {
    const config = this.agent.getConfig();
    const storage = this.agent.getStorage();

    if (!config.embeddingProvider) {
      return { summaries: [], max_score: 0, min_score: 0 };
    }

    // Generate embedding for current query
    const queryEmbedding = await config.embeddingProvider.generateEmbedding(query);

    // Search summaries with scoring
    const summaries = await storage.getRAGContext(this.uuid, queryEmbedding, {
      maxSummaries: config.ragMaxSummaries || 5,
      minScore: config.ragMinScore || 0.7,
      levelBoost: config.ragLevelBoost || { 1: 1.0, 2: 1.1, 3: 1.2 },
      recencyBoost: config.ragRecencyBoost !== false,
      recencyDecayDays: config.ragRecencyDecayDays || 7
    });

    const scores = summaries.map(s => s.score);

    return {
      summaries,
      max_score: scores.length > 0 ? Math.max(...scores) : 0,
      min_score: scores.length > 0 ? Math.min(...scores) : 0
    };
  }

  /**
   * Build system prompt with dual context
   */
  private buildSystemPrompt(context: ConversationContext): string {
    let prompt = `You are a helpful assistant with access to conversation history.`;

    // Add RAG context (relevant past conversations)
    if (context.rag.summaries.length > 0) {
      prompt += `\n\n## Relevant Past Context (from history)`;
      prompt += `\n\nI found ${context.rag.summaries.length} relevant segments from our past conversations:\n`;

      for (const summary of context.rag.summaries) {
        const levelLabel = `L${summary.level}`;
        const ageInDays = Math.floor(
          (Date.now() - new Date(summary.created_at).getTime()) / (1000 * 60 * 60 * 24)
        );
        const ageLabel = ageInDays === 0 ? 'today' : `${ageInDays} days ago`;

        prompt += `\n\n[${levelLabel} Summary - ${ageLabel} - relevance: ${(summary.score * 100).toFixed(0)}%]`;
        prompt += `\nConversation: ${summary.content.conversation_summary}`;
        prompt += `\nActions: ${summary.content.actions_summary}`;
      }

      prompt += `\n`;
    }

    // Add recent context (detailed last turns)
    if (context.recent.messages.length > 0) {
      prompt += `\n\n## Recent Conversation (last ${context.recent.turn_count} turns)`;
      prompt += `\n\nHere are the most recent exchanges:\n`;

      for (const msg of context.recent.messages) {
        prompt += `\n**${msg.role}**: ${msg.content}`;

        if (msg.reasoning) {
          prompt += `\n  [reasoning: ${msg.reasoning}]`;
        }

        if (msg.tool_calls && msg.tool_calls.length > 0) {
          prompt += `\n  [tools used:`;
          for (const tc of msg.tool_calls) {
            const status = tc.success ? '✓' : '✗';
            prompt += `\n    ${status} ${tc.tool_name}(${JSON.stringify(tc.arguments).substring(0, 50)}...)`;
            if (tc.result) {
              const resultStr = typeof tc.result === 'object'
                ? JSON.stringify(tc.result).substring(0, 100)
                : String(tc.result).substring(0, 100);
              prompt += ` → ${resultStr}...`;
            }
          }
          prompt += `\n  ]`;
        }
      }

      prompt += `\n`;
    }

    if (this.agent.getTools().length > 0) {
      prompt += `\n\nUse the available tools to answer questions accurately. Always explain your reasoning.`;
    }

    return prompt;
  }

  // ==========================================================================
  // Hierarchical Summarization (Character-based for ALL levels!)
  // ==========================================================================

  /**
   * Check if we need to create hierarchical summaries at any level
   */
  private async checkHierarchicalSummarization(): Promise<void> {
    const config = this.agent.getConfig();
    if (!config.enableSummarization) return;

    const threshold = config.summarizeEveryNChars || 10000;
    const maxLevels = config.summaryLevels || 3;

    // Check each level from L1 to maxLevels
    for (let level = 1; level <= maxLevels; level++) {
      const created = await this.tryCreateSummaryAtLevel(level, threshold);
      if (!created) break;  // Stop if we can't create this level
    }
  }

  /**
   * Try to create a summary at a given level
   * Returns true if a summary was created, false otherwise
   */
  private async tryCreateSummaryAtLevel(level: number, threshold: number): Promise<boolean> {
    const storage = this.agent.getStorage();

    if (level === 1) {
      // L1: Summarize raw messages
      return await this.tryCreateL1Summary(threshold);
    } else {
      // L2+: Summarize summaries from previous level
      return await this.tryCreateUpperLevelSummary(level, threshold);
    }
  }

  /**
   * Try to create an L1 summary (summarize raw messages)
   */
  private async tryCreateL1Summary(threshold: number): Promise<boolean> {
    const storage = this.agent.getStorage();
    const metadata = await storage.getConversationMetadata(this.uuid);
    if (!metadata) return false;

    // Find how many chars have been summarized so far at L1
    const latestL1 = await storage.getLatestSummaryByLevel(this.uuid, 1);
    const lastSummarizedChar = latestL1?.char_range_end || 0;

    const totalChars = metadata.total_chars;
    const newChars = totalChars - lastSummarizedChar;

    if (newChars < threshold) {
      return false;  // Not enough new chars yet
    }

    // Get messages in the char range
    const allMessages = await storage.getMessages(this.uuid, { limit: 100000 });

    // Calculate char positions
    let currentPos = 0;
    const messagesInRange: Message[] = [];

    for (const msg of allMessages) {
      const msgStart = currentPos;
      const msgEnd = currentPos + msg.char_count;

      if (msgEnd > lastSummarizedChar && msgStart < totalChars) {
        messagesInRange.push(msg);
      }

      currentPos = msgEnd;
    }

    if (messagesInRange.length === 0) return false;

    // Generate L1 summary
    await this.createL1Summary(messagesInRange, lastSummarizedChar, totalChars);

    console.log(`   ✓ Created L1 summary (chars ${lastSummarizedChar}-${totalChars})`);
    return true;
  }

  /**
   * Try to create an upper-level summary (L2, L3, etc.)
   */
  private async tryCreateUpperLevelSummary(level: number, threshold: number): Promise<boolean> {
    const storage = this.agent.getStorage();

    // Get summaries from previous level
    const lowerLevel = level - 1;
    const lowerSummaries = await storage.getSummaries(this.uuid, lowerLevel);

    if (lowerSummaries.length === 0) {
      return false;  // No summaries to summarize
    }

    // Find how many chars of lower-level summaries have been summarized
    const latestThisLevel = await storage.getLatestSummaryByLevel(this.uuid, level);
    const lastSummarizedSummaryEnd = latestThisLevel?.char_range_end || 0;

    // Calculate total chars of lower-level summaries
    const totalLowerChars = await storage.getTotalSummaryChars(this.uuid, lowerLevel);
    const newLowerChars = totalLowerChars - lastSummarizedSummaryEnd;

    if (newLowerChars < threshold) {
      return false;  // Not enough new summary chars yet
    }

    // Find which lower-level summaries are in the new range
    const summariesToSummarize = lowerSummaries.filter(
      s => s.char_range_end > lastSummarizedSummaryEnd
    );

    if (summariesToSummarize.length === 0) return false;

    // Generate upper-level summary
    await this.createUpperLevelSummary(level, summariesToSummarize, lastSummarizedSummaryEnd, totalLowerChars);

    console.log(`   ✓ Created L${level} summary from ${summariesToSummarize.length} L${lowerLevel} summaries`);
    return true;
  }

  /**
   * Create an L1 summary by summarizing raw messages
   */
  private async createL1Summary(
    messages: Message[],
    charRangeStart: number,
    charRangeEnd: number
  ): Promise<void> {
    const storage = this.agent.getStorage();
    const llmProvider = this.agent.getLLMProvider();

    // Format messages with tool calls linked to reasoning
    const formattedText = this.formatMessagesForSummary(messages);

    // Generate structured summary with LLM
    const result = await this.executor.executeLLMBatch(
      [{ conversation: formattedText }],
      {
        inputFields: ['conversation'],
        userTask: `Summarize this conversation segment into two distinct parts:

1. **Conversation Summary** (3-4 lines max):
   Focus on what the user asked and what you answered.
   Format: "L'utilisateur a demandé X, donc je lui ai répondu Y..."
   
2. **Actions Summary** (3-4 lines max):
   Focus on the tools you called and their results, linked with your reasoning.
   Format: "J'ai utilisé tool_name(args) qui a retourné X, puis..."

Be factual and preserve critical details.`,
        outputSchema: {
          conversation_summary: {
            type: 'string',
            description: 'Summary of user questions and assistant responses (3-4 lines)',
          },
          actions_summary: {
            type: 'string',
            description: 'Summary of tool calls and their results (3-4 lines)',
          }
        },
        llmProvider,
        batchSize: 1
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

    // Store L1 summary
    const summaryUuid = crypto.randomUUID();
    await storage.storeSummary({
      uuid: summaryUuid,
      conversation_id: this.uuid,
      level: 1,
      content: summaryContent,
      char_range_start: charRangeStart,
      char_range_end: charRangeEnd,
      summary_char_count: summaryCharCount,
      created_at: new Date()
    });

    // Generate embedding for summary if enabled
    const config = this.agent.getConfig();
    if (config.embedMessages && config.embeddingProvider) {
      const combinedText = `${summaryContent.conversation_summary}\n${summaryContent.actions_summary}`;
      this.generateSummaryEmbedding(summaryUuid, combinedText).catch(console.error);
    }
  }

  /**
   * Create an upper-level summary by summarizing lower-level summaries
   */
  private async createUpperLevelSummary(
    level: number,
    lowerSummaries: Summary[],
    charRangeStart: number,
    charRangeEnd: number
  ): Promise<void> {
    const storage = this.agent.getStorage();
    const llmProvider = this.agent.getLLMProvider();

    // Format lower summaries
    const formattedText = lowerSummaries
      .map((s, i) => {
        return `[Segment ${i + 1}]\nConversation: ${s.content.conversation_summary}\nActions: ${s.content.actions_summary}`;
      })
      .join('\n\n');

    // Generate higher-level summary
    const result = await this.executor.executeLLMBatch(
      [{ summaries: formattedText }],
      {
        inputFields: ['summaries'],
        userTask: `Synthesize these conversation summaries into a higher-level summary.

Combine them into two coherent parts:

1. **Conversation Summary** (3-4 lines max):
   What were the main topics and questions across all these segments?
   
2. **Actions Summary** (3-4 lines max):
   What were the main tools used and patterns of investigation?

Maintain chronological flow if relevant. Be concise but preserve key information.`,
        outputSchema: {
          conversation_summary: {
            type: 'string',
            description: 'Synthesized conversation summary (3-4 lines)',
          },
          actions_summary: {
            type: 'string',
            description: 'Synthesized actions summary (3-4 lines)',
          }
        },
        llmProvider,
        batchSize: 1
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

    // Store upper-level summary
    const summaryUuid = crypto.randomUUID();
    await storage.storeSummary({
      uuid: summaryUuid,
      conversation_id: this.uuid,
      level,
      content: summaryContent,
      char_range_start: charRangeStart,
      char_range_end: charRangeEnd,
      summary_char_count: summaryCharCount,
      created_at: new Date(),
      parent_summaries: lowerSummaries.map(s => s.uuid)
    });

    // Generate embedding
    const config = this.agent.getConfig();
    if (config.embedMessages && config.embeddingProvider) {
      const combinedText = `${summaryContent.conversation_summary}\n${summaryContent.actions_summary}`;
      this.generateSummaryEmbedding(summaryUuid, combinedText).catch(console.error);
    }
  }

  /**
   * Format messages with tool calls linked to reasoning
   */
  private formatMessagesForSummary(messages: Message[]): string {
    let formatted = '';
    let turnNumber = 0;

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];

      if (msg.role === 'user') {
        turnNumber++;
        formatted += `\nTurn ${turnNumber}:\n`;
      }

      formatted += `${msg.role}: "${msg.content}"\n`;

      if (msg.reasoning) {
        formatted += `[reasoning: ${msg.reasoning}]\n`;
      }

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        formatted += `[tools used:\n`;
        for (const tc of msg.tool_calls) {
          const argsStr = JSON.stringify(tc.arguments);
          const status = tc.success ? '✓' : '✗';
          formatted += `  ${status} ${tc.tool_name}(${argsStr})\n`;

          if (tc.result) {
            const resultStr = typeof tc.result === 'object'
              ? JSON.stringify(tc.result).substring(0, 200)
              : String(tc.result).substring(0, 200);
            formatted += `    → ${resultStr}${resultStr.length >= 200 ? '...' : ''}\n`;
          }
        }
        formatted += `]\n`;
      }
    }

    return formatted;
  }

  // ==========================================================================
  // Embeddings
  // ==========================================================================

  private async generateMessageEmbedding(messageUuid: string, content: string): Promise<void> {
    const config = this.agent.getConfig();
    const storage = this.agent.getStorage();

    if (!config.embeddingProvider) return;

    const embedding = await config.embeddingProvider.generateEmbedding(content);
    await storage.updateMessageEmbedding(messageUuid, embedding);
  }

  private async generateSummaryEmbedding(summaryUuid: string, content: string): Promise<void> {
    const config = this.agent.getConfig();
    const storage = this.agent.getStorage();

    if (!config.embeddingProvider) return;

    const embedding = await config.embeddingProvider.generateEmbedding(content);
    await storage.updateSummaryEmbedding(summaryUuid, embedding);
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Generate/regenerate summaries for entire conversation
   */
  async summarize(): Promise<string> {
    const config = this.agent.getConfig();
    const threshold = config.summarizeEveryNChars || 10000;

    // Force creation of all levels
    for (let level = 1; level <= (config.summaryLevels || 3); level++) {
      await this.tryCreateSummaryAtLevel(level, threshold);
    }

    // Return highest level summary
    const storage = this.agent.getStorage();
    const allSummaries = await storage.getSummaries(this.uuid);

    if (allSummaries.length === 0) {
      return 'No summary available yet';
    }

    // Get highest level
    const maxLevel = Math.max(...allSummaries.map(s => s.level));
    const highestLevel = allSummaries.filter(s => s.level === maxLevel);

    if (highestLevel.length === 0) {
      return 'No summary available';
    }

    // Combine all summaries of highest level
    const combined = highestLevel
      .map(s => `Conversation: ${s.content.conversation_summary}\nActions: ${s.content.actions_summary}`)
      .join('\n\n');

    return combined;
  }

  /**
   * Get conversation history
   */
  async getHistory(options?: GetMessagesOptions): Promise<{ messages: Message[] }> {
    const storage = this.agent.getStorage();
    const messages = await storage.getMessages(this.uuid, options);
    return { messages };
  }

  /**
   * Get all summaries
   */
  async getSummaries(): Promise<{ summaries: Summary[] }> {
    const storage = this.agent.getStorage();
    const summaries = await storage.getSummaries(this.uuid);
    return { summaries };
  }

  /**
   * Get full conversation data (for export)
   */
  async getFullData(): Promise<ConversationFullData> {
    const storage = this.agent.getStorage();
    const metadata = await storage.getConversationMetadata(this.uuid);
    const messages = await storage.getMessages(this.uuid, {
      includeToolCalls: true,
      limit: 100000
    });
    const summaries = await storage.getSummaries(this.uuid);

    return {
      ...metadata!,
      messages,
      summaries
    };
  }

  /**
   * Get conversation UUID
   */
  getUuid(): string {
    return this.uuid;
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Export to file asynchronously (non-blocking, for real-time debugging)
   */
  private async exportToFileAsync(): Promise<void> {
    const exporter = this.agent.getExporter();
    if (!exporter) return;

    try {
      const data = await this.getFullData();
      await exporter.export(this, data);
      console.log(`   📄 Exported conversation to file (${data.messages.length} messages, ${data.summaries?.length || 0} summaries)`);
    } catch (err: any) {
      // Don't throw - export is for debugging, shouldn't break the flow
      console.error(`   ❌ Failed to export conversation ${this.uuid}:`, err.message);
    }
  }
}
