/**
 * Native Tool Calling Types
 *
 * OpenAI-style tool definitions used as the standard format.
 * Compatible with OpenAI, Anthropic, and convertible to Gemini.
 */

/**
 * OpenAI-style tool definition (industry standard)
 */
export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>; // JSON Schema
  };
}

/**
 * Tool call returned by LLM
 */
export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

/**
 * Tool choice option
 */
export type ToolChoice =
  | "auto" // LLM decides
  | "any" // Must call at least one tool
  | "none" // Don't call any tools
  | { type: "function"; function: { name: string } }; // Specific tool

/**
 * Usage metadata
 */
export interface UsageMetadata {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

/**
 * LLM response with tool calls
 */
export interface LLMToolResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage?: UsageMetadata;
  finishReason?: string;
}

/**
 * Message format (simple, not tied to LangChain)
 */
export interface Message {
  role: "user" | "agent" | "system" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string; // For tool response messages
  name?: string; // Tool name for tool response messages
}

/**
 * Native tool calling provider interface
 */
export interface NativeToolCallingProvider {
  /**
   * Generate with native tool calling support
   */
  generateWithTools(
    messages: Message[],
    tools: ToolDefinition[],
    options?: {
      toolChoice?: ToolChoice;
      temperature?: number;
      maxTokens?: number;
    }
  ): Promise<LLMToolResponse>;

  /**
   * Stream with native tool calling support
   */
  streamWithTools(
    messages: Message[],
    tools: ToolDefinition[],
    options?: {
      toolChoice?: ToolChoice;
      temperature?: number;
      maxTokens?: number;
    }
  ): AsyncGenerator<LLMToolResponse>;

  /**
   * Get provider name
   */
  getProviderName(): string;

  /**
   * Check if native tool calling is supported
   */
  supportsNativeToolCalling(): boolean;
}
