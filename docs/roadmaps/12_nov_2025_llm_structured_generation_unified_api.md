# Unified LLM Structured Generation API - Roadmap

**Date**: 2025-01-12
**Goal**: Créer une API chainable `.llmGenerateStructured()` pour unifier et optimiser tous les appels LLM structurés dans RagForge

---

## 🎯 Vision

Permettre aux utilisateurs de chaîner des transformations **LLM structurées** ET **génération d'embeddings** directement sur les résultats de requêtes :

```typescript
const results = await rag.scope()
  .semanticSearchBySource('authentication flow', { topK: 100 })
  .llmGenerateStructured({
    // Inputs: quels champs envoyer au LLM
    inputFields: ['name', 'source', 'file', 'type'],
    inputContext: {
      relationships: ['CONSUMES', 'CONSUMED_BY'],
      summaries: true  // Utilise summaries si disponibles
    },

    // Output: structure de réponse attendue
    outputSchema: {
      relevance_score: {
        type: 'number',
        description: 'How relevant is this to authentication (0-1)',
        prompt: 'Evaluate relevance based on code content and dependencies'
      },
      security_issues: {
        type: 'array',
        description: 'List of potential security issues found',
        prompt: 'Identify authentication vulnerabilities, hardcoded secrets, weak validation'
      },
      complexity: {
        type: 'string',
        enum: ['Low', 'Medium', 'High'],
        description: 'Code complexity level'
      }
    },

    // System prompt (optionnel)
    systemPrompt: 'You are a security-focused code analyst',

    // LLM config (optionnel)
    llm: {
      provider: 'openai',
      model: 'gpt-4o',
      temperature: 0.3
    },

    // Batching & performance
    batchSize: 20,
    parallel: 5,
    tokenBudget: 8000
  })
  .execute();

// Résultats enrichis:
results[0] = {
  // Original fields
  uuid: "...",
  name: "validatePassword",
  source: "...",

  // Generated structured fields
  relevance_score: 0.92,
  security_issues: [
    "Missing rate limiting on password attempts",
    "No password complexity requirements enforced"
  ],
  complexity: "Medium"
};
```

---

## 📊 État Actuel - Systèmes Existants

### 1. LLM Reranking (`llm-reranker.ts`)

**Usage actuel:**
```typescript
const reranker = new LLMReranker(llmProvider, entityContext);
const reranked = await reranker.rerankResults(results, {
  userQuestion: "auth flow",
  topK: 10,
  scoreMerging: 'weighted'
});
```

**Ce qui fonctionne bien:**
- ✅ Batching intelligent (10 items/batch)
- ✅ Parallelization (5 batches en parallèle)
- ✅ Score merging (weighted, multiplicative, llm-override)
- ✅ Support agent context
- ✅ Query suggestions optionnelles

**Limitations:**
- ❌ Hardcodé pour reranking uniquement
- ❌ Format de prompt rigide
- ❌ XML attribute-based parsing seulement
- ❌ Pas de customisation des output fields
- ❌ Un seul LLM provider à la fois

### 2. Field Summarization (`generic-summarizer.ts`)

**Usage actuel:**
```typescript
const summarizer = new GenericSummarizer(llmProvider);
await summarizer.summarizeBatch({
  entityType: 'Scope',
  fieldName: 'source',
  entities: scopesToSummarize,
  strategy: CODE_ANALYSIS_STRATEGY
});
```

**Ce qui fonctionne bien:**
- ✅ System de stratégies réutilisables
- ✅ Token packing intelligent (1200 tokens/item)
- ✅ Graph context enrichment (Cypher query)
- ✅ Stockage automatique dans Neo4j
- ✅ Cache via hash (évite re-summarization)

**Limitations:**
- ❌ Un seul field à la fois
- ❌ Pas intégré dans query chain
- ❌ Pas de custom output schema par query
- ❌ Token budget fixe

### 3. Iterative Agent (`iterative-code-agent.ts`)

**Usage actuel:**
```typescript
const agent = new IterativeCodeAgent(rag, llmProvider);
const answer = await agent.answer("How does authentication work?");
```

**Ce qui fonctionne bien:**
- ✅ Multi-step reasoning
- ✅ Code generation + execution
- ✅ Result analysis avec structured output
- ✅ Auto-summarization du contexte

**Limitations:**
- ❌ Pas réutilisable hors agent
- ❌ Pas de streaming
- ❌ Exécution séquentielle (pas de parallélisation)

---

## 🏗️ Architecture Proposée

### 1. Unified LLM Call Interface

