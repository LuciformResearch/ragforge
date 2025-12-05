/**
 * ConversationStorage - Neo4j operations for conversations
 */

import type { Neo4jClient } from '../client/neo4j-client.js';
import { formatLocalDate } from '../utils/timestamp.js';
import neo4j from 'neo4j-driver';
import type {
  ConversationMetadata,
  Message,
  ToolCall,
  Summary,
  ListConversationsOptions,
  GetMessagesOptions,
  StoreMessageOptions,
  SummarizationTrigger
} from './types.js';

export class ConversationStorage {
  constructor(private neo4j: Neo4jClient) {}

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

  // ==========================================================================
  // Conversation Operations
  // ==========================================================================

  async createConversation(data: ConversationMetadata): Promise<void> {
    const created_at = data.created_at instanceof Date ? formatLocalDate(data.created_at) : data.created_at;
    const updated_at = data.updated_at instanceof Date ? formatLocalDate(data.updated_at) : data.updated_at;

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
    const uuid = crypto.randomUUID();
    const charCount = options.content.length + (options.reasoning?.length || 0);
    const timestamp = options.timestamp instanceof Date ? formatLocalDate(options.timestamp) : options.timestamp;

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
      const toolCalls = r.get('tool_calls').filter((tc: any) => tc.tool_name);

      return {
        uuid: props.uuid,
        conversation_id: props.conversation_id,
        role: props.role,
        content: props.content,
        reasoning: props.reasoning || undefined,
        timestamp: props.timestamp,
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

  // ==========================================================================
  // Tool Call Operations
  // ==========================================================================

  async storeToolCall(messageUuid: string, toolCall: any): Promise<void> {
    const tcUuid = crypto.randomUUID();
    const resultUuid = crypto.randomUUID();

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
    const created_at = summary.created_at instanceof Date ? formatLocalDate(summary.created_at) : summary.created_at;

    await this.neo4j.run(
      `MATCH (c:Conversation {uuid: $conversation_id})
       CREATE (c)-[:HAS_SUMMARY]->(s:Summary {
         uuid: $uuid,
         conversation_id: $conversation_id,
         level: $level,
         conversation_summary: $conversation_summary,
         actions_summary: $actions_summary,
         char_range_start: $char_range_start,
         char_range_end: $char_range_end,
         summary_char_count: $summary_char_count,
         created_at: datetime($created_at),
         parent_summaries: $parent_summaries
       })`,
      {
        uuid: summary.uuid,
        conversation_id: summary.conversation_id,
        level: summary.level,
        conversation_summary: summary.content.conversation_summary,
        actions_summary: summary.content.actions_summary,
        char_range_start: summary.char_range_start,
        char_range_end: summary.char_range_end,
        summary_char_count: summary.summary_char_count,
        created_at,
        parent_summaries: summary.parent_summaries || []
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
      char_range_start: props.char_range_start?.toNumber() || 0,
      char_range_end: props.char_range_end?.toNumber() || 0,
      summary_char_count: props.summary_char_count?.toNumber() || 0,
      created_at: props.created_at,
      embedding: props.embedding || undefined,
      parent_summaries: props.parent_summaries || undefined
    };
  }

  async updateSummaryEmbedding(summaryUuid: string, embedding: number[]): Promise<void> {
    await this.neo4j.run(
      `MATCH (s:Summary {uuid: $uuid})
       SET s.embedding = $embedding`,
      { uuid: summaryUuid, embedding }
    );
  }

  async getTotalSummaryChars(conversationId: string, level: number): Promise<number> {
    const summaries = await this.getSummaries(conversationId, level);
    return summaries.reduce((total, s) => total + s.summary_char_count, 0);
  }

  // ==========================================================================
  // Context Building
  // ==========================================================================

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
          timestamp: props.timestamp,
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
}
