/**
 * Generic Chat Types
 *
 * These types are domain-agnostic and work with any RagForge configuration.
 */

/**
 * Chat session
 */
export interface ChatSession {
  sessionId: string;
  title: string;
  domain?: string;              // Optional: 'code', 'products', 'documents', etc.
  createdAt: Date;
  lastActiveAt: Date;
  metadata?: Record<string, any>;
}

/**
 * Message in a chat session
 */
export interface Message {
  messageId: string;
  sessionId: string;
  content: string;
  role: 'user' | 'agent' | 'system';
  sentBy: string;               // User ID or Agent ID
  timestamp: Date;
  tokens?: number;
  toolCalls?: ToolCall[];
  tool_feedback?: ToolFeedback; // Feedback about tool usage (when debug mode enabled)
  metadata?: Record<string, any>;
}

/**
 * Tool call made by an agent
 */
export interface ToolCall {
  toolName: string;
  arguments: Record<string, any>;
  result?: any;
}

/**
 * Agent configuration
 */
export interface AgentConfig {
  id: string;
  name: string;
  domain?: string;              // Optional: for organization
  model: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt: string;
  tools: string[];              // Tool names (auto-generated from client)
  metadata?: Record<string, any>;

  /**
   * Final response configuration (optional)
   * Generate a structured response after tool loop completes
   * Use cases: feedback, analysis, summary, report generation, etc.
   */
  finalResponse?: {
    /** Schema for the final structured response */
    schema: any; // OutputSchema from StructuredLLMExecutor
    /** Prompt explaining what to include in the final response */
    prompt: string;
    /** Output format (default: 'xml') */
    format?: 'json' | 'xml' | 'yaml';
    /** Field name in Message where response will be stored (default: 'metadata.finalResponse') */
    fieldName?: string;
  };

  /**
   * Debug mode configuration (optional)
   * Enables tool feedback and verbose logging
   * Uses finalResponse internally with a predefined feedback schema
   */
  debug?: AgentDebugConfig;
}

/**
 * Debug mode configuration for agents
 */
export interface AgentDebugConfig {
  /** Enable debug mode */
  enabled: boolean;

  /** Tool feedback options */
  tool_feedback?: {
    /** Enable tool feedback generation */
    enabled: boolean;
    /** Include reasoning for tool choices */
    include_reasoning?: boolean;
    /** Include limitations encountered */
    include_limitations?: boolean;
    /** Include suggestions for improvements */
    include_suggestions?: boolean;
    /** Include alternative approaches */
    include_alternatives?: boolean;
  };

  /** Enable verbose logging */
  verbose_logging?: boolean;

  /** Track performance metrics */
  track_performance?: boolean;
}

/**
 * Tool definition
 */
export interface Tool {
  name: string;
  description: string;
  parameters: ToolParameter[];
  execute: (args: Record<string, any>) => Promise<any>;
  domain?: string;
  /**
   * Full JSON Schema for parameters (optional, for advanced tool definitions)
   * If provided, this will be used instead of `parameters` for native tool calling
   */
  inputSchema?: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

/**
 * Tool parameter definition
 */
export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required: boolean;
  default?: any;
}

/**
 * Context window for LLM
 */
export interface ContextWindow {
  messages: Message[];
  summaries?: any[];
  totalTokens: number;
}

/**
 * Tool feedback (generated when debug mode enabled)
 * Provides insights into tool usage, limitations, and suggestions
 */
export interface ToolFeedback {
  /** Tools that were actually used */
  tools_used: ToolUsageInfo[];

  /** Tools that were considered but not used */
  tools_considered?: ToolConsideredInfo[];

  /** Limitations encountered during execution */
  limitations?: ToolLimitation[];

  /** Suggestions for improving tool capabilities */
  suggestions?: ToolSuggestion[];

  /** Alternative approaches considered */
  alternatives?: AlternativeApproach[];

  /** Self-assessment of answer quality */
  answer_quality: AnswerQuality;
}

/**
 * Information about a tool that was used
 */
export interface ToolUsageInfo {
  /** Tool name */
  name: string;

  /** Why this tool was chosen */
  purpose: string;

  /** Whether execution succeeded */
  success: boolean;

  /** Quality of results (optional) */
  result_quality?: 'excellent' | 'good' | 'partial' | 'failed';
}

/**
 * Information about a tool that was considered but not used
 */
export interface ToolConsideredInfo {
  /** Tool name */
  name: string;

  /** Why it wasn't used */
  reason_not_used: string;
}

/**
 * A limitation encountered during execution
 */
export interface ToolLimitation {
  /** Description of the limitation */
  description: string;

  /** Impact severity */
  impact: 'critical' | 'high' | 'medium' | 'low';

  /** Type of missing capability */
  missing_capability?: 'tool' | 'field' | 'operator' | 'relationship';
}

/**
 * Suggestion for improving tool capabilities
 */
export interface ToolSuggestion {
  /** Type of suggestion */
  type: 'new_tool' | 'expose_field' | 'add_relationship' | 'improve_existing';

  /** Priority of this suggestion */
  priority: 'critical' | 'high' | 'medium' | 'low';

  /** Human-readable description */
  description: string;

  /** Specification for a new tool (if type=new_tool) */
  tool_spec?: {
    name: string;
    purpose: string;
    parameters: string[];
  };

  /** Config change needed (if type=expose_field) */
  config_change?: {
    entity: string;
    change: string;
    example: string;
  };
}

/**
 * Alternative approach that could be taken
 */
export interface AlternativeApproach {
  /** Description of the approach */
  approach: string;

  /** Advantages of this approach */
  pros: string[];

  /** Disadvantages of this approach */
  cons: string[];

  /** What would be required to use this approach */
  requires?: string[];
}

/**
 * Self-assessment of answer quality
 */
export interface AnswerQuality {
  /** How complete is the answer (0-100%) */
  completeness: number;

  /** Confidence in the answer (0-100%) */
  confidence: number;

  /** Additional notes */
  notes?: string;
}
