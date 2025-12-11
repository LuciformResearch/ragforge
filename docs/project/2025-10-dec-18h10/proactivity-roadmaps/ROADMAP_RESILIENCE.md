# Roadmap : Résilience et Gestion des Échecs

## Vue d'ensemble

Cette roadmap couvre les fonctionnalités permettant à l'agent de récupérer automatiquement des échecs et d'adapter son plan dynamiquement, améliorant sa robustesse et sa capacité à résoudre des problèmes complexes.

## Objectifs

- **Récupération automatique** : L'agent répare automatiquement les erreurs
- **Replanning dynamique** : L'agent adapte son plan en cas d'échec
- **Résilience** : L'agent ne abandonne pas facilement face aux obstacles

---

## Feature 1 : Replanning - Gestion Automatique des Échecs

### ✅ État Actuel : Non Implémenté (mais infrastructure existe)

**Dans `rag-agent.ts` (lignes 1845-1857)** :
Le code actuel arrête simplement l'exécution sur erreur :
```typescript
} catch (error: any) {
  console.log(`      ❌ Task failed: ${error.message}`);
  results.push({
    action: action.description,
    success: false,
    error: error.message,
  });

  // For sequential strategy, stop on first failure
  if (plan.strategy === 'sequential') {
    break;  // ❌ Arrête immédiatement, pas de retry
  }
  currentTaskIndex++;
}
```

**Infrastructure disponible** :
- ✅ Système de sous-agents fonctionnel
- ✅ Gestion des tentatives avec `currentTaskIndex`
- ✅ Accès au `subAgent` pour relancer
- ❌ Pas de logique de retry automatique

### Description

Ajouter une logique de retry automatique quand une étape échoue, permettant à l'agent de réparer automatiquement avant d'abandonner.

### Implémentation

Modifier `executeSubAgent()` dans `rag-agent.ts` pour ajouter le retry :

```typescript
// Dans le catch block de executeSubAgent (ligne 1845)
} catch (error: any) {
  console.log(`      ❌ Task failed: ${error.message}`);
  
  // --- AJOUT DE LA PROACTIVITÉ ---
  // Compteur de tentatives pour cette tâche
  const taskAttempts = (this.taskAttemptsMap?.get(currentTaskIndex) || 0) + 1;
  this.taskAttemptsMap?.set(currentTaskIndex, taskAttempts);
  
  if (plan.strategy === 'sequential' && taskAttempts < 2) {
    // On s'autorise une tentative de réparation
    console.log(`      🔄 Attempting automatic recovery (attempt ${taskAttempts}/2)...`);
    
    // On demande à l'agent comment fixer l'erreur
    try {
      const recoveryResult = await subAgent.ask(
        `L'action précédente a échoué avec l'erreur : "${error.message}".
         Analyse l'erreur et propose une correction immédiate ou une modification du plan.
         Utilise les outils nécessaires pour réparer.`
      );
      
      if (recoveryResult.toolsUsed && recoveryResult.toolsUsed.length > 0) {
        // Si l'agent a utilisé des outils pour réparer, on réessaie l'étape courante
        console.log(`      ✅ Recovery attempt successful, retrying task...`);
        continue; // On ne 'break' pas, on boucle sur la même étape
      }
    } catch (recoveryError: any) {
      console.log(`      ❌ Recovery attempt also failed: ${recoveryError.message}`);
    }
  }
  // -------------------------------
  
  results.push({
    action: action.description,
    success: false,
    error: error.message,
  });

  // For sequential strategy, stop on first failure (après avoir tenté recovery)
  if (plan.strategy === 'sequential') {
    break;
  }
  currentTaskIndex++;
}
```

**Note** : Il faut ajouter `taskAttemptsMap` comme propriété de la classe pour tracker les tentatives par tâche.

### Impact

L'agent récupère automatiquement des échecs au lieu d'abandonner, améliorant le taux de succès des tâches complexes.

