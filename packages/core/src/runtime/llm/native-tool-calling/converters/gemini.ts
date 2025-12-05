/**
 * Gemini Tool Conversion
 *
 * Adapted from LangChain.js (@langchain/google-genai)
 * Converts OpenAI-style tools to Gemini format
 */

import type { ToolDefinition } from '../types.js';

// Gemini types (from @google/generative-ai)
export interface FunctionDeclaration {
  name: string;
  description?: string;
  parameters?: FunctionDeclarationSchema;
}

export interface FunctionDeclarationSchema {
  type: string;
  properties?: Record<string, any>;
  required?: string[];
  items?: any;
  [key: string]: any;
}

export interface FunctionDeclarationsTool {
  functionDeclarations: FunctionDeclaration[];
}

export type GenerativeAITool = FunctionDeclarationsTool;

export interface ToolConfig {
  functionCallingConfig: {
    mode: "AUTO" | "ANY" | "NONE";
    allowedFunctionNames?: string[];
  };
}

export type ToolChoice = "auto" | "any" | "none" | string;

/**
 * Convert OpenAI-style tools to Gemini format
 *
 * Adapted from LangChain's convertToolsToGenAI function
 */
export function convertToolsToGenAI(
  tools: ToolDefinition[],
  extra?: {
    toolChoice?: ToolChoice;
    allowedFunctionNames?: string[];
  }
): {
  tools: GenerativeAITool[];
  toolConfig?: ToolConfig;
} {
  // Convert to function declarations
  const functionDeclarations: FunctionDeclaration[] = tools.map(tool => ({
    name: tool.function.name,
    description: tool.function.description,
    parameters: removeAdditionalProperties(
      tool.function.parameters
    ) as FunctionDeclarationSchema,
  }));

  const genAITools: GenerativeAITool[] = [
    {
      functionDeclarations,
    },
  ];

  // Create tool config
  const toolConfig = createToolConfig(genAITools, extra);

  return { tools: genAITools, toolConfig };
}

/**
 * Remove additionalProperties from JSON schema (Gemini doesn't support it)
 */
function removeAdditionalProperties(schema: Record<string, any>): Record<string, any> {
  if (typeof schema !== 'object' || schema === null) {
    return schema;
  }

  const result: Record<string, any> = {};

  for (const [key, value] of Object.entries(schema)) {
    if (key === 'additionalProperties') {
      continue; // Skip this property
    }

    if (typeof value === 'object' && value !== null) {
      if (Array.isArray(value)) {
        result[key] = value.map(item =>
          typeof item === 'object' ? removeAdditionalProperties(item) : item
        );
      } else {
        result[key] = removeAdditionalProperties(value);
      }
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Create tool config for function calling mode
 */
function createToolConfig(
  genAITools: GenerativeAITool[],
  extra?: {
    toolChoice?: ToolChoice;
    allowedFunctionNames?: string[];
  }
): ToolConfig | undefined {
  if (!genAITools.length || !extra) return undefined;

  const { toolChoice, allowedFunctionNames } = extra;

  const modeMap: Record<string, "AUTO" | "ANY" | "NONE"> = {
    any: "ANY",
    auto: "AUTO",
    none: "NONE",
  };

  if (toolChoice && ["any", "auto", "none"].includes(toolChoice as string)) {
    return {
      functionCallingConfig: {
        mode: modeMap[toolChoice as keyof typeof modeMap] ?? "AUTO",
        allowedFunctionNames,
      },
    };
  }

  if (typeof toolChoice === "string" || allowedFunctionNames) {
    return {
      functionCallingConfig: {
        mode: "ANY",
        allowedFunctionNames: [
          ...(allowedFunctionNames ?? []),
          ...(toolChoice && typeof toolChoice === "string" ? [toolChoice] : []),
        ],
      },
    };
  }

  return undefined;
}
