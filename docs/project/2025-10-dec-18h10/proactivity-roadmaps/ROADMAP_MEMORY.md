# Roadmap : Mémoire et Gestion du Contexte

## Vue d'ensemble

Cette roadmap couvre les améliorations de la gestion de la mémoire et du contexte de conversation, permettant à l'agent de maintenir une compréhension cohérente sur de longues conversations.

## Objectifs

- **Mémoire intelligente** : Conserver le contexte important même dans de longues conversations
- **Compression efficace** : Optimiser l'utilisation du contexte sans perdre d'information critique
- **Cohérence** : Maintenir la compréhension du but global de la conversation

---

## Feature 1 : Context Pruning Intelligent - Mémoire Glissante

### ✅ État Actuel : Partiellement Implémenté

**Dans `rag-agent.ts` (lignes 1293-1332)** :
La méthode `buildHistoryContext()` utilise un slice simple :
```typescript
const recentHistory = history.slice(-10);  // Ligne 1301
```

**MAIS** : Le système principal utilise `buildEnrichedContext()` dans `ConversationStorage` (lignes 1091-1102) qui est beaucoup plus sophistiqué :
- ✅ Last User Queries (5%)
- ✅ Recent Turns (5%)
- ✅ Code Semantic Results (10%)
- ✅ Semantic Results (L0/L1/L2 avec embeddings)
- ✅ L1 Summaries (10%)

**Problème** : `buildHistoryContext()` reste utilisé comme fallback quand `buildEnrichedContext()` n'est pas disponible, et il est trop brutal.

### Description

Améliorer `buildHistoryContext()` (fallback) pour garder le contexte initial + les messages récents, même si le système principal utilise déjà `buildEnrichedContext()` qui est meilleur.

### Problème Actuel

Ligne 1301 dans `rag-agent.ts` : `const recentHistory = history.slice(-10);`

C'est brutal. Si tu as une conversation complexe, tu perds le début (le contexte du projet) au bout de 10 tours.

**Note** : Le système utilise maintenant `buildEnrichedContext()` dans `ConversationStorage` qui gère déjà mieux le contexte avec L0/L1/L2, mais `buildHistoryContext()` reste utilisé comme fallback et doit être amélioré.

### Solution

Modifier `buildHistoryContext()` dans `rag-agent.ts` :

```typescript
private buildHistoryContext(history: Array<Message>): string {
    if (history.length <= 10) {
        // Comportement standard pour les conversations courtes
        return this.formatHistory(history);
    }

    // Garde le contexte initial (très important pour que l'agent n'oublie pas le but global)
    const initialPrompt = history[0];
    
    // Garde les échanges récents
    const recentMessages = history.slice(-9);
    
    // Insère un marqueur de compression
    const bridge: Message = {
        role: 'system',
        content: '... [Mémoire intermédiaire compressée] ...'
    };

    return this.formatHistory([initialPrompt, bridge, ...recentMessages]);
}
```

### Impact

L'agent conserve le contexte initial (définition du problème, but global) même dans de très longues conversations, tout en gardant accès aux échanges récents.

### Fichiers à modifier

- `packages/core/src/runtime/agents/rag-agent.ts` (méthode `buildHistoryContext`)

### Dépendances

- Système de messages/historique fonctionnel
- Formatage de l'historique pour affichage

### Tests

- Test avec conversation courte (< 10 messages) → comportement standard
- Test avec conversation longue (> 10 messages) → garde le premier + 9 derniers
- Vérifier que le marqueur de compression est présent

### Améliorations Futures

- Compression intelligente du contexte intermédiaire (résumé L1/L2)
- Détection automatique des messages "critiques" à conserver
- Adaptation dynamique du nombre de messages récents selon la taille du contexte

---

## Feature 2 : Historique des Fichiers Accédés Récemment

### Description

Ajouter un historique dédié qui liste tous les fichiers accédés récemment par les tools (read_file, write_file, edit_file, grep_files, brain_search, etc.), limité à 5% du contexte max.

### Problème Actuel

Les fichiers sont mentionnés dans les résumés L1/L2 via `filesMentioned`, mais il n'y a pas d'historique dédié et facilement accessible qui liste tous les fichiers récemment accédés par les tools. L'agent peut perdre la trace des fichiers qu'il a consultés récemment.

