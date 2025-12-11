# Roadmap : Architecture Unifiée pour la Proactivité

## Vue d'ensemble

Ce document propose une architecture unifiée pour regrouper et optimiser les différentes features de proactivité, réduisant la duplication et améliorant la maintenabilité.

## Problème Actuel : Duplication et Fragmentation

Les features actuelles sont fragmentées et dupliquent certaines logiques :

1. **Modifications de prompt** : 4-5 features modifient séparément `buildSystemPrompt()`
2. **Analyses structurées** : Plusieurs features utilisent `StructuredLLMExecutor` de manière isolée
3. **Systèmes de retry** : Logique de retry dispersée dans plusieurs endroits
4. **Validations** : Validations post-action non unifiées

## Solution : Architecture Modulaire Unifiée

### Composant 1 : Prompt Builder Unifié

**Problème** : 5 features modifient séparément le system prompt
- Manifeste de Proactivité
- Critic Mode
- Détection de Lazy Response
- Dynamic Planning
- Few-Shot Prompting

**Solution** : Créer un `ProactivePromptBuilder` qui assemble tous les composants

```typescript
// packages/core/src/runtime/agents/proactive-prompt-builder.ts
export class ProactivePromptBuilder {
  private components: PromptComponent[] = [];
  
  addManifesto(): this {
    this.components.push({
      name: 'manifesto',
      content: `**🛑 PROACTIVITY MANIFESTO (MANDATORY)**:
1. **ANTICIPATE DEPENDENCIES**: ...
2. **IMPLICIT CONTEXT**: ...
3. **FULL COMPLETION**: ...
4. **DEFENSIVE CODING**: ...`
    });
    return this;
  }
  
  addCriticMode(): this {
    this.components.push({
      name: 'critic',
      content: `**PROTOCOL DE QUALITÉ (CRITIC MODE)**:
Avant de donner une réponse finale...`
    });
    return this;
  }
  
  addLazyResponseDetection(): this {
    this.components.push({
      name: 'lazy_response',
      content: `**WHEN YOU ARE STUCK OR FIND NOTHING**: ...`
    });
    return this;
  }
  
  addDynamicPlanning(): this {
    this.components.push({
      name: 'dynamic_planning',
      content: `⚡ **DYNAMIC PLANNING**: ...`
    });
    return this;
  }
  
  addFewShotExamples(examples: string[]): this {
    this.components.push({
      name: 'few_shot',
      content: `*** EXEMPLES DE COMPORTEMENT ATTENDU ***\n${examples.join('\n\n')}`
    });
    return this;
  }
  
  build(): string {
    return this.components
      .map(c => c.content)
      .join('\n\n');
  }
}

// Usage dans rag-agent.ts
const promptBuilder = new ProactivePromptBuilder()
  .addManifesto()
  .addCriticMode()
  .addLazyResponseDetection()
  .addDynamicPlanning();

const proactivePrompt = promptBuilder.build();
basePrompt += proactivePrompt;
```

**Gain** : 
- ✅ Une seule modification de `buildSystemPrompt()`
- ✅ Composants activables/désactivables via config
- ✅ Réutilisable et testable indépendamment

---

### Composant 2 : Quality Analyzer Unifié

**Problème** : Plusieurs features analysent la qualité avec `StructuredLLMExecutor`
- Response Quality Analyzer (analyse réponse complète)
- Thought-Loop Forcé (analyse contexte avant action)

**Solution** : Créer un `QualityAnalyzer` unifié avec schémas réutilisables

