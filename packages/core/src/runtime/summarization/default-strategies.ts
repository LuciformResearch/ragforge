/**
 * Default Summarization Strategies
 *
 * Built-in strategies for common use cases.
 * Users can override these or add custom strategies via config.
 */

import type { StructuredPromptConfig } from '../llm/structured-prompt-builder.js';

/**
 * Strategy definition for summarization
 */
export interface SummaryStrategy {
  /** Strategy identifier */
  id: string;

  /** Human-readable name */
  name: string;

  /** Description of what this strategy does */
  description: string;

  /** Structured prompt configuration */
  promptConfig: StructuredPromptConfig;

  /** Recommended threshold (chars) above which to summarize */
  recommendedThreshold: number;
}

/**
 * Code Analysis Strategy
 *
 * Analyzes source code to extract:
 * - Purpose and functionality
 * - Key operations and algorithms
 * - Dependencies and APIs used
 * - Programming concepts
 * - Improvement suggestions
 * - Code quality issues
 */
export const CODE_ANALYSIS_STRATEGY: SummaryStrategy = {
  id: 'code_analysis',
  name: 'Code Analysis',
  description: 'Comprehensive code analysis with improvement suggestions',
  recommendedThreshold: 500,

  promptConfig: {
    systemContext: `You are an expert code analyst. You analyze code to extract structured information for semantic search and code understanding.

Your analysis must be:
- Accurate: Only describe what the code actually does
- Specific: Use concrete names, APIs, patterns from the code
- Actionable: Provide specific, implementable suggestions
- Concise: Keep descriptions brief but informative`,

    userTask: `Analyze the following code and extract key information.

{{#if entity_name}}Code context: {{entity_type}} "{{entity_name}}" from {{entity_file}}{{/if}}

Code to analyze:
{{field_value}}`,

    outputFormat: {
      rootElement: 'analysis',
      fields: [
        {
          name: 'purpose',
          type: 'string',
          description: 'What the code does (1-2 sentences, high-level purpose)',
          required: true
        },
        {
          name: 'operation',
          type: 'array',
          description: 'Key operations or algorithms used (3-5 items max)'
        },
        {
          name: 'dependency',
          type: 'array',
          description: 'Important dependencies, APIs, or libraries called'
        },
        {
          name: 'concept',
          type: 'array',
          description: 'Programming concepts (e.g., "authentication", "caching", "validation", "async I/O")'
        },
        {
          name: 'input',
          type: 'string',
          description: 'What the code takes as input (parameters, data sources)'
        },
        {
          name: 'output',
          type: 'string',
          description: 'What the code produces or returns'
        },
        {
          name: 'complexity',
          type: 'string',
          description: 'Code complexity level: "simple", "moderate", "complex", or "very complex"'
        },
        {
          name: 'suggestion',
          type: 'array',
          description: 'Specific improvement suggestions (code quality, performance, security, maintainability)'
        }
      ]
    },

    instructions: `Focus on extracting facts from the code, not assumptions.

For suggestions, identify:
- Code smells (long functions, deep nesting, duplicated code)
- Performance issues (unnecessary loops, inefficient algorithms)
- Security concerns (SQL injection risk, XSS vulnerabilities, hardcoded secrets)
- Maintainability (unclear naming, missing error handling, lack of documentation)
- Best practices not followed

Each suggestion must be:
- Specific to this code
- Actionable (developer can implement it)
- Brief (one sentence)`
  }
};

/**
 * Text Extraction Strategy
 *
 * Extracts key information from generic text:
 * - Main topic
 * - Keywords
 * - Named entities mentioned
 */
export const TEXT_EXTRACTION_STRATEGY: SummaryStrategy = {
  id: 'text_extraction',
  name: 'Text Extraction',
  description: 'Extract keywords and topics from text',
  recommendedThreshold: 300,

  promptConfig: {
    systemContext: `You extract structured information from text for semantic search.

Focus on:
- Main topic or subject
- Important keywords (nouns, verbs, technical terms)
- Named entities (people, places, products, technologies)`,

    userTask: `Extract key information from this text:

{{field_value}}`,

    outputFormat: {
      rootElement: 'extraction',
      fields: [
        {
          name: 'main_topic',
          type: 'string',
          description: 'The primary topic or subject (1 sentence)',
          required: true
        },
        {
          name: 'keyword',
          type: 'array',
          description: 'Important keywords and technical terms (5-10 items)'
        },
        {
          name: 'entity',
          type: 'array',
          description: 'Named entities mentioned (people, products, technologies, places)'
        },
        {
          name: 'category',
          type: 'string',
          description: 'Content category or type'
        }
      ]
    },

    instructions: `Extract only information that is explicitly present in the text.
Do not infer or add information that is not there.`
  }
};

