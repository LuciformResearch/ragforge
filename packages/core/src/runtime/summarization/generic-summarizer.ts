/**
 * Generic Summarizer
 *
 * Field-level summarization system that works across any domain.
 * Uses StructuredPromptBuilder and configurable strategies.
 *
 * Features:
 * - Domain-agnostic (code, products, documents, etc.)
 * - Batch processing for efficiency
 * - Configurable thresholds
 * - Custom templates support
 * - Strategy-based architecture
 */

import { StructuredPromptBuilder } from '../llm/structured-prompt-builder.js';
import type { LLMProvider } from '../reranking/llm-provider.js';
import type { SummaryStrategy } from './default-strategies.js';
import { StructuredLLMExecutor } from '../llm/structured-llm-executor.js';
import type { LLMStructuredCallConfig, OutputSchema } from '../llm/structured-llm-executor.js';

/**
 * Configuration for field summarization
 */
export interface SummarizationConfig {
  /** Whether summarization is enabled for this field */
  enabled: boolean;

  /** Strategy ID to use */
  strategy: string;

  /** Minimum field length (chars) to trigger summarization */
  threshold: number;

  /** Cache summaries in Neo4j */
  cache?: boolean;

  /** Generate summaries on-demand vs pre-generation */
  on_demand?: boolean;

  /** Custom prompt template path (optional, overrides strategy default) */
  prompt_template?: string;

  /** Output fields to extract and store */
  output_fields: string[];

  /** How to use summaries in reranking */
  rerank_use?: 'always' | 'prefer_summary' | 'never';
}

/**
 * Field summary result
 * Contains extracted structured data based on strategy output schema
 */
export interface FieldSummary {
  [key: string]: string | string[] | number | boolean;
}

/**
 * Input for single summarization
 */
export interface SummarizeInput {
  /** Entity type (e.g., "Scope", "Product") */
  entityType: string;

  /** Field name being summarized */
  fieldName: string;

  /** Field value (content to summarize) */
  fieldValue: string;

  /** Full entity object (for context) */
  entity: any;

  /** Summarization config */
  config: SummarizationConfig;

  /** Optional graph context from context_query */
  graphContext?: Record<string, any>;
}

/**
 * Generic Summarizer
 *
 * Provides field-level summarization with configurable strategies.
 *
 * @example
 * ```typescript
 * const summarizer = new GenericSummarizer(llmProvider, strategies);
 *
 * // Check if field needs summary
 * if (summarizer.needsSummary(sourceCode, config)) {
 *   // Generate summary
 *   const summary = await summarizer.summarizeField(
 *     'Scope',
 *     'source',
 *     sourceCode,
 *     entity,
 *     config
 *   );
 *
 *   // Use summary
 *   console.log(summary.purpose);
 *   console.log(summary.suggestions);
 * }
 * ```
 */
export class GenericSummarizer {
  private executor: StructuredLLMExecutor;

  constructor(
    private llmProvider: LLMProvider,
    private strategies: Map<string, SummaryStrategy>,
    private customTemplates: Map<string, string> = new Map()
  ) {
    this.executor = new StructuredLLMExecutor();
  }

  /**
   * Determine if a field value needs summarization
   *
   * @param fieldValue - The field content
   * @param config - Summarization config
   * @returns true if field should be summarized
   */
  needsSummary(fieldValue: string, config: SummarizationConfig): boolean {
    if (!config.enabled) return false;
    if (!fieldValue) return false;
    return fieldValue.length > config.threshold;
  }