```typescript
/**
 * Configuration pour un appel LLM structuré
 */
interface LLMStructuredCallConfig<TInput = any, TOutput = any> {
  // === INPUTS ===

  /** Champs des entités à envoyer au LLM */
  inputFields: string[] | InputFieldConfig[];

  /** Contexte additionnel du graphe */
  inputContext?: {
    /** Relationships à inclure (ex: CONSUMES, CONSUMED_BY) */
    relationships?: string[] | RelationshipConfig[];

    /** Utiliser summaries si disponibles */
    summaries?: boolean | string[];  // true = all, ['source'] = specific

    /** Cypher query custom pour contexte enrichi */
    contextQuery?: string;
  };

  /** Données additionnelles dans le prompt (pas des entities) */
  contextData?: Record<string, any>;

  // === PROMPTS ===

  /** System prompt global */
  systemPrompt?: string;

  /** User task description */
  userTask?: string;

  /** Exemples (optional) */
  examples?: string | Example[];

  /** Instructions additionnelles */
  instructions?: string;

  // === OUTPUT SCHEMA ===

  /** Schema de sortie structuré */
  outputSchema: OutputSchema<TOutput>;

  /** Format de sortie préféré */
  outputFormat?: 'json' | 'xml' | 'auto';  // auto = JSON si supporté, XML sinon

  /** Merge strategy: comment fusionner output dans entity */
  mergeStrategy?: 'append' | 'replace' | 'custom';

  /** Fonction custom pour merger */
  customMerge?: (entity: TInput, generated: TOutput) => TInput;

  // === LLM CONFIG ===

  /** Provider & model config */
  llm?: {
    provider?: string;      // 'openai', 'gemini', 'ollama', etc.
    model?: string;
    temperature?: number;
    maxTokens?: number;
  };

  /** Stratégie de fallback */
  fallback?: {
    providers: string[];    // Try in order
    retries: number;
    backoff: 'exponential' | 'linear';
  };

  // === PERFORMANCE ===

  /** Nombre d'items par batch */
  batchSize?: number;

  /** Nombre de batches en parallèle */
  parallel?: number;

  /** Budget token total par requête */
  tokenBudget?: number;

  /** Stratégie si dépassement */
  onOverflow?: 'truncate' | 'split' | 'error';

  /** Cache les résultats */
  cache?: boolean | CacheConfig;
}

/**
 * Config avancée pour un input field
 */
interface InputFieldConfig {
  name: string;

  /** Max length avant truncation */
  maxLength?: number;

  /** Préférer summary si disponible */
  preferSummary?: boolean;

  /** Prompt spécifique pour ce field */
  prompt?: string;

  /** Transformer custom avant envoi */
  transform?: (value: any) => string;
}

/**
 * Schema de sortie avec prompts par field
 */
interface OutputSchema<T = any> {
  [K in keyof T]: OutputFieldSchema<T[K]>;
}

interface OutputFieldSchema<T = any> {
  /** Type du field */
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';

  /** Description pour le LLM */
  description: string;

  /** Prompt spécifique pour ce field (mini-instruction) */
  prompt?: string;

  /** Required ou optional */
  required?: boolean;

  /** Valeur par défaut si non généré */
  default?: T;

  /** Enum de valeurs possibles */
  enum?: T extends string ? string[] : never;

  /** Min/max pour numbers */
  min?: T extends number ? number : never;
  max?: T extends number ? number : never;

  /** Schema nested pour objects */
  properties?: T extends object ? OutputSchema<T> : never;

  /** Schema des items pour arrays */
  items?: T extends Array<infer U> ? OutputFieldSchema<U> : never;

  /** Validation custom */
  validate?: (value: T) => boolean | string;
}

/**
 * Relationship config pour contexte
 */
interface RelationshipConfig {
  type: string;           // 'CONSUMES', 'CONSUMED_BY', etc.
  direction?: 'outgoing' | 'incoming' | 'both';
  maxItems?: number;      // Limite le nombre
  fields?: string[];      // Champs à inclure des nodes liés
}

/**
 * Cache config
 */
interface CacheConfig {
  enabled: boolean;
  ttl?: number;           // Time to live en secondes
  key?: (input: any) => string;  // Custom cache key
}
```

### 2. Query Builder Extension

```typescript
// Extension de QueryBuilder
declare module './query/query-builder' {
  interface QueryBuilder<T> {
    /**
     * Génère des champs structurés via LLM sur les résultats
     */
    llmGenerateStructured<TOutput = any>(
      config: LLMStructuredCallConfig<T, TOutput>
    ): QueryBuilder<T & TOutput>;

    /**
     * Alias pour reranking (backward compat)
     */
    rerankWithLLM(options: {
      userQuestion: string;
      topK?: number;
      scoreMerging?: 'weighted' | 'multiplicative' | 'llm-override';
      withSuggestions?: boolean;
    }): QueryBuilder<T & { llm_score: number; llm_reasoning: string }>;

    /**
     * Alias pour summarization (backward compat)
     */
    withSummaries(options?: {
      fields?: string[];
      strategy?: string | SummaryStrategy;
      regenerate?: boolean;
    }): QueryBuilder<T>;
  }
}
```