### Solution

#### Étape 1 : Tracker les fichiers accédés dans les tool calls

Modifier `ConversationStorage` pour extraire les fichiers des tool calls :

```typescript
// Dans packages/core/src/runtime/conversation/storage.ts

interface AccessedFile {
  path: string;
  toolName: string;
  accessType: 'read' | 'write' | 'search' | 'list';
  timestamp: Date;
  turnIndex: number;
}

/**
 * Extract files accessed from tool calls in a turn
 */
private extractAccessedFiles(turn: ConversationTurn): AccessedFile[] {
  const files: AccessedFile[] = [];
  
  for (const toolResult of turn.toolResults) {
    const toolName = toolResult.toolName;
    const args = toolResult.toolArgs || {};
    const result = toolResult.toolResult || {};
    
    // File tools that access specific files
    if (['read_file', 'write_file', 'edit_file', 'create_file'].includes(toolName)) {
      if (args.path) {
        files.push({
          path: args.path,
          toolName,
          accessType: toolName === 'read_file' ? 'read' : 'write',
          timestamp: new Date(),
          turnIndex: turn.turnIndex
        });
      }
    }
    
    // Search tools that return file paths
    if (['grep_files', 'search_files', 'brain_search'].includes(toolName)) {
      // Extract file paths from results
      if (Array.isArray(result)) {
        result.forEach((item: any) => {
          if (item.file || item.path) {
            files.push({
              path: item.file || item.path,
              toolName,
              accessType: 'search',
              timestamp: new Date(),
              turnIndex: turn.turnIndex
            });
          }
        });
      }
    }
    
    // Directory listing tools
    if (['list_directory', 'glob_files'].includes(toolName)) {
      if (args.path) {
        files.push({
          path: args.path,
          toolName,
          accessType: 'list',
          timestamp: new Date(),
          turnIndex: turn.turnIndex
        });
      }
    }
  }
  
  return files;
}

/**
 * Get recently accessed files (deduplicated, most recent first)
 * Limited to 5% of context max
 */
async getRecentlyAccessedFiles(
  conversationId: string,
  maxChars: number = 5000 // 5% of 100k context max
): Promise<AccessedFile[]> {
  // Get recent turns (same as getRecentTurns but we'll extract files)
  const recentTurns = await this.getRecentTurns(conversationId, maxChars * 10); // Get more turns to extract files
  
  // Extract all files from recent turns
  const allFiles: AccessedFile[] = [];
  for (const turn of recentTurns) {
    const files = this.extractAccessedFiles(turn);
    allFiles.push(...files);
  }
  
  // Deduplicate by path (keep most recent access)
  const fileMap = new Map<string, AccessedFile>();
  for (const file of allFiles) {
    const existing = fileMap.get(file.path);
    if (!existing || file.timestamp > existing.timestamp) {
      fileMap.set(file.path, file);
    }
  }
  
  // Sort by timestamp (most recent first) and limit by char count
  const sortedFiles = Array.from(fileMap.values())
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  
  // Limit to maxChars (rough estimate: ~50 chars per file path)
  const maxFiles = Math.floor(maxChars / 50);
  return sortedFiles.slice(0, maxFiles);
}
```

#### Étape 2 : Ajouter au contexte enrichi

Modifier `buildEnrichedContext()` pour inclure les fichiers récents :

```typescript
// Dans buildEnrichedContext()
async buildEnrichedContext(
  conversationId: string,
  userMessage: string,
  options?: { /* ... */ }
): Promise<{
  // ... existing fields ...
  recentlyAccessedFiles?: AccessedFile[];
}> {
  // ... existing code ...
  
  // 6. Get recently accessed files (5% of context max)
  const recentlyAccessedFilesMaxChars = this.getLastUserQueriesMaxChars(); // 5% of context max
  const recentlyAccessedFiles = await this.getRecentlyAccessedFiles(
    conversationId,
    recentlyAccessedFilesMaxChars
  );
  
  return {
    // ... existing fields ...
    recentlyAccessedFiles: recentlyAccessedFiles.length > 0 ? recentlyAccessedFiles : undefined
  };
}
```

#### Étape 3 : Formater pour l'agent

