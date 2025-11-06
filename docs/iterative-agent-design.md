# Iterative Code Agent - Design

## 🎯 Concept

Un agent LLM qui **écrit et exécute du code TypeScript** pour interroger RagForge et construire progressivement le contexte parfait.

L'agent est un **développeur automatisé** qui:
1. Reçoit une question utilisateur
2. Génère du code TypeScript pour interroger RagForge
3. Exécute ce code avec `tsx`
4. Analyse les résultats
5. Décide de la prochaine étape
6. Répète jusqu'à avoir le bon contexte

## 🔄 Workflow

```
┌─────────────────────────────────────────────────────────────┐
│                    User Question                            │
│          "À quoi sert la classe TypeScriptParser?"          │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              Iteration 1: Initial Search                    │
├─────────────────────────────────────────────────────────────┤
│  LLM generates code:                                        │
│    const results = await rag.scope()                        │
│      .semanticSearchBySource('TypeScript parser', {         │
│        topK: 100                                            │
│      })                                                     │
│      .execute();                                            │
├─────────────────────────────────────────────────────────────┤
│  Execute → 87 results                                       │
├─────────────────────────────────────────────────────────────┤
│  LLM analyzes (structured XML):                             │
│    <quality>good</quality>                                  │
│    <nextAction>refine</nextAction>                          │
│    <reasoning>Found parsers but too many test files         │
│    </reasoning>                                             │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              Iteration 2: Refine Search                     │
├─────────────────────────────────────────────────────────────┤
│  LLM generates code:                                        │
│    const results = await rag.scope()                        │
│      .where({ file: { contains: 'lib/parsers' } })         │
│      .semanticSearchBySource('parse AST extract', {         │
│        topK: 30                                             │
│      })                                                     │
│      .execute();                                            │
├─────────────────────────────────────────────────────────────┤
│  Execute → 12 results                                       │
├─────────────────────────────────────────────────────────────┤
│  LLM analyzes:                                              │
│    <quality>good</quality>                                  │
│    <nextAction>expand</nextAction>                          │
│    <reasoning>Found main parser, now get dependencies       │
│    </reasoning>                                             │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              Iteration 3: Expand Context                    │
├─────────────────────────────────────────────────────────────┤
│  LLM generates code:                                        │
│    const results = await rag.scope()                        │
│      .whereConsumedByScope('TypeScriptParser')              │
│      .execute();                                            │
├─────────────────────────────────────────────────────────────┤
│  Execute → 8 dependencies                                   │
├─────────────────────────────────────────────────────────────┤
│  LLM analyzes:                                              │
│    <quality>excellent</quality>                             │
│    <nextAction>complete</nextAction>                        │
│    <reasoning>Have parser + dependencies, can answer        │
│    </reasoning>                                             │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                  Final Synthesis                            │
├─────────────────────────────────────────────────────────────┤
│  LLM synthesizes answer from all 27 scopes:                 │
│                                                             │
│  <answer>                                                   │
│  TypeScriptParser est la classe principale pour parser     │
│  les fichiers TypeScript. Elle utilise le compilateur      │
│  TypeScript pour extraire l'AST et identifier les scopes   │
│  (fonctions, classes, interfaces, etc.).                   │
│                                                             │
│  Fichiers clés:                                             │
│  - src/lib/parsers/TypeScriptParser.ts: Classe principale  │
│  - Dépendances: typescript, fs, path                       │
│  - Méthodes: parseFile(), extractScopes(), extractFunction │
│  </answer>                                                  │
└─────────────────────────────────────────────────────────────┘
```

## 🏗️ Architecture

### Agent Principal

```typescript
class IterativeCodeAgent {
  async answer(userQuestion: string): Promise<AgentResult> {
    for (let i = 1; i <= maxIterations; i++) {
      // 1. Generate code
      const code = await this.generateQueryCode(userQuestion, previousResults, i);

      // 2. Execute code
      const results = await this.executeCode(code);

      // 3. Analyze with LLM
      const analysis = await this.analyzeResults(userQuestion, results, i);

      // 4. Check if done
      if (analysis.nextAction === 'complete') break;
    }

    // 5. Final synthesis
    return this.synthesizeAnswer(userQuestion, allResults);
  }
}
```

### LLM Interface

```typescript
interface LLMClient {
  generate(prompt: string): Promise<string>;
}
```

Implémentation pour Gemini, Claude, GPT-4, etc.

### XML Structured Outputs

Toutes les réponses LLM sont en XML structuré:

**Code Generation:**
```xml
<code>
const rag = createRagClient({ ... });
const results = await rag.scope()
  .semanticSearchBySource('query', { topK: 50 })
  .execute();
console.log(JSON.stringify(results));
</code>
```

**Analysis:**
```xml
<analysis>
  <quality>excellent|good|insufficient|irrelevant</quality>
  <findings>
    <finding>Found TypeScriptParser class</finding>
    <finding>Missing dependency information</finding>
  </findings>
  <nextAction>search|expand|refine|complete</nextAction>
  <reasoning>Explanation of decision</reasoning>
  <nextQuery>Optional refined query</nextQuery>
</analysis>
```

**Answer:**
```xml
<answer>
The final answer to the user's question...
</answer>
```

## 💡 Key Features

### 1. Framework Knowledge

L'agent a accès à des exemples du framework:

```typescript
const FRAMEWORK_EXAMPLES = `
# Basic Search
const results = await rag.scope()
  .semanticSearchBySource('parse typescript', { topK: 10 })
  .execute();

