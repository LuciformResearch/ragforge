# Proposition : Outils de Debug pour la Mémoire de Conversation

## Objectif

Fournir des outils MCP dédiés permettant d'**inspecter, tester et debugger** le système de mémoire de conversation sans avoir à analyser des logs ou modifier le code.

## Cas d'usage

1. **Diagnostic de contexte manquant** : "Pourquoi l'agent n'a pas retrouvé cette info ?"
2. **Validation des embeddings** : "Est-ce que mes messages sont bien vectorisés ?"
3. **Test de recherche** : "Quelle requête retourne les bons résultats ?"
4. **Inspection du prompt** : "Que voit exactement l'agent comme contexte ?"
5. **Audit des résumés** : "Quels résumés L1/L2 existent pour cette conversation ?"

## Outils proposés

### 1. `debug_context`

**Objectif** : Inspecter le contexte enrichi AVANT qu'il soit injecté dans le prompt agent.

```typescript
interface DebugContextParams {
  conversation_id: string;
  query: string;              // Question simulée pour la recherche
  show_raw?: boolean;         // Afficher l'objet EnrichedContext brut
  show_formatted?: boolean;   // Afficher le texte formaté pour l'agent
  show_sources?: boolean;     // Détailler les sources (semantic vs fuzzy)
  show_scores?: boolean;      // Afficher les scores de similarité
}

interface DebugContextResult {
  // Statistiques globales
  stats: {
    total_chars: number;
    budget_used_percent: number;
    search_time_ms: number;
  };

  // Sources détaillées
  sources: {
    last_user_queries: { count: number; chars: number };
    recent_turns: { count: number; chars: number };
    conversation_history: {
      l0_count: number;
      l1_count: number;
      l2_count: number;
      semantic_results: number;
    };
    code_results: {
      semantic_count: number;
      fuzzy_count: number;
      merged_count: number;
    };
    l1_summaries: { count: number; chars: number };
  };

  // Contenu optionnel
  raw_context?: EnrichedContext;
  formatted_context?: string;

  // Détails des résultats de recherche
  search_details?: {
    conversation: Array<{
      type: "L0" | "L1" | "L2";
      score: number;
      confidence: number;
      preview: string;
    }>;
    code: Array<{
      source: "semantic" | "fuzzy";
      file: string;
      lines: string;
      score: number;
      preview: string;
    }>;
  };
}
```

**Exemple d'utilisation** :
```
debug_context({
  conversation_id: "abc-123",
  query: "comment fonctionne l'authentification ?",
  show_sources: true,
  show_scores: true
})
```

---

### 2. `debug_agent_prompt`

**Objectif** : Simuler et afficher le prompt complet qui serait envoyé au LLM.

```typescript
interface DebugAgentPromptParams {
  conversation_id: string;
  question: string;
  include_system_prompt?: boolean;  // Inclure le system prompt de base
  include_tools?: boolean;          // Inclure la liste des outils
  truncate_at?: number;             // Tronquer le résultat (défaut: pas de troncature)
}

interface DebugAgentPromptResult {
  // Le prompt complet
  full_prompt: string;

  // Sections décomposées
  sections: {
    system_prompt: { chars: number; preview?: string };
    tools_description: { chars: number; tool_count: number };
    enriched_context: { chars: number; preview?: string };
    user_question: { chars: number };
  };

  // Métriques
  total_chars: number;
  estimated_tokens: number;  // Approximation
}
```

**Exemple d'utilisation** :
```
debug_agent_prompt({
  conversation_id: "abc-123",
  question: "peux-tu refactorer cette fonction ?",
  include_system_prompt: true
})
```

---

### 3. `debug_conversation_search`

**Objectif** : Tester la recherche sémantique sur l'historique de conversation de manière isolée.

```typescript
interface DebugConversationSearchParams {
  conversation_id: string;
  query: string;
  min_score?: number;           // Score minimum (défaut: 0.3)
  limit?: number;               // Nombre max de résultats (défaut: 20)
  level?: "L0" | "L1" | "L2" | "all";  // Filtrer par niveau
  include_embeddings?: boolean; // Inclure les vecteurs (attention: verbeux)
}

interface DebugConversationSearchResult {
  query_embedding_preview: number[];  // Premiers 10 dims du vecteur query

  results: Array<{
    level: "L0" | "L1" | "L2";
    score: number;
    confidence: number;

    // Pour L0
    message?: {
      role: string;
      content: string;
      timestamp: string;
      tool_calls?: string[];
    };

    // Pour L1/L2
    summary?: {
      conversation_summary: string;
      actions_summary: string;
      files_mentioned: string[];
      turns_covered: string;
    };

    embedding_preview?: number[];  // Si demandé
  }>;

  // Métriques
  search_time_ms: number;
  total_scanned: number;
  filtered_by_score: number;
}
```

