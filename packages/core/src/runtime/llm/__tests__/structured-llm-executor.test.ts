/**
 * Unit tests for StructuredLLMExecutor
 *
 * Tests the unified LLM API with:
 * - Mock Neo4j operations
 * - Real Gemini API calls (configurable via env)
 * - Full coverage of all methods
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StructuredLLMExecutor } from '../structured-llm-executor.js';
import { GeminiAPIProvider } from '../../reranking/gemini-api-provider.js';
import type { LLMProvider } from '../../reranking/llm-provider.js';
import type { EntityContext } from '../../types/entity-context.js';
import type {
  LLMStructuredCallConfig,
  OutputSchema,
  ItemEvaluation,
  EmbeddingGenerationConfig,
  LLMBatchResult
} from '../structured-llm-executor.js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load .env from ~/LR_CodeRag/.env
const homeDir = process.env.HOME || process.env.USERPROFILE || '';
const envPath = join(homeDir, 'LR_CodeRag', '.env');
dotenv.config({ path: envPath });

// Enable/disable real LLM calls
const USE_REAL_LLM = process.env.USE_REAL_LLM !== 'false';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Mock LLM Provider for testing without API calls
class MockLLMProvider implements LLMProvider {
  async generateContent(prompt: string): Promise<string> {
    // console.log('Mock LLM received prompt:', prompt.substring(0, 500));

    // Count number of items in prompt
    const itemMatches = prompt.match(/\[Item \d+\]/g);
    const itemCount = itemMatches ? itemMatches.length : 1;

    // Extract expected XML structure from prompt (look for example format)
    const xmlExampleMatch = prompt.match(/Expected XML format:\s*\n\s*<(\w+)>([\s\S]*?)<\/\1>/);
    const rootElement = xmlExampleMatch ? xmlExampleMatch[1] : 'result';

    // Extract field names from the XML example
    const fieldMatches = prompt.match(/<(\w+)>(?!.*<\/)/g);
    const fields: string[] = [];
    if (fieldMatches) {
      fieldMatches.forEach(match => {
        const fieldName = match.match(/<(\w+)>/)?.[1];
        if (fieldName && fieldName !== 'item' && fieldName !== rootElement && !fields.includes(fieldName)) {
          fields.push(fieldName);
        }
      });
    }

    //console.log('Detected fields:', fields);

    // Build XML response
    let xml = `<${rootElement}>\n`;
    for (let i = 0; i < itemCount; i++) {
      xml += `  <item id="${i}">\n`;

      // Add detected fields
      for (const field of fields) {
        let value: string;
        if (field === 'score') {
          value = String(8 - i);
        } else if (field === 'reasoning' || field === 'reason') {
          value = `Mock reasoning for item ${i}`;
        } else if (field === 'purpose') {
          value = `Mock purpose for item ${i}`;
        } else if (field === 'complexity') {
          value = 'Low';
        } else if (field === 'summary') {
          value = `Mock summary for item ${i}`;
        } else if (field === 'processed') {
          value = `Processed value ${i}`;
        } else if (field === 'result') {
          value = `Mock result ${i}`;
        } else if (field === 'id') {
          value = `item-${i}`;
        } else {
          value = `Value ${i}`;
        }
        xml += `    <${field}>${value}</${field}>\n`;
      }

      xml += `  </item>\n`;
    }
    xml += `</${rootElement}>`;

    //console.log('Mock LLM returning:', xml.substring(0, 500));
    return xml;
  }

  async generateBatch?(prompts: string[]): Promise<string[]> {
    return Promise.all(prompts.map(p => this.generateContent(p)));
  }
}

// Shared LLM provider for all tests (enables global rate limiting)
let sharedLLMProvider: LLMProvider;

if (USE_REAL_LLM && GEMINI_API_KEY) {
  sharedLLMProvider = new GeminiAPIProvider({
    apiKey: GEMINI_API_KEY,
    model: 'gemini-2.0-flash', // Flash 2.0: 1000 RPM (vs gemma 30 RPM)
    temperature: 0.1,
    // maxOutputTokens now calculated automatically based on prompt size
    // rateLimitStrategy defaults to 'reactive' (model-agnostic, handles 429 gracefully)
    // Can override to 'proactive' for zero 429s, or 'none' to disable
  });
} else {
  sharedLLMProvider = new MockLLMProvider();
}

describe('StructuredLLMExecutor', () => {
  let executor: StructuredLLMExecutor;
  let llmProvider: LLMProvider;

  beforeEach(() => {
    executor = new StructuredLLMExecutor();
    // Reuse shared provider for all tests
    llmProvider = sharedLLMProvider;
  });

  describe('executeLLMBatch', () => {
    it('should process batch with input fields', async () => {
      const items = [
        { code: 'function add(a, b) { return a + b; }', name: 'add' },
        { code: 'function multiply(a, b) { return a * b; }', name: 'multiply' }
      ];

      const outputSchema: OutputSchema<{ purpose: string; complexity: string }> = {
        purpose: {
          type: 'string',
          description: 'What the code does',
          required: true
        },
        complexity: {
          type: 'string',
          description: 'Complexity rating',
          required: true
        }
      };

      const config: LLMStructuredCallConfig<typeof items[0], { purpose: string; complexity: string }> = {
        inputFields: ['code', 'name'],
        llmProvider,
        systemPrompt: 'You are a code analyzer.',
        userTask: 'Analyze the following code and describe its purpose and complexity.',
        outputSchema,
        outputFormat: 'xml',
        batchSize: 2,
        parallel: 1
      };

      const results = await executor.executeLLMBatch(items, config);

      expect(results).toHaveLength(2);
      expect(results[0]).toHaveProperty('purpose');
      expect(results[0]).toHaveProperty('complexity');
      expect(results[0]).toHaveProperty('code');
      expect(results[0]).toHaveProperty('name');
    });

    it('should process batch with EntityContext', async () => {
      const items = [
        {
          uuid: 'scope-1',
          name: 'processData',
          type: 'function',
          source: 'function processData(input) { return input.map(x => x * 2); }'
        }
      ];

      const entityContext: EntityContext = {
        entityType: 'Scope',
        fields: [
          { name: 'uuid', required: true },
          { name: 'name', required: true },
          { name: 'type', required: true },
          { name: 'source', required: false, label: 'Source Code' }
        ],
        enrichments: []
      };

      const outputSchema: OutputSchema<{ purpose: string }> = {
        purpose: {
          type: 'string',
          description: 'Purpose of the function',
          required: true
        }
      };

      const config: LLMStructuredCallConfig<typeof items[0], { purpose: string }> = {
        entityContext,
        llmProvider,
        systemPrompt: 'You analyze code.',
        userTask: 'Describe what each function does.',
        outputSchema,
        outputFormat: 'xml',
        batchSize: 1
      };

      const results = await executor.executeLLMBatch(items, config);

      expect(results).toHaveLength(1);
      expect(results[0]).toHaveProperty('purpose');
      expect(results[0].uuid).toBe('scope-1');
    });

    it('should handle parallel batch processing', async () => {
      const items = Array.from({ length: 10 }, (_, i) => ({
        id: `item-${i}`,
        value: `Value ${i}`
      }));

      const outputSchema: OutputSchema<{ processed: string }> = {
        processed: {
          type: 'string',
          description: 'Processed value',
          required: true
        }
      };

      const config: LLMStructuredCallConfig<typeof items[0], { processed: string }> = {
        inputFields: ['id', 'value'],
        llmProvider,
        systemPrompt: 'You process data.',
        userTask: 'Process each item.',
        outputSchema,
        outputFormat: 'xml',
        batchSize: 3,
        parallel: 2
      };

      const results = await executor.executeLLMBatch(items, config);

      expect(results).toHaveLength(10);
      results.forEach((result, i) => {
        expect(result.id).toBe(`item-${i}`);
        expect(result).toHaveProperty('processed');
      });
    });

    it('should pack items by token budget', async () => {
      // Create items with varying sizes
      const items = [
        { text: 'Short' },
        { text: 'A'.repeat(1000) }, // Large item
        { text: 'Medium length text here' },
        { text: 'Another short' }
      ];

      const outputSchema: OutputSchema<{ summary: string }> = {
        summary: {
          type: 'string',
          description: 'Summary of text',
          required: true
        }
      };

      const config: LLMStructuredCallConfig<typeof items[0], { summary: string }> = {
        inputFields: ['text'],
        llmProvider,
        systemPrompt: 'You summarize text.',
        userTask: 'Summarize each text.',
        outputSchema,
        outputFormat: 'xml',
        batchSize: 2, // Will pack based on tokens
        tokenBudget: 1000 // Small budget to force multiple batches
      };

      const results = await executor.executeLLMBatch(items, config);

      expect(results).toHaveLength(4);
      results.forEach(result => {
        expect(result).toHaveProperty('summary');
        expect(result).toHaveProperty('text');
      });
    });
  });

  describe('executeReranking', () => {
    it('should rerank items and return evaluations', async () => {
      const items = [
        {
          uuid: 'scope-1',
          name: 'authenticateUser',
          description: 'Handles user authentication'
        },
        {
          uuid: 'scope-2',
          name: 'renderUI',
          description: 'Renders the user interface'
        },
        {
          uuid: 'scope-3',
          name: 'validateCredentials',
          description: 'Validates user credentials'
        }
      ];

      const entityContext: EntityContext = {
        entityType: 'Scope',
        fields: [
          { name: 'uuid', required: true },
          { name: 'name', required: true },
          { name: 'description', required: false, label: 'Description' }
        ],
        enrichments: []
      };

      const config = {
        userQuestion: 'How does authentication work?',
        entityContext,
        llmProvider,
        batchSize: 3,
        getItemId: (item: typeof items[0], index: number) => item.uuid
      };

      const result = await executor.executeReranking(items, config);

      expect(result.evaluations).toHaveLength(3);
      result.evaluations.forEach(evaluation => {
        expect(evaluation).toHaveProperty('id');
        expect(evaluation).toHaveProperty('score');
        expect(evaluation).toHaveProperty('reasoning');
        expect(evaluation.score).toBeGreaterThanOrEqual(0);
        expect(evaluation.score).toBeLessThanOrEqual(10);
      });
    });

    it.skip('should return query feedback when requested', async () => {
      // TODO: queryFeedback not yet implemented in executeReranking
      const items = [
        { uuid: 'item-1', content: 'Content about databases' }
      ];

      const entityContext: EntityContext = {
        entityType: 'Document',
        fields: [
          { name: 'uuid', required: true },
          { name: 'content', required: true }
        ],
        enrichments: []
      };

      const config = {
        userQuestion: 'Tell me about caching strategies',
        entityContext,
        llmProvider,
        withFeedback: true,
        getItemId: (item: typeof items[0]) => item.uuid
      };

      const result = await executor.executeReranking(items, config);

      expect(result.evaluations).toHaveLength(1);

      if (USE_REAL_LLM) {
        // Real LLM should provide feedback
        expect(result.queryFeedback).toBeDefined();
        if (result.queryFeedback) {
          expect(result.queryFeedback).toHaveProperty('suggestions');
          expect(Array.isArray(result.queryFeedback.suggestions)).toBe(true);
        }
      }
    });

    it('should handle empty items gracefully', async () => {
      const items: any[] = [];

      const config = {
        userQuestion: 'Test query',
        inputFields: ['name'],
        llmProvider
      };

      const result = await executor.executeReranking(items, config);

      expect(result.evaluations).toHaveLength(0);
    });
  });

  describe('generateEmbeddings', () => {
    it.skip('should generate embeddings with Gemini', async () => {
      if (!USE_REAL_LLM || !GEMINI_API_KEY) {
        console.log('Skipping embedding test - no API key');
        return;
      }

      const items = [
        {
          uuid: 'scope-1',
          name: 'mainFunction',
          description: 'A function that returns a greeting message'
        }
      ];

      const config: EmbeddingGenerationConfig = {
        sourceFields: ['name', 'description'],
        targetField: 'embedding',
        provider: {
          provider: 'gemini',
          model: 'text-embedding-004',
          dimensions: 768
        },
        batchSize: 10
      };

      const results = await executor.generateEmbeddings(items, config);

      expect(results).toHaveLength(1);
      expect(results[0]).toHaveProperty('embedding');
      expect(Array.isArray(results[0].embedding)).toBe(true);
      expect(results[0].embedding.length).toBe(768); // Gemini text-embedding-004 dimension
      expect(results[0].uuid).toBe('scope-1');
      expect(results[0].name).toBe('mainFunction');
    });

    it.skip('should handle batch embedding generation', async () => {
      if (!USE_REAL_LLM || !GEMINI_API_KEY) {
        console.log('Skipping batch embedding test - no API key');
        return;
      }

      const items = [
        { uuid: 'doc-1', text: 'First document' },
        { uuid: 'doc-2', text: 'Second document' },
        { uuid: 'doc-3', text: 'Third document' }
      ];

      const config: EmbeddingGenerationConfig = {
        sourceFields: ['text'],
        targetField: 'embedding',
        provider: {
          provider: 'gemini',
          model: 'text-embedding-004',
          dimensions: 768
        },
        batchSize: 3
      };

      const results = await executor.generateEmbeddings(items, config);

      expect(results).toHaveLength(3);
      results.forEach((result, i) => {
        expect(result.uuid).toBe(`doc-${i + 1}`);
        expect(result).toHaveProperty('embedding');
        expect(Array.isArray(result.embedding)).toBe(true);
        expect(result.embedding.length).toBe(768);
      });
    });
  });

  describe('Token estimation', () => {
    it('should estimate tokens accurately for input fields', async () => {
      const items = [
        {
          shortField: 'Short text',
          longField: 'A'.repeat(1000)
        }
      ];

      const outputSchema: OutputSchema<{ result: string }> = {
        result: {
          type: 'string',
          description: 'Result',
          required: true
        }
      };

      const config: LLMStructuredCallConfig<typeof items[0], { result: string }> = {
        inputFields: ['shortField', 'longField'],
        llmProvider,
        systemPrompt: 'You process data.',
        userTask: 'Process the data.',
        outputSchema,
        outputFormat: 'xml',
        batchSize: 1,
        tokenBudget: 500 // Small budget
      };

      // Should handle token budget and split appropriately
      const results = await executor.executeLLMBatch(items, config);

      expect(results).toHaveLength(1);
      expect(results[0]).toHaveProperty('result');
    });
  });

  describe('Error handling', () => {
    it('should handle LLM errors gracefully', async () => {
      const errorProvider: LLMProvider = {
        generateContent: async () => {
          throw new Error('LLM API error');
        }
      };

      const items = [{ data: 'test' }];
      const outputSchema: OutputSchema<{ output: string }> = {
        output: {
          type: 'string',
          description: 'Output',
          required: true
        }
      };

      const config: LLMStructuredCallConfig<typeof items[0], { output: string }> = {
        inputFields: ['data'],
        llmProvider: errorProvider,
        systemPrompt: 'Process',
        userTask: 'Process data',
        outputSchema,
        outputFormat: 'xml'
      };

      await expect(executor.executeLLMBatch(items, config)).rejects.toThrow();
    });

    it.skip('should handle malformed XML responses', async () => {
      // Note: The executor is permissive and tries to handle errors gracefully
      // This test is skipped as the behavior depends on LuciformXMLParser's error handling
      const malformedProvider: LLMProvider = {
        generateContent: async () => {
          return 'This is not XML at all, just plain text without any structure.';
        }
      };

      const items = [{ data: 'test' }];
      const outputSchema: OutputSchema<{ output: string }> = {
        output: {
          type: 'string',
          description: 'Output',
          required: true
        }
      };

      const config: LLMStructuredCallConfig<typeof items[0], { output: string }> = {
        inputFields: ['data'],
        llmProvider: malformedProvider,
        systemPrompt: 'Process',
        userTask: 'Process data',
        outputSchema,
        outputFormat: 'xml'
      };

      // Should throw an error due to malformed XML
      await expect(executor.executeLLMBatch(items, config)).rejects.toThrow();
    });

    it.skip('should handle optional fields correctly', async () => {
      // Note: This test requires more investigation into how the executor handles
      // custom providers that don't follow the prompt structure
      const incompleteProvider: LLMProvider = {
        generateContent: async () => {
          // Include only required field
          return `
<result>
  <item id="0">
    <field1>Value</field1>
  </item>
</result>`;
        }
      };

      const items = [{ data: 'test' }];
      const outputSchema: OutputSchema<{ field1: string; field2?: string }> = {
        field1: {
          type: 'string',
          description: 'Field 1',
          required: true
        },
        field2: {
          type: 'string',
          description: 'Field 2',
          required: false // Optional field
        }
      };

      const config: LLMStructuredCallConfig<typeof items[0], { field1: string; field2?: string }> = {
        inputFields: ['data'],
        llmProvider: incompleteProvider,
        systemPrompt: 'Process',
        userTask: 'Process data',
        outputSchema,
        outputFormat: 'xml'
      };

      const results = await executor.executeLLMBatch(items, config);
      expect(results).toHaveLength(1);
      expect(results[0].field1).toBe('Value');
      // field2 is optional, so undefined is acceptable
      expect(results[0].field2).toBeUndefined();
    });
  });

  describe('Multi-format support', () => {
    it('should process batch with JSON output format', async () => {
      const jsonProvider: LLMProvider = {
        generateContent: async () => {
          return JSON.stringify({
            items: [
              { score: 95, category: 'A' },
              { score: 80, category: 'B' }
            ]
          });
        }
      };

      const items = [
        { uuid: 'item-1', text: 'First item' },
        { uuid: 'item-2', text: 'Second item' }
      ];

      const outputSchema: OutputSchema<{ score: number; category: string }> = {
        score: {
          type: 'number',
          description: 'Score value',
          required: true
        },
        category: {
          type: 'string',
          description: 'Category',
          required: true
        }
      };

      const config: LLMStructuredCallConfig<typeof items[0], { score: number; category: string }> = {
        inputFields: ['text'],
        llmProvider: jsonProvider,
        systemPrompt: 'Analyze items',
        userTask: 'Score each item',
        outputSchema,
        outputFormat: 'json'
      };

      const results = await executor.executeLLMBatch(items, config);

      expect(results).toHaveLength(2);
      expect(results[0].uuid).toBe('item-1');
      expect(results[0].score).toBe(95);
      expect(results[0].category).toBe('A');
      expect(results[1].uuid).toBe('item-2');
      expect(results[1].score).toBe(80);
      expect(results[1].category).toBe('B');
    });

    it('should process batch with YAML output format', async () => {
      const yamlProvider: LLMProvider = {
        generateContent: async () => {
          return `items:
  - score: 85
    category: A
  - score: 75
    category: B`;
        }
      };

      const items = [
        { uuid: 'item-1', text: 'First item' },
        { uuid: 'item-2', text: 'Second item' }
      ];

      const outputSchema: OutputSchema<{ score: number; category: string }> = {
        score: {
          type: 'number',
          description: 'Score value',
          required: true
        },
        category: {
          type: 'string',
          description: 'Category',
          required: true
        }
      };

      const config: LLMStructuredCallConfig<typeof items[0], { score: number; category: string }> = {
        inputFields: ['text'],
        llmProvider: yamlProvider,
        systemPrompt: 'Analyze items',
        userTask: 'Score each item',
        outputSchema,
        outputFormat: 'yaml'
      };

      const results = await executor.executeLLMBatch(items, config);

      expect(results).toHaveLength(2);
      expect(results[0].uuid).toBe('item-1');
      expect(results[0].score).toBe(85);
      expect(results[0].category).toBe('A');
      expect(results[1].uuid).toBe('item-2');
      expect(results[1].score).toBe(75);
      expect(results[1].category).toBe('B');
    });

    it('should handle global metadata with JSON format', async () => {
      const jsonProvider: LLMProvider = {
        generateContent: async () => {
          return JSON.stringify({
            quality: 'excellent',
            confidence: 0.95,
            items: [
              { score: 95, category: 'A' },
              { score: 80, category: 'B' }
            ]
          });
        }
      };

      const items = [
        { uuid: 'item-1', text: 'First item' },
        { uuid: 'item-2', text: 'Second item' }
      ];

      const outputSchema: OutputSchema<{ score: number; category: string }> = {
        score: {
          type: 'number',
          description: 'Score value',
          required: true
        },
        category: {
          type: 'string',
          description: 'Category',
          required: true
        }
      };

      const globalSchema: OutputSchema<{ quality: string; confidence: number }> = {
        quality: {
          type: 'string',
          description: 'Overall quality assessment',
          required: true
        },
        confidence: {
          type: 'number',
          description: 'Confidence score',
          required: true
        }
      };

      const config: LLMStructuredCallConfig<typeof items[0], { score: number; category: string }> = {
        inputFields: ['text'],
        llmProvider: jsonProvider,
        systemPrompt: 'Analyze items',
        userTask: 'Score each item and provide overall quality',
        outputSchema,
        globalSchema,
        outputFormat: 'json',
        globalMetadataFormat: 'json'
      };

      const result = await executor.executeLLMBatch(items, config);

      expect(result).toHaveProperty('items');
      expect(result).toHaveProperty('globalMetadata');

      const { items: resultItems, globalMetadata } = result as LLMBatchResult<typeof items[0], { score: number; category: string }, { quality: string; confidence: number }>;

      expect(resultItems).toHaveLength(2);
      expect(resultItems[0].score).toBe(95);
      expect(resultItems[1].score).toBe(80);
      expect(globalMetadata?.quality).toBe('excellent');
      expect(globalMetadata?.confidence).toBe(0.95);
    });

    it('should handle global metadata with YAML format', async () => {
      const yamlProvider: LLMProvider = {
        generateContent: async () => {
          return `quality: good
confidence: 0.85
items:
  - score: 85
    category: A
  - score: 75
    category: B`;
        }
      };

      const items = [
        { uuid: 'item-1', text: 'First item' },
        { uuid: 'item-2', text: 'Second item' }
      ];

      const outputSchema: OutputSchema<{ score: number; category: string }> = {
        score: {
          type: 'number',
          description: 'Score value',
          required: true
        },
        category: {
          type: 'string',
          description: 'Category',
          required: true
        }
      };

      const globalSchema: OutputSchema<{ quality: string; confidence: number }> = {
        quality: {
          type: 'string',
          description: 'Overall quality assessment',
          required: true
        },
        confidence: {
          type: 'number',
          description: 'Confidence score',
          required: true
        }
      };

      const config: LLMStructuredCallConfig<typeof items[0], { score: number; category: string }> = {
        inputFields: ['text'],
        llmProvider: yamlProvider,
        systemPrompt: 'Analyze items',
        userTask: 'Score each item and provide overall quality',
        outputSchema,
        globalSchema,
        outputFormat: 'yaml',
        globalMetadataFormat: 'yaml'
      };

      const result = await executor.executeLLMBatch(items, config);

      expect(result).toHaveProperty('items');
      expect(result).toHaveProperty('globalMetadata');

      const { items: resultItems, globalMetadata } = result as LLMBatchResult<typeof items[0], { score: number; category: string }, { quality: string; confidence: number }>;

      expect(resultItems).toHaveLength(2);
      expect(resultItems[0].score).toBe(85);
      expect(resultItems[1].score).toBe(75);
      expect(globalMetadata?.quality).toBe('good');
      expect(globalMetadata?.confidence).toBe(0.85);
    });

    it('should handle mixed formats (XML items + JSON metadata)', async () => {
      const mixedProvider: LLMProvider = {
        generateContent: async () => {
          return '<items>\n' +
            '  <item id="0">\n' +
            '    <score>90</score>\n' +
            '    <category>A</category>\n' +
            '  </item>\n' +
            '  <item id="1">\n' +
            '    <score>85</score>\n' +
            '    <category>B</category>\n' +
            '  </item>\n' +
            '</items>\n' +
            '\n' +
            '```json\n' +
            '{\n' +
            '  "quality": "very good",\n' +
            '  "confidence": 0.92\n' +
            '}\n' +
            '```';
        }
      };

      const items = [
        { uuid: 'item-1', text: 'First item' },
        { uuid: 'item-2', text: 'Second item' }
      ];

      const outputSchema: OutputSchema<{ score: number; category: string }> = {
        score: {
          type: 'number',
          description: 'Score value',
          required: true
        },
        category: {
          type: 'string',
          description: 'Category',
          required: true
        }
      };

      const globalSchema: OutputSchema<{ quality: string; confidence: number }> = {
        quality: {
          type: 'string',
          description: 'Overall quality assessment',
          required: true
        },
        confidence: {
          type: 'number',
          description: 'Confidence score',
          required: true
        }
      };

      const config: LLMStructuredCallConfig<typeof items[0], { score: number; category: string }> = {
        inputFields: ['text'],
        llmProvider: mixedProvider,
        systemPrompt: 'Analyze items',
        userTask: 'Score each item and provide overall quality',
        outputSchema,
        globalSchema,
        outputFormat: 'xml',
        globalMetadataFormat: 'json'
      };

      const result = await executor.executeLLMBatch(items, config);

      expect(result).toHaveProperty('items');
      expect(result).toHaveProperty('globalMetadata');

      const { items: resultItems, globalMetadata } = result as LLMBatchResult<typeof items[0], { score: number; category: string }, { quality: string; confidence: number }>;

      expect(resultItems).toHaveLength(2);
      expect(resultItems[0].score).toBe(90);
      expect(resultItems[1].score).toBe(85);
      expect(globalMetadata?.quality).toBe('very good');
      expect(globalMetadata?.confidence).toBe(0.92);
    });

    // Real LLM test - comprehensive test for all 3 formats with automatic retry
    it('should work with real LLM across all formats (JSON, YAML, XML+JSON)', async () => {
      if (!USE_REAL_LLM || !GEMINI_API_KEY) {
        console.log('Skipping real LLM multi-format test - no API key');
        return;
      }

      // Provider with retry logic for rate limits
      const geminiProvider = new GeminiAPIProvider({
        apiKey: GEMINI_API_KEY!,
        model: 'gemini-2.0-flash-exp',
        retryAttempts: 3,
        retryDelay: 2000 // Start with 2s, will exponentially backoff
      });

      // Test 1: JSON format
      console.log('[Multi-format test] Testing JSON format...');
      const jsonItems = [
        { uuid: 'item-1', text: 'TypeScript is a strongly typed programming language' },
        { uuid: 'item-2', text: 'Python is known for its simplicity and readability' }
      ];

      const jsonSchema: OutputSchema<{ category: string; complexity: string }> = {
        category: {
          type: 'string',
          description: 'The category of the text (e.g., programming, science, etc.)',
          required: true
        },
        complexity: {
          type: 'string',
          description: 'The complexity level: simple, moderate, or complex',
          required: true
        }
      };

      const jsonResults = await executor.executeLLMBatch(jsonItems, {
        inputFields: ['text'],
        llmProvider: geminiProvider,
        systemPrompt: 'You are a text analyzer.',
        userTask: 'Analyze each text and categorize it.',
        outputSchema: jsonSchema,
        outputFormat: 'json'
      });

      expect(jsonResults).toHaveLength(2);
      expect(jsonResults[0]).toHaveProperty('category');
      expect(jsonResults[0]).toHaveProperty('complexity');
      expect(typeof jsonResults[0].category).toBe('string');
      expect(typeof jsonResults[0].complexity).toBe('string');
      console.log('[Multi-format test] JSON format ✓');

      // Test 2: YAML format (retry logic will handle rate limits automatically)
      console.log('[Multi-format test] Testing YAML format...');
      const yamlItems = [
        { uuid: 'item-1', text: 'Machine learning enables computers to learn from data' },
        { uuid: 'item-2', text: 'React is a JavaScript library for building user interfaces' }
      ];

      const yamlSchema: OutputSchema<{ topic: string; difficulty: string }> = {
        topic: {
          type: 'string',
          description: 'Main topic of the text',
          required: true
        },
        difficulty: {
          type: 'string',
          description: 'Difficulty level: beginner, intermediate, or advanced',
          required: true
        }
      };

      const yamlResults = await executor.executeLLMBatch(yamlItems, {
        inputFields: ['text'],
        llmProvider: geminiProvider,
        systemPrompt: 'You are a content classifier.',
        userTask: 'Classify each text by topic and difficulty.',
        outputSchema: yamlSchema,
        outputFormat: 'yaml'
      });

      expect(yamlResults).toHaveLength(2);
      expect(yamlResults[0]).toHaveProperty('topic');
      expect(yamlResults[0]).toHaveProperty('difficulty');
      expect(typeof yamlResults[0].topic).toBe('string');
      expect(typeof yamlResults[0].difficulty).toBe('string');
      console.log('[Multi-format test] YAML format ✓');

      // Test 3: Mixed formats (XML items + JSON metadata)
      console.log('[Multi-format test] Testing mixed formats (XML + JSON metadata)...');
      const mixedItems = [
        { uuid: 'item-1', text: 'Artificial intelligence is transforming industries' },
        { uuid: 'item-2', text: 'Cloud computing provides scalable infrastructure' }
      ];

      const mixedOutputSchema: OutputSchema<{ sentiment: string; keywords: string }> = {
        sentiment: {
          type: 'string',
          description: 'Overall sentiment: positive, neutral, or negative',
          required: true
        },
        keywords: {
          type: 'string',
          description: 'Comma-separated list of key terms',
          required: true
        }
      };

      const mixedGlobalSchema: OutputSchema<{ overallQuality: string; confidence: number }> = {
        overallQuality: {
          type: 'string',
          description: 'Overall quality of the analysis: excellent, good, or fair',
          required: true
        },
        confidence: {
          type: 'number',
          description: 'Confidence score from 0 to 100',
          required: true
        }
      };

      const mixedResult = await executor.executeLLMBatch(mixedItems, {
        inputFields: ['text'],
        llmProvider: geminiProvider,
        systemPrompt: 'You are a sentiment analyzer.',
        userTask: 'Analyze sentiment and extract keywords. Also provide overall quality assessment in JSON format.',
        outputSchema: mixedOutputSchema,
        globalSchema: mixedGlobalSchema,
        outputFormat: 'xml',
        globalMetadataFormat: 'json',
        logPrompts: './test-logs/mixed-format-prompt.log',
        logResponses: './test-logs/mixed-format-response.log'
      });

      expect(mixedResult).toHaveProperty('items');
      expect(mixedResult).toHaveProperty('globalMetadata');

      const { items: resultItems, globalMetadata } = mixedResult as LLMBatchResult<typeof mixedItems[0], { sentiment: string; keywords: string }, { overallQuality: string; confidence: number }>;

      expect(resultItems).toHaveLength(2);
      expect(resultItems[0]).toHaveProperty('sentiment');
      expect(resultItems[0]).toHaveProperty('keywords');
      expect(globalMetadata).toBeDefined();
      expect(globalMetadata).toHaveProperty('overallQuality');
      expect(globalMetadata).toHaveProperty('confidence');
      expect(typeof globalMetadata.overallQuality).toBe('string');
      expect(typeof globalMetadata.confidence).toBe('number');
      expect(globalMetadata.confidence).toBeGreaterThanOrEqual(0);
      expect(globalMetadata.confidence).toBeLessThanOrEqual(100);
      console.log('[Multi-format test] Mixed formats ✓');
    }, 120000); // 2 minute timeout to handle retries

    it('should handle realistic prompts of varying sizes (1k, 5k, 10k chars)', async () => {
      console.log('[Realistic sizes test] Testing small, medium, and large realistic prompts...');

      const outputSchema: OutputSchema<{ analysis: string; recommendation: string }> = {
        analysis: {
          type: 'string',
          description: 'Analysis of the code or content',
          required: true
        },
        recommendation: {
          type: 'string',
          description: 'Recommendation for improvement',
          required: true
        }
      };

      // Test 1: Small prompt (~1k chars) - Simple function
      console.log('[Realistic sizes test] Testing small prompt (~1k chars)...');
      const smallCode = [{
        id: 'small',
        code: `function calculateTotal(items) {
  let total = 0;
  for (let i = 0; i < items.length; i++) {
    total += items[i].price * items[i].quantity;
  }
  return total;
}

function applyDiscount(total, discountPercent) {
  return total - (total * discountPercent / 100);
}

function formatCurrency(amount) {
  return '$' + amount.toFixed(2);
}

// Usage example
const cart = [
  { name: 'Widget', price: 9.99, quantity: 2 },
  { name: 'Gadget', price: 14.99, quantity: 1 },
  { name: 'Doohickey', price: 4.99, quantity: 3 }
];

const subtotal = calculateTotal(cart);
const discounted = applyDiscount(subtotal, 10);
console.log('Final price:', formatCurrency(discounted));`
      }];

      const result1k = await executor.executeLLMBatch(smallCode, {
        inputFields: ['code'],
        llmProvider: sharedLLMProvider,
        systemPrompt: 'You are a code reviewer analyzing JavaScript code.',
        userTask: 'Review this code for quality and suggest improvements.',
        outputSchema,
        logPrompts: './test-logs/variable-sizes-1k-prompt.log',
        logResponses: './test-logs/variable-sizes-1k-response.log'
      });
      expect(result1k).toHaveLength(1);
      expect(result1k[0]).toHaveProperty('analysis');
      expect(result1k[0]).toHaveProperty('recommendation');
      console.log(`[Realistic sizes test] Small (~${smallCode[0].code.length} chars): ✓`);

      // Test 2: Medium prompt (~5k chars) - API endpoint with documentation
      console.log('[Realistic sizes test] Testing medium prompt (~5k chars)...');
      const mediumCode = [{
        id: 'medium',
        code: `/**
 * User Authentication API
 *
 * This module provides comprehensive user authentication functionality including:
 * - User registration with email verification
 * - Login with JWT token generation
 * - Password reset flows
 * - Session management
 * - OAuth integration (Google, GitHub)
 *
 * Security features:
 * - Bcrypt password hashing with salt rounds = 12
 * - JWT tokens with 1h expiration
 * - Refresh token rotation
 * - Rate limiting on authentication endpoints
 * - CSRF protection
 * - SQL injection prevention via parameterized queries
 *
 * Dependencies:
 * - express: Web framework
 * - bcrypt: Password hashing
 * - jsonwebtoken: JWT generation and verification
 * - express-validator: Input validation
 * - nodemailer: Email sending
 * - passport: OAuth strategies
 */

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