```typescript
// packages/core/src/runtime/agents/quality-analyzer.ts
import { StructuredLLMExecutor } from '../llm/structured-llm-executor.js';

export interface QualityAnalysis {
  effectiveness_score: number;
  is_effective: boolean;
  missing_context?: string[];
  suggested_actions?: Array<{
    type: 'search' | 'read_file' | 'tool_call';
    tool?: string;
    query?: string;
    reason: string;
  }>;
  should_retry?: boolean;
  improved_query?: string;
}

export class QualityAnalyzer {
  private executor: StructuredLLMExecutor;
  private schemas: Map<string, OutputSchema> = new Map();
  
  constructor(llmProvider: LLMProvider) {
    this.executor = new StructuredLLMExecutor(llmProvider);
    this.initializeSchemas();
  }
  
  private initializeSchemas() {
    // Schéma pour analyse de réponse complète
    this.schemas.set('response_quality', {
      effectiveness_score: { type: 'number', required: true },
      is_effective: { type: 'boolean', required: true },
      should_have_used_tools: { type: 'boolean', required: true },
      suggested_tools: { type: 'array', items: { /* ... */ } },
      improved_query: { type: 'string', required: false },
      // ...
    });
    
    // Schéma pour analyse de contexte (Thought-Loop)
    this.schemas.set('context_analysis', {
      context_analysis: { type: 'string', required: true },
      planned_actions: { type: 'string', required: false },
      missing_dependencies: { type: 'array', items: { type: 'string' } },
      // ...
    });
  }
  
  /**
   * Analyse la qualité d'une réponse complète
   */
  async analyzeResponse(
    userQuery: string,
    agentResponse: string,
    toolsUsed: string[],
    availableTools: string[]
  ): Promise<QualityAnalysis> {
    const schema = this.schemas.get('response_quality')!;
    
    return await this.executor.executeSingle<QualityAnalysis>({
      systemPrompt: `You are a quality analyzer...`,
      userTask: `USER QUERY: "${userQuery}"\nAGENT RESPONSE: "${agentResponse}"`,
      outputSchema: schema,
      outputFormat: 'xml',
      llmProvider: this.executor.llmProvider,
    });
  }
  
  /**
   * Analyse le contexte avant action (Thought-Loop)
   */
  async analyzeContext(
    userQuery: string,
    currentContext: string
  ): Promise<QualityAnalysis> {
    const schema = this.schemas.get('context_analysis')!;
    
    return await this.executor.executeSingle<QualityAnalysis>({
      systemPrompt: `Analyze the context before taking action...`,
      userTask: `QUERY: "${userQuery}"\nCONTEXT: "${currentContext}"`,
      outputSchema: schema,
      outputFormat: 'xml',
      llmProvider: this.executor.llmProvider,
    });
  }
}
```

**Gain** :
- ✅ Schémas réutilisables et centralisés
- ✅ Une seule instance de `StructuredLLMExecutor`
- ✅ Analyses cohérentes entre features

---

### Composant 3 : Retry Manager Unifié

