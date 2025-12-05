// ============================================
// RagForge Chat - Generic Neo4j Schema
// ============================================
//
// This schema is domain-agnostic and works with ANY
// RagForge configuration (code, products, documents, etc.)
//

// ============================================
// Constraints
// ============================================

// Chat Sessions
CREATE CONSTRAINT chat_session_id IF NOT EXISTS
FOR (s:ChatSession) REQUIRE s.sessionId IS UNIQUE;

// Messages
CREATE CONSTRAINT message_id IF NOT EXISTS
FOR (m:Message) REQUIRE m.messageId IS UNIQUE;

// Agents
CREATE CONSTRAINT agent_id IF NOT EXISTS
FOR (a:Agent) REQUIRE a.agentId IS UNIQUE;

// Tool Calls
CREATE CONSTRAINT tool_call_id IF NOT EXISTS
FOR (t:ToolCall) REQUIRE t.toolCallId IS UNIQUE;

// ============================================
// Indexes
// ============================================

// Session indexes
CREATE INDEX chat_session_domain IF NOT EXISTS
FOR (s:ChatSession) ON (s.domain);

CREATE INDEX chat_session_last_active IF NOT EXISTS
FOR (s:ChatSession) ON (s.lastActiveAt);

// Message indexes
CREATE INDEX message_session IF NOT EXISTS
FOR (m:Message) ON (m.sessionId);

CREATE INDEX message_timestamp IF NOT EXISTS
FOR (m:Message) ON (m.timestamp);

CREATE INDEX message_role IF NOT EXISTS
FOR (m:Message) ON (m.role);

// Agent indexes
CREATE INDEX agent_domain IF NOT EXISTS
FOR (a:Agent) ON (a.domain);

// Tool call indexes
CREATE INDEX tool_call_message IF NOT EXISTS
FOR (t:ToolCall) ON (t.messageId);

CREATE INDEX tool_call_tool_name IF NOT EXISTS
FOR (t:ToolCall) ON (t.toolName);
