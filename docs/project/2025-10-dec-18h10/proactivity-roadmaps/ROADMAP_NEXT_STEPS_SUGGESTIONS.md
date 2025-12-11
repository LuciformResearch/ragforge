# Roadmap : Suggestions d'Actions Suivantes

## Vue d'ensemble

Cette roadmap couvre l'implémentation d'un système qui permet à l'agent de proposer des actions supplémentaires dans sa réponse finale, comme des tests, compilation, vérifications, etc.

## Objectifs

- **Proactivité** : L'agent suggère des actions pertinentes après avoir complété une tâche
- **Guidance** : Aide l'utilisateur à savoir quoi faire ensuite
- **Qualité** : Encourage les bonnes pratiques (tests, compilation, vérification)

---

## Feature : Suggestions d'Actions Suivantes dans la Réponse Finale

### ✅ État Actuel

**Dans `rag-agent.ts`** :
L'agent génère une réponse finale mais ne propose pas d'actions supplémentaires de manière structurée.

**Problème** :
- L'utilisateur doit deviner quoi faire ensuite
- Pas de suggestions pour tester, compiler, vérifier
- Pas de guidance proactive

### Description

Ajouter un système qui analyse la tâche effectuée et propose des actions suivantes pertinentes dans la réponse finale de l'agent.

### Implémentation

#### Étape 1 : Créer le schéma de suggestions

```typescript
// Dans packages/core/src/runtime/agents/rag-agent.ts

interface NextStepSuggestion {
  action: string;              // Ex: "run_tests", "compile", "check_lint"
  description: string;         // Description de l'action
  command?: string;            // Commande à exécuter (optionnel)
  reason: string;              // Pourquoi cette action est pertinente
  priority: 'high' | 'medium' | 'low';
}

interface ResponseWithNextSteps {
  answer: string;
  confidence?: string;
  nextSteps?: NextStepSuggestion[];
}
```

#### Étape 2 : Créer le générateur de suggestions

```typescript
/**
 * Génère des suggestions d'actions suivantes basées sur la tâche effectuée
 */
private async generateNextStepsSuggestions(
  taskDescription: string,
  toolsUsed: string[],
  filesModified: string[]
): Promise<NextStepSuggestion[]> {
  if (!this.llmExecutor || !this.llmProvider) {
    return [];
  }

  try {
    const suggestions = await this.llmExecutor.executeSingle<{
      nextSteps: Array<{
        action: string;
        description: string;
        command?: string;
        reason: string;
        priority: 'high' | 'medium' | 'low';
      }>;
    }>({
      llmProvider: this.llmProvider,
      input: {
        taskDescription,
        toolsUsed: toolsUsed.join(', '),
        filesModified: filesModified.join(', ')
      },
      inputFields: [
        { name: 'taskDescription', maxLength: 500 },
        { name: 'toolsUsed' },
        { name: 'filesModified' }
      ],
      outputSchema: {
        nextSteps: {
          type: 'array',
          description: 'Suggested next steps for the user',
          required: false,
          items: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                description: 'Action identifier (e.g., "run_tests", "compile", "check_lint")',
                required: true
              },
              description: {
                type: 'string',
                description: 'Human-readable description of the action',
                required: true
              },
              command: {
                type: 'string',
                description: 'Command to execute (if applicable)',
                required: false
              },
              reason: {
                type: 'string',
                description: 'Why this action is relevant',
                required: true
              },
              priority: {
                type: 'string',
                enum: ['high', 'medium', 'low'],
                description: 'Priority of this suggestion',
                required: true
              }
            }
          },
          maxItems: 5  // Maximum 5 suggestions
        }
      },
      systemPrompt: `You are a proactive assistant that suggests next steps after completing a task.

Analyze the task that was completed and suggest relevant follow-up actions.

COMMON SUGGESTIONS:
- **run_tests**: If code was modified, suggest running tests
- **compile**: If code was modified, suggest compiling/checking for errors
- **check_lint**: If code was modified, suggest checking linting
- **review_changes**: If files were modified, suggest reviewing the changes
- **run_build**: If build files were modified, suggest running build
- **check_dependencies**: If package.json was modified, suggest checking dependencies
- **verify_functionality**: If functionality was added, suggest manual verification
- **update_documentation**: If code was added, suggest updating documentation
- **commit_changes**: If changes were made, suggest committing (if git available)

