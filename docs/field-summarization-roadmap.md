# Field-Level Summarization Roadmap

**Date**: 2025-11-10
**Status**: 📋 PLANNING
**Priority**: 🔵 HIGH (améliore significativement la qualité du LLM reranking)

## 🎯 Objectif

Créer un système **générique** de résumés au niveau des champs (field-level summarization) pour permettre au LLM reranker d'avoir accès à tout le contenu, pas juste 300 caractères tronqués.

**Caractéristiques clés**:
- ✅ Complètement générique (pas spécifique au code)
- ✅ Configuration déclarative via YAML
- ✅ Templates de prompts exportables et modifiables
- ✅ Cache dans Neo4j pour performance
- ✅ Batch processing pour efficacité
- ✅ On-demand ou pre-generated (flexible)

---

## 📦 Phase 1: Core Infrastructure

### 1.1 Structured Prompt Builder

**Fichier**: `packages/runtime/src/llm/structured-prompt-builder.ts`

**Fonctionnalités**:
- Génération de prompts avec template engine simple (Handlebars-like)
- Support pour `{{variable}}`, `{{#if}}...{{/if}}`, `{{#each}}...{{/each}}`
- Génération automatique des instructions XML basées sur schema
- Parsing de réponses XML structurées avec validation

**Interface**:
```typescript
interface PromptField {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required?: boolean;
  nested?: PromptField[];
}

interface StructuredPromptConfig {
  systemContext: string;
  userTask: string;
  examples?: string;
  outputFormat: {
    rootElement: string;
    fields: PromptField[];
  };
}

class StructuredPromptBuilder {
  constructor(config: StructuredPromptConfig) {}

  render(data: Record<string, any>): string;
  parse(response: string): any;
  previewInstructions(): string;
}
```

**Tests**:
- [ ] Template rendering avec variables simples
- [ ] Template rendering avec conditions
- [ ] Template rendering avec loops
- [ ] Génération d'instructions XML correctes
- [ ] Parsing de réponses XML valides
- [ ] Handling d'erreurs pour XML invalide

---

### 1.2 Generic Summarizer

**Fichier**: `packages/runtime/src/summarization/generic-summarizer.ts`

**Fonctionnalités**:
- Détermine si un champ a besoin d'un résumé (basé sur threshold)
- Génère des résumés en utilisant StructuredPromptBuilder
- Batch processing (via LLMProvider.generateBatch si disponible)
- Load et render des templates de prompts custom

**Interface**:
```typescript
interface SummarizationConfig {
  enabled: boolean;
  strategy: string;
  threshold: number;
  cache: boolean;
  on_demand: boolean;
  prompt_template?: string;
  output_fields: string[];
  rerank_use: 'always' | 'prefer_summary' | 'never';
}

interface SummaryStrategy {
  system_prompt: string;
  output_schema: {
    root: string;
    fields: Array<{
      name: string;
      type: 'string' | 'array' | 'object';
      description: string;
    }>;
  };
}

interface FieldSummary {
  [key: string]: string | string[];
}

class GenericSummarizer {
  constructor(
    llmProvider: LLMProvider,
    strategies: Map<string, SummaryStrategy>,
    promptTemplates: Map<string, string>
  ) {}

  needsSummary(fieldValue: string, config: SummarizationConfig): boolean;

  async summarizeField(
    entityType: string,
    fieldName: string,
    fieldValue: string,
    entity: any,
    config: SummarizationConfig
  ): Promise<FieldSummary>;

  async summarizeBatch(items: Array<{...}>): Promise<FieldSummary[]>;
}
```

**Tests**:
- [ ] needsSummary() retourne true/false correctement
- [ ] summarizeField() génère un résumé valide
- [ ] summarizeBatch() gère multiple items
- [ ] Template rendering fonctionne
- [ ] Fallback vers default prompt si template manquant
- [ ] Gestion d'erreurs LLM

---

## 📦 Phase 2: Configuration System

