# Findings : Gemini CLI & OpenCode - Patterns d'Implémentation

## Vue d'ensemble

Ce document synthétise les patterns d'implémentation trouvés dans Gemini CLI et OpenCode qui peuvent être appliqués aux features de proactivité de RagForge.

---

## 1. Tracking des Outils Utilisés (Gemini CLI)

### Pattern trouvé

**Fichier** : `references/gemini-cli/packages/core/src/telemetry/uiTelemetry.ts`

**Structure de tracking** :
```typescript
interface SessionMetrics {
  tools: {
    totalCalls: number;
    totalSuccess: number;
    totalFail: number;
    totalDurationMs: number;
    totalDecisions: {
      [ToolCallDecision.ACCEPT]: number;
      [ToolCallDecision.REJECT]: number;
      [ToolCallDecision.MODIFY]: number;
      [ToolCallDecision.AUTO_ACCEPT]: number;
    };
    byName: Record<string, ToolCallStats>;
  };
  files: {
    totalLinesAdded: number;
    totalLinesRemoved: number;
  };
}

interface ToolCallStats {
  count: number;
  success: number;
  fail: number;
  durationMs: number;
  decisions: {
    [ToolCallDecision.ACCEPT]: number;
    [ToolCallDecision.REJECT]: number;
    [ToolCallDecision.MODIFY]: number;
    [ToolCallDecision.AUTO_ACCEPT]: number;
  };
}
```

### Implémentation

**Classe `UiTelemetryService`** :
- Émet des événements pour chaque tool call
- Track automatiquement : `totalCalls`, `byName[toolName]`, `success/fail`, `durationMs`
- Track les décisions utilisateur (ACCEPT/REJECT/MODIFY)
- Track les lignes ajoutées/supprimées dans les fichiers

**Méthode `processToolCall()`** :
```typescript
private processToolCall(event: ToolCallEvent) {
  const { tools, files } = this.#metrics;
  tools.totalCalls++;
  tools.totalDurationMs += event.duration_ms;

  if (event.success) {
    tools.totalSuccess++;
  } else {
    tools.totalFail++;
  }

  if (!tools.byName[event.function_name]) {
    tools.byName[event.function_name] = {
      count: 0,
      success: 0,
      fail: 0,
      durationMs: 0,
      decisions: { /* ... */ }
    };
  }

  const toolStats = tools.byName[event.function_name];
  toolStats.count++;
  toolStats.durationMs += event.duration_ms;
  if (event.success) {
    toolStats.success++;
  } else {
    toolStats.fail++;
  }

  // Track file modifications
  if (event.metadata) {
    if (event.metadata['model_added_lines'] !== undefined) {
      files.totalLinesAdded += event.metadata['model_added_lines'];
    }
    if (event.metadata['model_removed_lines'] !== undefined) {
      files.totalLinesRemoved += event.metadata['model_removed_lines'];
    }
  }
}
```

### Application à RagForge

**Pour "Suggestions d'Actions Suivantes"** :
- ✅ Utiliser le même pattern de tracking dans `RagAgent`
- ✅ Track `filesModifiedInSession` et `toolsUsedInSession` comme dans Gemini CLI
- ✅ Utiliser les métadonnées des tool calls pour détecter les fichiers modifiés
- ✅ Exposer les stats dans la réponse finale (comme Gemini CLI expose dans JSON)

**Code à adapter** :
```typescript
// Dans RagAgent
private sessionMetrics: {
  tools: {
    totalCalls: number;
    byName: Record<string, { count: number; success: number; fail: number }>;
  };
  files: {
    modified: Set<string>;
    totalLinesAdded: number;
    totalLinesRemoved: number;
  };
} = {
  tools: { totalCalls: 0, byName: {} },
  files: { modified: new Set(), totalLinesAdded: 0, totalLinesRemoved: 0 }
};

// Dans GeneratedToolExecutor.execute()
private trackToolCall(toolName: string, result: any, success: boolean) {
  this.sessionMetrics.tools.totalCalls++;
  
  if (!this.sessionMetrics.tools.byName[toolName]) {
    this.sessionMetrics.tools.byName[toolName] = { count: 0, success: 0, fail: 0 };
  }
  
  const stats = this.sessionMetrics.tools.byName[toolName];
  stats.count++;
  if (success) {
    stats.success++;
  } else {
    stats.fail++;
  }

  // Track file modifications
  if (toolName === 'write_file' || toolName === 'edit_file' || toolName === 'create_file') {
    const filePath = result.file || result.path;
    if (filePath) {
      this.sessionMetrics.files.modified.add(filePath);
    }
    
    // Track lines if available in metadata
    if (result.metadata?.linesAdded) {
      this.sessionMetrics.files.totalLinesAdded += result.metadata.linesAdded;
    }
    if (result.metadata?.linesRemoved) {
      this.sessionMetrics.files.totalLinesRemoved += result.metadata.linesRemoved;
    }
  }
}
```