PRIORITY GUIDELINES:
- **high**: Critical actions (tests, compilation) after code changes
- **medium**: Important but not critical (linting, review)
- **low**: Nice to have (documentation, commit)

Only suggest actions that are relevant to the task completed.`,
      userTask: `Task completed: "${taskDescription}"

Tools used: ${toolsUsed}
Files modified: ${filesModified}

Suggest 2-5 relevant next steps. Focus on high-priority actions first.`
    });

    return suggestions.nextSteps || [];
  } catch (error) {
    console.debug('[RagAgent] Error generating next steps:', error);
    return [];
  }
}
```

#### Étape 3 : Détecter les fichiers modifiés et outils utilisés

**Pattern inspiré de Gemini CLI** : Utiliser un système de tracking similaire à `UiTelemetryService`.

```typescript
// Dans RagAgent class
interface SessionMetrics {
  tools: {
    totalCalls: number;
    byName: Record<string, { count: number; success: number; fail: number }>;
  };
  files: {
    modified: Set<string>;
    totalLinesAdded: number;
    totalLinesRemoved: number;
  };
}

private sessionMetrics: SessionMetrics = {
  tools: { totalCalls: 0, byName: {} },
  files: { modified: new Set(), totalLinesAdded: 0, totalLinesRemoved: 0 }
};

// Dans GeneratedToolExecutor.execute() ou via callback onToolResult
private trackToolUsage(toolName: string, result: any, success: boolean) {
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
  
  // Détecter fichiers modifiés depuis tool results (pattern Gemini CLI)
  if (toolName === 'write_file' || toolName === 'edit_file' || toolName === 'create_file') {
    const filePath = result.file || result.path;
    if (filePath) {
      this.sessionMetrics.files.modified.add(filePath);
    }
    
    // Track lines if available in metadata (comme Gemini CLI)
    if (result.metadata?.linesAdded) {
      this.sessionMetrics.files.totalLinesAdded += result.metadata.linesAdded;
    }
    if (result.metadata?.linesRemoved) {
      this.sessionMetrics.files.totalLinesRemoved += result.metadata.linesRemoved;
    }
  }
}
```

#### Étape 4 : Intégrer dans la réponse finale

```typescript
// Dans ask() method, après génération de la réponse
async ask(question: string, conversationId?: string): Promise<AskResult> {
  // ... existing code ...
  
  // Générer la réponse normale
  const result = await this.executor.executeLLMBatchWithTools(...);
  
    // Générer les suggestions d'actions suivantes
    const nextSteps = await this.generateNextStepsSuggestions(
      question,
      Array.from(Object.keys(this.sessionMetrics.tools.byName)),
      Array.from(this.sessionMetrics.files.modified)
    );
  
  // Formater la réponse avec suggestions
  const answer = result.answer || '';
  const formattedAnswer = nextSteps.length > 0
    ? this.formatAnswerWithNextSteps(answer, nextSteps)
    : answer;
  
  // Reset tracking pour la prochaine question (pattern Gemini CLI)
  this.sessionMetrics = {
    tools: { totalCalls: 0, byName: {} },
    files: { modified: new Set(), totalLinesAdded: 0, totalLinesRemoved: 0 }
  };
  
  return {
    answer: formattedAnswer,
    confidence: result.confidence,
    toolsUsed: Array.from(Object.keys(this.sessionMetrics.tools.byName)),
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
    nextSteps: nextSteps  // Exposer aussi dans le résultat
  };
}

/**
 * Formate la réponse avec les suggestions d'actions suivantes
 */
private formatAnswerWithNextSteps(
  answer: string,
  nextSteps: NextStepSuggestion[]
): string {
  if (nextSteps.length === 0) {
    return answer;
  }
  
  const highPriority = nextSteps.filter(s => s.priority === 'high');
  const mediumPriority = nextSteps.filter(s => s.priority === 'medium');
  const lowPriority = nextSteps.filter(s => s.priority === 'low');
  
  let formatted = answer;
  
  formatted += '\n\n---\n\n';
  formatted += '## 📋 Actions suggérées pour la suite\n\n';
  
  if (highPriority.length > 0) {
    formatted += '### 🔥 Priorité haute\n\n';
    for (const step of highPriority) {
      formatted += `- **${step.description}**\n`;
      if (step.command) {
        formatted += `  \`${step.command}\`\n`;
      }
      formatted += `  _${step.reason}_\n\n`;
    }
  }
  
  if (mediumPriority.length > 0) {
    formatted += '### ⚠️ Priorité moyenne\n\n';
    for (const step of mediumPriority) {
      formatted += `- **${step.description}**\n`;
      if (step.command) {
        formatted += `  \`${step.command}\`\n`;
      }
      formatted += `  _${step.reason}_\n\n`;
    }
  }
  
  if (lowPriority.length > 0) {
    formatted += '### 💡 Suggestions\n\n';
    for (const step of lowPriority) {
      formatted += `- **${step.description}**\n`;
      if (step.command) {
        formatted += `  \`${step.command}\`\n`;
      }
      formatted += `  _${step.reason}_\n\n`;
    }
  }
  
  return formatted;
}
```

#### Étape 5 : Détecter le type de projet pour suggestions adaptées

```typescript
/**
 * Détecte le type de projet pour adapter les suggestions
 */