/**
 * Document Summary Strategy
 *
 * Summarizes long documents:
 * - Main points
 * - Topics covered
 * - Key takeaways
 */
export const DOCUMENT_SUMMARY_STRATEGY: SummaryStrategy = {
  id: 'document_summary',
  name: 'Document Summary',
  description: 'Summarize long documents and articles',
  recommendedThreshold: 1000,

  promptConfig: {
    systemContext: `You create concise summaries of documents for semantic search and quick understanding.

Focus on:
- Main points and key takeaways
- Topics and themes covered
- Important entities and references`,

    userTask: `Summarize this document:

{{#if entity_name}}Document: {{entity_name}}{{/if}}

Content:
{{field_value}}`,

    outputFormat: {
      rootElement: 'summary',
      fields: [
        {
          name: 'overview',
          type: 'string',
          description: 'Brief overview of the document (2-3 sentences)',
          required: true
        },
        {
          name: 'main_point',
          type: 'array',
          description: 'Key points or arguments (3-5 items)'
        },
        {
          name: 'topic',
          type: 'array',
          description: 'Main topics or themes discussed'
        },
        {
          name: 'key_entity',
          type: 'array',
          description: 'Important entities, technologies, or references mentioned'
        },
        {
          name: 'takeaway',
          type: 'string',
          description: 'Main takeaway or conclusion'
        }
      ]
    }
  }
};

/**
 * Product Features Strategy
 *
 * Analyzes product descriptions:
 * - Key features
 * - Use cases
 * - Target audience
 */
export const PRODUCT_FEATURES_STRATEGY: SummaryStrategy = {
  id: 'product_features',
  name: 'Product Features',
  description: 'Extract features and use cases from product descriptions',
  recommendedThreshold: 300,

  promptConfig: {
    systemContext: `You analyze product descriptions to extract structured information for e-commerce search.

Focus on:
- Key features and capabilities
- Primary use cases
- Target audience or customer type`,

    userTask: `Analyze this product description:

{{#if entity_name}}Product: {{entity_name}}{{/if}}
{{#if entity_category}}Category: {{entity_category}}{{/if}}

Description:
{{field_value}}`,

    outputFormat: {
      rootElement: 'product_analysis',
      fields: [
        {
          name: 'summary',
          type: 'string',
          description: 'One-sentence product summary',
          required: true
        },
        {
          name: 'feature',
          type: 'array',
          description: 'Key features or capabilities (5-10 items)'
        },
        {
          name: 'use_case',
          type: 'array',
          description: 'Primary use cases or applications'
        },
        {
          name: 'target_audience',
          type: 'string',
          description: 'Who this product is for'
        },
        {
          name: 'benefit',
          type: 'array',
          description: 'Main benefits or value propositions'
        }
      ]
    }
  }
};

/**
 * Get all default strategies as a map
 */
export function getDefaultStrategies(): Map<string, SummaryStrategy> {
  return new Map([
    [CODE_ANALYSIS_STRATEGY.id, CODE_ANALYSIS_STRATEGY],
    [TEXT_EXTRACTION_STRATEGY.id, TEXT_EXTRACTION_STRATEGY],
    [DOCUMENT_SUMMARY_STRATEGY.id, DOCUMENT_SUMMARY_STRATEGY],
    [PRODUCT_FEATURES_STRATEGY.id, PRODUCT_FEATURES_STRATEGY]
  ]);
}

/**
 * Get a strategy by ID
 */
export function getStrategy(id: string): SummaryStrategy | undefined {
  return getDefaultStrategies().get(id);
}

/**
 * List all available strategy IDs
 */
export function listStrategyIds(): string[] {
  return Array.from(getDefaultStrategies().keys());
}