### 2.1 Extend YAML Schema

**Fichier**: `packages/core/src/types/config.ts`

**Nouvelles structures**:
```typescript
interface PropertyConfig {
  name: string;
  type: string;
  summarization?: {
    enabled: boolean;
    strategy: string;
    threshold: number;
    cache?: boolean;
    on_demand?: boolean;
    prompt_template?: string;
    output_fields: string[];
    rerank_use?: 'always' | 'prefer_summary' | 'never';
  };
}

interface SummarizationStrategyConfig {
  system_prompt: string;
  output_schema: {
    root: string;
    fields: Array<{
      name: string;
      type: string;
      description: string;
    }>;
  };
}

interface RagForgeConfig {
  // ... existing fields

  summarization_strategies?: Record<string, SummarizationStrategyConfig>;

  summarization_llm?: {
    provider: string;
    model: string;
    temperature?: number;
    max_tokens?: number;
  };
}
```

**Tâches**:
- [ ] Ajouter types TypeScript
- [ ] Valider schema YAML (Zod ou Joi)
- [ ] Documenter le nouveau schema
- [ ] Créer exemples de configs pour différents use cases

---

### 2.2 Default Strategies

**Fichier**: `packages/core/src/summarization/default-strategies.ts`

**Stratégies built-in**:
1. **`code_analysis`**: Pour code source
   - Output: purpose, operations, concepts, dependencies
2. **`text_extraction`**: Pour texte générique
   - Output: keywords, main_topic, entities
3. **`document_summary`**: Pour documents longs
   - Output: main_points, topics, key_entities

**Tâches**:
- [ ] Implémenter les 3 stratégies par défaut
- [ ] Tester avec exemples réels
- [ ] Documenter quand utiliser chaque stratégie
- [ ] Créer templates de prompts associés

---

## 📦 Phase 3: Storage & Caching

### 3.1 Neo4j Storage Strategy

**Fichiers**:
- `packages/runtime/src/adapters/code-source-adapter.ts` (modifier)
- `packages/runtime/src/summarization/summary-storage.ts` (nouveau)

**Fonctionnalités**:
- Génération automatique des property names: `{fieldName}_summary_{outputField}`
- Load cached summaries depuis Neo4j avant génération
- Store summaries après génération
- Timestamp: `{fieldName}_summarized_at`
- Support pour incremental updates (re-summarize si contenu changé)

**Schema Neo4j**:
```cypher
// Example pour field "source" avec strategy "code_analysis"
(:Scope {
  uuid: "...",
  source: "function foo() {...}",  // Original (peut être très long)

  // Résumés générés:
  source_summary_purpose: "Creates a new user account",
  source_summary_operations: "validates input, hashes password, saves to DB",
  source_summary_concepts: "authentication, database, validation",
  source_summarized_at: datetime("2025-01-10T15:30:00Z")
})
```

**Tâches**:
- [ ] Implémenter cache loading
- [ ] Implémenter batch storage
- [ ] Gérer les updates (détecter si source a changé)
- [ ] Ajouter métriques (combien de résumés générés vs cached)
- [ ] Tests avec large datasets

---

### 3.2 On-Demand vs Pre-Generated

**Fichier**: `packages/runtime/src/summarization/summary-manager.ts`

**Modes**:
1. **Pre-generated** (comme embeddings):
   - Script `generate-summaries.ts`
   - Exécuté manuellement ou en CI/CD
   - Idéal pour production

2. **On-demand** (lazy):
   - Généré à la volée lors du premier rerank
   - Mis en cache pour les prochaines fois
   - Idéal pour dev/prototyping

3. **Hybrid**:
   - Pre-generate pour contenu existant
   - On-demand pour nouveau contenu
   - Best of both worlds

**Tâches**:
- [ ] Implémenter les 3 modes
- [ ] Config pour choisir le mode
- [ ] Fallback gracieux si LLM unavailable
- [ ] Progress indicators pour pre-generation
- [ ] Tests pour chaque mode