private detectProjectType(projectRoot: string): {
  type: 'typescript' | 'python' | 'javascript' | 'rust' | 'go' | 'unknown';
  hasTests: boolean;
  hasLint: boolean;
  hasBuild: boolean;
} {
  const fs = require('fs');
  const path = require('path');
  
  const packageJsonPath = path.join(projectRoot, 'package.json');
  const hasPackageJson = fs.existsSync(packageJsonPath);
  
  let type: 'typescript' | 'python' | 'javascript' | 'rust' | 'go' | 'unknown' = 'unknown';
  let hasTests = false;
  let hasLint = false;
  let hasBuild = false;
  
  if (hasPackageJson) {
    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      const scripts = packageJson.scripts || {};
      
      hasTests = 'test' in scripts || 'test:unit' in scripts || 'test:integration' in scripts;
      hasLint = 'lint' in scripts || 'lint:fix' in scripts;
      hasBuild = 'build' in scripts || 'compile' in scripts;
      
      if (packageJson.devDependencies?.typescript || packageJson.dependencies?.typescript) {
        type = 'typescript';
      } else {
        type = 'javascript';
      }
    } catch {
      // Ignore
    }
  }
  
  // Détecter Python
  if (fs.existsSync(path.join(projectRoot, 'requirements.txt')) ||
      fs.existsSync(path.join(projectRoot, 'pyproject.toml'))) {
    type = 'python';
    hasTests = fs.existsSync(path.join(projectRoot, 'pytest.ini')) ||
               fs.existsSync(path.join(projectRoot, 'tests'));
  }
  
  // Détecter Rust
  if (fs.existsSync(path.join(projectRoot, 'Cargo.toml'))) {
    type = 'rust';
    hasTests = true; // Rust a tests intégrés
    hasBuild = true;
  }
  
  // Détecter Go
  if (fs.existsSync(path.join(projectRoot, 'go.mod'))) {
    type = 'go';
    hasTests = true; // Go a tests intégrés
    hasBuild = true;
  }
  
  return { type, hasTests, hasLint, hasBuild };
}
```

#### Étape 6 : Adapter les suggestions selon le type de projet

```typescript
private async generateNextStepsSuggestions(
  taskDescription: string,
  toolsUsed: string[],
  filesModified: string[],
  projectRoot?: string
): Promise<NextStepSuggestion[]> {
  // Détecter le type de projet
  const projectInfo = projectRoot 
    ? this.detectProjectType(projectRoot)
    : { type: 'unknown' as const, hasTests: false, hasLint: false, hasBuild: false };
  
  // Générer les suggestions avec contexte du projet
  const suggestions = await this.llmExecutor.executeSingle<{
    nextSteps: Array<{
      action: string;
      description: string;
      command?: string;
      reason: string;
      priority: 'high' | 'medium' | 'low';
    }>;
  }>({
    // ... existing config ...
    input: {
      taskDescription,
      toolsUsed: toolsUsed.join(', '),
      filesModified: filesModified.join(', '),
      projectType: projectInfo.type,
      hasTests: projectInfo.hasTests,
      hasLint: projectInfo.hasLint,
      hasBuild: projectInfo.hasBuild
    },
    systemPrompt: `You are a proactive assistant that suggests next steps after completing a task.

PROJECT CONTEXT:
- Type: ${projectInfo.type}
- Has tests: ${projectInfo.hasTests}
- Has lint: ${projectInfo.hasLint}
- Has build: ${projectInfo.hasBuild}

SUGGESTIONS BY PROJECT TYPE:

**TypeScript/JavaScript**:
- run_tests: npm test / npm run test
- check_lint: npm run lint
- compile: npm run build / tsc --noEmit
- check_types: tsc --noEmit

**Python**:
- run_tests: pytest / python -m pytest
- check_lint: pylint / flake8 / black --check
- type_check: mypy

**Rust**:
- run_tests: cargo test
- compile: cargo build
- check: cargo check

**Go**:
- run_tests: go test ./...
- build: go build
- vet: go vet

Only suggest actions that are relevant to the project type and available in the project.`
  });
  
  return suggestions.nextSteps || [];
}
```

### Fichiers à modifier

- `packages/core/src/runtime/agents/rag-agent.ts` :
  - Ajouter interface `NextStepSuggestion` et `ResponseWithNextSteps`
  - Ajouter `filesModifiedInSession` et `toolsUsedInSession` pour tracking
  - Ajouter `trackToolUsage()` pour tracker les outils et fichiers modifiés
  - Ajouter `generateNextStepsSuggestions()` pour générer les suggestions
  - Ajouter `detectProjectType()` pour détecter le type de projet
  - Ajouter `formatAnswerWithNextSteps()` pour formater la réponse
  - Modifier `ask()` pour intégrer les suggestions dans la réponse finale
  - Modifier `GeneratedToolExecutor` ou ajouter callback pour tracker les outils

### Tests

- Test avec modification de code TypeScript → suggère tests, lint, build
- Test avec modification de code Python → suggère pytest, pylint
- Test avec modification de documentation → suggère review seulement
- Test sans modifications → pas de suggestions
- Test avec projet sans tests → ne suggère pas run_tests
- Test avec plusieurs fichiers modifiés → suggestions adaptées

### Exemples de Suggestions

**Après modification de code TypeScript** :
```
## 📋 Actions suggérées pour la suite

