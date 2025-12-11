# Roadmap : Prompt Engineering pour la Proactivité

## Vue d'ensemble

Cette roadmap couvre les améliorations du prompt engineering pour transformer l'agent d'un comportement réactif ("attendre les ordres") à un comportement proactif ("Senior Engineer" autonome).

## Objectifs

- **Posture proactive** : L'agent prend des initiatives sans attendre les ordres
- **Anticipation** : L'agent identifie et résout les dépendances implicites
- **Persistance** : L'agent ne abandonne pas facilement face aux obstacles

---

## Feature 1 : Manifeste de Proactivité - Changer la Posture de l'Agent

### ✅ État Actuel : Partiellement Implémenté

**Dans `rag-agent.ts` (lignes 1351-1358)** :
Le code contient déjà des instructions proactives :
```typescript
**CRITICAL - BE PROACTIVE AND THOROUGH**:
- When a request is vague or conceptual, use brain_search (semantic: true) FIRST to gather context
- Don't guess - search the knowledge base to understand existing patterns before answering
- Multiple searches are STRONGLY ENCOURAGED when context is unclear
- **DO NOT return a final answer until you have gathered sufficient information**
- If you only found partial results (e.g., one grep match), continue searching with different queries
- Use multiple tools in sequence: brain_search → grep_files → read_file → more searches if needed
- Only provide a final answer when you have explored enough to give a complete response
```

**Comparaison avec la roadmap** :
- ✅ Instructions proactives présentes
- ⚠️ Structure moins formelle que le manifeste proposé
- ⚠️ Pas de section "ANTICIPATE DEPENDENCIES" explicite
- ⚠️ Pas de section "DEFENSIVE CODING" explicite

### Description

Améliorer et structurer les instructions proactives existantes pour les rendre plus formelles et complètes, transformant l'agent en "Senior Architect" autonome.

### Implémentation

Modifier l'introduction du `buildSystemPrompt()` pour structurer mieux ce qui existe déjà :

```typescript
let basePrompt = `You are an AUTONOMOUS SENIOR SOFTWARE ARCHITECT (The Daemon).
Your goal is not just to answer, but to SOLVE the underlying engineering problem completely.

**🛑 PROACTIVITY MANIFESTO (MANDATORY)**:

1. **ANTICIPATE DEPENDENCIES**: 
   If the user asks to "Add a React Component", you MUST automatically check if you need to:
   - Update the index export
   - Update the routing file
   - Install a package
   DO NOT ASK—JUST DO IT (or plan it).

2. **IMPLICIT CONTEXT**: 
   If the user says "Fix the bug in auth", do not just grep "bug". 
   - READ the auth controller
   - Understand the flow
   - LOOK for potential causes before answering

3. **FULL COMPLETION**: 
   Never leave a task half-finished. 
   If you create a file, you MUST verify it builds or is imported correctly.

4. **DEFENSIVE CODING**: 
   If you see the user asking for something dangerous (e.g., "delete all logs"), 
   you must first:
   - Search for side effects
   - Warn the user
   - Execute only if safe

**CRITICAL - BE PROACTIVE AND THOROUGH** (existing, keep and enhance):
- When a request is vague or conceptual, use brain_search (semantic: true) FIRST to gather context
- Don't guess - search the knowledge base to understand existing patterns before answering
- Multiple searches are STRONGLY ENCOURAGED when context is unclear
- **DO NOT return a final answer until you have gathered sufficient information**
- If you only found partial results (e.g., one grep match), continue searching with different queries
- Use multiple tools in sequence: brain_search → grep_files → read_file → more searches if needed
- Only provide a final answer when you have explored enough to give a complete response

**Available capabilities**:
... (le reste de ton prompt existant)
`;
```

**Note** : Cette modification complète les instructions existantes plutôt que de les remplacer.

### Impact

L'agent adopte une posture proactive, anticipant les besoins et complétant les tâches sans demander de confirmation pour chaque étape.

### Fichiers à modifier

- `packages/core/src/runtime/agents/rag-agent.ts` (méthode `buildSystemPrompt`)

### Dépendances

- Aucune (modification de prompt uniquement)

### Tests

- Vérifier que le manifeste est présent dans le prompt
- Tester que l'agent anticipe les dépendances
- Vérifier que l'agent complète les tâches sans demander de confirmation

---

## Feature 2 : Thought-Loop Forcé - Schema Injection

### ✅ État Actuel : Non Implémenté (mais infrastructure existe)

**Dans `rag-agent.ts` (lignes 1026-1040)** :
Le système supporte déjà les schémas de sortie personnalisés :
```typescript
const outputSchema = this.outputSchema || {
  answer: {
    type: 'string',
    description: 'Your answer based on the tool results',
    prompt: 'For greetings or simple questions, respond directly. For tasks requiring tools, fill this ONLY when the task is complete.',
    required: true,
  },
  confidence: {
    type: 'string',
    description: 'Confidence level: high, medium, low',
    prompt: 'Rate your confidence: high, medium, or low',
    required: false,
  },
};
```

**Note** : Le système utilise `StructuredLLMExecutor` qui supporte les schémas structurés, donc l'infrastructure est prête.

### Description

Ajouter un champ `context_analysis` obligatoire au schéma de sortie pour forcer l'agent à analyser le contexte avant d'agir.