---

## 📦 Phase 4: Code Generation

### 4.1 Generate Prompt Templates

**Fichier**: `packages/core/src/generator/prompt-generator.ts` (nouveau)

**Fonctionnalités**:
- Génère `prompts/{strategy_name}.txt` depuis config
- Support pour templates custom fournis par user
- Validation des templates (variables manquantes, etc.)

**Templates générés**:
```
generated/
├── prompts/
│   ├── code_analysis.txt       // Auto-généré depuis strategy config
│   ├── text_extraction.txt
│   └── custom_strategy.txt     // Si fourni par user
```

**Tâches**:
- [ ] Implémenter génération de templates
- [ ] Copier templates custom depuis project
- [ ] Validation des templates
- [ ] Documentation des variables disponibles

---

### 4.2 Generate Summary Script

**Fichier**: `packages/core/templates/scripts/generate-summaries.ts` (nouveau template)

**Fonctionnalités**:
- Lit la config YAML
- Pour chaque entity et field avec summarization enabled:
  - Query Neo4j pour items needing summaries
  - Generate summaries en batch
  - Store dans Neo4j
  - Show progress
- Options CLI: `--entity`, `--field`, `--force`, `--dry-run`

**Usage**:
```bash
npm run generate-summaries              # All entities/fields
npm run generate-summaries -- --entity=Scope --field=source
npm run generate-summaries -- --force   # Re-generate all
npm run generate-summaries -- --dry-run # Preview only
```

**Tâches**:
- [ ] Créer template du script
- [ ] Implémenter CLI args parsing
- [ ] Progress bars avec ora
- [ ] Error handling et retry logic
- [ ] Tests avec mock Neo4j

---

### 4.3 Update Reranker Integration

**Fichier**: `packages/runtime/src/reranking/llm-reranker.ts` (modifier)

**Modifications**:
- Constructor prend `SummaryManager` optionnel
- `buildPrompt()` check pour chaque field si résumé disponible
- Utilise résumé selon `rerank_use` config ('always', 'prefer_summary', 'never')
- Fallback vers valeur originale si résumé manquant

**Logique**:
```typescript
if (summaryAvailable) {
  if (rerank_use === 'always') {
    // Utiliser SEULEMENT le résumé
    prompt += `${field.label}: ${summary.purpose}\n`;
  } else if (rerank_use === 'prefer_summary') {
    // Résumé + snippet de l'original
    prompt += `${field.label}: ${summary.purpose}\n`;
    prompt += `  (Excerpt: ${original.substring(0, 200)}...)\n`;
  }
} else {
  // Fallback: valeur originale tronquée
  prompt += `${field.label}: ${truncate(original, maxLength)}\n`;
}
```

**Tâches**:
- [ ] Modifier buildPrompt() pour intégrer résumés
- [ ] Tester avec/sans résumés disponibles
- [ ] Benchmark qualité (avec vs sans résumés)
- [ ] Documentation du comportement

---

### 4.4 Update EntityContext Generation

**Fichier**: `packages/core/src/generator/code-generator.ts` (modifier)

**Modifications**:
- Générer EntityContext avec info sur summarization
- Inclure `rerank_use` config dans les field definitions
- Passer cette config au LLMReranker

**Tâches**:
- [ ] Extend EntityField type avec summarization info
- [ ] Générer correct context depuis config YAML
- [ ] Tests de génération

---

## 📦 Phase 5: Documentation & Examples

### 5.1 User Documentation

**Fichiers**:
- `docs/features/field-summarization.md` (nouveau)
- `docs/configuration/summarization.md` (nouveau)
- `docs/guides/custom-strategies.md` (nouveau)

**Contenu**:
- Overview du système
- Quand utiliser summarization
- Config examples pour différents use cases
- Comment créer une stratégie custom
- Performance considerations
- Troubleshooting