Modifier `formatContextForAgent()` pour afficher l'historique :

```typescript
// Dans formatContextForAgent()
formatContextForAgent(enrichedContext: {
  // ... existing fields ...
  recentlyAccessedFiles?: AccessedFile[];
}): string {
  const sections: string[] = [];
  
  // ... existing sections ...
  
  // 6. Recently Accessed Files (5% of context max)
  if (enrichedContext.recentlyAccessedFiles && enrichedContext.recentlyAccessedFiles.length > 0) {
    sections.push('## Recently Accessed Files');
    sections.push('Files that were accessed by tools in recent turns:');
    
    // Group by access type
    const byType = {
      read: enrichedContext.recentlyAccessedFiles.filter(f => f.accessType === 'read'),
      write: enrichedContext.recentlyAccessedFiles.filter(f => f.accessType === 'write'),
      search: enrichedContext.recentlyAccessedFiles.filter(f => f.accessType === 'search'),
      list: enrichedContext.recentlyAccessedFiles.filter(f => f.accessType === 'list')
    };
    
    if (byType.read.length > 0) {
      sections.push('\n**Read:**');
      byType.read.forEach(file => {
        sections.push(`- ${file.path} (via ${file.toolName}, Turn ${file.turnIndex})`);
      });
    }
    
    if (byType.write.length > 0) {
      sections.push('\n**Modified:**');
      byType.write.forEach(file => {
        sections.push(`- ${file.path} (via ${file.toolName}, Turn ${file.turnIndex})`);
      });
    }
    
    if (byType.search.length > 0) {
      sections.push('\n**Found in searches:**');
      // Deduplicate by path
      const uniqueSearchFiles = Array.from(new Set(byType.search.map(f => f.path)));
      uniqueSearchFiles.forEach(path => {
        sections.push(`- ${path}`);
      });
    }
    
    sections.push('');
  }
  
  return sections.join('\n');
}
```

### Impact

L'agent a toujours accès à une liste claire des fichiers récemment accédés, améliorant la cohérence et évitant de relire les mêmes fichiers inutilement.

### Fichiers à modifier

- `packages/core/src/runtime/conversation/storage.ts` :
  - Ajouter `extractAccessedFiles()`
  - Ajouter `getRecentlyAccessedFiles()`
  - Modifier `buildEnrichedContext()` pour inclure les fichiers
  - Modifier `formatContextForAgent()` pour afficher l'historique

### Dépendances

- Système de turns avec tool results
- Extraction des fichiers depuis les tool calls et résultats
- Limite de 5% du contexte max

### Tests

- Test avec plusieurs tools accédant aux fichiers → extraction correcte
- Test avec fichiers dupliqués → déduplication correcte
- Test avec limite de 5% → respect de la limite
- Test avec aucun fichier → pas d'affichage
- Vérifier que les fichiers sont triés par timestamp (plus récent en premier)

### Optimisations

1. **Cache** : Mettre en cache la liste des fichiers récents pour éviter de recalculer à chaque requête
2. **Groupement intelligent** : Grouper les fichiers par répertoire parent pour réduire l'affichage
3. **Filtrage** : Exclure les fichiers temporaires ou générés automatiquement
4. **Priorisation** : Donner plus de poids aux fichiers modifiés vs simplement lus

---

## Métriques de Succès

- Amélioration de la cohérence dans les conversations longues
- Réduction des cas où l'agent "oublie" le contexte initial
- Optimisation de l'utilisation du contexte (tokens)
- **Amélioration de la traçabilité des fichiers accédés**
- **Réduction des relectures inutiles de fichiers**

---

## Notes

Ces deux features travaillent ensemble pour améliorer la gestion de la mémoire :
- Le **Context Pruning Intelligent** conserve le contexte initial et récent
- L'**Historique des Fichiers Accédés** donne une vue claire des fichiers récemment consultés

Ces features sont particulièrement importantes pour les conversations longues où l'utilisateur travaille sur un projet complexe. Le contexte initial contient souvent la définition du problème et les objectifs, qui sont cruciaux pour maintenir la cohérence tout au long de la conversation. L'historique des fichiers permet à l'agent de garder une trace de ce qu'il a déjà consulté, évitant les relectures inutiles et améliorant l'efficacité.