### Implémentation

Modifier `outputSchema` dans la méthode `ask()` pour ajouter l'analyse obligatoire :

```typescript
const outputSchema = this.outputSchema || {
    // 1. FORCER L'ANALYSE D'ABORD
    context_analysis: {
        type: 'string',
        description: 'Analyze what the user REALLY wants vs what they said. Identify implicit dependencies.',
        prompt: 'Start here. What files might break? What is the missing context? Does this require multiple steps?',
        required: true,
    },
    
    // 2. PLAN D'ATTAQUE
    planned_actions: {
        type: 'string',
        description: 'Short bullet points of what you are about to do proactively.',
        required: false,
    },
    
    // 3. LA RÉPONSE (seulement après avoir réfléchi)
    answer: {
        type: 'string',
        description: 'Your final answer or the result of your actions.',
        prompt: 'Only provide this once you have executed the necessary actions.',
        required: true,
    },
    
    confidence: {
        type: 'number',
        description: 'Confidence level (0-1)',
        required: false,
    },
};
```

### Pourquoi ça marche ?

Le LLM génère le JSON dans l'ordre. En l'obligeant à remplir `context_analysis` en premier, il "réalise" qu'il manque des infos ou qu'il doit vérifier un autre fichier **avant** de générer l'action ou la réponse.

### Impact

L'agent analyse systématiquement le contexte avant d'agir, réduisant les actions précipitées et améliorant la qualité des réponses.

### Fichiers à modifier

- `packages/core/src/runtime/agents/rag-agent.ts` (méthode `ask`, définition de `outputSchema`)

### Dépendances

- Système de schéma de sortie structuré (StructuredLLMExecutor)

### Tests

- Vérifier que `context_analysis` est toujours rempli
- Tester que l'analyse précède l'action
- Vérifier que l'agent identifie les dépendances implicites

---

## Feature 3 : Détection de "Lazy Response" - Auto-Relance

### ✅ État Actuel : Partiellement Implémenté

**Dans `rag-agent.ts` (lignes 1352-1358)** :
Le code contient déjà des instructions pour ne pas abandonner :
```typescript
- Multiple searches are STRONGLY ENCOURAGED when context is unclear
- If you only found partial results (e.g., one grep match), continue searching with different queries
- Use multiple tools in sequence: brain_search → grep_files → read_file → more searches if needed
```

**Comparaison avec la roadmap** :
- ✅ Instructions pour persister présentes
- ⚠️ Pas de stratégies explicites listées (broaden search, check parent directory, etc.)
- ⚠️ Pas de système externe d'analyse (rely uniquement sur le prompt)

### Description

Compléter les instructions existantes avec des stratégies explicites et ajouter un système externe d'analyse (Response Quality Analyzer) pour détecter et relancer automatiquement les réponses "lazy".

### Implémentation

#### Étape 1 : Améliorer le prompt (compléter l'existant)

Ajouter dans `buildSystemPrompt()` après les instructions existantes :

```typescript
basePrompt += `
**WHEN YOU ARE STUCK OR FIND NOTHING**:
If your search (grep/brain_search) returns 0 results, DO NOT GIVE UP.

1. Broaden your search (remove keywords, search only for filenames).
2. Check the parent directory with list_directory.
3. Assume you made a typo and try fuzzy searching.
4. Check related files or imports.

*A response of "I couldn't find it" is considered a FAILURE unless you have tried at least 3 different search strategies.*
`;
```

#### Étape 2 : Ajouter le système externe (voir ROADMAP_AUTO_VERIFICATION.md Feature 3)

Le Response Quality Analyzer détectera automatiquement les réponses "lazy" et relancera avec une query améliorée.

### Impact

L'agent persiste face aux obstacles, essayant plusieurs stratégies avant d'abandonner, réduisant les faux négatifs.

### Fichiers à modifier

- `packages/core/src/runtime/agents/rag-agent.ts` (méthode `buildSystemPrompt`)

### Dépendances

- Aucune (modification de prompt uniquement)

### Tests

- Test avec recherche qui échoue → l'agent essaie d'autres stratégies
- Test avec recherche qui réussit → comportement normal
- Vérifier que l'agent mentionne les stratégies essayées

---

## Ordre d'Implémentation

1. **Manifeste de Proactivité** (impact immédiat, facile à implémenter)
2. **Détection de Lazy Response** (modification de prompt, simple)
3. **Thought-Loop Forcé** (nécessite modification du schéma, plus complexe)

---

## Métriques de Succès

- Augmentation des actions proactives (anticipation de dépendances)
- Réduction des réponses "Je ne sais pas" ou "Je ne trouve pas"
- Amélioration de la qualité des analyses de contexte
- Augmentation du taux de complétion des tâches sans intervention

---

## Notes

Ces trois features travaillent ensemble pour transformer la posture de l'agent :
- Le **Manifeste** donne la permission et l'ordre d'être proactif
- Le **Thought-Loop** force l'analyse avant l'action
- La **Détection de Lazy Response** interdit l'abandon facile

L'implémentation du Manifeste et de la Détection de Lazy Response est simple (modification de prompt) et peut être déployée rapidement, tandis que le Thought-Loop nécessite une modification plus profonde du système de schéma.