**Tâches**:
- [ ] Écrire documentation complète
- [ ] Screenshots/diagrammes
- [ ] Code examples
- [ ] FAQ section

---

### 5.2 Example Configs

**Fichier**: `examples/configs/` (nouveau dossier)

**Exemples à créer**:
1. **Code analysis** (ragforge.code-analysis.yaml):
   - Summarization sur `source`, `description`
   - Strategy: code_analysis

2. **E-commerce** (ragforge.ecommerce.yaml):
   - Summarization sur `description`, `reviews`
   - Strategy: product_features + text_extraction

3. **Document search** (ragforge.documents.yaml):
   - Summarization sur `content`, `abstract`
   - Strategy: document_summary

4. **Custom strategy** (ragforge.custom.yaml):
   - Montre comment définir une nouvelle stratégie
   - Template custom de prompt

**Tâches**:
- [ ] Créer les 4 example configs
- [ ] Tester que chaque example génère correctement
- [ ] Documenter les différences entre examples

---

### 5.3 Generated Examples

**Fichier**: `packages/core/src/generator/code-generator.ts` (modifier)

**Nouveaux exemples à générer**:
1. **`XX-view-summaries.ts`**: Liste les entities avec leurs résumés
2. **`XX-regenerate-summaries.ts`**: Exemple de re-génération pour entities spécifiques
3. **`XX-compare-with-without-summaries.ts`**: A/B test du reranking

**Tâches**:
- [ ] Implémenter génération des 3 nouveaux exemples
- [ ] Inclure seulement si summarization enabled dans config
- [ ] Tests que exemples compilent et s'exécutent

---

## 📦 Phase 6: Testing & Validation

### 6.1 Unit Tests

**Packages à tester**:
- `packages/runtime/src/llm/structured-prompt-builder.ts`
- `packages/runtime/src/summarization/generic-summarizer.ts`
- `packages/runtime/src/summarization/summary-storage.ts`
- `packages/runtime/src/summarization/summary-manager.ts`

**Coverage target**: 80%+

**Tâches**:
- [ ] Tests pour StructuredPromptBuilder
- [ ] Tests pour GenericSummarizer
- [ ] Tests pour storage layer
- [ ] Tests pour chaque default strategy
- [ ] Mock LLM provider pour tests

---

### 6.2 Integration Tests

**Scénarios**:
1. **End-to-end code summarization**:
   - Config avec code_analysis strategy
   - Generate summaries
   - Verify Neo4j storage
   - Rerank query utilise résumés

2. **Custom strategy**:
   - Config avec custom strategy + template
   - Generate summaries
   - Verify correct prompt used

3. **Cache behavior**:
   - Generate summaries
   - Re-run (should hit cache)
   - Modify source field
   - Re-run (should regenerate)

**Tâches**:
- [ ] Setup test Neo4j instance
- [ ] Implement les 3 scénarios
- [ ] CI/CD integration
- [ ] Performance benchmarks

---

### 6.3 Quality Validation

**Métriques à mesurer**:
1. **Reranking quality**:
   - Compare avec/sans résumés
   - Mesurer precision@K, recall@K
   - User feedback on relevance