### 3. Implementation - Structured LLM Executor

```typescript
/**
 * Exécuteur unifié pour appels LLM structurés
 */
export class StructuredLLMExecutor {
  constructor(
    private providers: LLMProviderAdapter[],  // Support multi-provider
    private cache?: CacheManager
  ) {}

  /**
   * Execute batch structured generation
   */
  async executeBatch<TInput, TOutput>(
    items: TInput[],
    config: LLMStructuredCallConfig<TInput, TOutput>
  ): Promise<(TInput & TOutput)[]> {
    // 1. Validate config
    this.validateConfig(config);

    // 2. Build prompts avec token management
    const batches = this.packBatches(items, config);

    // 3. Execute batches en parallèle avec fallback
    const results = await this.executeParallel(batches, config);

    // 4. Parse & validate outputs
    const parsed = this.parseOutputs(results, config.outputSchema);

    // 5. Merge avec inputs
    return this.mergeResults(items, parsed, config);
  }

  /**
   * Pack items en batches optimaux
   */
  private packBatches<T>(
    items: T[],
    config: LLMStructuredCallConfig<T, any>
  ): Batch<T>[] {
    const tokenBudget = config.tokenBudget || 8000;
    const estimatedResponseTokens = this.estimateResponseSize(config.outputSchema);
    const baseOverhead = this.estimatePromptOverhead(config);

    const batches: Batch<T>[] = [];
    let currentBatch: T[] = [];
    let currentTokens = baseOverhead;

    for (const item of items) {
      const itemTokens = this.estimateItemTokens(item, config);
      const wouldExceed = currentTokens + itemTokens + estimatedResponseTokens > tokenBudget;

      if (wouldExceed && currentBatch.length > 0) {
        batches.push({ items: currentBatch, tokenEstimate: currentTokens });
        currentBatch = [];
        currentTokens = baseOverhead;
      }

      currentBatch.push(item);
      currentTokens += itemTokens;

      // Force batch si atteint batchSize max
      if (currentBatch.length >= (config.batchSize || 20)) {
        batches.push({ items: currentBatch, tokenEstimate: currentTokens });
        currentBatch = [];
        currentTokens = baseOverhead;
      }
    }

    if (currentBatch.length > 0) {
      batches.push({ items: currentBatch, tokenEstimate: currentTokens });
    }

    return batches;
  }

  /**
   * Execute batches avec parallelization & fallback
   */
  private async executeParallel<T>(
    batches: Batch<T>[],
    config: LLMStructuredCallConfig<T, any>
  ): Promise<LLMResponse[]> {
    const parallel = config.parallel || 5;
    const results: LLMResponse[] = [];

    // Process batches en groupes parallèles
    for (let i = 0; i < batches.length; i += parallel) {
      const batchGroup = batches.slice(i, i + parallel);

      const groupResults = await Promise.all(
        batchGroup.map(batch => this.executeSingleBatch(batch, config))
      );

      results.push(...groupResults);
    }

    return results;
  }

  /**
   * Execute un batch avec fallback multi-provider
   */
  private async executeSingleBatch<T>(
    batch: Batch<T>,
    config: LLMStructuredCallConfig<T, any>
  ): Promise<LLMResponse> {
    // Check cache
    if (config.cache) {
      const cacheKey = this.getCacheKey(batch, config);
      const cached = await this.cache?.get(cacheKey);
      if (cached) return cached;
    }

    // Build prompt
    const prompt = this.buildPrompt(batch.items, config);

    // Try providers avec fallback
    const providers = this.getProviders(config);
    let lastError: Error | null = null;

    for (const provider of providers) {
      try {
        const response = await this.callProvider(provider, prompt, config);

        // Cache le résultat
        if (config.cache) {
          const cacheKey = this.getCacheKey(batch, config);
          await this.cache?.set(cacheKey, response, config.cache.ttl);
        }

        return response;

      } catch (error) {
        console.warn(`Provider ${provider.getProviderName()} failed:`, error);
        lastError = error as Error;

        // Retry avec exponential backoff si configuré
        if (config.fallback?.backoff) {
          await this.sleep(this.getBackoffDelay(config.fallback));
        }
      }
    }

    throw new Error(`All providers failed. Last error: ${lastError?.message}`);
  }

  /**
   * Call provider avec structured output si supporté
   */
  private async callProvider(
    provider: LLMProviderAdapter,
    prompt: string,
    config: LLMStructuredCallConfig<any, any>
  ): Promise<LLMResponse> {
    // Vérifier si provider supporte structured outputs natifs
    const supportsStructured = this.supportsStructuredOutputs(provider);

    if (supportsStructured && config.outputFormat !== 'xml') {
      // Utiliser JSON Schema natif
      return await provider.generateStructured({
        prompt,
        schema: this.convertToJSONSchema(config.outputSchema),
        systemPrompt: config.systemPrompt
      });
    } else {
      // Fallback XML
      const xmlPrompt = this.addXMLInstructions(prompt, config.outputSchema);
      const response = await provider.generate(xmlPrompt);
      return { text: response, format: 'xml' };
    }
  }

  /**
   * Build prompt à partir du config
   */
  private buildPrompt<T>(
    items: T[],
    config: LLMStructuredCallConfig<T, any>
  ): string {
    const builder = new UnifiedPromptBuilder();

    // System context
    if (config.systemPrompt) {
      builder.addSection('system', config.systemPrompt);
    }

    // User task
    if (config.userTask) {
      builder.addSection('task', config.userTask);
    }

    // Context data (non-entity data)
    if (config.contextData) {
      builder.addSection('context', this.formatContext(config.contextData));
    }

    // Examples
    if (config.examples) {
      builder.addSection('examples', this.formatExamples(config.examples));
    }

    // Items to analyze
    builder.addSection('items', this.formatItems(items, config));

    // Output instructions
    builder.addSection('output', this.generateOutputInstructions(config.outputSchema));

    // Additional instructions
    if (config.instructions) {
      builder.addSection('instructions', config.instructions);
    }

    return builder.build();
  }

  /**
   * Format items avec input field config
   */
  private formatItems<T>(
    items: T[],
    config: LLMStructuredCallConfig<T, any>
  ): string {
    return items.map((item, index) => {
      const fields: string[] = [`[Item ${index}]`];

      for (const fieldConfig of config.inputFields) {
        const fieldName = typeof fieldConfig === 'string' ? fieldConfig : fieldConfig.name;
        let value = (item as any)[fieldName];

        // Apply transformations
        if (typeof fieldConfig !== 'string') {
          // Use summary si préféré
          if (fieldConfig.preferSummary && config.inputContext?.summaries) {
            const summaryValue = this.getSummary(item, fieldName);
            if (summaryValue) value = summaryValue;
          }

          // Apply custom transform
          if (fieldConfig.transform) {
            value = fieldConfig.transform(value);
          }

          // Truncate si maxLength
          if (fieldConfig.maxLength && typeof value === 'string') {
            value = this.truncate(value, fieldConfig.maxLength);
          }

          // Add field-specific prompt
          if (fieldConfig.prompt) {
            fields.push(`${fieldName} (${fieldConfig.prompt}):`);
          } else {
            fields.push(`${fieldName}:`);
          }
        } else {
          fields.push(`${fieldName}:`);
        }

        fields.push(this.formatValue(value));
      }

      // Add relationship context
      if (config.inputContext?.relationships) {
        fields.push(...this.formatRelationships(item, config.inputContext.relationships));
      }

      return fields.join('\n');
    }).join('\n\n');
  }

  /**
   * Generate output instructions from schema
   */
  private generateOutputInstructions(schema: OutputSchema<any>): string {
    const instructions: string[] = [
      'You MUST respond with the following structured format:',
      ''
    ];

    // Liste des fields avec descriptions
    for (const [fieldName, fieldSchema] of Object.entries(schema)) {
      const required = fieldSchema.required ? '(REQUIRED)' : '(optional)';
      instructions.push(`- ${fieldName} ${required}: ${fieldSchema.description}`);

      // Field-specific prompt
      if (fieldSchema.prompt) {
        instructions.push(`  Guidance: ${fieldSchema.prompt}`);
      }

      // Type constraints
      if (fieldSchema.enum) {
        instructions.push(`  Allowed values: ${fieldSchema.enum.join(', ')}`);
      }
      if (fieldSchema.min !== undefined || fieldSchema.max !== undefined) {
        instructions.push(`  Range: ${fieldSchema.min ?? '-∞'} to ${fieldSchema.max ?? '∞'}`);
      }
    }

    instructions.push('');
    instructions.push('Example output format:');
    instructions.push(this.generateExampleOutput(schema));

    return instructions.join('\n');
  }

  /**
   * Parse outputs selon format détecté
   */
  private parseOutputs<TOutput>(
    responses: LLMResponse[],
    schema: OutputSchema<TOutput>
  ): TOutput[] {
    const results: TOutput[] = [];

    for (const response of responses) {
      if (response.format === 'json') {
        // JSON natif (OpenAI structured outputs)
        const parsed = JSON.parse(response.text);
        results.push(...this.validateAndCoerce(parsed, schema));
      } else {
        // XML fallback
        const parsed = this.parseXML(response.text, schema);
        results.push(...parsed);
      }
    }

    return results;
  }

  /**
   * Validate & coerce types selon schema
   */
  private validateAndCoerce<T>(data: any, schema: OutputSchema<T>): T {
    const result: any = {};

    for (const [fieldName, fieldSchema] of Object.entries(schema)) {
      const value = data[fieldName];

      // Check required
      if (fieldSchema.required && value === undefined) {
        if (fieldSchema.default !== undefined) {
          result[fieldName] = fieldSchema.default;
        } else {
          throw new Error(`Required field missing: ${fieldName}`);
        }
        continue;
      }

      if (value === undefined) {
        if (fieldSchema.default !== undefined) {
          result[fieldName] = fieldSchema.default;
        }
        continue;
      }

      // Type coercion
      switch (fieldSchema.type) {
        case 'number':
          result[fieldName] = typeof value === 'number' ? value : parseFloat(value);
          if (fieldSchema.min !== undefined && result[fieldName] < fieldSchema.min) {
            result[fieldName] = fieldSchema.min;
          }
          if (fieldSchema.max !== undefined && result[fieldName] > fieldSchema.max) {
            result[fieldName] = fieldSchema.max;
          }
          break;

        case 'boolean':
          result[fieldName] = Boolean(value);
          break;

        case 'array':
          result[fieldName] = Array.isArray(value) ? value : [value];
          break;

        case 'object':
          if (fieldSchema.properties) {
            result[fieldName] = this.validateAndCoerce(value, fieldSchema.properties);
          } else {
            result[fieldName] = value;
          }
          break;

        default:
          result[fieldName] = String(value);
      }

      // Custom validation
      if (fieldSchema.validate) {
        const valid = fieldSchema.validate(result[fieldName]);
        if (valid !== true) {
          throw new Error(`Validation failed for ${fieldName}: ${valid}`);
        }
      }
    }

    return result as T;
  }

  /**
   * Merge results avec inputs
   */
  private mergeResults<TInput, TOutput>(
    inputs: TInput[],
    outputs: TOutput[],
    config: LLMStructuredCallConfig<TInput, TOutput>
  ): (TInput & TOutput)[] {
    if (inputs.length !== outputs.length) {
      throw new Error(`Mismatch: ${inputs.length} inputs vs ${outputs.length} outputs`);
    }

    return inputs.map((input, index) => {
      const output = outputs[index];

      if (config.customMerge) {
        return config.customMerge(input, output) as any;
      }

      switch (config.mergeStrategy) {
        case 'replace':
          return { ...output, ...input } as any;  // Output fields prioritaires

        case 'append':
        default:
          return { ...input, ...output } as any;  // Input fields prioritaires
      }
    });
  }
}
```

