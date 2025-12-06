# Agent Task Tracking Design

## Problem Statement

L'agent RagForge s'arrête prématurément quand il reçoit une requête multi-étapes comme :
> "Create a TypeScript project called webapp, write src/index.ts with a main function, write public/index.html, ingest all files"

Après avoir exécuté `create_project`, le LLM décide parfois de donner une "final answer" au lieu de continuer avec les autres étapes.

### Cause racine
Le prompt actuel est ambigu :
```
Based on these results, provide your final answer or call additional tools if needed.
```

Le LLM interprète "if needed" comme optionnel et peut décider que c'est "suffisant".

---

## Design retenu

### Deux modes d'exécution

| Mode | Quand | Flow |
|------|-------|------|
| **Simple** | Requête directe (ex: "query all functions") | `tool_calls` → `answer` |
| **Complex** | Agent choisit `plan_actions` | TASK_LIST → tracking → `task_completed` → `final_answer` |

L'agent décide lui-même s'il a besoin de planifier ou pas. Le task tracking s'applique **uniquement** quand `plan_actions` est utilisé.

### Principes (mode Complex)

1. **L'orchestrateur track les tâches** - pas le LLM
2. **1 tâche = 1 objectif** - peut nécessiter plusieurs tool calls
3. **`task_completed`** = réponse intermédiaire (résumé de la tâche courante)
4. **`final_answer`** = STOP, toutes les tâches sont terminées

### Structured Output Schema

```typescript
interface AgentResponse {
  // Reasoning pendant l'exécution (optionnel)
  reasoning?: string;

  // Tools à appeler - continue la boucle
  tool_calls: ToolCall[];

  // Marqueur : tâche courante terminée + résumé
  // Quand présent → orchestrateur passe à la tâche suivante
  task_completed?: string;

  // STOP - fin de l'agent, toutes les tâches sont terminées
  final_answer?: string;
}
```

### Combinaisons possibles

| tool_calls | task_completed | final_answer | Signification |
|------------|----------------|--------------|---------------|
| `[...]`    | -              | -            | Travaille sur la tâche courante |
| `[...]`    | `"summary"`    | -            | Tâche finie, commence la suivante |
| `[]`       | `"summary"`    | -            | Tâche finie, attend prochaine instruction |
| `[]`       | -              | `"Done!"`    | **STOP** - Toutes les tâches terminées |

---

## Prompt Structure

### Initial (avant exécution)

```
=== USER REQUEST ===
Create a TypeScript project called webapp, write src/index.ts with a main function,
write public/index.html, ingest all files

=== TASK LIST ===
1. [ ] Create TypeScript project "webapp"
2. [ ] Write src/index.ts with main function
3. [ ] Write public/index.html with basic HTML
4. [ ] Ingest all files

=== CURRENT TASK ===
Task 1: Create TypeScript project "webapp"

=== INSTRUCTIONS ===
Execute the CURRENT TASK by calling the appropriate tool(s).
- While working on a task, return tool_calls with your reasoning
- When the current task is done, return task_completed with a brief summary
- Only return final_answer when ALL 4 tasks are complete
```

### Après Task 1 terminée

```
=== USER REQUEST ===
Create a TypeScript project called webapp, write src/index.ts with a main function,
write public/index.html, ingest all files

=== TASK LIST ===
1. [x] Create TypeScript project "webapp" ✓
2. [>] Write src/index.ts with main function  ← CURRENT
3. [ ] Write public/index.html with basic HTML
4. [ ] Ingest all files

=== CURRENT TASK ===
Task 2: Write src/index.ts with main function

=== COMPLETED TASKS ===
Task 1: "Project webapp created at /tmp/webapp with RAG setup"

=== TOOL RESULTS ===
create_project [SUCCESS]: { "projectPath": "/tmp/webapp", ... }

=== INSTRUCTIONS ===
Execute the CURRENT TASK.
- Return tool_calls to continue working
- Return task_completed when this task is done
- Only return final_answer when ALL 4 tasks are complete (3 remaining)
```

---

## Orchestrator Flow