### 🔥 Priorité haute
- **Exécuter les tests**
  `npm test`
  _Vérifier que les modifications n'ont pas cassé les tests existants_

- **Vérifier la compilation**
  `npm run build`
  _S'assurer que le code compile sans erreurs_

### ⚠️ Priorité moyenne
- **Vérifier le linting**
  `npm run lint`
  _S'assurer que le code respecte les conventions_
```

**Après modification de documentation** :
```
## 📋 Actions suggérées pour la suite

### 💡 Suggestions
- **Revoir les changements**
  `git diff`
  _Vérifier que la documentation est correcte et complète_
```

### Optimisations

1. **Cache des suggestions** : Mettre en cache les suggestions pour tâches similaires
2. **Apprentissage** : Adapter les suggestions selon les préférences de l'utilisateur
3. **Intégration CLI** : Permettre d'exécuter directement les suggestions depuis la CLI
4. **Suggestions contextuelles** : Adapter selon le contexte de la conversation

---

## Métriques de Succès

- **Proactivité** : +30% d'actions suggérées pertinentes
- **Adoption** : +20% d'utilisateurs qui suivent les suggestions
- **Qualité** : -15% d'erreurs détectées après les suggestions

---

## Notes

Cette feature transforme l'agent d'un "exécuteur de tâches" en un "conseiller proactif" qui guide l'utilisateur vers les meilleures pratiques.

Les suggestions sont générées de manière intelligente selon :
- Le type de projet (TypeScript, Python, Rust, etc.)
- Les outils disponibles (tests, lint, build)
- Les fichiers modifiés
- La tâche effectuée

**Pattern inspiré de Gemini CLI** :
- Utilise le même système de tracking que `UiTelemetryService` de Gemini CLI
- Track les outils utilisés (`byName`) et fichiers modifiés
- Expose les stats dans la réponse (comme le format JSON de Gemini CLI)
- Permet l'analyse et la génération de suggestions intelligentes

Voir [FINDINGS_GEMINI_CLI_OPENCODE.md](./FINDINGS_GEMINI_CLI_OPENCODE.md) pour plus de détails sur les patterns réutilisés.
