# Iterative Code Agent

🤖 **Un agent LLM qui écrit et exécute du code TypeScript pour construire progressivement le contexte parfait.**

## Concept

Au lieu d'une simple recherche sémantique, l'agent:
1. **Génère du code TypeScript** pour interroger RagForge
2. **Exécute ce code** avec `tsx`
3. **Analyse les résultats** avec un LLM (structured XML)
4. **Décide** de la prochaine action (refine, expand, complete)
5. **Itère** jusqu'à avoir le bon contexte

## Architecture

```typescript
┌──────────────────────┐
│   User Question      │
│ "À quoi sert X?"     │
└──────┬───────────────┘
       │
       ▼
┌──────────────────────────────────┐
│  Iteration Loop (max 5)          │
│                                  │
│  ┌────────────────────────────┐ │
│  │ 1. LLM generates TS code   │ │
│  └────────────────────────────┘ │
│                                  │
│  ┌────────────────────────────┐ │
│  │ 2. Execute with tsx        │ │
│  └────────────────────────────┘ │
│                                  │
│  ┌────────────────────────────┐ │
│  │ 3. LLM analyzes (XML)      │ │
│  │    <quality>good</quality>  │ │
│  │    <nextAction>expand</... │ │
│  └────────────────────────────┘ │
│                                  │
│  ┌────────────────────────────┐ │
│  │ 4. Decide: continue or     │ │
│  │    stop if complete        │ │
│  └────────────────────────────┘ │
└──────────────────────────────────┘
       │
       ▼
┌──────────────────────┐
│  Final Synthesis     │
│  LLM creates answer  │
└──────────────────────┘
```

## Usage

```typescript
import { IterativeCodeAgent } from '@ragforge/runtime/agent';
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

## LLM Interface

Implementez `LLMClient` pour votre provider préféré:

```typescript
interface LLMClient {
  generate(prompt: string): Promise<string>;
}

// Example with Gemini
class GeminiLLMClient implements LLMClient {
  async generate(prompt: string): Promise<string> {
    const result = await this.model.generateContent(prompt);
    return result.response.text;
  }
}
```

## Structured XML Outputs

Toutes les réponses LLM sont en XML structuré et parsées avec `@luciformresearch/xmlparser`.

### Code Generation
```xml
<code>
import { createRagClient } from './client';
const rag = createRagClient({ ... });
const results = await rag.scope()
  .semanticSearchBySource('query', { topK: 50 })
  .execute();
console.log(JSON.stringify(results));
</code>
```

### Analysis
```xml
<analysis>
  <quality>excellent|good|insufficient|irrelevant</quality>
  <findings>
    <finding>Found TypeScriptParser class</finding>
    <finding>Missing dependencies</finding>
  </findings>
  <nextAction>search|expand|refine|complete</nextAction>
  <reasoning>Explanation here</reasoning>
  <nextQuery>Optional refined query</nextQuery>
</analysis>
```

### Answer
```xml
<answer>
The final answer to the user's question...
</answer>
```

## Framework Knowledge

L'agent a accès à des exemples du framework (voir `FRAMEWORK_EXAMPLES` constant):

- Basic semantic search
- Relationship queries (whereConsumesScope, whereConsumedByScope)
- Filtering
- Combining operations

Ces exemples sont injectés dans les prompts LLM pour guider la génération de code.

## Features

- ✅ **Iterative refinement** - S'améliore à chaque itération
- ✅ **Code execution** - Teste réellement les queries
- ✅ **Structured analysis** - XML parsing robuste
- ✅ **Result merging** - Déduplique par UUID
- ✅ **Verbose logging** - Trace complète de l'exécution

## Configuration

```typescript
interface AgentConfig {
  llm: LLMClient;                    // LLM provider
  ragClientPath: string;             // Path to generated client
  workDir: string;                   // Temp script directory
  maxIterations?: number;            // Default: 5
  verbose?: boolean;                 // Default: false
}
```

## Example Output

```
🤖 Agent starting: "À quoi sert la classe TypeScriptParser?"

======================================================================
Iteration 1/5
======================================================================

📝 Generated code:
const results = await rag.scope()
  .semanticSearchBySource('TypeScript parser class', { topK: 100 })
  .execute();

✅ Execution complete: 87 results

🔍 Analysis:
   Quality: good
   Next action: refine
   Reasoning: Found parsers but too many test files

======================================================================
Iteration 2/5
======================================================================

📝 Generated code:
const results = await rag.scope()
  .where({ file: { contains: 'lib/parsers' } })
  .semanticSearchBySource('parse AST extract', { topK: 30 })
  .execute();

✅ Execution complete: 12 results

🔍 Analysis:
   Quality: excellent
   Next action: complete
   Reasoning: Found main parser class with clear context

======================================================================
Synthesizing final answer...
======================================================================

✅ Complete in 3547ms after 2 iterations

Answer: TypeScriptParser est la classe principale pour parser les fichiers
TypeScript. Elle utilise le compilateur TypeScript pour extraire l'AST...
```

## Future Enhancements

- [ ] Tool library (instead of raw code generation)
- [ ] Multi-agent collaboration
- [ ] Human-in-the-loop for clarifications
- [ ] Learning from successful queries
- [ ] Cost tracking (LLM tokens)
- [ ] Timeout protection
- [ ] Retry with backoff

## Testing

```bash
cd ragforge/examples
npx tsx test-iterative-agent.ts
```

## Documentation

See [iterative-agent-design.md](../../../docs/iterative-agent-design.md) for full design document.
