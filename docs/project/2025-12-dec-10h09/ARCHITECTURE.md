# Architecture Actuelle de la Mémoire de Conversation

## Vue d'ensemble

Le système de mémoire de conversation de RagForge est implémenté principalement dans :
- `packages/core/src/runtime/conversation/storage.ts` - Stockage et recherche
- `packages/core/src/runtime/agents/rag-agent.ts` - Utilisation du contexte
- `packages/core/src/runtime/llm/structured-llm-executor.ts` - Exécution avec contexte

## 1. Modèle de données (Neo4j)

### Hiérarchie des nœuds

```
Conversation
├── uuid: string
├── title: string
├── tags: string[]
├── created_at: datetime
├── updated_at: datetime
├── message_count: number
├── total_chars: number
└── status: string

    └─[:HAS_MESSAGE]─► Message
                        ├── uuid: string
                        ├── conversation_id: string
                        ├── role: "user" | "assistant" | "system"
                        ├── content: string
                        ├── reasoning?: string
                        ├── timestamp: datetime
                        ├── char_count: number
                        └── embedding: float[] (vector)

                            └─[:HAS_TOOL_CALL]─► ToolCall
                                                ├── uuid: string
                                                ├── tool_name: string
                                                ├── arguments: string (JSON)
                                                ├── duration_ms: number
                                                └── success: boolean

                                                    └─[:HAS_RESULT]─► ToolResult
                                                                      ├── uuid: string
                                                                      ├── result: string
                                                                      ├── error?: string
                                                                      └── result_size_bytes: number
```

### Index vectoriels

| Index | Nœud | Propriété | Utilisation |
|-------|------|-----------|-------------|
| `message_embedding_index` | Message | embedding | Recherche sémantique historique |
| `scope_embedding_content_vector` | Scope | embedding | Recherche sémantique code |

## 2. Niveaux de résumé hiérarchique

Le système utilise 3 niveaux de résumé avec des seuils configurables :

### L0 - Turns bruts
- **Confiance**: 1.0 (maximale)
- **Contenu**: Messages user + assistant + tool calls
- **Rétention**: Toujours accessible

### L1 - Résumés de conversation
- **Confiance**: 0.7
- **Seuil**: 10% du `maxContextChars` (défaut: 10,000 chars)
- **Contenu**:
  - Résumé de la conversation
  - Résumé des actions (tools utilisés)
  - Fichiers mentionnés
  - Turns couverts (plage)

### L2 - Résumés consolidés
- **Confiance**: 0.5
- **Seuil**: 10% du `maxContextChars`
- **Contenu**: Consolidation de plusieurs L1
- **Utilisation**: Contexte long-terme

## 3. Context Engineering (`buildEnrichedContext`)

### Pipeline d'enrichissement

```
Question utilisateur
        │
        ▼
┌───────────────────────────────────────────────────────────┐
│  1. getLastUserQueries()                                  │
│     • 5% du budget de contexte                            │
│     • Dernières requêtes avec turnIndex                   │
└───────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────┐
│  2. getRecentTurns()                                      │
│     • 5% du budget de contexte                            │
│     • Échanges user/assistant bruts                       │
│     • Toujours affichés même si résumés                   │
└───────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────┐
│  3. Recherches parallèles                                 │
│     ┌─────────────────┬─────────────────┐                 │
│     │                 │                 │                 │
│     ▼                 ▼                 ▼                 │
│  searchConversation  searchCode      searchCode          │
│  History()           Semantic()      FuzzyWithLLM()      │
│     │                 │                 │                 │
│     └─────────────────┴─────────────────┘                 │
│                       │                                   │
│                       ▼                                   │
│              Merge & Deduplicate                          │
│              (par file:startLine:endLine)                 │
└───────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────┐
│  4. getRecentL1Summaries()                                │
│     • 10% du budget de contexte                           │
│     • Résumés non encore consolidés en L2                 │
│     • Continuité du contexte                              │
└───────────────────────────────────────────────────────────┘
        │
        ▼
    EnrichedContext
```

### Conditions pour la recherche sémantique code

```typescript
canRunSemanticSearch =
  isProjectKnown AND
  locksAvailable AND
  (isSubdirectory OR hasProjectsInCwd)
```

- **isProjectKnown**: Un projet est chargé dans le brain
- **locksAvailable**: `embeddingLock` ET `ingestionLock` non verrouillés
- **isSubdirectory**: `cwd` est sous-répertoire de `projectRoot`
- **hasProjectsInCwd**: `cwd` contient des projets enregistrés

### Stratégie de recherche code (PARALLÈLE)

> **Note** : La recherche fuzzy n'est PAS un fallback. Elle s'exécute **toujours en parallèle** avec la recherche sémantique.

```
┌─────────────────────────────────────────────────────────┐
│                   Promise.all([...])                    │
├────────────────────────┬────────────────────────────────┤
│                        │                                │
│  Recherche sémantique  │  Recherche fuzzy (LLM-guided)  │
│  (conditionnelle)      │  (TOUJOURS exécutée)           │
│                        │                                │
│  Conditions:           │  Utilise:                      │
│  • projet connu        │  • grep_files                  │
│  • locks disponibles   │  • search_files                │
│  • sous-répertoire OR  │  • list_directory              │
│    projets dans cwd    │  • glob_files                  │
│                        │                                │
└────────────────────────┴────────────────────────────────┘
                         │
                         ▼
              Merge & Deduplicate
              (par file:startLine:endLine)
              Sémantique prioritaire si doublons
```

