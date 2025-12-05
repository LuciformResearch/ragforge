/**
 * Generic Chat Session Manager
 *
 * Manages chat sessions for ANY domain configured in RagForge.
 * Works with code, products, documents, or any custom entities.
 */

import type { Neo4jClient } from '../client/neo4j-client.js';
import type { ChatSession, Message } from '../types/chat.js';
import { v4 as uuidv4 } from 'uuid';

export interface CreateSessionOptions {
  title: string;
  domain?: string;              // Optional: 'code', 'products', etc.
  metadata?: Record<string, any>;
}

export class ChatSessionManager {
  constructor(private neo4j: Neo4jClient) {}

  /**
   * Create a new chat session (generic, works for any domain)
   */
  async createSession(options: CreateSessionOptions): Promise<ChatSession> {
    const sessionId = uuidv4();
    const now = new Date();

    await this.neo4j.run(
      `
      CREATE (s:ChatSession {
        sessionId: $sessionId,
        title: $title,
        domain: $domain,
        createdAt: datetime($createdAt),
        lastActiveAt: datetime($createdAt),
        metadata: $metadata
      })
    `,
      {
        sessionId,
        title: options.title,
        domain: options.domain || 'generic',
        createdAt: now.toISOString(),
        metadata: options.metadata || {},
      }
    );

    return {
      sessionId,
      title: options.title,
      domain: options.domain,
      createdAt: now,
      lastActiveAt: now,
      metadata: options.metadata,
    };
  }

  /**
   * Get a session by ID
   */
  async getSession(sessionId: string): Promise<ChatSession | null> {
    const result = await this.neo4j.run(
      `
      MATCH (s:ChatSession {sessionId: $sessionId})
      RETURN s
    `,
      { sessionId }
    );

    if (result.records.length === 0) return null;

    const node = result.records[0].get('s');
    return this.deserializeSession(node);
  }

  /**
   * Add a message to a session
   */
  async addMessage(message: Message): Promise<void> {
    // Store message
    await this.neo4j.run(
      `
      MATCH (s:ChatSession {sessionId: $sessionId})
      CREATE (m:Message {
        messageId: $messageId,
        sessionId: $sessionId,
        content: $content,
        role: $role,
        sentBy: $sentBy,
        timestamp: datetime($timestamp),
        tokens: $tokens,
        metadata: $metadata
      })
      CREATE (m)-[:IN_SESSION]->(s)
      SET s.lastActiveAt = datetime($timestamp)
    `,
      {
        messageId: message.messageId,
        sessionId: message.sessionId,
        content: message.content,
        role: message.role,
        sentBy: message.sentBy,
        timestamp: message.timestamp.toISOString(),
        tokens: message.tokens || 0,
        metadata: message.metadata || {},
      }
    );

    // Store tool calls if present
    if (message.toolCalls && message.toolCalls.length > 0) {
      await this.storeToolCalls(message.messageId, message.toolCalls);
    }
  }

  /**
   * Get messages from a session
   */
  async getMessages(
    sessionId: string,
    limit: number = 50
  ): Promise<Message[]> {
    const result = await this.neo4j.run(
      `
      MATCH (m:Message)-[:IN_SESSION]->(s:ChatSession {sessionId: $sessionId})
      OPTIONAL MATCH (m)-[:EXECUTED_TOOL]->(t:ToolCall)
      RETURN m, collect(t) as toolCalls
      ORDER BY m.timestamp DESC
      LIMIT $limit
    `,
      { sessionId, limit }
    );

    const messages = result.records.map((r) => {
      const node = r.get('m');
      const toolCalls = r
        .get('toolCalls')
        .filter((t: any) => t)
        .map((t: any) => ({
          toolName: t.properties.toolName,
          arguments: t.properties.arguments,
          result: t.properties.result,
        }));

      return this.deserializeMessage(node, toolCalls);
    });

    // Return oldest first
    return messages.reverse();
  }

  /**
   * List all sessions (optionally filtered by domain)
   */
  async listSessions(domain?: string): Promise<ChatSession[]> {
    const query = domain
      ? `MATCH (s:ChatSession {domain: $domain}) RETURN s ORDER BY s.lastActiveAt DESC`
      : `MATCH (s:ChatSession) RETURN s ORDER BY s.lastActiveAt DESC`;

    const result = await this.neo4j.run(query, domain ? { domain } : {});

    return result.records.map((r) => this.deserializeSession(r.get('s')));
  }

  /**
   * Delete a session and all its messages
   */
  async deleteSession(sessionId: string): Promise<void> {
    await this.neo4j.run(
      `
      MATCH (s:ChatSession {sessionId: $sessionId})
      OPTIONAL MATCH (m:Message)-[:IN_SESSION]->(s)
      OPTIONAL MATCH (m)-[:EXECUTED_TOOL]->(t:ToolCall)
      DETACH DELETE s, m, t
    `,
      { sessionId }
    );
  }

  /**
   * Store tool calls for a message
   */
  private async storeToolCalls(
    messageId: string,
    toolCalls: Array<{ toolName: string; arguments: any; result?: any }>
  ): Promise<void> {
    for (const tc of toolCalls) {
      await this.neo4j.run(
        `
        MATCH (m:Message {messageId: $messageId})
        CREATE (t:ToolCall {
          toolCallId: $toolCallId,
          messageId: $messageId,
          toolName: $toolName,
          arguments: $arguments,
          result: $result,
          executedAt: datetime($executedAt),
          status: $status
        })
        CREATE (m)-[:EXECUTED_TOOL]->(t)
      `,
        {
          messageId,
          toolCallId: uuidv4(),
          toolName: tc.toolName,
          arguments: tc.arguments,
          result: tc.result || {},
          executedAt: new Date().toISOString(),
          status: tc.result ? 'success' : 'pending',
        }
      );
    }
  }

  /**
   * Deserialize Neo4j node to ChatSession
   */
  private deserializeSession(node: any): ChatSession {
    return {
      sessionId: node.properties.sessionId,
      title: node.properties.title,
      domain: node.properties.domain,
      createdAt: new Date(node.properties.createdAt),
      lastActiveAt: new Date(node.properties.lastActiveAt),
      metadata: node.properties.metadata,
    };
  }

  /**
   * Deserialize Neo4j node to Message
   */
  private deserializeMessage(node: any, toolCalls: any[]): Message {
    return {
      messageId: node.properties.messageId,
      sessionId: node.properties.sessionId,
      content: node.properties.content,
      role: node.properties.role,
      sentBy: node.properties.sentBy,
      timestamp: new Date(node.properties.timestamp),
      tokens: node.properties.tokens,
      metadata: node.properties.metadata,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }
}