### 4. Unified Prompt Builder (Enhanced)

```typescript
/**
 * Builder unifié pour prompts structurés
 */
export class UnifiedPromptBuilder {
  private sections: Map<string, string> = new Map();
  private helpers: Map<string, Function> = new Map();
  private tokenBudget?: number;

  constructor() {
    // Register default helpers
    this.registerHelper('truncate', (text: string, max: number) => {
      if (text.length <= max) return text;
      return text.slice(0, max - 3) + '...';
    });

    this.registerHelper('join', (arr: any[], sep: string = ', ') => {
      return arr.join(sep);
    });

    this.registerHelper('formatCode', (code: string) => {
      // Smart code formatting avec indentation
      return code.trim().split('\n').map(l => '  ' + l).join('\n');
    });
  }

  addSection(name: string, content: string): this {
    this.sections.set(name, content);
    return this;
  }

  registerHelper(name: string, fn: Function): this {
    this.helpers.set(name, fn);
    return this;
  }

  withTokenBudget(budget: number): this {
    this.tokenBudget = budget;
    return this;
  }

  build(): string {
    const parts: string[] = [];

    // System context
    if (this.sections.has('system')) {
      parts.push(this.sections.get('system')!);
      parts.push('');
    }

    // Task
    if (this.sections.has('task')) {
      parts.push('## Task');
      parts.push(this.sections.get('task')!);
      parts.push('');
    }

    // Context
    if (this.sections.has('context')) {
      parts.push('## Context');
      parts.push(this.sections.get('context')!);
      parts.push('');
    }

    // Examples
    if (this.sections.has('examples')) {
      parts.push('## Examples');
      parts.push(this.sections.get('examples')!);
      parts.push('');
    }

    // Items
    if (this.sections.has('items')) {
      parts.push('## Items to Analyze');
      parts.push(this.sections.get('items')!);
      parts.push('');
    }

    // Output format
    if (this.sections.has('output')) {
      parts.push('## Required Output Format');
      parts.push(this.sections.get('output')!);
      parts.push('');
    }

    // Instructions
    if (this.sections.has('instructions')) {
      parts.push('## Additional Instructions');
      parts.push(this.sections.get('instructions')!);
      parts.push('');
    }

    let prompt = parts.join('\n');

    // Token budget enforcement
    if (this.tokenBudget) {
      const estimatedTokens = prompt.length / 4;  // Rough estimate
      if (estimatedTokens > this.tokenBudget) {
        console.warn(`Prompt exceeds token budget: ${estimatedTokens} > ${this.tokenBudget}`);
        // Truncate sections intelligemment (items d'abord, puis context, etc.)
        prompt = this.truncateToFit(prompt, this.tokenBudget);
      }
    }

    return prompt;
  }

  private truncateToFit(prompt: string, budget: number): string {
    // Smart truncation strategy
    // TODO: Implement intelligent truncation
    const targetChars = budget * 4;
    if (prompt.length <= targetChars) return prompt;
    return prompt.slice(0, targetChars - 100) + '\n\n[... content truncated to fit token budget ...]';
  }
}
```

