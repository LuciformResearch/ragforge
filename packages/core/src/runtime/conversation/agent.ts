/**
 * ConversationAgent - High-level API for managing conversational agents with memory
 *
 * Features:
 * - Neo4j-based conversation storage with hierarchical summaries
 * - Optional real-time file export for debugging
 * - Tool calling support with history
 * - Dual context (recent + RAG)
 */

import type { Neo4jClient } from '../client/neo4j-client.js';
import type { LLMProvider } from '../reranking/llm-provider.js';
import type { ToolDefinition } from '../llm/native-tool-calling/index.js';
import type { ToolExecutor } from '../llm/structured-llm-executor.js';
import type {
  ConversationAgentOptions,
  ConversationConfig,
  ConversationMetadata,
  ListConversationsOptions,
  Summary
} from './types.js';
import { ConversationStorage } from './storage.js';
import { Conversation } from './conversation.js';
import { ConversationExporter } from './exporter.js';

export class ConversationAgent {
  private neo4j: Neo4jClient;
  private llmProvider: LLMProvider;
  private tools: ToolDefinition[];
  private toolExecutor?: ToolExecutor;
  private config: ConversationConfig;
  private storage: ConversationStorage;
  private exporter?: ConversationExporter;
  private initialized: boolean = false;

  constructor(options: ConversationAgentOptions) {
    this.neo4j = options.neo4j;
    this.llmProvider = options.llmProvider;
    this.tools = options.tools || [];
    this.toolExecutor = options.toolExecutor;
    this.config = this.buildConfig(options.config || {});
    this.storage = new ConversationStorage(this.neo4j);

    // Create exporter if file export is enabled
    if (this.config.exportToFiles) {
      this.exporter = new ConversationExporter({
        exportPath: this.config.exportPath || './conversations',
        exportFormat: this.config.exportFormat || 'json'
      });
    }
  }

  /**
   * Build configuration with defaults
   */
  private buildConfig(userConfig: ConversationConfig): ConversationConfig {
    return {
      // Recent context defaults
      recentContextMaxChars: userConfig.recentContextMaxChars ?? 5000,
      recentContextMaxTurns: userConfig.recentContextMaxTurns ?? 10,

      // RAG context defaults
      ragMaxSummaries: userConfig.ragMaxSummaries ?? 5,
      ragMinScore: userConfig.ragMinScore ?? 0.7,
      ragLevelBoost: userConfig.ragLevelBoost ?? { 1: 1.0, 2: 1.1, 3: 1.2 },
      ragRecencyBoost: userConfig.ragRecencyBoost !== false,
      ragRecencyDecayDays: userConfig.ragRecencyDecayDays ?? 7,

      // Hierarchical summarization defaults
      enableSummarization: userConfig.enableSummarization !== false,
      summarizeEveryNChars: userConfig.summarizeEveryNChars ?? 10000,
      summaryLevels: userConfig.summaryLevels ?? 3,

      // Embeddings
      embedMessages: userConfig.embedMessages ?? false,
      embeddingProvider: userConfig.embeddingProvider,

      // Export defaults
      exportToFiles: userConfig.exportToFiles ?? false,
      exportPath: userConfig.exportPath ?? './conversations',
      exportFormat: userConfig.exportFormat ?? 'json',
      exportOnEveryMessage: userConfig.exportOnEveryMessage ?? false
    };
  }