**Problème** : Logique de retry dispersée
- Response Quality Analyzer (retry avec query améliorée)
- Replanning (retry après échec d'étape)

**Solution** : Créer un `RetryManager` centralisé

```typescript
// packages/core/src/runtime/agents/retry-manager.ts
export interface RetryStrategy {
  type: 'improved_query' | 'recovery' | 'alternative_approach';
  maxAttempts: number;
  shouldRetry: (context: RetryContext) => boolean;
  buildRetryQuery: (context: RetryContext) => string;
}

export interface RetryContext {
  originalQuery: string;
  lastResponse?: string;
  error?: Error;
  toolsUsed: string[];
  attemptNumber: number;
  analysis?: QualityAnalysis;
}

export class RetryManager {
  private strategies: RetryStrategy[] = [];
  private maxTotalRetries: number = 3;
  
  constructor() {
    this.initializeStrategies();
  }
  
  private initializeStrategies() {
    // Stratégie 1 : Retry avec query améliorée (Response Quality Analyzer)
    this.strategies.push({
      type: 'improved_query',
      maxAttempts: 1,
      shouldRetry: (ctx) => {
        return ctx.analysis?.should_retry === true 
          && ctx.toolsUsed.length === 0
          && ctx.attemptNumber < this.maxTotalRetries;
      },
      buildRetryQuery: (ctx) => {
        return ctx.analysis?.improved_query || ctx.originalQuery;
      }
    });
    
    // Stratégie 2 : Recovery après échec (Replanning)
    this.strategies.push({
      type: 'recovery',
      maxAttempts: 2,
      shouldRetry: (ctx) => {
        return ctx.error !== undefined 
          && ctx.attemptNumber < this.maxTotalRetries;
      },
      buildRetryQuery: (ctx) => {
        return `L'action précédente a échoué avec l'erreur : "${ctx.error?.message}".
Analyse l'erreur et propose une correction immédiate.
Utilise les outils nécessaires pour réparer.`;
      }
    });
  }
  
  async shouldRetry(context: RetryContext): Promise<{
    shouldRetry: boolean;
    retryQuery?: string;
    strategy?: RetryStrategy;
  }> {
    for (const strategy of this.strategies) {
      if (strategy.shouldRetry(context)) {
        return {
          shouldRetry: true,
          retryQuery: strategy.buildRetryQuery(context),
          strategy
        };
      }
    }
    
    return { shouldRetry: false };
  }
}
```

**Gain** :
- ✅ Logique de retry centralisée et configurable
- ✅ Stratégies de retry réutilisables
- ✅ Évite les boucles infinies avec limite globale

---

### Composant 4 : Validation Pipeline Unifié

**Problème** : Validations post-action non unifiées
- Self-Healing (validation syntaxique fichiers)

**Solution** : Créer un `ValidationPipeline` extensible

```typescript
// packages/core/src/runtime/agents/validation-pipeline.ts
export interface ValidationRule {
  name: string;
  appliesTo: (toolName: string, args: any) => boolean;
  validate: (toolName: string, args: any, result: any) => Promise<ValidationResult>;
}

export interface ValidationResult {
  passed: boolean;
  warnings?: string[];
  errors?: string[];
  suggestions?: string[];
}

export class ValidationPipeline {
  private rules: ValidationRule[] = [];
  
  constructor() {
    this.initializeRules();
  }
  
  private initializeRules() {
    // Règle 1 : Validation syntaxique fichiers de code
    this.rules.push({
      name: 'syntax_validation',
      appliesTo: (toolName) => ['write_file', 'edit_file', 'create_file'].includes(toolName),
      validate: async (toolName, args, result) => {
        if (!args.path.match(/\.(ts|js|tsx|jsx)$/)) {
          return { passed: true };
        }
        
        const syntaxErrors = await validateSyntax(args.path);
        if (syntaxErrors.length > 0) {
          return {
            passed: false,
            warnings: [`Erreurs de syntaxe : ${syntaxErrors.join(', ')}. CORRIGE IMMÉDIATEMENT.`]
          };
        }
        
        return { passed: true };
      }
    });
    
    // Règle 2 : Vérification des imports (peut être ajoutée plus tard)
    // Règle 3 : Vérification des dépendances (peut être ajoutée plus tard)
  }
  
  async validate(toolName: string, args: any, result: any): Promise<ValidationResult> {
    const applicableRules = this.rules.filter(r => r.appliesTo(toolName, args));
    
    const results = await Promise.all(
      applicableRules.map(r => r.validate(toolName, args, result))
    );
    
    // Fusionner les résultats
    return {
      passed: results.every(r => r.passed),
      warnings: results.flatMap(r => r.warnings || []),
      errors: results.flatMap(r => r.errors || []),
      suggestions: results.flatMap(r => r.suggestions || [])
    };
  }
  
  addRule(rule: ValidationRule): this {
    this.rules.push(rule);
    return this;
  }
}
```

**Gain** :
- ✅ Pipeline extensible pour nouvelles validations
- ✅ Validations modulaires et testables
- ✅ Facile d'ajouter de nouvelles règles

---

## Architecture Unifiée Complète

### Intégration dans `rag-agent.ts`

```typescript
export class RagAgent {
  private promptBuilder: ProactivePromptBuilder;
  private qualityAnalyzer: QualityAnalyzer;
  private retryManager: RetryManager;
  private validationPipeline: ValidationPipeline;
  
  constructor(options: RagAgentOptions) {
    // Initialiser les composants unifiés
    this.promptBuilder = new ProactivePromptBuilder()
      .addManifesto()
      .addCriticMode()
      .addLazyResponseDetection()
      .addDynamicPlanning();
    
    this.qualityAnalyzer = new QualityAnalyzer(options.llmProvider);
    this.retryManager = new RetryManager();
    this.validationPipeline = new ValidationPipeline();
  }
  
  buildSystemPrompt(): string {
    // UNE SEULE modification du prompt
    const basePrompt = `You are an AUTONOMOUS SENIOR SOFTWARE ARCHITECT...`;
    const proactivePrompt = this.promptBuilder.build();
    return basePrompt + '\n\n' + proactivePrompt;
  }
  
  async ask(query: string): Promise<AgentResponse> {
    let attemptNumber = 0;
    let lastResponse: AgentResponse | undefined;
    
    while (attemptNumber < this.retryManager.maxTotalRetries) {
      // 1. Exécuter la requête
      const response = await this.executeQuery(query);
      lastResponse = response;
      
      // 2. Valider les actions (Self-Healing)
      for (const toolCall of response.toolsUsed) {
        const validation = await this.validationPipeline.validate(
          toolCall.tool_name,
          toolCall.args,
          toolCall.result
        );
        
        if (!validation.passed) {
          response.warnings = [...(response.warnings || []), ...(validation.warnings || [])];
        }
      }
      
      // 3. Analyser la qualité (Response Quality Analyzer)
      if (response.toolsUsed.length === 0) {
        const analysis = await this.qualityAnalyzer.analyzeResponse(
          query,
          response.answer,
          response.toolsUsed,
          this.getAvailableToolNames()
        );
        
        // 4. Décider du retry (Retry Manager)
        const retryDecision = await this.retryManager.shouldRetry({
          originalQuery: query,
          lastResponse: response.answer,
          toolsUsed: response.toolsUsed,
          attemptNumber,
          analysis
        });
        
        if (retryDecision.shouldRetry && retryDecision.retryQuery) {
          query = retryDecision.retryQuery;
          attemptNumber++;
          continue; // Retry avec query améliorée
        }
      }
      
      // 5. Si pas de retry, retourner la réponse
      return response;
    }
    
    // Si on arrive ici, on a épuisé les retries
    return lastResponse!;
  }
  
  async executeSubAgent(plan: ActionPlan): Promise<PlanExecutionResult> {
    // ... code existant ...
    
    // Intégrer Replanning avec RetryManager
    try {
      // ... exécution de l'étape ...
    } catch (error) {
      const retryDecision = await this.retryManager.shouldRetry({
        originalQuery: task.description,
        error,
        toolsUsed: [],
        attemptNumber: attempts
      });
      
      if (retryDecision.shouldRetry && retryDecision.retryQuery) {
        // Retry avec recovery
        continue;
      }
    }
  }
}
```

---

## Gains d'Optimisation

### Réduction des Opérations

| Avant | Après | Gain |
|-------|-------|------|
| 5 modifications de `buildSystemPrompt()` | 1 modification avec builder | **-80%** |
| 2 instances de `StructuredLLMExecutor` | 1 instance partagée | **-50%** |
| 2 logiques de retry séparées | 1 manager unifié | **-50%** |
| Validations dispersées | 1 pipeline extensible | **Centralisé** |

### Avantages

1. **Maintenabilité** : Code centralisé, plus facile à maintenir
2. **Testabilité** : Composants testables indépendamment
3. **Extensibilité** : Facile d'ajouter de nouvelles features
4. **Performance** : Réutilisation d'instances, moins de duplication
5. **Cohérence** : Comportement unifié entre features

---

## Plan de Migration

### Phase 1 : Créer les Composants Unifiés
1. Créer `ProactivePromptBuilder`
2. Créer `QualityAnalyzer`
3. Créer `RetryManager`
4. Créer `ValidationPipeline`

### Phase 2 : Migrer les Features Existantes
1. Migrer les modifications de prompt vers `ProactivePromptBuilder`
2. Migrer Response Quality Analyzer vers `QualityAnalyzer`
3. Migrer Replanning vers `RetryManager`
4. Migrer Self-Healing vers `ValidationPipeline`

### Phase 3 : Intégration et Tests
1. Intégrer dans `rag-agent.ts`
2. Tests d'intégration
3. Tests de régression
4. Documentation

---

## Métriques de Succès

- **Réduction du code** : -40% de lignes de code dupliquées
- **Temps d'implémentation** : -50% pour ajouter une nouvelle feature de proactivité
- **Maintenabilité** : +60% de facilité à modifier le comportement
- **Performance** : Pas de dégradation, réutilisation d'instances

---

## Notes

Cette architecture unifiée permet de :
- Implémenter toutes les features de proactivité avec moins de code
- Maintenir et étendre facilement le système
- Tester chaque composant indépendamment
- Activer/désactiver des features via configuration

Les composants sont modulaires et peuvent être activés progressivement, permettant une migration en douceur sans casser le code existant.