  /**
   * NEW: Summarize using StructuredLLMExecutor (unified approach)
   */
  async summarizeFieldWithExecutor(
    entityType: string,
    fieldName: string,
    fieldValue: string,
    entity: any,
    config: SummarizationConfig
  ): Promise<FieldSummary> {
    // Get strategy
    const strategy = this.strategies.get(config.strategy);
    if (!strategy) {
      throw new Error(`Unknown summarization strategy: ${config.strategy}`);
    }

    // Convert strategy output schema to StructuredLLMExecutor format
    const outputSchema: OutputSchema<FieldSummary> = {};
    for (const field of strategy.promptConfig.outputFormat.fields) {
      outputSchema[field.name] = {
        type: field.type as any,
        description: field.description || `Summary field: ${field.name}`,
        required: field.required
      };
    }

    // Prepare data for input
    const item = {
      [fieldName]: fieldValue,
      ...entity
    };

    // Use StructuredLLMExecutor
    const result = await this.executor.executeLLMBatch([item], {
      inputFields: [fieldName],
      llmProvider: this.llmProvider,
      systemPrompt: strategy.promptConfig.systemContext,
      userTask: strategy.promptConfig.userTask,
      outputSchema,
      outputFormat: 'xml',
      batchSize: 1
    });

    // Handle return type (array or LLMBatchResult)
    const results = Array.isArray(result) ? result : result.items;
    const summary = results[0];

    // Filter to requested output fields (if specified)
    if (config.output_fields.length > 0) {
      return this.filterOutputFields(summary, config.output_fields);
    }

    return summary;
  }

  /**
   * LEGACY: Summarize a single field (kept for backward compatibility)
   * @deprecated Use summarizeFieldWithExecutor for better performance
   */
  async summarizeField(
    entityType: string,
    fieldName: string,
    fieldValue: string,
    entity: any,
    config: SummarizationConfig
  ): Promise<FieldSummary> {
    // Delegate to new implementation
    return this.summarizeFieldWithExecutor(entityType, fieldName, fieldValue, entity, config);

    /* ORIGINAL IMPLEMENTATION
    // Get strategy
    const strategy = this.strategies.get(config.strategy);
    if (!strategy) {
      throw new Error(`Unknown summarization strategy: ${config.strategy}`);
    }

    // Build prompt using StructuredPromptBuilder
    const builder = new StructuredPromptBuilder(strategy.promptConfig);

    // Prepare template data
    const data = this.prepareTemplateData(
      entityType,
      fieldName,
      fieldValue,
      entity
    );

    // Render prompt
    const prompt = builder.render(data);

    // Call LLM
    const response = await this.llmProvider.generateContent(prompt);

    // Parse response
    const parsed = builder.parse(response);

    // Filter to requested output fields (if specified)
    if (config.output_fields.length > 0) {
      return this.filterOutputFields(parsed, config.output_fields);
    }

    return parsed;
    */
  }

  /**
   * Batch summarization with intelligent packing
   *
   * Packs as many items as possible per prompt without exceeding token limits.
   * This is much more efficient than one-item-per-prompt.
   *
   * @param items - Array of items to summarize
   * @param maxTokensPerPrompt - Max tokens per prompt (default: model-dependent)
   * @returns Array of summaries in same order
   */
  async summarizeBatch(
    items: SummarizeInput[],
    maxTokensPerPrompt?: number
  ): Promise<FieldSummary[]> {
    if (items.length === 0) return [];

    // Default token limit (conservative, works for most models)
    const tokenLimit = maxTokensPerPrompt || 6000; // Leave room for response

    // Pack items into prompts based on token budget
    return this.summarizeBatchPacked(items, tokenLimit);
  }

  /**
   * Build prompts without sending them (for debugging/logging)
   *
   * Returns the exact prompts that would be sent to the LLM.
   *
   * @param items - Array of items to build prompts for
   * @param maxTokensPerPrompt - Max tokens per prompt (default: 6000)
   * @returns Array of prompt strings
   */
  buildPrompts(
    items: SummarizeInput[],
    maxTokensPerPrompt?: number
  ): string[] {
    if (items.length === 0) return [];

    const tokenLimit = maxTokensPerPrompt || 6000;

    // Group by strategy
    const byStrategy = new Map<string, Array<SummarizeInput & { originalIndex: number }>>();

    items.forEach((item, i) => {
      const strategyId = item.config.strategy;
      if (!byStrategy.has(strategyId)) {
        byStrategy.set(strategyId, []);
      }
      byStrategy.get(strategyId)!.push({ ...item, originalIndex: i });
    });

    const prompts: string[] = [];

    // Process each strategy group
    for (const [strategyId, strategyItems] of byStrategy) {
      const strategy = this.strategies.get(strategyId);
      if (!strategy) {
        throw new Error(`Strategy not found: ${strategyId}`);
      }

      // Pack items by token budget
      const packs = this.packItemsByTokens(strategyItems, tokenLimit);

      // Build prompt for each pack
      for (const pack of packs) {
        const prompt = this.buildMultiItemPrompt(pack, strategy);
        prompts.push(prompt);
      }
    }

    return prompts;
  }