**Exemple d'utilisation** :
```
debug_conversation_search({
  conversation_id: "abc-123",
  query: "erreur d'authentification",
  level: "L0",
  min_score: 0.5,
  limit: 10
})
```

---

### 4. `debug_list_summaries`

**Objectif** : Lister et inspecter les résumés existants pour une conversation.

```typescript
interface DebugListSummariesParams {
  conversation_id: string;
  level?: "L1" | "L2" | "all";     // Filtrer par niveau
  include_content?: boolean;       // Inclure le contenu complet
  include_metadata?: boolean;      // Inclure les métadonnées détaillées
}

interface DebugListSummariesResult {
  conversation_info: {
    id: string;
    title: string;
    total_messages: number;
    total_chars: number;
    created_at: string;
  };

  summaries: {
    l1: Array<{
      uuid: string;
      turns_covered: { start: number; end: number };
      created_at: string;
      char_count: number;
      content?: {
        conversation_summary: string;
        actions_summary: string;
        files_mentioned: string[];
      };
      metadata?: {
        has_embedding: boolean;
        embedding_dims?: number;
      };
    }>;

    l2: Array<{
      uuid: string;
      l1_summaries_consolidated: string[];  // UUIDs des L1
      created_at: string;
      char_count: number;
      content?: {
        consolidated_summary: string;
      };
      metadata?: {
        has_embedding: boolean;
        embedding_dims?: number;
      };
    }>;
  };

  // Statistiques
  stats: {
    l1_count: number;
    l2_count: number;
    total_summarized_turns: number;
    unsummarized_turns: number;
    consolidation_ratio: number;  // L1/L2
  };
}
```

**Exemple d'utilisation** :
```
debug_list_summaries({
  conversation_id: "abc-123",
  level: "all",
  include_content: true
})
```

---

### 5. `debug_message`

**Objectif** : Inspecter un message spécifique et ses métadonnées.

```typescript
interface DebugMessageParams {
  message_id?: string;           // Par UUID
  conversation_id?: string;      // Avec turn_index pour trouver par position
  turn_index?: number;
  show_embedding?: boolean;      // Afficher le vecteur complet
  show_tool_calls?: boolean;     // Inclure les tool calls et résultats
  show_neighbors?: boolean;      // Messages avant/après
}

interface DebugMessageResult {
  message: {
    uuid: string;
    conversation_id: string;
    role: "user" | "assistant" | "system";
    content: string;
    reasoning?: string;
    timestamp: string;
    char_count: number;
    turn_index: number;
  };

  embedding?: {
    exists: boolean;
    dimensions?: number;
    vector?: number[];           // Si demandé
    vector_preview?: number[];   // Premiers 10 dims
  };

  tool_calls?: Array<{
    uuid: string;
    tool_name: string;
    arguments: object;
    duration_ms: number;
    success: boolean;
    result?: {
      content: string;
      error?: string;
      size_bytes: number;
    };
  }>;

  neighbors?: {
    previous?: { uuid: string; role: string; preview: string };
    next?: { uuid: string; role: string; preview: string };
  };

  // Contexte de résumé
  summarization: {
    is_summarized: boolean;
    in_l1_summary?: string;  // UUID du L1 qui le couvre
    in_l2_summary?: string;  // UUID du L2 qui le couvre
  };
}
```

**Exemple d'utilisation** :
```
debug_message({
  conversation_id: "abc-123",
  turn_index: 5,
  show_tool_calls: true,
  show_neighbors: true
})
```

---

### 6. `debug_inject_turn` (NOUVEAU)

**Objectif** : Injecter manuellement un turn complet (user query, tool calls intermédiaires, réponse finale) pour tester le système de mémoire sans exécuter l'agent.

**Cas d'usage** :
- Reproduire un scénario problématique
- Tester le comportement des résumés L1/L2
- Vérifier que les tool calls sont bien capturés
- Simuler des conversations complexes pour le debugging