---

## 💡 Use Cases Concrets

### Use Case 1: Security Audit

```typescript
const vulnerabilities = await rag.scope()
  .whereType('function')
  .semanticSearchBySource('authentication', { topK: 50 })
  .llmGenerateStructured({
    inputFields: [
      { name: 'name', maxLength: 100 },
      { name: 'source', maxLength: 2000, preferSummary: true },
      { name: 'file' }
    ],
    inputContext: {
      relationships: [
        { type: 'CONSUMES', maxItems: 5, fields: ['name'] },
        { type: 'USES_LIBRARY', maxItems: 10, fields: ['name', 'version'] }
      ]
    },

    systemPrompt: 'You are a security auditor analyzing authentication code for vulnerabilities.',

    outputSchema: {
      risk_level: {
        type: 'string',
        enum: ['Critical', 'High', 'Medium', 'Low', 'None'],
        description: 'Overall security risk level',
        required: true
      },
      vulnerabilities: {
        type: 'array',
        description: 'List of security issues found',
        items: {
          type: 'string',
          description: 'Specific vulnerability with OWASP classification if applicable'
        },
        prompt: 'Look for: SQL injection, XSS, hardcoded secrets, weak crypto, missing validation'
      },
      mitigations: {
        type: 'array',
        description: 'Recommended fixes',
        items: { type: 'string' }
      },
      confidence: {
        type: 'number',
        min: 0,
        max: 1,
        description: 'Confidence in this assessment (0-1)',
        prompt: 'Be honest if code is unclear or context is insufficient'
      }
    },

    batchSize: 10,
    parallel: 3,
    tokenBudget: 8000,

    llm: {
      provider: 'openai',
      model: 'gpt-4o',
      temperature: 0.2  // Low temp pour consistency
    }
  })
  .execute();

// Filtrer les critiques
const critical = vulnerabilities.filter(v => v.risk_level === 'Critical');

// Générer rapport
console.log(`Found ${critical.length} critical vulnerabilities:`);
critical.forEach(v => {
  console.log(`\n${v.name} (${v.file}):`);
  v.vulnerabilities.forEach(vuln => console.log(`  - ${vuln}`));
});
```