### Fichiers à modifier

- `packages/core/src/runtime/agents/rag-agent.ts` (méthode `executeSubAgent`)

### Dépendances

- Système de sous-agents fonctionnel
- Gestion des tentatives multiples

### Tests

- Test avec erreur récupérable → l'agent réessaie
- Test avec erreur non-récupérable → l'agent abandonne après 2 tentatives
- Test avec stratégie parallèle → pas de replanning automatique

---

## Feature 2 : Dynamic Planning pour Sub-Agent

### ✅ État Actuel : Partiellement Implémenté

**Dans `rag-agent.ts` (lignes 1766-1791)** :
Le système construit déjà un prompt de tâche avec instructions :
```typescript
const buildTaskPrompt = (taskIndex: number): string => {
  return `=== GOAL ===
${plan.goal}

=== TASK LIST ===
${taskListStr}

=== CURRENT TASK ===
Task ${taskIndex + 1}: ${plan.actions[taskIndex]?.description || 'All tasks complete'}

=== INSTRUCTIONS ===
Execute the CURRENT TASK by calling the appropriate tools.
When this task is done, fill task_completed with a summary.
Only fill final_answer when ALL ${plan.actions.length} tasks are complete.`;
};
```

**Comparaison avec la roadmap** :
- ✅ Instructions pour exécuter la tâche courante
- ❌ Pas de permission explicite de modifier le plan
- ❌ Pas d'instruction pour ajouter des étapes supplémentaires

### Description

Ajouter la permission explicite au sous-agent de modifier son propre plan si nécessaire, en complétant les instructions existantes.

### Implémentation

Modifier `buildTaskPrompt()` dans `executeSubAgent()` pour ajouter la permission de planification dynamique :

```typescript
const buildTaskPrompt = (taskIndex: number): string => {
    // ... code existant ...
    
    return `=== GOAL ===
${plan.goal}

=== TASK LIST ===
${taskListStr}

=== CURRENT TASK ===
Task ${taskIndex + 1}: ${plan.actions[taskIndex]?.description || 'All tasks complete'}

=== INSTRUCTIONS ===
Execute the CURRENT TASK by calling the appropriate tools.
When this task is done, fill task_completed with a summary.
Only fill final_answer when ALL ${plan.actions.length} tasks are complete.

⚡ **DYNAMIC PLANNING**:
If while doing this task, you discover a NEW required step 
(e.g., "Oh, I need to create a utils file first"), DO NOT ASK.

Just perform the extra step and mention it in your 'task_completed' summary.
You have authority to deviate from the plan if it serves the Goal.
    `;
};
```

### Impact

Le sous-agent peut adapter son plan dynamiquement, évitant les blocages dus à des étapes manquantes.

### Fichiers à modifier

- `packages/core/src/runtime/agents/rag-agent.ts` (méthode `buildTaskPrompt`)

### Dépendances

- Système de sous-agents fonctionnel
- Gestion des tâches avec résumés

### Tests

- Test avec étape manquante → l'agent l'ajoute automatiquement
- Test avec plan complet → l'agent suit le plan normalement
- Vérifier que les étapes ajoutées sont mentionnées dans le résumé

---

## Ordre d'Implémentation

1. **Dynamic Planning** (modification de prompt, plus simple)
2. **Replanning** (nécessite logique de récupération plus complexe)

---

## Métriques de Succès

- Réduction du taux d'échec des tâches complexes
- Augmentation des récupérations automatiques réussies
- Réduction des interventions utilisateur pour débloquer l'agent

---

## Notes

Ces deux features travaillent ensemble pour améliorer la résilience : le Dynamic Planning permet d'éviter les blocages en adaptant le plan, tandis que le Replanning permet de récupérer des erreurs inattendues. L'implémentation du Dynamic Planning est plus simple (modification de prompt) et peut être déployée rapidement.