# Relationships
const consumers = await rag.scope()
  .whereConsumesScope('TypeScriptParser')
  .execute();

# Filtering
const results = await rag.scope()
  .where({ file: { contains: 'parser' } })
  .semanticSearchBySource('extract', { topK: 20 })
  .execute();
`;
```

Ces exemples sont injectés dans les prompts LLM.

### 2. Code Execution

L'agent écrit du code TypeScript dans un fichier temporaire et l'exécute:

```typescript
private async executeCode(code: string): Promise<SearchResult[]> {
  const tempFile = `agent-query-${Date.now()}.ts`;
  writeFileSync(tempFile, code);

  const output = execSync(`npx tsx ${tempFile}`);
  const results = JSON.parse(output);

  unlinkSync(tempFile);
  return results;
}
```

### 3. Iterative Refinement

L'agent peut:
- **Search:** Large initial query
- **Refine:** Different query based on findings
- **Expand:** Get relationships (deps, consumers)
- **Complete:** Stop when enough context

### 4. Context Merging

Résultats de toutes les itérations sont fusionnés (dedupe par UUID) et triés par score.

## 🎬 Usage Example

```typescript
import { IterativeCodeAgent } from '@ragforge/runtime';
import { GeminiLLMClient } from './gemini-client';

const agent = new IterativeCodeAgent({
  llm: new GeminiLLMClient(),
  ragClientPath: './generated-client/index.js',
  workDir: process.cwd(),
  maxIterations: 5,
  verbose: true
});

const result = await agent.answer(
  "À quoi sert la classe TypeScriptParser?"
);

console.log(result.answer);
console.log('Context:', result.context.length, 'scopes');
console.log('Iterations:', result.totalIterations);
```

## 📊 Benefits

### vs Static Queries

| Feature | Static Query | Iterative Agent |
|---------|-------------|-----------------|
| Adaptability | Fixed | Adjusts based on results |
| Context Building | One shot | Progressive refinement |
| Relationship Exploration | Manual | Automatic |
| Result Quality | Depends on query | Self-improving |
| User Input | Precise query needed | Natural language OK |

### vs Simple LLM RAG

| Feature | Simple RAG | Iterative Agent |
|---------|-----------|-----------------|
| Search Strategy | Single vector search | Multi-strategy (semantic + relationships) |
| Code Context | Top-K results | Intelligently expanded |
| Understanding | Surface level | Deep (follows dependencies) |
| Iteration | None | Multiple rounds |

## 🔮 Future Enhancements

### 1. Tool Library

Au lieu de générer du code brut, l'agent pourrait appeler des "tools":

```typescript
interface AgentTool {
  name: string;
  description: string;
  execute(params: any): Promise<any>;
}

const tools = [
  {
    name: 'semanticSearch',
    description: 'Search code by semantic similarity',
    execute: async ({ query, topK }) => { ... }
  },
  {
    name: 'getDependencies',
    description: 'Get all dependencies of a scope',
    execute: async ({ scopeName }) => { ... }
  }
];
```

L'agent choisit quel tool appeler (format function calling).

### 2. Multi-Agent Collaboration

Plusieurs agents spécialisés:
- **SearchAgent:** Expert en queries sémantiques
- **GraphAgent:** Expert en traversée de graphe
- **SynthesisAgent:** Expert en synthèse de réponses

### 3. Human-in-the-Loop

L'agent peut demander clarification:

```
Agent: "J'ai trouvé 2 TypeScriptParser classes. Laquelle vous intéresse?
        1. src/lib/parsers/TypeScriptParser.ts
        2. packages/codeparsers/src/legacy/TypeScriptParser.ts"

User: "La première"

Agent: "OK, je continue avec src/lib/parsers/TypeScriptParser.ts"
```

### 4. Learning from Feedback

Stocker les queries réussies pour améliorer les futures:

```typescript
interface QueryPattern {
  userIntent: string;
  successfulQueries: string[];
  score: number;
}

// Next time, start with proven patterns
const patterns = await learningDB.findSimilar(userQuestion);
```

## 🧪 Testing Strategy

### Unit Tests

- Test code generation avec mocks LLM
- Test XML parsing
- Test result merging

### Integration Tests

- Test avec vraie base Neo4j
- Test avec vrai LLM (Gemini)
- Vérifier convergence en X iterations

### Quality Metrics

- **Precision@K:** Top K results sont-ils pertinents?
- **Coverage:** A-t-on trouvé tous les scopes importants?
- **Efficiency:** Nombre moyen d'iterations
- **Cost:** Tokens LLM consommés

## 📝 Implementation Checklist

- [x] Core agent architecture
- [x] Code generation with LLM
- [x] Code execution with tsx
- [x] XML structured outputs
- [x] Result analysis
- [x] Iterative loop
- [ ] Build runtime package
- [ ] Test with real queries
- [ ] Add error handling
- [ ] Add timeout protection
- [ ] Add cost tracking (LLM tokens)
- [ ] Documentation and examples
- [ ] Tool library abstraction
- [ ] Multi-agent orchestration

## 🎯 Success Criteria

The agent is successful if:

1. **Answers correctly** 80%+ of code questions
2. **Converges** in <5 iterations on average
3. **Finds relevant context** (Precision@10 > 0.7)
4. **Handles edge cases** (no crashes, graceful degradation)
5. **Cost-effective** (<50k tokens per query on average)

---

**Next Step:** Build, test, iterate! 🚀