```
┌─────────────────────────────────────────────────┐
│  1. Receive USER REQUEST                        │
└─────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────┐
│  2. LLM: Decompose into TASK LIST               │
│     (first LLM call, structured output)         │
└─────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────┐
│  3. Set CURRENT_TASK = 0                        │
└─────────────────────────────────────────────────┘
                    ↓
        ┌──────────────────────┐
        │  4. Build prompt     │◄──────────────┐
        │  with task context   │               │
        └──────────────────────┘               │
                    ↓                          │
        ┌──────────────────────┐               │
        │  5. Call LLM         │               │
        └──────────────────────┘               │
                    ↓                          │
        ┌──────────────────────┐               │
        │  6. Parse response   │               │
        └──────────────────────┘               │
                    ↓                          │
    ┌───────────────┴───────────────┐          │
    ↓                               ↓          │
┌─────────┐                   ┌───────────┐    │
│final_   │                   │tool_calls │    │
│answer?  │                   │present?   │    │
└────┬────┘                   └─────┬─────┘    │
     ↓                              ↓          │
┌─────────┐                   ┌───────────┐    │
│ RETURN  │                   │ Execute   │    │
│ Done!   │                   │ tools     │    │
└─────────┘                   └─────┬─────┘    │
                                    ↓          │
                              ┌───────────┐    │
                              │task_      │    │
                              │completed? │    │
                              └─────┬─────┘    │
                                    ↓          │
                         ┌──────────┴──────────┐
                         ↓                     ↓
                   ┌───────────┐         ┌───────────┐
                   │ Yes:      │         │ No:       │
                   │ CURRENT++ │         │ Continue  │
                   └─────┬─────┘         └─────┬─────┘
                         ↓                     │
                         └─────────────────────┘
                                    │
                                    └──────────┘
```

---

## Implémentation

### Scope

Ces changements s'appliquent **uniquement** au mode Complex (plan_actions).
Le mode Simple reste inchangé.

### Fichiers à modifier

1. **`planning-tools.ts`** (principal)
   - Modifier `executeSubAgent()` pour implémenter le task tracking
   - Le sub-agent reçoit TASK_LIST + CURRENT_TASK dans son contexte
   - Gérer la logique CURRENT_TASK++ quand `task_completed` reçu

2. **`rag-agent.ts`**
   - Ajouter support pour `taskContext` avec TASK_LIST (déjà partiellement fait)
   - Modifier `buildSystemPrompt()` pour afficher la TASK_LIST

3. **`structured-llm-executor.ts`**
   - Modifier `buildTaskWithToolResults()` pour le nouveau format de prompt
   - Ajouter `task_completed` et `final_answer` au schema de sortie

4. **Output schema avec prompts**

   Le champ `prompt` donne des instructions spécifiques au LLM pour chaque field.

   **Mode Simple :**
   ```typescript
   const outputSchema = {
     answer: {
       type: 'string',
       description: 'Your answer',
       prompt: 'Provide your answer ONLY when you have completed the task. If you still need to call tools, leave this empty.',
       required: true,
     },
     confidence: {
       type: 'string',
       description: 'Confidence level',
       prompt: 'Rate your confidence: high, medium, or low',
       required: false,
     },
   };
   ```

   **Mode Complex (plan_actions) :**
   ```typescript
   const outputSchema = {
     reasoning: {
       type: 'string',
       description: 'Your reasoning',
       prompt: 'Explain what you are doing and why',
     },
     tool_calls: {
       type: 'array',
       description: 'Tools to call',
       prompt: 'List the tools you need to call. Can be combined with task_completed.',
     },
     task_completed: {
       type: 'string',
       description: 'Summary of completed task',
       prompt: 'Fill this ONLY when you have finished the CURRENT TASK. Brief summary of what was done.',
       required: false,
     },
     final_answer: {
       type: 'string',
       description: 'Final response',
       prompt: 'Fill this ONLY when ALL tasks in the TASK LIST are complete. This stops the agent.',
       required: false,
     },
   };
   ```

---

## Questions résolues

| Question | Réponse |
|----------|---------|
| Qui décompose les tâches ? | Le LLM à la première itération |
| Granularité des tâches ? | 1 tâche = 1 objectif (peut nécessiter plusieurs tools) |
| Qui track les tâches ? | L'orchestrateur (pas le LLM) |
| Comment signaler tâche finie ? | `task_completed` avec résumé texte |
| Comment signaler ALL DONE ? | `final_answer` |

---

## Statut d'implémentation

- [x] Mode Simple : `prompt` ajouté au output schema (rag-agent.ts:652-665)
- [x] Mode Complex : `executeSubAgent` refactorisé avec task tracking (rag-agent.ts:1039-1192)
- [x] Output schema Complex : `task_completed` + `final_answer` (rag-agent.ts:1056-1075)
- [x] Méthode `updateTaskContext()` ajoutée (rag-agent.ts:889-899)
- [x] Prompt TASK_LIST avec [x]/[>]/[ ] markers (rag-agent.ts:1091-1116)
- [x] Log path affiché en premier (cli/agent.ts:848)

## Prochaines étapes

- [ ] Tester Mode Simple amélioré
- [ ] Tester Mode Complex (plan_actions) avec le cas problématique (webapp + HTML/CSS)