### Use Case 2: Documentation Generation

```typescript
const documentation = await rag.scope()
  .whereType('class')
  .llmGenerateStructured({
    inputFields: ['name', 'source', 'file'],
    inputContext: {
      relationships: [
        { type: 'HAS_METHOD', fields: ['name', 'signature'] },
        { type: 'INHERITS_FROM', fields: ['name'] },
        { type: 'IMPLEMENTS', fields: ['name'] }
      ],
      summaries: true
    },

    systemPrompt: 'You are a technical writer generating API documentation.',
    userTask: 'Generate comprehensive documentation for each class.',

    outputSchema: {
      summary: {
        type: 'string',
        description: 'One-sentence summary of what this class does',
        prompt: 'Focus on the primary responsibility, avoid implementation details',
        required: true
      },
      purpose: {
        type: 'string',
        description: 'Detailed explanation of purpose and use cases (2-3 sentences)'
      },
      key_methods: {
        type: 'array',
        description: 'List of important public methods with brief descriptions',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            example: { type: 'string' }
          }
        }
      },
      usage_example: {
        type: 'string',
        description: 'TypeScript code example showing typical usage',
        prompt: 'Generate a realistic code snippet, 5-10 lines max'
      },
      related_classes: {
        type: 'array',
        description: 'Classes that are commonly used together',
        items: { type: 'string' }
      }
    },

    batchSize: 15,
    llm: { provider: 'gemini', model: 'gemini-1.5-pro' }
  })
  .execute();

// Export vers Markdown
const markdown = documentation.map(doc => `
## ${doc.name}