---

## 2. Système de Retry avec Exponential Backoff (OpenCode)

### Pattern trouvé

**Fichier** : `references/opencode/packages/sdk/go/README.md` et `packages/sdk/python/README.md`

**Implémentation** :
- Retry automatique 2 fois par défaut
- Exponential backoff pour erreurs transitoires (429, 5xx, connection errors)
- Configurable via `WithMaxRetries` option

**Exemple Go** :
```go
client := opencode.NewClient(
  option.WithMaxRetries(0), // default is 2
)

// Override per-request:
client.Session.List(
  context.TODO(),
  opencode.SessionListParams{},
  option.WithMaxRetries(5),
)
```

**Exemple Python** :
```python
client = OpenCodeClient(retries=2, backoff_factor=0.1)
```

### Application à RagForge

**Pour "Replanning" et "Self-Healing"** :
- ✅ Implémenter un système de retry similaire dans `GeneratedToolExecutor`
- ✅ Exponential backoff pour erreurs récupérables
- ✅ Limiter le nombre de retries (max 2-3)
- ✅ Configurable par tool ou globalement

**Code à adapter** :
```typescript
// Dans GeneratedToolExecutor
private async executeWithRetry(
  toolCall: ToolCallRequest,
  maxRetries: number = 2,
  backoffMs: number = 100
): Promise<any> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await this.execute(toolCall);
      return result;
    } catch (error: any) {
      lastError = error;
      
      // Check if error is retryable
      if (!this.isRetryableError(error)) {
        throw error;
      }
      
      // Don't retry on last attempt
      if (attempt < maxRetries) {
        const delay = backoffMs * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
    }
  }
  
  throw lastError || new Error('Max retries exceeded');
}

private isRetryableError(error: any): boolean {
  // Retry on connection errors, timeouts, rate limits, server errors
  const retryablePatterns = [
    /ECONNREFUSED/i,
    /ETIMEDOUT/i,
    /429/i,  // Rate limit
    /5\d{2}/i,  // Server errors
  ];
  
  return retryablePatterns.some(pattern => 
    pattern.test(error.message || String(error))
  );
}
```

---

## 3. Format de Sortie JSON avec Stats (Gemini CLI)

### Pattern trouvé

**Fichier** : `references/gemini-cli/packages/core/src/output/stream-json-formatter.ts`

**Format de sortie** :
```typescript
{
  response: string,
  stats: {
    models: Record<string, ModelMetrics>,
    tools: {
      totalCalls: number,
      byName: Record<string, ToolCallStats>
    },
    files: {
      totalLinesAdded: number,
      totalLinesRemoved: number
    }
  }
}
```

**Exemple d'usage** :
```bash
result=$(gemini -p "Explain this database schema" --output-format json)
total_tokens=$(echo "$result" | jq -r '.stats.models // {} | to_entries | map(.value.tokens.total) | add // 0')
tool_calls=$(echo "$result" | jq -r '.stats.tools.totalCalls // 0')
tools_used=$(echo "$result" | jq -r '.stats.tools.byName // {} | keys | join(", ")')
```

### Application à RagForge

**Pour "Suggestions d'Actions Suivantes"** :
- ✅ Exposer les stats dans `AskResult` pour permettre l'analyse
- ✅ Utiliser les stats pour générer des suggestions intelligentes
- ✅ Format JSON optionnel pour intégration avec scripts