  /**
   * Initialize Neo4j schema (constraints, indexes, vector indexes)
   * Must be called before using the agent
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      console.log('⚠️  ConversationAgent already initialized');
      return;
    }

    console.log('🔧 Initializing ConversationAgent schema in Neo4j...');

    // Create constraints
    await this.neo4j.run(`
      CREATE CONSTRAINT conversation_uuid_unique IF NOT EXISTS
      FOR (c:Conversation) REQUIRE c.uuid IS UNIQUE
    `);

    await this.neo4j.run(`
      CREATE CONSTRAINT message_uuid_unique IF NOT EXISTS
      FOR (m:Message) REQUIRE m.uuid IS UNIQUE
    `);

    await this.neo4j.run(`
      CREATE CONSTRAINT summary_uuid_unique IF NOT EXISTS
      FOR (s:Summary) REQUIRE s.uuid IS UNIQUE
    `);

    await this.neo4j.run(`
      CREATE CONSTRAINT tool_call_uuid_unique IF NOT EXISTS
      FOR (tc:ToolCall) REQUIRE tc.uuid IS UNIQUE
    `);

    await this.neo4j.run(`
      CREATE CONSTRAINT tool_result_uuid_unique IF NOT EXISTS
      FOR (tr:ToolResult) REQUIRE tr.uuid IS UNIQUE
    `);

    // Create indexes for performance
    await this.neo4j.run(`
      CREATE INDEX conversation_created_at IF NOT EXISTS
      FOR (c:Conversation) ON (c.created_at)
    `);

    await this.neo4j.run(`
      CREATE INDEX conversation_updated_at IF NOT EXISTS
      FOR (c:Conversation) ON (c.updated_at)
    `);

    await this.neo4j.run(`
      CREATE INDEX conversation_status IF NOT EXISTS
      FOR (c:Conversation) ON (c.status)
    `);

    await this.neo4j.run(`
      CREATE INDEX message_timestamp IF NOT EXISTS
      FOR (m:Message) ON (m.timestamp)
    `);

    await this.neo4j.run(`
      CREATE INDEX summary_level IF NOT EXISTS
      FOR (s:Summary) ON (s.level)
    `);

    await this.neo4j.run(`
      CREATE INDEX summary_created_at IF NOT EXISTS
      FOR (s:Summary) ON (s.created_at)
    `);

    // Create vector indexes if embeddings are enabled
    if (this.config.embedMessages && this.config.embeddingProvider) {
      const dimension = await this.getEmbeddingDimension();

      console.log(`📊 Creating vector indexes for embeddings (dimension: ${dimension})...`);

      // Vector index for messages
      await this.neo4j.run(`
        CREATE VECTOR INDEX message_embedding_index IF NOT EXISTS
        FOR (m:Message) ON (m.embedding)
        OPTIONS {indexConfig: {
          \`vector.dimensions\`: ${dimension},
          \`vector.similarity_function\`: 'cosine'
        }}
      `);

      // Vector index for summaries
      await this.neo4j.run(`
        CREATE VECTOR INDEX summary_embedding_index IF NOT EXISTS
        FOR (s:Summary) ON (s.embedding)
        OPTIONS {indexConfig: {
          \`vector.dimensions\`: ${dimension},
          \`vector.similarity_function\`: 'cosine'
        }}
      `);
    }

    this.initialized = true;
    console.log('✅ ConversationAgent schema initialized successfully');
  }

  /**
   * Get embedding dimension from provider
   */
  private async getEmbeddingDimension(): Promise<number> {
    if (!this.config.embeddingProvider) {
      throw new Error('Embedding provider not configured');
    }

    // Generate a test embedding to get dimension
    const testEmbedding = await this.config.embeddingProvider.generateEmbedding('test');
    return testEmbedding.length;
  }

  /**
   * Create a new conversation
   */
  async createConversation(options?: {
    title?: string;
    tags?: string[];
  }): Promise<Conversation> {
    if (!this.initialized) {
      throw new Error('ConversationAgent not initialized. Call initialize() first.');
    }

    const uuid = crypto.randomUUID();
    const title = options?.title || `Conversation ${new Date().toISOString()}`;
    const tags = options?.tags || [];

    await this.storage.createConversation({
      uuid,
      title,
      tags,
      created_at: new Date(),
      updated_at: new Date(),
      message_count: 0,
      total_chars: 0,
      status: 'active'
    });

    console.log(`✅ Created conversation: ${uuid}`);

    return new Conversation(uuid, this);
  }