**File**: \`${doc.file}\`

${doc.summary}

### Purpose
${doc.purpose}

### Key Methods
${doc.key_methods.map(m => `- **${m.name}**: ${m.description}`).join('\n')}

### Usage Example
\`\`\`typescript
${doc.usage_example}
\`\`\`

### Related Classes
${doc.related_classes.join(', ')}
`).join('\n---\n');

fs.writeFileSync('API_DOCS.md', markdown);
```

### Use Case 3: Smart Reranking (Backward Compat)

```typescript
// Ancien code (toujours supporté):
const results = await rag.scope()
  .semanticSearchBySource('auth flow', { topK: 100 })
  .rerankWithLLM({
    userQuestion: 'How does authentication work in this codebase?',
    topK: 10,
    scoreMerging: 'weighted',
    withSuggestions: true
  })
  .execute();

// Implémenté comme:
.llmGenerateStructured({
  inputFields: [
    { name: 'name', maxLength: 120 },
    { name: 'source', maxLength: 2500, preferSummary: true },
    { name: 'file' },
    { name: 'type' }
  ],
  inputContext: {
    relationships: ['CONSUMES', 'CONSUMED_BY'],
    summaries: true
  },

  contextData: {
    userQuestion: options.userQuestion
  },

  systemPrompt: 'You are ranking code scopes for relevance.',
  userTask: `Evaluate each scope's relevance to: "${options.userQuestion}"`,

  outputSchema: {
    llm_score: {
      type: 'number',
      min: 0,
      max: 1,
      description: 'Relevance score',
      prompt: 'Evaluate based on code content, dependencies, and purpose',
      required: true
    },
    llm_reasoning: {
      type: 'string',
      description: 'Specific reasons for this score',
      prompt: 'Reference concrete details from the code, avoid generic phrases',
      required: true
    }
  },

  mergeStrategy: 'custom',
  customMerge: (entity, generated) => {
    // Merge scores selon strategy
    const vectorScore = entity.score || 0;
    const llmScore = generated.llm_score;

    let finalScore: number;
    switch (options.scoreMerging) {
      case 'weighted':
        finalScore = 0.3 * vectorScore + 0.7 * llmScore;
        break;
      case 'multiplicative':
        finalScore = vectorScore * llmScore;
        break;
      case 'llm-override':
        finalScore = llmScore > 0.9 ? llmScore : 0.5 * vectorScore + 0.5 * llmScore;
        break;
    }

    return {
      ...entity,
      score: finalScore,
      llm_score: llmScore,
      llm_reasoning: generated.llm_reasoning
    };
  },

  batchSize: 10,
  parallel: 5
})
```

### Use Case 4: Code Quality Analysis

```typescript
const qualityReport = await rag.scope()
  .whereFile('src/**/*.ts')
  .llmGenerateStructured({
    inputFields: ['name', 'source', 'file', 'type'],
    inputContext: {
      relationships: [
        { type: 'CALLS', direction: 'both', maxItems: 20, fields: ['name'] }
      ]
    },

    outputSchema: {
      complexity: {
        type: 'string',
        enum: ['Low', 'Medium', 'High', 'Very High'],
        description: 'Cyclomatic complexity level'
      },
      maintainability_score: {
        type: 'number',
        min: 0,
        max: 100,
        description: 'Maintainability index (0-100)'
      },
      code_smells: {
        type: 'array',
        description: 'List of code smells detected',
        items: { type: 'string' },
        prompt: 'Look for: long methods, god classes, duplicate code, tight coupling'
      },
      test_coverage_estimate: {
        type: 'string',
        enum: ['None', 'Low', 'Medium', 'High'],
        description: 'Estimated test coverage based on code structure',
        prompt: 'Infer from naming, error handling, edge case coverage'
      },
      refactoring_priority: {
        type: 'string',
        enum: ['Low', 'Medium', 'High', 'Critical'],
        description: 'Priority for refactoring'
      },
      suggestions: {
        type: 'array',
        description: 'Specific refactoring suggestions',
        items: { type: 'string' }
      }
    },

    batchSize: 20,
    llm: { provider: 'gemini', model: 'gemini-1.5-flash' }  // Flash pour coût réduit
  })
  .execute();