**Code à adapter** :
```typescript
// Dans RagAgent.ask()
return {
  answer: formattedAnswer,
  confidence: result.confidence,
  toolsUsed: Array.from(this.sessionMetrics.tools.byName.keys()),
  stats: {
    tools: {
      totalCalls: this.sessionMetrics.tools.totalCalls,
      byName: this.sessionMetrics.tools.byName
    },
    files: {
      modified: Array.from(this.sessionMetrics.files.modified),
      totalLinesAdded: this.sessionMetrics.files.totalLinesAdded,
      totalLinesRemoved: this.sessionMetrics.files.totalLinesRemoved
    }
  },
  nextSteps: nextSteps
};
```

---

## 4. Hooks Après Tool Execution (Gemini CLI)

### Pattern trouvé

**Fichier** : `references/gemini-cli/schemas/settings.schema.json`

**Configuration** :
```json
{
  "description": "Hooks that execute after tool execution. Can process results, log outputs, or trigger follow-up actions.",
  "markdownDescription": "Hooks that execute after tool execution. Can process results, log outputs, or trigger follow-up actions."
}
```

### Application à RagForge

**Pour "Suggestions d'Actions Suivantes"** :
- ✅ Utiliser les callbacks `onToolResult` existants pour tracker les modifications
- ✅ Analyser les résultats des tools pour détecter les actions suivantes pertinentes
- ✅ Système extensible pour ajouter des hooks personnalisés

**Code existant dans RagForge** :
```typescript
// Déjà présent dans rag-agent.ts
onToolResult?: (toolName: string, result: any, success: boolean, durationMs: number) => void;
```

**Amélioration** :
```typescript
// Dans GeneratedToolExecutor.execute()
if (this.onToolResult) {
  this.onToolResult(toolName, result, success, durationMs);
  
  // Track pour suggestions d'actions suivantes
  if (success && (toolName === 'write_file' || toolName === 'edit_file')) {
    this.trackFileModification(result);
  }
}
```

---

## 5. Système de Todo/Planning (Gemini CLI)

### Pattern trouvé

**Fichier** : `references/gemini-cli/docs/tools/todos.md`

**Fonctionnalité** :
- Tool `write_todos` pour tracker les tâches
- Mise à jour dynamique du plan
- Affichage de la tâche en cours (`in_progress`)

**Comportement** :
- Progress tracking : marquer les tâches comme `completed`
- Single focus : une seule tâche `in_progress` à la fois
- Dynamic updates : le plan peut évoluer avec de nouvelles informations

### Application à RagForge

**Pour "Replanning" et "Dynamic Planning"** :
- ✅ Utiliser le système de planning existant (`plan_actions` tool)
- ✅ Permettre la modification dynamique du plan
- ✅ Track les tâches complétées vs en cours

**Code existant dans RagForge** :
- `generatePlanActionsTool()` existe déjà
- `executeSubAgent()` gère déjà l'exécution des plans

**Amélioration suggérée** :
- Ajouter permission explicite de modifier le plan dans le prompt
- Track les modifications du plan pour analyse

---

## 6. Analyse de Qualité avec Structured Output (RagForge)

### Pattern trouvé dans RagForge

**Fichier** : `packages/core/src/runtime/types/chat.ts`

**Interface existante** :
```typescript
interface AnswerQuality {
  completeness: number;  // 0-100%
  confidence: number;    // 0-100%
  notes?: string;
}
```

### Application

**Pour "Response Quality Analyzer"** :
- ✅ Utiliser cette interface existante
- ✅ Étendre avec `missing_tool_calls` et `improved_query`
- ✅ Intégrer dans `StructuredLLMExecutor` pour analyse automatique

**Code à adapter** :
```typescript
interface ResponseQualityAnalysis extends AnswerQuality {
  missing_tool_calls?: Array<{
    tool_name: string;
    reason: string;
  }>;
  improved_query?: string;
}
```

---

## 7. Query Feedback avec Suggestions (RagForge)

### Pattern trouvé

**Fichier** : `docs/llm-reranking.md`

**Fonctionnalité** :
```typescript
const results = await rag.scope()
  .semanticSearchBySource(query, { topK: 30 })
  .llmRerank(userQuestion, llmProvider, {
    withSuggestions: true  // ← Enable feedback
  })
  .execute();

// Suggestions:
//   - [add_filter] Filter by 'function' type for more precise results
//   - [expand_relationships] Include CONSUMES relationships to find dependencies
```

