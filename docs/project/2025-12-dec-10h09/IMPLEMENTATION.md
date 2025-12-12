# Plan d'Implémentation : Debug Tools

## Vue d'ensemble

Ce document détaille le plan d'implémentation des 5 outils de debug pour la mémoire de conversation.

## Structure des fichiers

```
packages/core/src/
├── tools/
│   └── debug-tools.ts          # Nouveau fichier - logique des outils
├── runtime/
│   └── conversation/
│       └── storage.ts          # Modifications mineures pour exposer des méthodes
└── index.ts                    # Export des nouveaux outils

packages/cli/src/
└── mcp/
    └── tools/
        └── debug-tools.ts      # Handlers MCP pour les outils
```

## Phase 1 : `debug_context` (Priorité haute)

### Étape 1.1 : Créer la structure de base

```typescript
// packages/core/src/tools/debug-tools.ts

import { ConversationStorage } from '../runtime/conversation/storage';

export interface DebugContextParams {
  conversation_id: string;
  query: string;
  show_raw?: boolean;
  show_formatted?: boolean;
  show_sources?: boolean;
  show_scores?: boolean;
}

export interface DebugContextResult {
  stats: {
    total_chars: number;
    budget_used_percent: number;
    search_time_ms: number;
  };
  sources: { /* ... */ };
  raw_context?: EnrichedContext;
  formatted_context?: string;
  search_details?: { /* ... */ };
}

export async function debugContext(
  storage: ConversationStorage,
  params: DebugContextParams
): Promise<DebugContextResult> {
  // Implémentation
}
```

### Étape 1.2 : Modifier ConversationStorage

Ajouter des méthodes pour exposer les données intermédiaires :

```typescript
// packages/core/src/runtime/conversation/storage.ts

// Nouvelle méthode publique
public async buildEnrichedContextWithMetrics(
  conversationId: string,
  query: string,
  options: BuildEnrichedContextOptions
): Promise<{
  context: EnrichedContext;
  metrics: {
    search_time_ms: number;
    conversation_results: SearchResultWithScore[];
    code_results: CodeSearchResultWithScore[];
  };
}> {
  // Wrapper autour de buildEnrichedContext avec timing et résultats détaillés
}
```

### Étape 1.3 : Créer le handler MCP

```typescript
// packages/cli/src/mcp/tools/debug-tools.ts

import { debugContext } from '@ragforge/core';

export const debugContextTool = {
  name: 'debug_context',
  description: 'Inspect enriched context before agent injection',
  inputSchema: { /* Zod schema */ },
  handler: async (params, context) => {
    const result = await debugContext(context.conversationStorage, params);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
};
```

### Étape 1.4 : Tests

```typescript
// packages/core/src/tools/__tests__/debug-tools.test.ts

describe('debugContext', () => {
  it('should return context stats', async () => { /* ... */ });
  it('should include raw context when requested', async () => { /* ... */ });
  it('should show search scores when requested', async () => { /* ... */ });
});
```

---

## Phase 2 : `debug_agent_prompt` (Priorité haute)

### Étape 2.1 : Extraire la logique de construction du prompt

```typescript
// packages/core/src/runtime/agents/rag-agent.ts

// Nouvelle méthode publique
public buildPromptPreview(
  question: string,
  enrichedContext: string,
  options?: { includeTools?: boolean }
): {
  full_prompt: string;
  sections: {
    system_prompt: { chars: number; content: string };
    tools: { chars: number; count: number; content?: string };
    context: { chars: number; content: string };
    question: { chars: number; content: string };
  };
} {
  // Construction du prompt sans exécution
}
```

### Étape 2.2 : Créer l'outil de debug

```typescript
// packages/core/src/tools/debug-tools.ts

export async function debugAgentPrompt(
  agent: RagAgent,
  storage: ConversationStorage,
  params: DebugAgentPromptParams
): Promise<DebugAgentPromptResult> {
  // 1. Construire le contexte enrichi
  const enrichedContext = await storage.buildEnrichedContext(/*...*/);
  const formatted = storage.formatContextForAgent(enrichedContext);

  // 2. Construire le prompt sans exécuter
  const preview = agent.buildPromptPreview(params.question, formatted, {
    includeTools: params.include_tools
  });

  // 3. Retourner avec métriques
  return {
    full_prompt: params.truncate_at
      ? preview.full_prompt.slice(0, params.truncate_at)
      : preview.full_prompt,
    sections: preview.sections,
    total_chars: preview.full_prompt.length,
    estimated_tokens: Math.ceil(preview.full_prompt.length / 4)  // Approximation
  };
}
```

---

## Phase 3 : `debug_conversation_search` (Priorité moyenne)

### Étape 3.1 : Exposer la recherche sémantique

```typescript
// packages/core/src/runtime/conversation/storage.ts

// Rendre public avec plus de détails
public async searchConversationHistoryDetailed(
  conversationId: string,
  query: string,
  options: {
    minScore?: number;
    limit?: number;
    level?: 'L0' | 'L1' | 'L2' | 'all';
    includeEmbeddings?: boolean;
  }
): Promise<{
  query_embedding: number[];
  results: Array<{
    level: string;
    score: number;
    confidence: number;
    content: Message | Summary;
    embedding?: number[];
  }>;
  metrics: {
    search_time_ms: number;
    total_scanned: number;
    filtered_count: number;
  };
}> {
  // Implémentation basée sur searchConversationHistory existante
}
```

---

## Phase 4 : `debug_list_summaries` (Priorité moyenne)

### Étape 4.1 : Ajouter une méthode de listing