```typescript
interface DebugInjectTurnParams {
  conversation_id: string;         // Conversation cible (créée si n'existe pas)
  create_conversation?: boolean;   // Créer la conversation si elle n'existe pas

  // Le turn à injecter
  turn: {
    user_message: string;          // Question/requête utilisateur

    // Tool calls intermédiaires (optionnel)
    tool_calls?: Array<{
      tool_name: string;
      arguments: Record<string, any>;
      result: any;
      success?: boolean;           // Défaut: true
      duration_ms?: number;        // Défaut: 100
    }>;

    assistant_message: string;     // Réponse finale de l'assistant
    reasoning?: string;            // Raisonnement (optionnel)
  };

  // Options
  generate_embeddings?: boolean;   // Générer les embeddings (défaut: true)
  trigger_summarization?: boolean; // Déclencher résumé L1 si seuil atteint (défaut: false)
}

interface DebugInjectTurnResult {
  success: boolean;
  conversation_id: string;

  // Messages créés
  created_messages: Array<{
    uuid: string;
    role: string;
    char_count: number;
    has_embedding: boolean;
  }>;

  // Tool calls créés
  created_tool_calls: Array<{
    uuid: string;
    tool_name: string;
    message_id: string;
  }>;

  // État de la conversation après injection
  conversation_stats: {
    total_messages: number;
    total_chars: number;
    total_turns: number;
    l1_summaries: number;
    l2_summaries: number;
  };

  // Si trigger_summarization était true
  summarization_triggered?: {
    l1_created: boolean;
    l2_created: boolean;
    summary_uuid?: string;
  };
}
```

**Exemple d'utilisation - Injecter un turn simple** :
```
debug_inject_turn({
  conversation_id: "test-conv-1",
  create_conversation: true,
  turn: {
    user_message: "Lis le fichier config.ts",
    assistant_message: "Voici le contenu du fichier config.ts..."
  }
})
```

**Exemple d'utilisation - Injecter un turn avec tool calls** :
```
debug_inject_turn({
  conversation_id: "test-conv-1",
  turn: {
    user_message: "Trouve la fonction handleAuth et explique-la",
    tool_calls: [
      {
        tool_name: "grep_files",
        arguments: { pattern: "handleAuth", path: "/src" },
        result: { matches: ["/src/auth/handler.ts:45"] },
        success: true
      },
      {
        tool_name: "read_file",
        arguments: { path: "/src/auth/handler.ts", startLine: 40, endLine: 60 },
        result: { content: "function handleAuth() { ... }" },
        success: true
      }
    ],
    assistant_message: "La fonction handleAuth gère l'authentification...",
    reasoning: "J'ai d'abord cherché la fonction puis lu le fichier"
  },
  generate_embeddings: true,
  trigger_summarization: false
})
```

**Exemple d'utilisation - Tester les résumés** :
```
// Injecter plusieurs turns puis déclencher un résumé
for (let i = 0; i < 10; i++) {
  await debug_inject_turn({
    conversation_id: "test-summarization",
    turn: {
      user_message: `Question ${i}`,
      assistant_message: `Réponse détaillée ${i} avec beaucoup de contenu...`
    },
    trigger_summarization: i === 9  // Déclencher sur le dernier
  });
}
```

---

### 7. `debug_replay_conversation` (BONUS)

**Objectif** : Rejouer une conversation existante dans une nouvelle conversation pour tester des modifications du système.

```typescript
interface DebugReplayConversationParams {
  source_conversation_id: string;  // Conversation source
  target_conversation_id?: string; // Nouvelle conversation (auto-générée si omis)

  // Filtres
  start_turn?: number;             // Turn de départ (défaut: 0)
  end_turn?: number;               // Turn de fin (défaut: tous)

  // Options
  regenerate_embeddings?: boolean; // Re-générer les embeddings
  skip_tool_calls?: boolean;       // Ne pas copier les tool calls
}

interface DebugReplayConversationResult {
  source_conversation_id: string;
  target_conversation_id: string;
  turns_replayed: number;
  messages_created: number;
  tool_calls_created: number;
}
```

## Considérations techniques

### Sécurité
- Les outils de **lecture** (1-5) ne modifient pas les données existantes
- Les outils d'**écriture** (6-7) créent de nouvelles données pour le debugging
- Prévoir un flag `--debug` ou config pour activer/désactiver ces outils en production
- Les outils d'écriture devraient avoir un préfixe `test-` ou `debug-` sur les conversation_id pour éviter de polluer les vraies conversations

### Performance
- Les embeddings complets peuvent être volumineux (768-1536 dims)
- Utiliser `preview` par défaut, vecteur complet en option
- Limiter les résultats par défaut

### Intégration
- Ajouter dans `packages/cli/src/tools/debug-tools.ts`
- Enregistrer dans le serveur MCP existant
- Utiliser le même `ConversationStorage` que l'agent

## Alternatives considérées

### 1. Dashboard web
- **Pour** : Interface visuelle, plus intuitive
- **Contre** : Plus complexe à implémenter, nécessite un serveur web
- **Décision** : Peut être ajouté plus tard, les outils MCP sont prioritaires

### 2. Commandes CLI directes
- **Pour** : Plus rapide à implémenter
- **Contre** : Moins intégré avec le workflow agent
- **Décision** : Les outils MCP permettent de tester dans le même contexte que l'agent

### 3. Logs enrichis
- **Pour** : Pas de nouveaux outils à créer
- **Contre** : Pas interactif, difficile à filtrer
- **Décision** : Complémentaire mais insuffisant seul