### Application

**Pour "Response Quality Analyzer"** :
- ✅ Réutiliser le système de suggestions existant
- ✅ Adapter pour analyser les réponses de l'agent
- ✅ Générer des suggestions d'amélioration de query

---

## Recommandations d'Implémentation

### 1. Tracking des Outils (Priorité HAUTE)

**Pattern Gemini CLI** → **RagForge** :
- Créer `SessionMetrics` similaire à Gemini CLI
- Track dans `GeneratedToolExecutor.execute()`
- Exposer dans `AskResult`

**Temps estimé** : 2h

### 2. Suggestions d'Actions Suivantes (Priorité HAUTE)

**Utiliser le tracking** :
- Analyser `sessionMetrics.files.modified` pour suggérer tests/compilation
- Analyser `sessionMetrics.tools.byName` pour suggérer vérifications
- Utiliser `StructuredLLMExecutor` pour générer suggestions intelligentes

**Temps estimé** : 3h (déjà dans roadmap)

### 3. Système de Retry (Priorité MOYENNE)

**Pattern OpenCode** → **RagForge** :
- Implémenter `executeWithRetry()` dans `GeneratedToolExecutor`
- Exponential backoff pour erreurs récupérables
- Configurable par tool

**Temps estimé** : 2h (déjà dans roadmap pour Self-Healing)

### 4. Format JSON avec Stats (Priorité FAIBLE)

**Pattern Gemini CLI** → **RagForge** :
- Ajouter `stats` dans `AskResult`
- Format JSON optionnel pour CLI
- Permet scripts d'analyse

**Temps estimé** : 1h

---

## Code de Référence

### Gemini CLI - Tracking Complet

**Fichiers clés** :
- `packages/core/src/telemetry/uiTelemetry.ts` : Service de tracking
- `packages/core/src/output/stream-json-formatter.ts` : Format de sortie
- `packages/cli/src/ui/components/ToolStatsDisplay.tsx` : Affichage des stats

**Points clés** :
- ✅ Tracking automatique via événements
- ✅ Stats par tool (`byName`)
- ✅ Track succès/échecs
- ✅ Track décisions utilisateur
- ✅ Track modifications de fichiers

### OpenCode - Retry Mechanism

**Fichiers clés** :
- `packages/sdk/go/README.md` : Documentation retry
- `packages/sdk/python/README.md` : Documentation retry

**Points clés** :
- ✅ Retry automatique avec exponential backoff
- ✅ Configurable (default: 2 retries)
- ✅ Erreurs retryables : 429, 5xx, connection errors

---

## Synthèse

### Patterns Réutilisables

1. **Tracking des outils** : Pattern Gemini CLI très complet, directement applicable
2. **Retry avec backoff** : Pattern OpenCode simple et efficace
3. **Stats dans réponse** : Format JSON de Gemini CLI utile pour intégration
4. **Hooks après execution** : Déjà présent dans RagForge, à exploiter davantage

### Améliorations Suggérées

1. **Tracking plus complet** : Ajouter tracking des fichiers modifiés et lignes changées
2. **Stats exposées** : Permettre l'accès aux stats pour génération de suggestions
3. **Retry intelligent** : Implémenter retry avec exponential backoff pour robustesse
4. **Format JSON** : Optionnel mais utile pour scripts et intégration

### Impact sur Roadmaps

- ✅ **Suggestions d'Actions Suivantes** : Pattern de tracking Gemini CLI directement applicable
- ✅ **Replanning/Self-Healing** : Pattern retry OpenCode directement applicable
- ✅ **Response Quality Analyzer** : Peut utiliser les stats pour analyse plus précise
- ✅ **Tracking général** : Améliore toutes les features de proactivité

---

## Prochaines Étapes

1. ✅ Implémenter `SessionMetrics` dans `RagAgent` (pattern Gemini CLI)
2. ✅ Utiliser le tracking pour générer suggestions d'actions suivantes
3. ✅ Implémenter retry avec exponential backoff (pattern OpenCode)
4. ✅ Exposer stats dans `AskResult` pour analyse

**Temps total estimé** : ~6h (déjà inclus dans les roadmaps existantes)