  /**
   * Load an existing conversation
   */
  async loadConversation(uuid: string): Promise<Conversation> {
    if (!this.initialized) {
      throw new Error('ConversationAgent not initialized. Call initialize() first.');
    }

    const metadata = await this.storage.getConversationMetadata(uuid);
    if (!metadata) {
      throw new Error(`Conversation not found: ${uuid}`);
    }

    return new Conversation(uuid, this);
  }

  /**
   * List conversations with filtering
   */
  async listConversations(options?: ListConversationsOptions): Promise<ConversationMetadata[]> {
    if (!this.initialized) {
      throw new Error('ConversationAgent not initialized. Call initialize() first.');
    }

    return await this.storage.listConversations(options);
  }

  /**
   * Find similar conversations using RAG on summaries
   */
  async findSimilarConversations(
    query: string,
    options?: {
      maxResults?: number;
      minScore?: number;
      excludeConversationId?: string;
    }
  ): Promise<Array<{ conversation: ConversationMetadata; summaries: Array<Summary & { score: number }> }>> {
    if (!this.initialized) {
      throw new Error('ConversationAgent not initialized. Call initialize() first.');
    }

    if (!this.config.embedMessages || !this.config.embeddingProvider) {
      throw new Error('Embeddings not enabled. Set embedMessages and embeddingProvider in config.');
    }

    const maxResults = options?.maxResults || 5;
    const minScore = options?.minScore || 0.7;

    // Generate query embedding
    const queryEmbedding = await this.config.embeddingProvider.generateEmbedding(query);

    // Search all summaries across all conversations
    const result = await this.neo4j.run(
      `
      MATCH (c:Conversation)-[:HAS_SUMMARY]->(s:Summary)
      WHERE s.embedding IS NOT NULL
      ${options?.excludeConversationId ? 'AND c.uuid <> $excludeId' : ''}
      WITH c, s, vector.similarity.cosine(s.embedding, $queryEmbedding) AS similarity
      WHERE similarity >= $minScore
      WITH c, s, similarity
      ORDER BY similarity DESC
      LIMIT $maxResults
      RETURN c, collect({summary: s, score: similarity}) AS summaries
      `,
      {
        queryEmbedding,
        minScore,
        maxResults,
        excludeId: options?.excludeConversationId
      }
    );

    const results: Array<{
      conversation: ConversationMetadata;
      summaries: Array<Summary & { score: number }>;
    }> = [];

    for (const record of result.records) {
      const c = record.get('c').properties;
      const summaries = record.get('summaries').map((item: any) => ({
        ...item.summary.properties,
        score: item.score
      }));

      results.push({
        conversation: c as ConversationMetadata,
        summaries
      });
    }

    return results;
  }

  /**
   * Archive a conversation
   */
  async archiveConversation(uuid: string): Promise<void> {
    if (!this.initialized) {
      throw new Error('ConversationAgent not initialized. Call initialize() first.');
    }

    await this.neo4j.run(
      `
      MATCH (c:Conversation {uuid: $uuid})
      SET c.status = 'archived', c.updated_at = datetime()
      `,
      { uuid }
    );

    console.log(`📦 Archived conversation: ${uuid}`);
  }

  /**
   * Delete a conversation (WARNING: permanent!)
   */
  async deleteConversation(uuid: string): Promise<void> {
    if (!this.initialized) {
      throw new Error('ConversationAgent not initialized. Call initialize() first.');
    }

    await this.neo4j.run(
      `
      MATCH (c:Conversation {uuid: $uuid})
      DETACH DELETE c
      `,
      { uuid }
    );

    console.log(`🗑️  Deleted conversation: ${uuid}`);
  }

  // ==========================================================================
  // Getters for Conversation class
  // ==========================================================================

  getStorage(): ConversationStorage {
    return this.storage;
  }

  getConfig(): ConversationConfig {
    return this.config;
  }

  getLLMProvider(): LLMProvider {
    return this.llmProvider;
  }

  getTools(): ToolDefinition[] {
    return this.tools;
  }

  getToolExecutor(): ToolExecutor | undefined {
    return this.toolExecutor;
  }

  getExporter(): ConversationExporter | undefined {
    return this.exporter;
  }
}