## 4. Formatage du contexte (`formatContextForAgent`)

### Structure du contexte injecté

```markdown
## Last User Queries
[Turn 5] Comment fonctionne l'authentification ?
[Turn 8] Peux-tu refactorer cette fonction ?

## Recent Conversation (Raw)
**User**: [question récente]
**Assistant**: [réponse récente]
Tools used: read_file, edit_file

## Relevant Past Context

### L0 Turns (confidence: 1.0)
[Relevance: 85%, Confidence: 100%]
**User**: [question passée pertinente]
**Assistant**: [réponse]
Tools: grep_files

### L1 Summaries (confidence: 0.7)
[Relevance: 72%, Confidence: 70%]
**Conversation**: Résumé de la discussion sur...
**Actions**: L'utilisateur a demandé... J'ai utilisé...
**Files**: src/auth.ts, src/utils.ts

### L2 Summaries (confidence: 0.5)
[Relevance: 60%, Confidence: 50%]
**Conversation**: Contexte long-terme sur...

## Relevant Code Context (confidence: 0.5)
### src/auth/handler.ts (lines 45-89)
[Relevance: 78%, Confidence: 50%]
\`\`\`typescript
export function handleAuth() {
  // code tronqué à 500 chars max
}
\`\`\`

## Recent L1 Summaries (Not Yet Summarized)
[Pour continuité même si non retrouvé par recherche]
```

## 5. Injection dans le prompt agent

### Dans RagAgent.ask()

```typescript
// Ligne ~1055-1114 de rag-agent.ts
if (this.conversationStorage && conversationId) {
  enrichedContext = await this.conversationStorage.buildEnrichedContext(
    conversationId,
    question,
    { cwd, projectRoot, embeddingLock, ingestionLock }
  );
  enrichedContextString = this.conversationStorage.formatContextForAgent(enrichedContext);
}

// Injection dans le system prompt
const systemPrompt = historyContext
  ? `${this.buildSystemPrompt()}\n\n${historyContext}`
  : this.buildSystemPrompt();
```

## 6. Constantes et configuration

### Valeurs par défaut (types.ts)

| Paramètre | Défaut | Description |
|-----------|--------|-------------|
| `maxContextChars` | 100,000 | Budget total de contexte |
| `l1ThresholdPercent` | 10% | Seuil pour déclencher résumé L1 |
| `l2ThresholdPercent` | 10% | Seuil pour déclencher résumé L2 |
| `lastUserQueriesPercent` | 5% | Budget pour requêtes récentes |
| `codeSearchPercent` | 10% | Budget pour contexte code |
| `codeSearchInitialLimit` | 100 | Limite résultats recherche code |
| `semanticMinScore` | 0.3 | Score minimum pour résultats |

## 7. Mécanismes de debugging existants

### AgentLogger

```typescript
// packages/core/src/runtime/agents/rag-agent.ts
export class AgentLogger {
  logIteration(iteration, llmResponse)
  logToolCall(toolName, args, reasoning)
  logToolResult(toolName, result, durationMs)
  logFinalAnswer(answer, confidence)
  logError(error, context)
  getSession(): AgentSessionLog
  flush(): void
}
```

### Options de logging StructuredLLMExecutor

```typescript
// packages/core/src/runtime/llm/structured-llm-executor.ts
{
  logPrompts: boolean | string,    // Console ou fichier
  logResponses: boolean | string,  // Console ou fichier
  onLLMResponse: (iteration, reasoning, toolCalls, output) => void
}
```

### Logs console

Préfixes utilisés :
- `[ConversationStorage]` - Opérations de stockage et recherche
- `[executeSingle]` - Exécution LLM structurée
- `[RagAgent]` - Opérations de l'agent

## 8. Limitations actuelles

1. **Pas d'inspection interactive** du contexte enrichi
2. **Pas de test isolé** des recherches sémantiques
3. **Pas de visibilité** sur le prompt final envoyé au LLM
4. **Pas d'inspection** des embeddings stockés
5. **Debugging uniquement via logs** (pas d'outils dédiés)

## 9. Bugs connus

### BUG: `messagesToTurns` ignore les tool calls intermédiaires

**Fichier**: `packages/core/src/runtime/conversation/storage.ts:815-864`

**Problème**: La méthode assume un pairing simple `user[i]` → `assistant[i+1]`, mais l'agent peut générer plusieurs messages assistant avec des tool calls avant la réponse finale.

**Impact**: Les tool calls des messages assistant intermédiaires sont perdus dans `getRecentTurns()`.

**Exemple**:
```
user[0]      → "Lis ce fichier"
assistant[1] → (tool_call: read_file)     ← IGNORÉ
assistant[2] → (tool_call: grep_files)    ← IGNORÉ
assistant[3] → "Voici le contenu..."      ← Seul ce message est capturé
```

**Voir**: [BUGS_FOUND.md](./BUGS_FOUND.md) pour la solution proposée.
