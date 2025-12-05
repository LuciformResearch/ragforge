/**
 * Gemini Native Tool Calling Provider
 *
 * Uses LangChain's conversion logic to handle tool calling natively with Gemini API.
 * Bypasses LangChain's message system and uses our own simple Message format.
 */

import { GoogleGenerativeAI, type Content, type Part } from "@google/generative-ai";
import { convertToolsToGenAI } from "../converters/gemini.js";
import { v4 as uuidv4 } from "uuid";
import type {
  NativeToolCallingProvider,
  ToolDefinition,
  ToolCall,
  ToolChoice,
  LLMToolResponse,
  Message,
  UsageMetadata,
} from "../types.js";

export interface GeminiNativeToolConfig {
  apiKey: string;
  model: string;
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  topK?: number;
}

export class GeminiNativeToolProvider implements NativeToolCallingProvider {
  private client: GoogleGenerativeAI;
  private modelName: string;
  private defaultTemperature?: number;
  private defaultMaxTokens?: number;
  private defaultTopP?: number;
  private defaultTopK?: number;

  constructor(config: GeminiNativeToolConfig) {
    this.client = new GoogleGenerativeAI(config.apiKey);
    this.modelName = config.model;
    this.defaultTemperature = config.temperature;
    this.defaultMaxTokens = config.maxOutputTokens;
    this.defaultTopP = config.topP;
    this.defaultTopK = config.topK;
  }

  getProviderName(): string {
    return "gemini";
  }

  supportsNativeToolCalling(): boolean {
    return true;
  }

  async generateWithTools(
    messages: Message[],
    tools: ToolDefinition[],
    options?: {
      toolChoice?: ToolChoice;
      temperature?: number;
      maxTokens?: number;
    }
  ): Promise<LLMToolResponse> {
    const model = this.client.getGenerativeModel({
      model: this.modelName,
      generationConfig: {
        temperature: options?.temperature ?? this.defaultTemperature,
        maxOutputTokens: options?.maxTokens ?? this.defaultMaxTokens,
        topP: this.defaultTopP,
        topK: this.defaultTopK,
      },
    });

    // Convert tools to Gemini format using our conversion
    const { tools: geminiTools, toolConfig } = convertToolsToGenAI(tools, {
      toolChoice: options?.toolChoice as any,
    });

    // Convert our simple messages to Gemini Content format
    const contents = this.convertMessagesToGeminiFormat(messages);

    // Call Gemini API
    const response = await model.generateContent({
      contents,
      tools: geminiTools as any,
      toolConfig: toolConfig as any,
    });

    // Parse response
    return this.parseGeminiResponse(response.response);
  }

  async *streamWithTools(
    messages: Message[],
    tools: ToolDefinition[],
    options?: {
      toolChoice?: ToolChoice;
      temperature?: number;
      maxTokens?: number;
    }
  ): AsyncGenerator<LLMToolResponse> {
    const model = this.client.getGenerativeModel({
      model: this.modelName,
      generationConfig: {
        temperature: options?.temperature ?? this.defaultTemperature,
        maxOutputTokens: options?.maxTokens ?? this.defaultMaxTokens,
        topP: this.defaultTopP,
        topK: this.defaultTopK,
      },
    });

    // Convert tools to Gemini format
    const { tools: geminiTools, toolConfig } = convertToolsToGenAI(tools, {
      toolChoice: options?.toolChoice as any,
    });

    // Convert messages
    const contents = this.convertMessagesToGeminiFormat(messages);

    // Stream from Gemini
    const result = await model.generateContentStream({
      contents,
      tools: geminiTools as any,
      toolConfig: toolConfig as any,
    });

    let accumulatedText = "";
    let accumulatedToolCalls: ToolCall[] = [];

    for await (const chunk of result.stream) {
      const parsed = this.parseGeminiResponse(chunk);

      // Accumulate text
      if (parsed.content) {
        accumulatedText += parsed.content;
      }

      // Accumulate tool calls
      if (parsed.toolCalls) {
        accumulatedToolCalls = parsed.toolCalls;
      }

      yield {
        content: accumulatedText,
        toolCalls: accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
        usage: parsed.usage,
        finishReason: parsed.finishReason,
      };
    }
  }

  /**
   * Convert our simple Message format to Gemini Content format
   */
  private convertMessagesToGeminiFormat(messages: Message[]): Content[] {
    const contents: Content[] = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        // Gemini doesn't support system messages directly
        // Merge with next user message or convert to user message
        contents.push({
          role: "user",
          parts: [{ text: `[System]: ${msg.content}` }],
        });
        continue;
      }

      if (msg.role === "user") {
        contents.push({
          role: "user",
          parts: [{ text: msg.content }],
        });
        continue;
      }

      if (msg.role === "agent") {
        const parts: Part[] = [];

        // Add text content
        if (msg.content) {
          parts.push({ text: msg.content });
        }

        // Add tool calls
        if (msg.toolCalls) {
          parts.push(
            ...msg.toolCalls.map((tc) => ({
              functionCall: {
                name: tc.function.name,
                args: JSON.parse(tc.function.arguments),
              },
            }))
          );
        }

        contents.push({
          role: "model",
          parts,
        });
        continue;
      }

      if (msg.role === "tool") {
        // Tool response message
        contents.push({
          role: "function",
          parts: [
            {
              functionResponse: {
                name: msg.name ?? "unknown",
                response: {
                  result: msg.content,
                },
              },
            },
          ],
        });
        continue;
      }
    }

    return contents;
  }

  /**
   * Parse Gemini response to our LLMToolResponse format
   */
  private parseGeminiResponse(response: any): LLMToolResponse {
    // Extract text content
    let content = "";
    const candidates = response.candidates || [];

    if (candidates.length > 0) {
      const candidate = candidates[0];
      const parts = candidate.content?.parts || [];

      for (const part of parts) {
        if (part.text) {
          content += part.text;
        }
      }
    }

    // Extract tool calls
    let toolCalls: ToolCall[] | undefined;
    const functionCalls = response.functionCalls?.() || [];

    if (functionCalls.length > 0) {
      toolCalls = functionCalls.map((fc: any) => ({
        id: fc.id || uuidv4(),
        type: "function" as const,
        function: {
          name: fc.name,
          arguments: JSON.stringify(fc.args || {}),
        },
      }));
    }

    // Extract usage metadata
    let usage: UsageMetadata | undefined;
    if (response.usageMetadata) {
      usage = {
        input_tokens: response.usageMetadata.promptTokenCount || 0,
        output_tokens: response.usageMetadata.candidatesTokenCount || 0,
        total_tokens: response.usageMetadata.totalTokenCount || 0,
      };
    }

    // Extract finish reason
    const finishReason = candidates[0]?.finishReason;

    return {
      content,
      toolCalls,
      usage,
      finishReason,
    };
  }
}