  /**
   * Batch summarization with packed prompts
   *
   * Multiple items per prompt for maximum efficiency.
   * Items are packed until token budget is reached.
   *
   * @param items - Array of items to summarize
   * @param maxTokensPerPrompt - Max tokens per prompt
   * @returns Array of summaries in same order
   */
  private async summarizeBatchPacked(
    items: SummarizeInput[],
    maxTokensPerPrompt: number
  ): Promise<FieldSummary[]> {
    if (items.length === 0) return [];

    // Group by strategy
    const byStrategy = this.groupByStrategy(items);
    const allResults: Array<{ index: number; summary: FieldSummary }> = [];

    for (const [strategyId, strategyItems] of byStrategy.entries()) {
      const strategy = this.strategies.get(strategyId);
      if (!strategy) {
        throw new Error(`Unknown strategy: ${strategyId}`);
      }

      // Pack items into prompts based on token budget
      const packs = this.packItemsByTokens(strategyItems, maxTokensPerPrompt);

      console.log(`  Strategy ${strategyId}: ${strategyItems.length} items → ${packs.length} prompts`);

      // Process all packs in parallel for better throughput
      const packResults = await Promise.all(
        packs.map(async (pack) => {
          const prompt = this.buildMultiItemPrompt(pack, strategy);
          const requestId = `summarize-pack-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
          const response = await this.llmProvider.generateContent(prompt, requestId);
          const summaries = await this.parseMultiItemResponse(response, pack, strategy);

          // Validate summaries - warn about empty results and log raw response
          const emptyCount = summaries.filter(s => !s || Object.keys(s).length === 0).length;
          if (emptyCount > 0) {
            console.warn(`    ⚠️  Warning: ${emptyCount}/${summaries.length} summaries were empty`);
            console.warn(`       This may indicate max_tokens is too low or batch size too large`);
            console.warn(`       Consider increasing max_tokens in config or reducing batch size`);

            // Log first 500 chars of raw response for debugging
            console.warn(`       Raw response preview: ${response.substring(0, 500)}...`);
          }

          return { pack, summaries };
        })
      );

      // Collect results from all packs
      for (const { pack, summaries } of packResults) {
        pack.forEach((item, i) => {
          allResults.push({
            index: item.originalIndex,
            summary: summaries[i]
          });
        });
      }
    }

    // Sort back to original order
    allResults.sort((a, b) => a.index - b.index);
    return allResults.map(r => r.summary);
  }

  /**
   * Pack items into groups based on token budget
   *
   * Each group will fit in one prompt without exceeding token limit.
   */
  private packItemsByTokens(
    items: Array<SummarizeInput & { originalIndex: number }>,
    maxTokens: number
  ): Array<Array<SummarizeInput & { originalIndex: number }>> {
    const packs: Array<Array<SummarizeInput & { originalIndex: number }>> = [];
    let currentPack: Array<SummarizeInput & { originalIndex: number }> = [];
    let currentTokens = 500; // Base prompt overhead

    // Estimate tokens per summary response
    // With concise instructions, each summary should be ~300-500 tokens
    // We reserve 1200 per item to ensure LLM has enough space to complete all items without truncation
    const TOKENS_PER_RESPONSE = 1200;

    for (const item of items) {
      // Estimate tokens for this item in prompt (rough: 1 token ≈ 4 chars)
      const itemTokens = Math.ceil(item.fieldValue.length / 4) + 200; // +200 for metadata overhead

      // Calculate total tokens: prompt + space needed for responses
      const promptTokens = currentTokens + itemTokens;
      const responseTokens = (currentPack.length + 1) * TOKENS_PER_RESPONSE;
      const totalTokens = promptTokens + responseTokens;

      // Check if adding this item would exceed budget
      const shouldStartNewPack = totalTokens > maxTokens && currentPack.length > 0;

      if (shouldStartNewPack) {
        // Current pack is full, start new one
        packs.push(currentPack);
        currentPack = [item];
        currentTokens = 500 + itemTokens;
      } else {
        // Add to current pack
        currentPack.push(item);
        currentTokens += itemTokens;
      }
    }

    // Add last pack
    if (currentPack.length > 0) {
      packs.push(currentPack);
    }

    return packs;
  }

  /**
   * Build prompt for multiple items
   */
  private buildMultiItemPrompt(
    items: Array<SummarizeInput & { originalIndex: number }>,
    strategy: SummaryStrategy
  ): string {
    let prompt = strategy.promptConfig.systemContext + '\n\n';
    prompt += `CRITICAL: You will analyze exactly ${items.length} items below.\n`;
    prompt += `You MUST provide analysis for ALL ${items.length} items (id="0" through id="${items.length - 1}").\n`;
    prompt += `Do NOT stop early. Complete ALL ${items.length} items.\n\n`;

    // Add all items
    items.forEach((item, idx) => {
      prompt += `[Item ${idx}]\n`;
      prompt += `Type: ${item.entityType}\n`;
      if (item.entity.name) prompt += `Name: ${item.entity.name}\n`;
      if (item.entity.file) prompt += `File: ${item.entity.file}\n`;

      // Add graph context if available
      if (item.graphContext) {
        if (item.graphContext.file_path) {
          prompt += `File: ${item.graphContext.file_path}\n`;
        }
        if (item.graphContext.scope_type) {
          prompt += `Scope Type: ${item.graphContext.scope_type}\n`;
        }
        if (item.graphContext.start_line && item.graphContext.end_line) {
          prompt += `Lines: ${item.graphContext.start_line}-${item.graphContext.end_line}\n`;
        }
        if (item.graphContext.is_exported !== undefined) {
          prompt += `Exported: ${item.graphContext.is_exported}\n`;
        }
        if (item.graphContext.imports_internal && item.graphContext.imports_internal.length > 0) {
          prompt += `Imports: ${item.graphContext.imports_internal.join(', ')}\n`;
        }
        if (item.graphContext.calls_internal && item.graphContext.calls_internal.length > 0) {
          prompt += `Calls: ${item.graphContext.calls_internal.join(', ')}\n`;
        }
        if (item.graphContext.called_by && item.graphContext.called_by.length > 0) {
          prompt += `Called by: ${item.graphContext.called_by.join(', ')}\n`;
        }
      }

      prompt += `\nSource code:\n${item.fieldValue}\n\n`;
    });

    // Instructions
    prompt += '\nIMPORTANT: You MUST respond with XML ONLY. Do NOT use JSON or markdown.\n\n';
    prompt += 'IMPORTANT: Keep responses CONCISE to fit within token limits:\n';
    prompt += '- purpose: 1 sentence (15-25 words max)\n';
    prompt += '- operation: 2-5 items, each 10-15 words max\n';
    prompt += '- dependency: names only, no descriptions\n';
    prompt += '- concept: 2-4 short keywords\n';
    prompt += '- complexity: "Low", "Medium", "High", or O(n) notation\n';
    prompt += '- suggestion: 0-3 items, each 15-20 words max\n\n';
    prompt += 'Provide one analysis per item in this format:\n\n';
    prompt += '<analyses>\n';
    prompt += '  <item id="0">\n';
    strategy.promptConfig.outputFormat.fields.forEach(field => {
      if (field.type === 'array') {
        prompt += `    <${field.name}>Value 1</${field.name}>\n`;
        prompt += `    <${field.name}>Value 2</${field.name}>\n`;
      } else {
        prompt += `    <${field.name}>Value</${field.name}>\n`;
      }
    });
    prompt += '  </item>\n';
    prompt += '  <item id="1">\n';
    prompt += '    ...\n';
    prompt += '  </item>\n';

    // List all required item IDs explicitly
    if (items.length > 2) {
      prompt += '  ...\n';
      for (let i = 2; i < items.length; i++) {
        prompt += `  <item id="${i}">\n    ...\n  </item>\n`;
      }
    }

    prompt += '</analyses>\n\n';

    if (strategy.promptConfig.instructions) {
      prompt += strategy.promptConfig.instructions + '\n\n';
    }

    prompt += `REMINDER: You MUST generate exactly ${items.length} <item> elements.\n`;
    prompt += `Required item IDs: ${Array.from({ length: items.length }, (_, i) => `"${i}"`).join(', ')}\n\n`;
    prompt += `Now analyze all ${items.length} items and respond with complete XML:`;

    return prompt;
  }

  /**
   * Parse multi-item XML response
   */
  private async parseMultiItemResponse(
    response: string,
    items: Array<SummarizeInput & { originalIndex: number }>,
    strategy: SummaryStrategy
  ): Promise<FieldSummary[]> {
    // Clean response
    let xmlText = response.trim();
    if (xmlText.includes('```')) {
      const match = xmlText.match(/```(?:xml)?\s*\n?([\s\S]*?)\n?```/);
      if (match && match[1]) {
        xmlText = match[1].trim();
      }
    }

    // Parse XML
    const { LuciformXMLParser } = await import('@luciformresearch/xmlparser');
    const parser = new LuciformXMLParser(
      xmlText,
      { mode: 'luciform-permissive' }
    );
    const result = parser.parse();

    if (!result.document?.root) {
      throw new Error('No XML root in multi-item response');
    }

    const root = result.document.root;

    // Find all <item> elements
    const itemElements = root.children?.filter(
      (c: any) => c.type === 'element' && c.name === 'item'
    ) || [];

    if (itemElements.length !== items.length) {
      console.warn(`Expected ${items.length} items, got ${itemElements.length}`);
    }

    // Extract each item's summary
    const summaries: FieldSummary[] = [];

    for (let i = 0; i < items.length; i++) {
      const itemEl = itemElements[i];
      if (!itemEl) {
        // Missing item in response, use empty summary
        summaries.push({});
        continue;
      }

      const summary: FieldSummary = {};

      for (const field of strategy.promptConfig.outputFormat.fields) {
        if (field.type === 'array') {
          // Extract all elements with this name
          const elements = itemEl.children?.filter(
            (c: any) => c.type === 'element' && c.name === field.name
          ) || [];

          summary[field.name] = elements.map((el: any) =>
            this.getTextContent(el)
          );
        } else {
          // Extract single element
          const fieldElement = itemEl.children?.find(
            (c: any) => c.type === 'element' && c.name === field.name
          );

          if (fieldElement) {
            summary[field.name] = this.getTextContent(fieldElement);
          }
        }
      }

      // Filter to requested output fields
      const filtered = items[i].config.output_fields.length > 0
        ? this.filterOutputFields(summary, items[i].config.output_fields)
        : summary;

      summaries.push(filtered);
    }

    return summaries;
  }

  /**
   * Get text content from XML element
   */
  private getTextContent(element: any): string {
    return element.children
      ?.filter((c: any) => c.type === 'text')
      ?.map((c: any) => c.content)
      ?.join('')
      .trim() || '';
  }

  /**
   * Batch summarization with parallel individual prompts (fallback)
   *
   * One prompt per item, processed in parallel.
   * Used as fallback if packed approach fails.
   *
   * @param items - Array of items to summarize
   * @returns Array of summaries in same order
   */
  private async summarizeBatchParallel(items: SummarizeInput[]): Promise<FieldSummary[]> {
    if (items.length === 0) return [];

    // Group by strategy (each strategy has different prompt schema)
    const byStrategy = this.groupByStrategy(items);

    const allResults: Array<{ index: number; summary: FieldSummary }> = [];

    for (const [strategyId, strategyItems] of byStrategy.entries()) {
      const strategy = this.strategies.get(strategyId);
      if (!strategy) {
        throw new Error(`Unknown strategy: ${strategyId}`);
      }

      const builder = new StructuredPromptBuilder(strategy.promptConfig);

      // Try batch processing if provider supports it
      if (typeof this.llmProvider.generateBatch === 'function') {
        // Build all prompts
        const prompts = strategyItems.map(item =>
          builder.render(
            this.prepareTemplateData(
              item.entityType,
              item.fieldName,
              item.fieldValue,
              item.entity
            )
          )
        );

        // Batch call
        const batchRequestId = `summarize-batch-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        const responses = await this.llmProvider.generateBatch!(prompts, batchRequestId);

        // Parse all responses
        strategyItems.forEach((item, i) => {
          const parsed = builder.parse(responses[i]);
          const filtered = item.config.output_fields.length > 0
            ? this.filterOutputFields(parsed, item.config.output_fields)
            : parsed;

          allResults.push({
            index: item.originalIndex,
            summary: filtered
          });
        });
      } else {
        // Fallback: sequential processing
        for (const item of strategyItems) {
          const summary = await this.summarizeField(
            item.entityType,
            item.fieldName,
            item.fieldValue,
            item.entity,
            item.config
          );

          allResults.push({
            index: item.originalIndex,
            summary
          });
        }
      }
    }

    // Sort back to original order
    allResults.sort((a, b) => a.index - b.index);

    return allResults.map(r => r.summary);
  }

  /**
   * Prepare template data for prompt rendering
   */
  private prepareTemplateData(
    entityType: string,
    fieldName: string,
    fieldValue: string,
    entity: any
  ): Record<string, any> {
    return {
      entity_type: entityType,
      entity_name: entity.name || entity.title || entity.id,
      entity_file: entity.file || entity.path,
      entity_category: entity.category || entity.type,
      field_name: fieldName,
      field_value: fieldValue,
      entity: entity
    };
  }

  /**
   * Filter parsed output to only requested fields
   */
  private filterOutputFields(
    parsed: Record<string, any>,
    outputFields: string[]
  ): FieldSummary {
    const filtered: FieldSummary = {};

    for (const field of outputFields) {
      if (field in parsed) {
        filtered[field] = parsed[field];
      }
    }

    return filtered;
  }

  /**
   * Group items by strategy for batch processing
   */
  private groupByStrategy(
    items: SummarizeInput[]
  ): Map<string, Array<SummarizeInput & { originalIndex: number }>> {
    const groups = new Map<string, Array<SummarizeInput & { originalIndex: number }>>();

    items.forEach((item, index) => {
      const strategyId = item.config.strategy;

      if (!groups.has(strategyId)) {
        groups.set(strategyId, []);
      }

      groups.get(strategyId)!.push({ ...item, originalIndex: index });
    });

    return groups;
  }

  /**
   * Estimate token cost for summarization
   * Useful for budget planning
   */
  estimateTokens(items: SummarizeInput[]): {
    totalPromptTokens: number;
    totalResponseTokens: number;
    estimatedCost: number;
  } {
    let totalPromptTokens = 0;
    let totalResponseTokens = 0;

    for (const item of items) {
      const strategy = this.strategies.get(item.config.strategy);
      if (!strategy) continue;

      // Rough estimate: 1 token ≈ 4 characters
      const promptLength = item.fieldValue.length + 500; // field + instructions
      totalPromptTokens += Math.ceil(promptLength / 4);

      // Response estimate based on output fields
      const responseFields = item.config.output_fields.length || 5;
      totalResponseTokens += responseFields * 50; // ~50 tokens per field
    }

    // Very rough cost estimate (assuming GPT-3.5-like pricing)
    // Adjust based on actual provider pricing
    const estimatedCost =
      (totalPromptTokens / 1000) * 0.0005 +
      (totalResponseTokens / 1000) * 0.0015;

    return {
      totalPromptTokens,
      totalResponseTokens,
      estimatedCost
    };
  }

  /**
   * Add custom template for a strategy
   */
  addCustomTemplate(templatePath: string, content: string): void {
    this.customTemplates.set(templatePath, content);
  }

  /**
   * Get template content (custom or default)
   */
  getTemplate(templatePath?: string): string | undefined {
    if (!templatePath) return undefined;
    return this.customTemplates.get(templatePath);
  }
}