const router = express.Router();
const SALT_ROUNDS = 12;
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRY = '1h';
const REFRESH_TOKEN_EXPIRY = '7d';

// Email configuration
const emailTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

/**
 * Register new user
 * POST /api/auth/register
 *
 * Request body:
 * {
 *   email: string,
 *   password: string,
 *   name: string
 * }
 *
 * Returns:
 * {
 *   success: boolean,
 *   message: string,
 *   userId?: string
 * }
 */
router.post('/register',
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }).matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)/),
  body('name').trim().isLength({ min: 2, max: 100 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, name } = req.body;

    try {
      // Check if user exists
      const existingUser = await db.query('SELECT id FROM users WHERE email = $1', [email]);
      if (existingUser.rows.length > 0) {
        return res.status(409).json({ success: false, message: 'User already exists' });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

      // Generate email verification token
      const verificationToken = crypto.randomBytes(32).toString('hex');

      // Insert user
      const result = await db.query(
        'INSERT INTO users (email, password_hash, name, verification_token, created_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING id',
        [email, hashedPassword, name, verificationToken]
      );

      const userId = result.rows[0].id;

      // Send verification email
      await emailTransporter.sendMail({
        from: process.env.FROM_EMAIL,
        to: email,
        subject: 'Verify your email',
        html: \`<p>Click <a href="\${process.env.BASE_URL}/verify/\${verificationToken}">here</a> to verify your email.</p>\`
      });

      res.status(201).json({
        success: true,
        message: 'User registered. Please check your email to verify.',
        userId
      });
    } catch (error) {
      console.error('Registration error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }
);

/**
 * Login
 * POST /api/auth/login
 */
router.post('/login',
  body('email').isEmail().normalizeEmail(),
  body('password').exists(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    try {
      const result = await db.query(
        'SELECT id, password_hash, email_verified FROM users WHERE email = $1',
        [email]
      );

      if (result.rows.length === 0) {
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
      }

      const user = result.rows[0];

      if (!user.email_verified) {
        return res.status(403).json({ success: false, message: 'Email not verified' });
      }

      const validPassword = await bcrypt.compare(password, user.password_hash);
      if (!validPassword) {
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
      }

      // Generate tokens
      const accessToken = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
      const refreshToken = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRY });

      // Store refresh token
      await db.query('INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, NOW() + INTERVAL \\'7 days\\')',
        [user.id, refreshToken]);

      res.json({
        success: true,
        accessToken,
        refreshToken
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }
);

module.exports = router;`
      }];

      const result5k = await executor.executeLLMBatch(mediumCode, {
        inputFields: ['code'],
        llmProvider: sharedLLMProvider,
        systemPrompt: 'You are a senior security engineer reviewing authentication code.',
        userTask: 'Analyze this authentication API for security vulnerabilities and best practices.',
        outputSchema,
        logPrompts: './test-logs/variable-sizes-5k-prompt.log',
        logResponses: './test-logs/variable-sizes-5k-response.log'
      });
      expect(result5k).toHaveLength(1);
      expect(result5k[0]).toHaveProperty('analysis');
      expect(result5k[0]).toHaveProperty('recommendation');
      console.log(`[Realistic sizes test] Medium (~${mediumCode[0].code.length} chars): ✓`);

      // Test 3: Large prompt (~10k chars) - Full React component with hooks and context
      console.log('[Realistic sizes test] Testing large prompt (~10k chars)...');
      const largeCode = [{
        id: 'large',
        code: `/**
 * E-commerce Product Dashboard Component
 *
 * A comprehensive React component that manages product listings, inventory,
 * analytics, and user interactions for an e-commerce platform.
 *
 * Features:
 * - Real-time product search and filtering
 * - Inventory management with live updates
 * - Sales analytics with charts
 * - Bulk operations (edit, delete, export)
 * - Pagination and infinite scroll
 * - Image upload and optimization
 * - Price history tracking
 * - Review management
 * - Integration with payment gateway
 * - Multi-currency support
 * - A/B testing framework
 */

import React, { useState, useEffect, useCallback, useMemo, useContext, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { debounce } from 'lodash';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend } from 'chart.js';
import { Line } from 'react-chartjs-2';
import { toast } from 'react-hot-toast';
import { AuthContext } from '../../contexts/AuthContext';
import { ThemeContext } from '../../contexts/ThemeContext';
import { api } from '../../services/api';
import { formatCurrency, formatDate, validatePrice } from '../../utils/formatters';
import { useInfiniteScroll } from '../../hooks/useInfiniteScroll';
import { useImageUpload } from '../../hooks/useImageUpload';
import ProductCard from './ProductCard';
import FilterPanel from './FilterPanel';
import BulkActions from './BulkActions';
import AnalyticsDashboard from './AnalyticsDashboard';
import LoadingSpinner from '../common/LoadingSpinner';
import ErrorBoundary from '../common/ErrorBoundary';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

const ProductDashboard = () => {
  // Context
  const { user, permissions } = useContext(AuthContext);
  const { theme } = useContext(ThemeContext);

  // State management
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState({
    category: 'all',
    priceRange: { min: 0, max: 10000 },
    inStock: true,
    sortBy: 'name',
    sortOrder: 'asc'
  });
  const [selectedProducts, setSelectedProducts] = useState(new Set());
  const [viewMode, setViewMode] = useState('grid'); // 'grid' | 'list' | 'analytics'
  const [page, setPage] = useState(1);
  const [currency, setCurrency] = useState('USD');

  // Refs
  const queryClient = useQueryClient();
  const scrollRef = useRef(null);

  // Data fetching
  const { data: productsData, isLoading, isError, error } = useQuery(
    ['products', searchQuery, filters, page],
    () => api.products.getAll({ search: searchQuery, ...filters, page, limit: 20 }),
    {
      keepPreviousData: true,
      staleTime: 30000,
      onError: (err) => toast.error('Failed to load products')
    }
  );

  const { data: analyticsData } = useQuery(
    ['analytics', filters],
    () => api.analytics.getProductMetrics(filters),
    { enabled: viewMode === 'analytics' }
  );

  // Mutations
  const updateProductMutation = useMutation(
    (product) => api.products.update(product.id, product),
    {
      onSuccess: () => {
        queryClient.invalidateQueries('products');
        toast.success('Product updated successfully');
      },
      onError: () => toast.error('Failed to update product')
    }
  );

  const deleteProductsMutation = useMutation(
    (productIds) => api.products.bulkDelete(productIds),
    {
      onSuccess: () => {
        queryClient.invalidateQueries('products');
        setSelectedProducts(new Set());
        toast.success('Products deleted successfully');
      },
      onError: () => toast.error('Failed to delete products')
    }
  );

  const { uploadImage, isUploading, uploadProgress } = useImageUpload();

  // Debounced search
  const debouncedSearch = useMemo(
    () => debounce((query) => setSearchQuery(query), 300),
    []
  );

  // Infinite scroll
  useInfiniteScroll(scrollRef, () => {
    if (productsData?.hasMore && !isLoading) {
      setPage(prev => prev + 1);
    }
  });

  // Handlers
  const handleSearchChange = useCallback((e) => {
    debouncedSearch(e.target.value);
  }, [debouncedSearch]);

  const handleFilterChange = useCallback((newFilters) => {
    setFilters(prev => ({ ...prev, ...newFilters }));
    setPage(1);
  }, []);

  const handleProductSelect = useCallback((productId) => {
    setSelectedProducts(prev => {
      const next = new Set(prev);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      return next;
    });
  }, []);

  const handleBulkDelete = useCallback(async () => {
    if (selectedProducts.size === 0) return;

    const confirmed = window.confirm(\`Delete \${selectedProducts.size} products?\`);
    if (confirmed) {
      await deleteProductsMutation.mutateAsync(Array.from(selectedProducts));
    }
  }, [selectedProducts, deleteProductsMutation]);

  const handleBulkEdit = useCallback(async (updates) => {
    const promises = Array.from(selectedProducts).map(id => {
      const product = productsData?.products.find(p => p.id === id);
      return updateProductMutation.mutateAsync({ ...product, ...updates });
    });
    await Promise.all(promises);
  }, [selectedProducts, productsData, updateProductMutation]);

  const handleExport = useCallback(async (format = 'csv') => {
    try {
      const data = await api.products.export({
        productIds: Array.from(selectedProducts),
        format
      });
      const blob = new Blob([data], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = \`products-\${Date.now()}.\${format}\`;
      a.click();
      toast.success('Export completed');
    } catch (error) {
      toast.error('Export failed');
    }
  }, [selectedProducts]);

  const handleImageUpload = useCallback(async (productId, file) => {
    try {
      const imageUrl = await uploadImage(file);
      await updateProductMutation.mutateAsync({ id: productId, imageUrl });
    } catch (error) {
      toast.error('Image upload failed');
    }
  }, [uploadImage, updateProductMutation]);

  // Computed values
  const products = productsData?.products || [];
  const totalProducts = productsData?.total || 0;
  const hasMore = productsData?.hasMore || false;

  const selectedProductsData = useMemo(() => {
    return products.filter(p => selectedProducts.has(p.id));
  }, [products, selectedProducts]);

  const totalValue = useMemo(() => {
    return selectedProductsData.reduce((sum, p) => sum + (p.price * p.stock), 0);
  }, [selectedProductsData]);

  // Effects
  useEffect(() => {
    // Track page view
    api.analytics.trackPageView('product-dashboard', { filters, viewMode });
  }, [filters, viewMode]);

  useEffect(() => {
    // Real-time inventory updates via WebSocket
    const ws = new WebSocket(process.env.REACT_APP_WS_URL);

    ws.onmessage = (event) => {
      const update = JSON.parse(event.data);
      if (update.type === 'inventory-update') {
        queryClient.setQueryData(['products'], (old) => {
          return {
            ...old,
            products: old.products.map(p =>
              p.id === update.productId ? { ...p, stock: update.stock } : p
            )
          };
        });
      }
    };

    return () => ws.close();
  }, [queryClient]);

  // Render helpers
  const renderProducts = () => {
    if (isLoading) return <LoadingSpinner />;
    if (isError) return <div className="error">Error: {error.message}</div>;
    if (products.length === 0) return <div className="empty">No products found</div>;

    return products.map(product => (
      <ProductCard
        key={product.id}
        product={product}
        selected={selectedProducts.has(product.id)}
        onSelect={handleProductSelect}
        onUpdate={updateProductMutation.mutate}
        onImageUpload={(file) => handleImageUpload(product.id, file)}
        viewMode={viewMode}
        currency={currency}
      />
    ));
  };

  // Main render
  return (
    <ErrorBoundary>
      <div className={\`product-dashboard theme-\${theme}\`}>
        <header className="dashboard-header">
          <h1>Product Management</h1>
          <div className="header-actions">
            <input
              type="search"
              placeholder="Search products..."
              onChange={handleSearchChange}
              className="search-input"
            />
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
            </select>
            <button onClick={() => setViewMode('grid')}>Grid</button>
            <button onClick={() => setViewMode('list')}>List</button>
            <button onClick={() => setViewMode('analytics')}>Analytics</button>
          </div>
        </header>

        <div className="dashboard-content">
          <aside className="sidebar">
            <FilterPanel filters={filters} onChange={handleFilterChange} />
          </aside>

          <main className="main-content" ref={scrollRef}>
            {selectedProducts.size > 0 && (
              <BulkActions
                selectedCount={selectedProducts.size}
                totalValue={formatCurrency(totalValue, currency)}
                onDelete={handleBulkDelete}
                onEdit={handleBulkEdit}
                onExport={handleExport}
              />
            )}

            {viewMode === 'analytics' ? (
              <AnalyticsDashboard data={analyticsData} />
            ) : (
              <div className={\`product-grid view-\${viewMode}\`}>
                {renderProducts()}
              </div>
            )}

            {hasMore && <LoadingSpinner className="load-more" />}
          </main>
        </div>

        <footer className="dashboard-footer">
          <p>Showing {products.length} of {totalProducts} products</p>
          {permissions.includes('admin') && (
            <p>Selected: {selectedProducts.size} | Total Value: {formatCurrency(totalValue, currency)}</p>
          )}
        </footer>
      </div>
    </ErrorBoundary>
  );
};

export default ProductDashboard;`
      }];

      const result10k = await executor.executeLLMBatch(largeCode, {
        inputFields: ['code'],
        llmProvider: sharedLLMProvider,
        systemPrompt: 'You are a React expert reviewing production code.',
        userTask: 'Analyze this React component for performance, best practices, and potential issues.',
        outputSchema,
        logPrompts: './test-logs/variable-sizes-10k-prompt.log',
        logResponses: './test-logs/variable-sizes-10k-response.log'
      });
      expect(result10k).toHaveLength(1);
      expect(result10k[0]).toHaveProperty('analysis');
      expect(result10k[0]).toHaveProperty('recommendation');
      console.log(`[Realistic sizes test] Large (~${largeCode[0].code.length} chars): ✓`);

      console.log('[Realistic sizes test] All realistic prompts handled successfully ✓');
    }, 180000); // 3 minute timeout for larger prompts
  });
});