2. **Summary quality**:
   - Manual review de résumés générés
   - Completeness (couvre tous les aspects?)
   - Accuracy (pas d'hallucinations?)

3. **Performance**:
   - Temps de génération (with/without batch)
   - Cache hit rate
   - Token usage (cost)

**Tâches**:
- [ ] Créer benchmark dataset
- [ ] Mesurer baseline (sans résumés)
- [ ] Mesurer avec résumés
- [ ] Documenter les gains

---

## 📦 Phase 7: Migration & Deployment

### 7.1 Breaking Changes

**Changements potentiels**:
- EntityContext structure étendue
- Config YAML schema étendu
- Nouveaux scripts générés

**Migration guide**:
- Pour users existants: opt-in (pas de breaking change si pas utilisé)
- Instructions pour activer summarization
- Comment migrer les résumés existants (si applicable)

**Tâches**:
- [ ] Documenter breaking changes
- [ ] Créer migration script si nécessaire
- [ ] Tests de backward compatibility

---

### 7.2 Release Plan

**Version target**: v0.2.0 (minor version bump)

**Release notes sections**:
1. **New Feature**: Field-Level Summarization
2. **Configuration**: New YAML schema
3. **Scripts**: generate-summaries.ts
4. **Performance**: Benchmarks
5. **Migration Guide**: For existing users

**Tâches**:
- [ ] Bump version numbers
- [ ] Update CHANGELOG.md
- [ ] Tag release
- [ ] Publish to npm
- [ ] Announce on GitHub/social

---

## 🎯 Success Criteria

### Must Have ✅
- [ ] StructuredPromptBuilder implémenté et testé
- [ ] GenericSummarizer implémenté et testé
- [ ] Config YAML étendu avec validation
- [ ] Au moins 2 default strategies (code_analysis, text_extraction)
- [ ] Neo4j storage avec cache
- [ ] generate-summaries.ts script généré
- [ ] Reranker utilise résumés quand disponibles
- [ ] Documentation complète
- [ ] Tests coverage > 80%

### Should Have 🟡
- [ ] Batch processing efficace
- [ ] On-demand summarization
- [ ] Custom prompt templates support
- [ ] Progress indicators
- [ ] Error recovery
- [ ] Performance benchmarks

### Nice to Have 🔵
- [ ] Incremental updates (re-summarize on change)
- [ ] Summary versioning (track changes)
- [ ] Multi-language support
- [ ] Summary quality metrics
- [ ] A/B testing framework

---

## 📅 Estimated Timeline

| Phase | Description | Estimated Time | Dependencies |
|-------|-------------|----------------|--------------|
| 1 | Core Infrastructure | 3-4 days | None |
| 2 | Configuration System | 2-3 days | Phase 1 |
| 3 | Storage & Caching | 2-3 days | Phase 1, 2 |
| 4 | Code Generation | 3-4 days | Phase 1, 2, 3 |
| 5 | Documentation & Examples | 2-3 days | Phase 4 |
| 6 | Testing & Validation | 3-4 days | All phases |
| 7 | Migration & Deployment | 1-2 days | All phases |
| **TOTAL** | **End-to-end** | **16-23 days** | Sequential |

**Note**: Peut être parallelized pour certaines phases (ex: Phase 5 peut commencer pendant Phase 4)

---

## 🔗 Related Documents

- `docs/phase3-implementation-summary.md` - Phase 3 context (heritage clauses, generics)
- `docs/querybuilder-result-structure-decision.md` - Result structure decisions
- `docs/generated-examples-status.md` - Current examples status
- `docs/example-query-length-analysis.md` - Query truncation analysis (inspira cette roadmap)

---

## 💡 Future Enhancements (Post-MVP)

1. **Multi-modal summaries**: Images, audio transcriptions
2. **Hierarchical summaries**: Summary of summaries for very large content
3. **Semantic compression**: Use embeddings to find most important parts
4. **Summary chaining**: Use one summary as input to generate another
5. **Quality feedback loop**: Users rate summary quality → improve prompts
6. **Cost optimization**: Estimate costs before generation, suggest cheaper alternatives

---

## 📝 Notes & Considerations

### Performance
- Batch processing crucial (10-20x faster que sequential)
- Cache hit rate should be > 90% après première génération
- Consider rate limits des LLM providers

### Cost
- Estimate: ~$0.001-0.01 per summary (depending on model)
- Pour 10,000 scopes: ~$10-100
- Beaucoup moins cher que re-générer à chaque query

### Quality
- Garbage in, garbage out: résumés dépendent de la qualité du prompt
- Users doivent pouvoir customiser les prompts
- Monitoring important (log hallucinations, errors)

### UX
- Progress bars essentiels pour pre-generation
- Clear error messages si LLM fails
- Dry-run mode pour preview avant generate