// Générer rapport priorisé
const critical = qualityReport
  .filter(r => r.refactoring_priority === 'Critical')
  .sort((a, b) => a.maintainability_score - b.maintainability_score);

console.log('Critical refactoring needed:');
critical.forEach(r => {
  console.log(`\n${r.name} (${r.file}) - Score: ${r.maintainability_score}/100`);
  console.log('Code smells:', r.code_smells.join(', '));
  console.log('Suggestions:', r.suggestions.join('; '));
});
```

---

## 🚀 Migration Path

### Phase 1: Core Infrastructure (1-2 semaines)

1. **Créer `StructuredLLMExecutor`**
   - Batch processing avec token management
   - Multi-provider fallback
   - Cache layer

2. **Améliorer `UnifiedPromptBuilder`**
   - Helpers custom
   - Token budget enforcement
   - Smart truncation

3. **Extension `QueryBuilder`**
   - `.llmGenerateStructured()` method
   - Chainable API

### Phase 2: Backward Compatibility (1 semaine)

1. **Implémenter `.rerankWithLLM()` comme alias**
   - Wrapper autour de `.llmGenerateStructured()`
   - Migration path transparent

2. **Implémenter `.withSummaries()` comme alias**
   - Utilise summarization strategies existantes
   - Cache summaries dans Neo4j

3. **Tests de régression**
   - Vérifier que le comportement reste identique
   - Benchmarks de performance

### Phase 3: Refactor Systems Existants (2 semaines)

1. **Migrer LLMReranker**
   - Utiliser `StructuredLLMExecutor` en interne
   - Garder l'API publique identique

2. **Migrer GenericSummarizer**
   - Utiliser `StructuredLLMExecutor` en interne
   - Améliorer token packing

3. **Migrer IterativeCodeAgent**
   - Utiliser `.llmGenerateStructured()` pour steps
   - Paralléliser où possible

### Phase 4: Advanced Features (1-2 semaines)

1. **Streaming support**
   - Progressive results
   - Real-time feedback

2. **Advanced caching**
   - Semantic cache (similar prompts)
   - Distributed cache (Redis)

3. **Observability**
   - LlamaIndex callbacks integration
   - Metrics & tracing

---

## 🎯 Success Metrics

### Performance
- **Token efficiency**: ↓30% via smart packing & caching
- **Latency**: ↓50% via parallelization
- **Cost**: ↓40% via batching & fallback to cheaper models

### Developer Experience
- **Lines of code**: ↓60% pour use cases typiques
- **Time to implement**: ↓70% avec API chainable
- **Bugs**: ↓80% via validation de schema

### Reliability
- **Uptime**: ↑99.9% via multi-provider fallback
- **Success rate**: ↑95% via retry & validation
- **Error recovery**: ↑100% via fallback gracieux

---

## 📝 Open Questions

1. **Cache invalidation**: Quand régénérer les summaries?
   - Option A: Hash-based (content change)
   - Option B: Time-based (TTL)
   - Option C: Manual (user trigger)

2. **Token budget overflow**: Que faire si trop d'items?
   - Option A: Split en multiple requêtes
   - Option B: Truncate items (risque perte info)
   - Option C: Error (force user à réduire topK)

3. **Provider selection**: Auto ou manual?
   - Option A: Auto-select based on schema complexity
   - Option B: User specifies provider
   - Option C: Hybrid (user default + auto-fallback)

4. **Schema evolution**: Comment gérer breaking changes?
   - Option A: Versioning des schemas
   - Option B: Migration scripts
   - Option C: Best-effort coercion

5. **Streaming**: Comment streamer structured outputs?
   - Option A: Field-by-field streaming
   - Option B: Partial objects avec validation progressive
   - Option C: No streaming pour structured (wait for complete)

---

## 🔗 Related Work

- **LlamaIndex QueryPipeline**: Orchestration de modules LLM
- **OpenAI Structured Outputs**: JSON Schema validation native
- **Anthropic Tool Use**: Structured outputs via function calling
- **LangChain LCEL**: Chainable API pour LLM workflows
- **Instructor (Python)**: Validation Pydantic pour LLM outputs

---

## 📚 References

- [OpenAI Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs)
- [LlamaIndex Query Pipeline](https://docs.llamaindex.ai/en/stable/examples/pipeline/)
- [Anthropic Tool Use](https://docs.anthropic.com/claude/docs/tool-use)
- [JSON Schema Specification](https://json-schema.org/)