```typescript
// packages/core/src/runtime/conversation/storage.ts

public async listSummaries(
  conversationId: string,
  options: {
    level?: 'L1' | 'L2' | 'all';
    includeContent?: boolean;
    includeMetadata?: boolean;
  }
): Promise<{
  conversation_info: ConversationInfo;
  summaries: {
    l1: L1Summary[];
    l2: L2Summary[];
  };
  stats: SummaryStats;
}> {
  // Query Neo4j pour récupérer les résumés
}
```

### Étape 4.2 : Requête Cypher

```cypher
// Récupérer les L1
MATCH (c:Conversation {uuid: $conversationId})-[:HAS_SUMMARY]->(s:L1Summary)
RETURN s
ORDER BY s.created_at DESC

// Récupérer les L2
MATCH (c:Conversation {uuid: $conversationId})-[:HAS_SUMMARY]->(s:L2Summary)
OPTIONAL MATCH (s)-[:CONSOLIDATES]->(l1:L1Summary)
RETURN s, collect(l1.uuid) as consolidated_l1s
ORDER BY s.created_at DESC
```

---

## Phase 5 : `debug_message` (Priorité basse)

### Étape 5.1 : Ajouter une méthode d'inspection

```typescript
// packages/core/src/runtime/conversation/storage.ts

public async inspectMessage(
  options: {
    messageId?: string;
    conversationId?: string;
    turnIndex?: number;
  },
  details: {
    showEmbedding?: boolean;
    showToolCalls?: boolean;
    showNeighbors?: boolean;
  }
): Promise<MessageInspection> {
  // Query Neo4j avec les relations appropriées
}
```

### Étape 5.2 : Requête Cypher

```cypher
// Message avec tool calls
MATCH (m:Message {uuid: $messageId})
OPTIONAL MATCH (m)-[:HAS_TOOL_CALL]->(tc:ToolCall)
OPTIONAL MATCH (tc)-[:HAS_RESULT]->(tr:ToolResult)
RETURN m, collect({call: tc, result: tr}) as tool_calls

// Voisins
MATCH (c:Conversation)-[:HAS_MESSAGE]->(m:Message {uuid: $messageId})
MATCH (c)-[:HAS_MESSAGE]->(neighbor:Message)
WHERE neighbor.timestamp < m.timestamp OR neighbor.timestamp > m.timestamp
RETURN neighbor
ORDER BY neighbor.timestamp
LIMIT 2
```

---

## Enregistrement MCP

### Ajout au serveur MCP existant

```typescript
// packages/cli/src/mcp/server.ts

import {
  debugContextTool,
  debugAgentPromptTool,
  debugConversationSearchTool,
  debugListSummariesTool,
  debugMessageTool
} from './tools/debug-tools';

// Dans la configuration du serveur
const debugTools = [
  debugContextTool,
  debugAgentPromptTool,
  debugConversationSearchTool,
  debugListSummariesTool,
  debugMessageTool
];

// Enregistrer si le mode debug est activé
if (config.enableDebugTools) {
  debugTools.forEach(tool => server.registerTool(tool));
}
```

### Configuration

```typescript
// packages/cli/src/config.ts

export interface ServerConfig {
  // ...existing config
  enableDebugTools?: boolean;  // Défaut: true en dev, false en prod
}
```

---

## Tests d'intégration

```typescript
// packages/cli/src/mcp/tools/__tests__/debug-tools.integration.test.ts

describe('Debug Tools Integration', () => {
  let storage: ConversationStorage;
  let testConversationId: string;

  beforeAll(async () => {
    // Créer une conversation de test avec messages
  });

  describe('debug_context', () => {
    it('should return enriched context for a query', async () => {
      const result = await callMcpTool('debug_context', {
        conversation_id: testConversationId,
        query: 'test query',
        show_sources: true
      });
      expect(result.stats).toBeDefined();
      expect(result.sources).toBeDefined();
    });
  });

  // ... autres tests
});
```

---

## Checklist d'implémentation

### Phase 1 : debug_context
- [ ] Créer `packages/core/src/tools/debug-tools.ts`
- [ ] Ajouter `buildEnrichedContextWithMetrics` à ConversationStorage
- [ ] Créer le handler MCP
- [ ] Écrire les tests unitaires
- [ ] Tester manuellement via MCP

### Phase 2 : debug_agent_prompt
- [ ] Ajouter `buildPromptPreview` à RagAgent
- [ ] Implémenter `debugAgentPrompt`
- [ ] Créer le handler MCP
- [ ] Tests

### Phase 3 : debug_conversation_search
- [ ] Ajouter `searchConversationHistoryDetailed`
- [ ] Implémenter l'outil
- [ ] Handler MCP
- [ ] Tests

### Phase 4 : debug_list_summaries
- [ ] Ajouter `listSummaries`
- [ ] Implémenter l'outil
- [ ] Handler MCP
- [ ] Tests

### Phase 5 : debug_message
- [ ] Ajouter `inspectMessage`
- [ ] Implémenter l'outil
- [ ] Handler MCP
- [ ] Tests

### Finalisation
- [ ] Configuration `enableDebugTools`
- [ ] Documentation utilisateur
- [ ] Tests d'intégration
- [ ] Review et merge

---

## Estimation de complexité

| Outil | Complexité | Fichiers modifiés |
|-------|------------|-------------------|
| debug_context | Moyenne | 3 |
| debug_agent_prompt | Moyenne | 3 |
| debug_conversation_search | Faible | 2 |
| debug_list_summaries | Faible | 2 |
| debug_message | Faible | 2 |

**Total** : ~5 fichiers à créer/modifier significativement
