# Roadmap : Agent de Contexte Initial - Recherche Parallèle Multi-Outils

## Vue d'ensemble

Cette roadmap couvre l'implémentation d'un **agent de contexte initial** simple qui utilise `StructuredLLMExecutor` pour effectuer jusqu'à 3 recherches parallèles (grep, terminal, fuzzy search) au lieu du fallback fuzzy search actuel. Cet agent est lancé **en parallèle** avec le semantic search, quoi qu'il arrive, pour compléter le contexte.

## Objectifs

- **Recherche parallèle** : Lancer jusqu'à 3 recherches simultanément pour améliorer la couverture
- **Choix intelligent** : L'agent compose librement jusqu'à 3 appels parmi grep_files, run_command, search_files
- **Performance** : Recherches parallèles plutôt que séquentielles
- **Meilleure couverture** : Plus de chances de trouver le code recherché
- **Abstraction réutilisable** : Créer un agent de contexte initial réutilisable, basé sur `rag-agent` mais simplifié

---

## Feature : Agent de Recherche Parallèle Multi-Outils

### ✅ État Actuel : Fallback Simple

**Dans `storage.ts` (lignes 2204-2211)** :
Le système actuel fait un fallback simple avec fuzzy search :
```typescript
// Fallback: Use LLM-guided fuzzy search if project not known OR locks not available
if (!isProjectKnown || !locksAvailable) {
  return await this.searchCodeFuzzyWithLLM(userMessage, {
    cwd: options.cwd,
    projectRoot: options.projectRoot,
    maxChars: options?.codeSearchMaxChars ?? this.getCodeSearchMaxChars()
  });
}
```

**Problème** :
- Une seule méthode de recherche (fuzzy)
- Pas de parallélisme
- Pas de choix entre grep, terminal, ou fuzzy search
- L'agent ne peut pas combiner plusieurs approches

### Description

Remplacer le fallback fuzzy search par un **agent de contexte initial** simple qui :
1. Utilise `StructuredLLMExecutor` avec un prompt simplifié : "tu es un agent de contexte initial, l'utilisateur a posé cette question à notre agent de code, appelle jusqu'à 3 fois des outils parmi ceux disponibles"
2. Dispose de 3 tools : `grep_files`, `run_command` (terminal), et `search_files` (fuzzy)
3. L'agent compose librement : peut utiliser le même tool 3 fois, ou combiner les 3 tools différemment
4. Exécute les recherches en parallèle (via `toolMode: 'global'` de `StructuredLLMExecutor`)
5. Fusionne et trie les résultats
6. **Toujours lancé en parallèle** avec semantic search, quoi qu'il arrive

### Implémentation

#### Étape 1 : Créer l'agent de contexte initial (abstraction réutilisable)

**Architecture proposée** : Créer un `ContextInitialAgent` qui réutilise la logique de `rag-agent` mais simplifié :

```typescript
// Dans packages/core/src/runtime/agents/context-initial-agent.ts (nouveau fichier)

import { StructuredLLMExecutor } from '../llm/structured-llm-executor.js';
import type { LLMProvider } from '../reranking/llm-provider.js';
import type { ToolDefinition, ToolExecutor } from '../llm/structured-llm-executor.js';
import { BaseToolExecutor } from '../llm/structured-llm-executor.js';

/**
 * Agent de contexte initial - Recherche parallèle multi-outils
 * 
 * Version simplifiée de rag-agent pour les recherches de contexte initial.
 * Utilise StructuredLLMExecutor avec seulement 3 tools (grep, terminal, fuzzy).
 * Peut appeler jusqu'à 3 fois ces tools en parallèle.
 */
export class ContextInitialAgent {
  private executor: StructuredLLMExecutor;
  private llmProvider: LLMProvider;
  private tools: ToolDefinition[];
  private toolExecutor: ToolExecutor;

  constructor(
    llmProvider: LLMProvider,
    tools: ToolDefinition[],
    toolExecutor: ToolExecutor
  ) {
    this.executor = new StructuredLLMExecutor();
    this.llmProvider = llmProvider;
    this.tools = tools;
    this.toolExecutor = toolExecutor;
  }

  /**
   * Exécute jusqu'à 3 recherches parallèles pour enrichir le contexte
   */
  async searchContext(
    userQuery: string,
    options: {
      cwd: string;
      projectRoot: string;
    }
  ): Promise<Array<{
    scopeId: string;
    name: string;
    file: string;
    startLine: number;
    endLine: number;
    content: string;
    score: number;
    charCount: number;
    confidence: number;
  }>> {
    const result = await this.executor.executeLLMBatchWithTools(
      [{ query: userQuery, cwd: options.cwd, projectRoot: options.projectRoot }],
      {
        inputFields: [
          { name: 'query', maxLength: 1000 },
          { name: 'cwd' },
          { name: 'projectRoot' }
        ],
        systemPrompt: `Tu es un agent de contexte initial. L'utilisateur a posé cette question à notre agent de code.

Ton rôle est d'enrichir le contexte en effectuant des recherches dans le code.

OUTILS DISPONIBLES :
1. grep_files : Recherche regex exacte dans les fichiers (meilleur pour patterns exacts, noms de fonctions/classe)
   - pattern: Pattern glob (ex: "**/*.ts", "src/**/*.js")
   - regex: Expression régulière à chercher
   - Exemple: grep_files({ pattern: "**/*.ts", regex: "function.*authenticate" })

2. run_command : Commandes terminal (meilleur pour trouver des fichiers, opérations git, sorties de build)
   - command: Commande shell à exécuter
   - Exemple: run_command({ command: "find src -name '*auth*.ts' -type f" })
   - Exemple: run_command({ command: "git grep -n 'authenticate' -- '*.ts'" })

3. search_files : Recherche fuzzy avec tolérance aux fautes (meilleur pour correspondances approximatives, typos)
   - pattern: Pattern glob
   - query: Texte à chercher (fuzzy matched)
   - Exemple: search_files({ pattern: "**/*.ts", query: "authentification" })

INSTRUCTIONS :
- Analyse la requête utilisateur et détermine quelles recherches seraient utiles
- Tu peux appeler jusqu'à 3 outils en parallèle
- Tu peux utiliser le même outil plusieurs fois si nécessaire (ex: 3 grep différents)
- Tu peux combiner les outils différemment selon tes besoins
- Appelle les outils qui te permettront de trouver le code le plus pertinent`,
        userTask: `L'utilisateur a demandé : "${userQuery}"

Effectue jusqu'à 3 recherches parallèles pour enrichir le contexte.`,
        outputSchema: {
          tool_calls: {
            type: 'array',
            description: 'Tool calls to execute (up to 3)',
            required: false,
            items: {
              type: 'object',
              properties: {
                tool_name: {
                  type: 'string',
                  enum: ['grep_files', 'run_command', 'search_files'],
                  required: true
                },
                arguments: {
                  type: 'object',
                  required: true
                }
              }
            },
            maxItems: 3
          }
        },
        tools: this.tools,
        toolMode: 'global', // Un seul appel avec jusqu'à 3 tools en parallèle
        toolChoice: 'any',
        toolExecutor: this.toolExecutor,
        llmProvider: this.llmProvider,
        maxIterationsPerItem: 1 // Pas de boucle, juste un appel
      }
    );

    // Parser les résultats des tool calls et les convertir au format attendu
    const allResults: Array<{
      scopeId: string;
      name: string;
      file: string;
      startLine: number;
      endLine: number;
      content: string;
      score: number;
      charCount: number;
      confidence: number;
    }> = [];

    // Les résultats des tools sont dans toolResults (via callback ou résultat)
    // On doit parser chaque résultat selon le tool utilisé
    // (grep_files retourne matches, run_command retourne stdout, search_files retourne matches)

    return allResults;
  }
}
```

#### Étape 1.5 : Modifier les outils grep_files et search_files pour supporter context_lines

**Modification des outils** : Ajouter un paramètre optionnel `context_lines` à `grep_files` et `search_files` pour extraire le contenu autour des lignes trouvées.

```typescript
// Dans packages/core/src/tools/fs-tools.ts

export function generateGrepFilesTool(): GeneratedToolDefinition {
  return {
    name: 'grep_files',
    // ... existing ...
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { /* ... */ },
        regex: { /* ... */ },
        ignore_case: { /* ... */ },
        max_results: { /* ... */ },
        context_lines: {
          type: 'number',
          description: 'Number of lines of context to include around each match (default: 0, no context). If > 0, extracts context_lines before and after each match.',
          default: 0
        }
      },
      required: ['pattern', 'regex'],
    },
  };
}

export function generateSearchFilesTool(): GeneratedToolDefinition {
  return {
    name: 'search_files',
    // ... existing ...
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { /* ... */ },
        query: { /* ... */ },
        threshold: { /* ... */ },
        max_results: { /* ... */ },
        context_lines: {
          type: 'number',
          description: 'Number of lines of context to include around each match (default: 0, no context). If > 0, extracts context_lines before and after each match.',
          default: 0
        }
      },
      required: ['pattern', 'query'],
    },
  };
}

// Modifier les handlers pour extraire le contexte si context_lines > 0
export function generateGrepFilesHandler(ctx: FsToolsContext) {
  return async (params: { 
    pattern: string; 
    regex: string; 
    ignore_case?: boolean; 
    max_results?: number;
    context_lines?: number;  // NOUVEAU
  }) => {
    const { pattern, regex, ignore_case = false, max_results = 100, context_lines = 0 } = params;
    
    // ... existing search logic ...
    
    // Quand on trouve un match, si context_lines > 0, extraire le contexte
    if (match) {
      let content = line.trim();
      
      if (context_lines > 0) {
        // Extraire context_lines avant et après
        const startLine = Math.max(0, i - context_lines);
        const endLine = Math.min(lines.length - 1, i + context_lines);
        const contextLines = lines.slice(startLine, endLine + 1);
        content = contextLines.join('\n');
      }
      
      matches.push({
        file,
        line: i + 1,
        content: content.substring(0, context_lines > 0 ? 5000 : 200), // Plus de chars si contexte
        match: match[0],
        startLine: context_lines > 0 ? startLine + 1 : i + 1,  // NOUVEAU : ligne de début si contexte
        endLine: context_lines > 0 ? endLine + 1 : i + 1,     // NOUVEAU : ligne de fin si contexte
      });
    }
    
    // ... rest of handler ...
  };
}

// Même logique pour generateSearchFilesHandler
```

**Note importante** : 
- Pour le **rag-agent normal** : Ce paramètre est exposé dans les tool definitions, l'agent peut choisir de l'utiliser ou non
- Pour l'**agent de contexte initial** : Ce paramètre n'est PAS exposé dans les tool definitions, mais est appliqué systématiquement (50 lignes) lors de l'appel des handlers

#### Étape 2 : Implémentation simplifiée dans storage.ts

**Approche** : Utiliser directement `StructuredLLMExecutor.executeLLMBatchWithTools` avec les 3 tools, sans créer de classe séparée. C'est juste un call StructuredLLMExecutor.

**Important** : Les tool definitions pour l'agent de contexte initial n'exposent PAS `context_lines`, mais les handlers sont appelés avec `context_lines: 50` systématiquement.

```typescript
// Dans packages/core/src/runtime/conversation/storage.ts

import { StructuredLLMExecutor } from '../llm/structured-llm-executor.js';
import { BaseToolExecutor } from '../llm/structured-llm-executor.js';
import type { ToolCallRequest, ToolExecutionResult } from '../llm/structured-llm-executor.js';
import { generateGrepFilesHandler, generateSearchFilesHandler } from '../../tools/fs-tools.js';
import { generateRunCommandHandler } from '../../tools/shell-tools.js';
import type { FsToolsContext } from '../../tools/fs-tools.js';
import type { ShellToolsContext } from '../../tools/shell-tools.js';
import * as path from 'path';

/**
 * Tool executor pour les 3 tools de recherche (grep, terminal, fuzzy)
 * 
 * IMPORTANT : Applique systématiquement context_lines: 50 pour grep_files et search_files
 * même si ce paramètre n'est pas exposé dans les tool definitions pour l'agent de contexte initial.
 */
class ContextSearchToolExecutor extends BaseToolExecutor {
  private grepHandler: (args: any) => Promise<any>;
  private searchHandler: (args: any) => Promise<any>;
  private runCommandHandler: (args: any) => Promise<any>;
  private readonly CONTEXT_LINES = 50; // Contexte systématique pour l'agent de contexte initial

  constructor(projectRoot: string, cwd: string) {
    super();
    const fsCtx: FsToolsContext = { projectRoot };
    const shellCtx: ShellToolsContext = { projectRoot: cwd, onConfirmationRequired: undefined };
    this.grepHandler = generateGrepFilesHandler(fsCtx);
    this.searchHandler = generateSearchFilesHandler(fsCtx);
    this.runCommandHandler = generateRunCommandHandler(shellCtx);
  }

  async execute(toolCall: ToolCallRequest): Promise<any> {
    if (toolCall.tool_name === 'grep_files') {
      // Appliquer systématiquement context_lines: 50 pour l'agent de contexte initial
      const argsWithContext = {
        ...toolCall.arguments,
        context_lines: this.CONTEXT_LINES
      };
      return await this.grepHandler(argsWithContext);
    } else if (toolCall.tool_name === 'search_files') {
      // Appliquer systématiquement context_lines: 50 pour l'agent de contexte initial
      const argsWithContext = {
        ...toolCall.arguments,
        context_lines: this.CONTEXT_LINES
      };
      return await this.searchHandler(argsWithContext);
    } else if (toolCall.tool_name === 'run_command') {
      return await this.runCommandHandler(toolCall.arguments);
    }
    throw new Error(`Unknown tool: ${toolCall.tool_name}`);
  }
}

/**
 * Agent de contexte initial - Recherche parallèle multi-outils
 * Utilise StructuredLLMExecutor pour appeler jusqu'à 3 recherches en parallèle
 * Remplace searchCodeFuzzyWithLLM
 */
private async searchCodeWithContextInitialAgent(
  userMessage: string,
  options: {
    cwd: string;
    projectRoot: string;
    maxChars: number;
  }
): Promise<Array<{
  scopeId: string;
  name: string;
  file: string;
  startLine: number;
  endLine: number;
  content: string;
  score: number;
  charCount: number;
  confidence: number;
}>> {
  if (!this.llmExecutor || !this.llmProvider) {
    return [];
  }

  try {
    // 1. Créer le tool executor avec les 3 handlers
    const toolExecutor = new ContextSearchToolExecutor(options.projectRoot, options.cwd);

    // 2. Définir les 3 tools disponibles pour l'agent de contexte initial
    // NOTE : context_lines n'est PAS exposé ici, mais sera appliqué systématiquement dans le handler
    const tools: ToolDefinition[] = [
      {
        name: 'grep_files',
        description: 'Search file contents using regex pattern. Best for exact patterns, function names, class names.',
        inputSchema: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Glob pattern (e.g., "**/*.ts", "src/**/*.js")' },
            regex: { type: 'string', description: 'Regular expression to search for' },
            ignore_case: { type: 'boolean', description: 'Case insensitive (default: false)' },
            max_results: { type: 'number', description: 'Maximum matches (default: 100)' }
            // context_lines n'est PAS exposé ici - sera appliqué systématiquement (50 lignes)
          },
          required: ['pattern', 'regex']
        }
      },
      {
        name: 'run_command',
        description: 'Execute terminal commands. Best for finding files, git operations, build outputs.',
        inputSchema: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Shell command to execute' },
            cwd: { type: 'string', description: 'Working directory (optional)' },
            timeout: { type: 'number', description: 'Timeout in ms (optional)' },
            modifies_files: { type: 'boolean', description: 'Whether command modifies files (default: false)' }
          },
          required: ['command']
        }
      },
      {
        name: 'search_files',
        description: 'Fuzzy search file contents with typo tolerance. Best for approximate matches, typos.',
        inputSchema: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Glob pattern (e.g., "**/*.ts")' },
            query: { type: 'string', description: 'Text to search for (fuzzy matched)' },
            threshold: { type: 'number', description: 'Similarity threshold 0-1 (default: 0.7)' },
            max_results: { type: 'number', description: 'Maximum matches (default: 50)' }
            // context_lines n'est PAS exposé ici - sera appliqué systématiquement (50 lignes)
          },
          required: ['pattern', 'query']
        }
      }
    ];

    // 3. Utiliser StructuredLLMExecutor pour appeler jusqu'à 3 tools en parallèle
    const result = await this.llmExecutor.executeLLMBatchWithTools(
      [{ query: userMessage, cwd: options.cwd, projectRoot: options.projectRoot }],
      {
        inputFields: [
          { name: 'query', maxLength: 1000 },
          { name: 'cwd' },
          { name: 'projectRoot' }
        ],
        systemPrompt: `Tu es un agent de contexte initial. L'utilisateur a posé cette question à notre agent de code.

Ton rôle est d'enrichir le contexte en effectuant des recherches dans le code.

OUTILS DISPONIBLES :
1. grep_files : Recherche regex exacte dans les fichiers (meilleur pour patterns exacts, noms de fonctions/classe)
2. run_command : Commandes terminal (meilleur pour trouver des fichiers, opérations git, sorties de build)
3. search_files : Recherche fuzzy avec tolérance aux fautes (meilleur pour correspondances approximatives, typos)

INSTRUCTIONS :
- Analyse la requête utilisateur et détermine quelles recherches seraient utiles
- Tu peux appeler jusqu'à 3 outils en parallèle
- Tu peux utiliser le même outil plusieurs fois si nécessaire (ex: 3 grep différents)
- Tu peux combiner les outils différemment selon tes besoins
- Appelle les outils qui te permettront de trouver le code le plus pertinent`,
        userTask: `L'utilisateur a demandé : "${userMessage.substring(0, 200)}"

Effectue jusqu'à 3 recherches parallèles pour enrichir le contexte.`,
        outputSchema: {
          // Pas besoin de outputSchema, on utilise juste tool_calls
        },
        tools,
        toolMode: 'global', // Un seul appel avec jusqu'à 3 tools en parallèle
        toolChoice: 'any',
        toolExecutor,
        llmProvider: this.llmProvider,
        maxIterationsPerItem: 1, // Pas de boucle, juste un appel
        useNativeToolCalling: true // Utiliser native tool calling si disponible
      }
    );

    // 4. Parser les résultats des tool calls
    // Les résultats sont dans result.items[0] avec toolResults accessibles via callback
    // On doit extraire les tool calls exécutés et leurs résultats

    // Note: StructuredLLMExecutor.executeLLMBatchWithTools retourne les résultats des tools
    // via le callback onLLMResponse ou dans la réponse finale
    // Pour récupérer les résultats, on doit utiliser le callback ou modifier le code

    // Solution temporaire : utiliser le callback pour capturer les résultats
    const toolResults: ToolExecutionResult[] = [];
    
    const resultWithCallback = await this.llmExecutor.executeLLMBatchWithTools(
      [{ query: userMessage, cwd: options.cwd, projectRoot: options.projectRoot }],
      {
        // ... même config ...
        onLLMResponse: (response) => {
          // Les tool results sont déjà exécutés par toolExecutor
          // On doit les récupérer autrement
        }
      }
    );

    // Solution meilleure : exécuter les tools manuellement après avoir obtenu les tool_calls
    // Mais StructuredLLMExecutor le fait déjà... On doit récupérer les résultats

    // TODO: Adapter selon la structure de retour de executeLLMBatchWithTools
    // Pour l'instant, on suppose qu'on peut accéder aux résultats via un mécanisme

    return []; // Placeholder
  } catch (error) {
    console.debug('[ConversationStorage] Error in context initial agent:', error);
    return [];
  }
}
```

**Note importante** : `StructuredLLMExecutor.executeLLMBatchWithTools` exécute déjà les tools via `toolExecutor`, mais on doit récupérer les résultats. Il faut vérifier comment accéder aux résultats des tool calls dans la réponse.

#### Étape 3 : Implémentation finale simplifiée

**Approche finale** : Utiliser `executeSingle` avec `tool_calls` dans le schéma de sortie, puis exécuter les tools manuellement :

```typescript
/**
 * Agent de contexte initial - Recherche parallèle multi-outils
 * Utilise StructuredLLMExecutor pour appeler jusqu'à 3 recherches en parallèle
 */
private async searchCodeWithContextInitialAgent(
  userMessage: string,
  options: {
    cwd: string;
    projectRoot: string;
    maxChars: number;
    embeddingLockAvailable?: boolean; // Vérifier si lock embedding disponible
    ingestionLockAvailable?: boolean; // Vérifier si lock ingestion disponible
  }
): Promise<Array<{
  scopeId: string;
  name: string;
  file: string;
  startLine: number;
  endLine: number;
  content: string;
  score: number;
  charCount: number;
  confidence: number;
}>> {
  if (!this.llmExecutor || !this.llmProvider) {
    return [];
  }

  // Vérifier si les locks sont disponibles pour l'enrichissement depuis Neo4j
  const embeddingLockAvailable = options.embeddingLockAvailable ?? true;
  const ingestionLockAvailable = options.ingestionLockAvailable ?? true;
  const canEnrichFromDB = embeddingLockAvailable && ingestionLockAvailable;

  try {
    // 1. Créer le tool executor avec les 3 handlers
    const toolExecutor = new ContextSearchToolExecutor(options.projectRoot, options.cwd);

    // 2. Demander à l'LLM quels tools appeler (jusqu'à 3)
    const response = await this.llmExecutor.executeSingle<{
      tool_calls?: Array<{
        tool_name: 'grep_files' | 'run_command' | 'search_files';
        arguments: Record<string, any>;
      }>;
      reasoning?: string;
    }>({
      llmProvider: this.llmProvider,
      input: {
        query: userMessage,
        cwd: options.cwd,
        projectRoot: options.projectRoot
      },
      inputFields: [
        { name: 'query', maxLength: 1000 },
        { name: 'cwd' },
        { name: 'projectRoot' }
      ],
      outputSchema: {
        tool_calls: {
          type: 'array',
          description: 'Up to 3 tool calls to execute in parallel for context enrichment',
          required: false,
          items: {
            type: 'object',
            properties: {
              tool_name: {
                type: 'string',
                enum: ['grep_files', 'run_command', 'search_files'],
                required: true
              },
              arguments: {
                type: 'object',
                required: true
              }
            }
          },
          maxItems: 3
        },
        reasoning: {
          type: 'string',
          description: 'Brief explanation of why these tools were chosen',
          required: false
        }
      },
      systemPrompt: `Tu es un agent de contexte initial. L'utilisateur a posé cette question à notre agent de code.

Ton rôle est d'enrichir le contexte en effectuant des recherches dans le code.

OUTILS DISPONIBLES :
1. grep_files : Recherche regex exacte dans les fichiers (meilleur pour patterns exacts, noms de fonctions/classe)
   - pattern: Pattern glob (ex: "**/*.ts", "src/**/*.js")
   - regex: Expression régulière à chercher
   - Exemple: { "tool_name": "grep_files", "arguments": { "pattern": "**/*.ts", "regex": "function.*authenticate" } }

2. run_command : Commandes terminal (meilleur pour trouver des fichiers, opérations git, sorties de build)
   - command: Commande shell à exécuter
   - Exemple: { "tool_name": "run_command", "arguments": { "command": "git grep -n 'authenticate' -- '*.ts'" } }

3. search_files : Recherche fuzzy avec tolérance aux fautes (meilleur pour correspondances approximatives, typos)
   - pattern: Pattern glob
   - query: Texte à chercher (fuzzy matched)
   - Exemple: { "tool_name": "search_files", "arguments": { "pattern": "**/*.ts", "query": "authentification" } }

INSTRUCTIONS :
- Analyse la requête utilisateur et détermine quelles recherches seraient utiles
- Tu peux appeler jusqu'à 3 outils en parallèle
- Tu peux utiliser le même outil plusieurs fois si nécessaire (ex: 3 grep différents)
- Tu peux combiner les outils différemment selon tes besoins
- Appelle les outils qui te permettront de trouver le code le plus pertinent`,
      userTask: `L'utilisateur a demandé : "${userMessage.substring(0, 200)}"

Effectue jusqu'à 3 recherches parallèles pour enrichir le contexte. Retourne les tool_calls à exécuter.`
    });

    if (!response.tool_calls || response.tool_calls.length === 0) {
      return [];
    }

    // 3. Exécuter les tool calls en parallèle
    const toolCallRequests: ToolCallRequest[] = response.tool_calls.map(tc => ({
      tool_name: tc.tool_name,
      arguments: tc.arguments
    }));

    const toolResults = await toolExecutor.executeBatch(toolCallRequests);

    // 4. Parser et convertir les résultats au format attendu, puis enrichir avec scopes
    const rawResults: Array<{
      file: string;
      line: number;
      content: string;
      score: number;
      confidence: number;
      tool: string;
    }> = [];

    for (let i = 0; i < toolResults.length; i++) {
      const toolResult = toolResults[i];
      const toolCall = toolCallRequests[i];

      if (!toolResult.success || !toolResult.result) {
        continue;
      }

      const result = toolResult.result;

      if (toolCall.tool_name === 'grep_files') {
        // Parser résultats grep_files : { matches: [{ file, line, content, match, startLine?, endLine? }], files_searched, total_matches }
        // Si context_lines était utilisé, startLine et endLine sont disponibles
        const matches = result.matches || [];
        for (const match of matches) {
          rawResults.push({
            file: match.file,
            line: match.line,
            content: match.content, // Contient déjà le contexte si context_lines > 0
            score: 0.9, // High confidence for exact regex matches
            confidence: 0.8,
            tool: 'grep',
            startLine: match.startLine || match.line, // Utiliser startLine si disponible (contexte extrait)
            endLine: match.endLine || match.line      // Utiliser endLine si disponible (contexte extrait)
          });
        }
      } else if (toolCall.tool_name === 'run_command') {
        // Parser résultats run_command : { stdout, stderr, exitCode, error }
        if (result.stdout) {
          const parsed = this.parseCommandOutput(result.stdout, options.projectRoot);
          rawResults.push(...parsed.map(p => ({
            file: p.file,
            line: p.startLine,
            content: p.content,
            score: p.score,
            confidence: p.confidence,
            tool: 'command'
          })));
        }
      } else if (toolCall.tool_name === 'search_files') {
        // Parser résultats search_files : { matches: [{ file, line, content, similarity, startLine?, endLine? }], files_searched, total_matches }
        // Si context_lines était utilisé, startLine et endLine sont disponibles
        const matches = result.matches || [];
        for (const match of matches) {
          rawResults.push({
            file: match.file,
            line: match.line || 1,
            content: match.content, // Contient déjà le contexte si context_lines > 0
            score: match.similarity || match.score || 0.7,
            confidence: 0.6, // Lower confidence for fuzzy matches
            tool: 'fuzzy',
            startLine: match.startLine || match.line || 1, // Utiliser startLine si disponible
            endLine: match.endLine || match.line || 1      // Utiliser endLine si disponible
          });
        }
      }
    }

    // 5. Enrichir les résultats : chercher les scopes dans Neo4j ou utiliser le contexte déjà extrait
    // IMPORTANT : 
    // - Si context_lines était utilisé dans grep/search_files, le contenu contient déjà le contexte
    // - Sinon, chercher les scopes dans Neo4j (si locks disponibles) ou lire le fichier avec contexte
    const allResults: Array<{
      scopeId: string;
      name: string;
      file: string;
      startLine: number;
      endLine: number;
      content: string;
      score: number;
      charCount: number;
      confidence: number;
    }> = [];

    // Vérifier si le contexte a déjà été extrait par les outils (context_lines utilisé)
    const hasContextExtracted = rawResults.some(r => 
      (r as any).startLine !== undefined && (r as any).endLine !== undefined && 
      (r as any).startLine !== (r as any).endLine
    );

    if (hasContextExtracted) {
      // Le contexte a déjà été extrait par grep_files/search_files avec context_lines
      // Utiliser directement les résultats avec leur contexte
      for (const raw of rawResults) {
        const startLine = (raw as any).startLine || raw.line;
        const endLine = (raw as any).endLine || raw.line;
        
        allResults.push({
          scopeId: `tool-${raw.file}-${raw.line}`,
          name: `Lines ${startLine}-${endLine} (${raw.tool} avec contexte)`,
          file: raw.file,
          startLine,
          endLine,
          content: raw.content,
          score: raw.score,
          charCount: raw.content.length,
          confidence: raw.confidence
        });
      }
    } else if (canEnrichFromDB) {
      // Option B : Enrichissement en batch depuis Neo4j (recommandé pour performance)
      const enrichedResults = await this.enrichSearchResultsBatch(
        rawResults,
        options.projectRoot
      );
      allResults.push(...enrichedResults);
    } else {
      // Option C : Pas de locks disponibles → enrichir uniquement avec lecture de fichier (contexte large)
      for (const raw of rawResults) {
        const fileContext = await this.readFileWithContext(
          raw.file,
          raw.line,
          options.projectRoot,
          50  // Contexte large : 50 lignes avant/après
        );
        
        if (fileContext) {
          allResults.push({
            scopeId: `file-${raw.file}-${raw.line}`,
            name: `Lines ${fileContext.startLine}-${fileContext.endLine} (contexte autour, ${fileContext.endLine - fileContext.startLine + 1} lignes)`,
            file: raw.file,
            startLine: fileContext.startLine,
            endLine: fileContext.endLine,
            content: fileContext.content,
            score: raw.score * 0.9,
            charCount: fileContext.content.length,
            confidence: raw.confidence * 0.9 // Légèrement moins de confidence sans scope DB
          });
        }
      }
    }

    // 6. Dédupliquer par file:startLine (ou scopeId si scope trouvé)
    const deduplicated: typeof allResults = [];
    const seen = new Set<string>();

    for (const result of allResults) {
      // Utiliser scopeId si disponible (scope entier), sinon file:startLine
      const key = result.scopeId.startsWith('file-') 
        ? `${result.file}:${result.startLine}` 
        : result.scopeId;
      
      if (!seen.has(key)) {
        seen.add(key);
        deduplicated.push(result);
      } else {
        // Si déjà présent, garder celui avec le meilleur score/confidence
        const existing = deduplicated.find(r => {
          const existingKey = r.scopeId.startsWith('file-') 
            ? `${r.file}:${r.startLine}` 
            : r.scopeId;
          return existingKey === key;
        });
        if (existing) {
          // Préférer le scope entier (meilleur contexte) ou le meilleur score
          const preferNew = result.scopeId.startsWith('file-') === false || // Scope entier > contexte autour
                           result.score > existing.score ||
                           (result.score === existing.score && result.confidence > existing.confidence);
          if (preferNew) {
            Object.assign(existing, result);
          }
        }
      }
    }

    // 7. Trier par score/confidence et appliquer limite de caractères
    deduplicated.sort((a, b) => {
      // Trier par confidence d'abord, puis par score
      if (b.confidence !== a.confidence) {
        return b.confidence - a.confidence;
      }
      return b.score - a.score;
    });

    const limitedResults: typeof deduplicated = [];
    let cumulativeChars = 0;

    for (const result of deduplicated) {
      if (cumulativeChars + result.charCount <= options.maxChars) {
        limitedResults.push(result);
        cumulativeChars += result.charCount;
      } else {
        const remainingChars = options.maxChars - cumulativeChars;
        if (remainingChars > 200) { // Minimum 200 chars pour garder du contexte utile
          // Tronquer intelligemment : garder le début et la fin si possible
          const halfRemaining = Math.floor(remainingChars / 2);
          const truncatedContent = result.content.length > remainingChars
            ? result.content.substring(0, halfRemaining) + '\n...\n' + result.content.substring(result.content.length - halfRemaining)
            : result.content.substring(0, remainingChars) + '...';
          
          limitedResults.push({
            ...result,
            content: truncatedContent,
            charCount: remainingChars
          });
        }
        break;
      }
    }

    return limitedResults;

  } catch (error) {
    console.debug('[ConversationStorage] Error in context initial agent:', error);
    return [];
  }
}

/**
 * Helper: Parse command output (git grep, find, etc.)
 * Retourne des résultats bruts (file, line, content) pour enrichissement ultérieur
 */
private parseCommandOutput(output: string, projectRoot: string): Array<{
  file: string;
  line: number;
  content: string;
  score: number;
  confidence: number;
}> {
  const results: Array<{
    file: string;
    line: number;
    content: string;
    score: number;
    confidence: number;
  }> = [];

  // Parser git grep output: "file:line:content"
  const gitGrepRegex = /^([^:]+):(\d+):(.+)$/gm;
  let match;
  while ((match = gitGrepRegex.exec(output)) !== null) {
    const [, file, line, content] = match;
    results.push({
      file: path.relative(projectRoot, file),
      line: parseInt(line, 10),
      content: content.trim(),
      score: 0.85,
      confidence: 0.75
    });
  }

  // Parser find output: just file paths (pas de ligne spécifique, on utilisera ligne 1)
  if (results.length === 0 && output.includes('\n')) {
    const lines = output.split('\n').filter(l => l.trim());
    for (const line of lines) {
      if (line.match(/\.(ts|tsx|js|jsx|py|vue|svelte)$/)) {
        results.push({
          file: path.relative(projectRoot, line.trim()),
          line: 1,
          content: `File found: ${line.trim()}`,
          score: 0.7,
          confidence: 0.6
        });
      }
    }
  }

  return results;
}

/**
 * Enrichir plusieurs résultats de recherche en batch (optimisation)
 * 
 * Cherche tous les scopes en une seule requête Neo4j, puis enrichit les résultats manquants
 * avec lecture de fichier si nécessaire.
 * 
 * PRÉREQUIS : Les locks doivent être disponibles (vérifiés par l'appelant)
 */
private async enrichSearchResultsBatch(
  rawResults: Array<{
    file: string;
    line: number;
    content: string;
    score: number;
    confidence: number;
    tool: string;
  }>,
  projectRoot: string
): Promise<Array<{
  scopeId: string;
  name: string;
  file: string;
  startLine: number;
  endLine: number;
  content: string;
  score: number;
  charCount: number;
  confidence: number;
}>> {
  if (rawResults.length === 0) {
    return [];
  }

  // Note: Les locks doivent être vérifiés par l'appelant avant d'appeler cette méthode

  // 1. Construire une requête Neo4j pour trouver tous les scopes en une fois
  const fileLinePairs = rawResults.map(r => ({ file: r.file, line: r.line }));
  
  // Requête optimisée : trouver tous les scopes qui contiennent les lignes recherchées
  const scopeQuery = `
    UNWIND $fileLinePairs AS pair
    MATCH (s:Scope)
    WHERE s.file = pair.file
      AND s.startLine IS NOT NULL
      AND s.endLine IS NOT NULL
      AND s.startLine <= pair.line
      AND s.endLine >= pair.line
      AND NOT s:MarkdownSection
      AND NOT s:WebPage
      AND NOT s:DocumentFile
    WITH pair, s, (s.endLine - s.startLine) AS scopeSize
    ORDER BY pair.file, pair.line, scopeSize ASC
    RETURN pair.file AS file, pair.line AS line, 
           collect(s)[0] AS scope
  `;

  const scopeMap = new Map<string, {
    scopeId: string;
    name: string;
    startLine: number;
    endLine: number;
    content: string;
  }>();

  try {
    const scopeResult = await this.neo4j.run(scopeQuery, {
      fileLinePairs: fileLinePairs.map(p => ({
        file: p.file,
        line: neo4j.int(p.line)
      }))
    });

    for (const record of scopeResult.records) {
      const file = record.get('file') as string;
      const line = this.toNumber(record.get('line'));
      const scope = record.get('scope');
      
      if (scope) {
        const key = `${file}:${line}`;
        scopeMap.set(key, {
          scopeId: scope.properties.uuid,
          name: scope.properties.name,
          startLine: this.toNumber(scope.properties.startLine),
          endLine: this.toNumber(scope.properties.endLine),
          content: scope.properties.source || ''
        });
      }
    }
  } catch (error: any) {
    console.debug(`[ConversationStorage] Error in batch scope lookup: ${error.message}`);
    // Fallback to individual lookups
  }

  // 2. Enrichir chaque résultat
  const enriched: Array<{
    scopeId: string;
    name: string;
    file: string;
    startLine: number;
    endLine: number;
    content: string;
    score: number;
    charCount: number;
    confidence: number;
  }> = [];

  for (const raw of rawResults) {
    const key = `${raw.file}:${raw.line}`;
    const scope = scopeMap.get(key);

    if (scope) {
      // Scope trouvé : utiliser le scope entier
      enriched.push({
        scopeId: scope.scopeId,
        name: `${scope.name} (scope entier)`,
        file: raw.file,
        startLine: scope.startLine,
        endLine: scope.endLine,
        content: scope.content,
        score: raw.score,
        charCount: scope.content.length,
        confidence: Math.min(raw.confidence + 0.1, 1.0)
      });
    } else {
      // Pas de scope : lire le fichier avec contexte large (50 lignes)
      const fileContext = await this.readFileWithContext(
        raw.file,
        raw.line,
        projectRoot,
        50  // Contexte large : 50 lignes avant/après
      );
      
      if (fileContext) {
        enriched.push({
          scopeId: `file-${raw.file}-${raw.line}`,
          name: `Lines ${fileContext.startLine}-${fileContext.endLine} (contexte autour, ${fileContext.endLine - fileContext.startLine + 1} lignes)`,
          file: raw.file,
          startLine: fileContext.startLine,
          endLine: fileContext.endLine,
          content: fileContext.content,
          score: raw.score * 0.9,
          charCount: fileContext.content.length,
          confidence: raw.confidence
        });
      }
    }
  }

  return enriched;
}

/**
 * Lire un fichier avec contexte autour d'une ligne
 * 
 * Utilise un contexte large (50 lignes) pour enrichir les résultats quand on ne peut pas
 * utiliser les scopes depuis Neo4j (locks non disponibles ou scope non trouvé).
 */
private async readFileWithContext(
  filePath: string,
  lineNumber: number,
  projectRoot: string,
  contextLines: number = 50  // Contexte large : 50 lignes avant/après
): Promise<{
  startLine: number;
  endLine: number;
  content: string;
} | null> {
  try {
    const fs = await import('fs/promises');
    const absolutePath = path.join(projectRoot, filePath);
    const fileContent = await fs.readFile(absolutePath, 'utf-8');
    const lines = fileContent.split('\n');

    const startLine = Math.max(1, lineNumber - contextLines);
    const endLine = Math.min(lines.length, lineNumber + contextLines);
    const content = lines.slice(startLine - 1, endLine).join('\n');

    return { startLine, endLine, content };
  } catch (error: any) {
    console.debug(`[ConversationStorage] Cannot read file ${filePath}: ${error.message}`);
    return null;
  }
}

/**
 * Enrichir un résultat de recherche avec un scope depuis Neo4j ou lire le fichier avec contexte
 * 
 * Version séquentielle (utilisée en fallback si batch échoue)
 * 
 * Stratégie :
 * 1. Chercher dans Neo4j un scope qui contient cette ligne (startLine <= line <= endLine)
 * 2. Si trouvé : retourner le scope entier (meilleur contexte)
 * 3. Sinon : lire le fichier et retourner quelques lignes autour (fallback)
 */
private async enrichSearchResultWithScope(
  filePath: string,
  lineNumber: number,
  projectRoot: string,
  baseScore: number,
  baseConfidence: number
): Promise<{
  scopeId: string;
  name: string;
  file: string;
  startLine: number;
  endLine: number;
  content: string;
  score: number;
  charCount: number;
  confidence: number;
} | null> {
  try {
    // 1. Chercher un scope dans Neo4j qui contient cette ligne
    const scopeResult = await this.neo4j.run(
      `MATCH (s:Scope)
       WHERE s.file = $filePath
         AND s.startLine IS NOT NULL
         AND s.endLine IS NOT NULL
         AND s.startLine <= $lineNumber
         AND s.endLine >= $lineNumber
         AND NOT s:MarkdownSection
         AND NOT s:WebPage
         AND NOT s:DocumentFile
       RETURN s.uuid AS scopeId, s.name AS name, s.startLine AS startLine, 
              s.endLine AS endLine, s.source AS content
       ORDER BY (s.endLine - s.startLine) ASC
       LIMIT 1`,
      { filePath, lineNumber: neo4j.int(lineNumber) }
    );

    if (scopeResult.records.length > 0) {
      // Scope trouvé : retourner le scope entier
      const record = scopeResult.records[0];
      const scopeId = record.get('scopeId') as string;
      const name = record.get('name') as string;
      const startLine = this.toNumber(record.get('startLine'));
      const endLine = this.toNumber(record.get('endLine'));
      const content = record.get('content') as string || '';

      return {
        scopeId,
        name: `${name} (scope entier)`,
        file: filePath,
        startLine,
        endLine,
        content,
        score: baseScore,
        charCount: content.length,
        confidence: Math.min(baseConfidence + 0.1, 1.0) // Boost confidence si scope trouvé
      };
    }

    // 2. Pas de scope trouvé : lire le fichier avec contexte large (50 lignes avant/après)
    const absolutePath = path.join(projectRoot, filePath);
    try {
      const fs = await import('fs/promises');
      const fileContent = await fs.readFile(absolutePath, 'utf-8');
      const lines = fileContent.split('\n');

      // Contexte large : 50 lignes avant/après pour mieux comprendre le code
      const contextLines = 50;
      const startLine = Math.max(1, lineNumber - contextLines);
      const endLine = Math.min(lines.length, lineNumber + contextLines);
      const contextContent = lines.slice(startLine - 1, endLine).join('\n');

      return {
        scopeId: `file-${filePath}-${lineNumber}`,
        name: `Lines ${startLine}-${endLine} (contexte autour, ${endLine - startLine + 1} lignes)`,
        file: filePath,
        startLine,
        endLine,
        content: contextContent,
        score: baseScore * 0.9, // Légèrement moins de score si pas de scope
        charCount: contextContent.length,
        confidence: baseConfidence
      };
    } catch (fileError: any) {
      // Fichier non lisible ou inexistant
      console.debug(`[ConversationStorage] Cannot read file ${absolutePath}: ${fileError.message}`);
      return null;
    }
  } catch (error: any) {
    console.debug(`[ConversationStorage] Error enriching search result: ${error.message}`);
    return null;
  }
}
```
      llmProvider: this.llmProvider!,
      input: {
        userQuery: userMessage,
        cwd: options.cwd,
        projectRoot: options.projectRoot
      },
      inputFields: [
        { name: 'userQuery', maxLength: 1000 },
        { name: 'cwd' },
        { name: 'projectRoot' }
      ],
      outputSchema: {
        strategies: {
          type: 'array',
          description: 'Up to 3 search strategies to execute in parallel. Choose the most appropriate tools for this query.',
          required: true,
          items: {
            tool: {
              type: 'string',
              enum: ['grep_files', 'run_command', 'search_files'],
              required: true
            },
            args: {
              type: 'object',
              description: 'Arguments for the tool call',
              required: true
            },
            reason: {
              type: 'string',
              description: 'Why this search strategy is relevant',
              required: true
            },
            priority: {
              type: 'number',
              description: 'Priority 1-3 (1 = highest priority)',
              required: true
            }
          },
          maxItems: 3
        },
        explanation: {
          type: 'string',
          description: 'Brief explanation of why these strategies were chosen',
          required: false
        }
      },
      systemPrompt: `You are a code search strategist. Analyze the user query and propose up to 3 parallel search strategies using different tools.

AVAILABLE TOOLS:
1. grep_files: Regex search in files (best for exact patterns, function names, class names)
   - pattern: Glob pattern (e.g., "**/*.ts", "src/**/*.js")
   - regex: Regular expression to search for
   - Example: grep_files({ pattern: "**/*.ts", regex: "function.*authenticate" })

2. run_command: Terminal commands (best for finding files, git operations, build outputs)
   - command: Shell command to execute
   - Example: run_command({ command: "find src -name '*auth*.ts' -type f" })
   - Example: run_command({ command: "git grep -n 'authenticate' -- '*.ts'" })

3. search_files: Fuzzy search with typo tolerance (best for approximate matches, typos)
   - pattern: Glob pattern
   - query: Text to search for (fuzzy matched)
   - Example: search_files({ pattern: "**/*.ts", query: "authentification" })

STRATEGY SELECTION:
- For exact patterns → use grep_files
- For file finding → use run_command with find/git grep
- For typos/approximate → use search_files
- Combine multiple strategies for better coverage

Return up to 3 strategies, prioritized by relevance.`,
      userTask: `Analyze this query and propose search strategies: "${userMessage.substring(0, 200)}"
      
Current directory: ${options.cwd}
Project root: ${options.projectRoot}

Propose up to 3 parallel search strategies that would help find the relevant code.`
    });

    if (!searchPlan.strategies || searchPlan.strategies.length === 0) {
      return [];
    }

    // 2. Exécuter les recherches en parallèle
    const searchResults = await Promise.allSettled(
      searchPlan.strategies.map(async (strategy): Promise<ParallelSearchResult> => {
        try {
          let results: any[] = [];

          if (strategy.tool === 'grep_files') {
            // Appeler grep_files handler
            const grepHandler = await this.getGrepFilesHandler(options.projectRoot);
            const grepResult = await grepHandler(strategy.args);
            
            if (grepResult.error) {
              return { strategy, results: [], success: false, error: grepResult.error };
            }

            // Convertir les résultats au format attendu
            results = (grepResult.matches || []).map((match: any) => ({
              file: match.file,
              line: match.line,
              content: match.content,
              score: 0.9, // High confidence for exact regex matches
              charCount: match.content.length,
              confidence: 0.8
            }));

          } else if (strategy.tool === 'run_command') {
            // Appeler run_command handler
            const commandHandler = await this.getRunCommandHandler(options.cwd);
            const commandResult = await commandHandler(strategy.args);
            
            if (commandResult.error) {
              return { strategy, results: [], success: false, error: commandResult.error };
            }

            // Parser la sortie du terminal (ex: git grep, find)
            results = this.parseCommandOutput(commandResult.stdout || '', options.projectRoot);

          } else if (strategy.tool === 'search_files') {
            // Appeler search_files handler
            const searchHandler = await this.getSearchFilesHandler(options.projectRoot);
            const searchResult = await searchHandler(strategy.args);
            
            if (searchResult.error) {
              return { strategy, results: [], success: false, error: searchResult.error };
            }

            // Convertir les résultats au format attendu
            results = (searchResult.matches || []).map((match: any) => ({
              file: match.file,
              line: match.line,
              content: match.content,
              score: match.score || 0.7,
              charCount: match.content.length,
              confidence: 0.6 // Lower confidence for fuzzy matches
            }));
          }

          return {
            strategy,
            results,
            success: true
          };

        } catch (error: any) {
          return {
            strategy,
            results: [],
            success: false,
            error: error.message
          };
        }
      })
    );

    // 3. Fusionner et dédupliquer les résultats
    const allResults: Array<{
      scopeId: string;
      name: string;
      file: string;
      startLine: number;
      endLine: number;
      content: string;
      score: number;
      charCount: number;
      confidence: number;
    }> = [];

    for (const result of searchResults) {
      if (result.status === 'fulfilled' && result.value.success) {
        for (const item of result.value.results) {
          // Dédupliquer par file:line
          const key = `${item.file}:${item.line || 0}`;
          const existing = allResults.find(r => `${r.file}:${r.startLine}` === key);
          
          if (!existing) {
            allResults.push({
              scopeId: `parallel-${item.file}-${item.line || 0}`,
              name: `Line ${item.line || '?'} (${result.value.strategy.tool})`,
              file: item.file,
              startLine: item.line || 1,
              endLine: item.line || 1,
              content: item.content.substring(0, 500),
              score: item.score,
              charCount: item.charCount,
              confidence: item.confidence
            });
          } else {
            // Si déjà présent, garder celui avec le meilleur score
            if (item.score > existing.score) {
              Object.assign(existing, {
                score: item.score,
                confidence: Math.max(existing.confidence, item.confidence),
                name: `${existing.name} + ${result.value.strategy.tool}`
              });
            }
          }
        }
      }
    }

    // 4. Trier par score et appliquer limite de caractères
    allResults.sort((a, b) => b.score - a.score);

    const limitedResults: typeof allResults = [];
    let cumulativeChars = 0;

    for (const result of allResults) {
      if (cumulativeChars + result.charCount <= options.maxChars) {
        limitedResults.push(result);
        cumulativeChars += result.charCount;
      } else {
        const remainingChars = options.maxChars - cumulativeChars;
        if (remainingChars > 100) {
          limitedResults.push({
            ...result,
            content: result.content.substring(0, remainingChars) + '...',
            charCount: remainingChars
          });
        }
        break;
      }
    }

    return limitedResults;

  } catch (error) {
    console.debug('[ConversationStorage] Error in parallel search agent:', error);
    return [];
  }
}

/**
 * Helper: Get grep_files handler
 */
private async getGrepFilesHandler(projectRoot: string): Promise<(args: any) => Promise<any>> {
  // Créer un handler temporaire avec le projectRoot
  // Note: Nécessite d'importer generateGrepFilesHandler depuis fs-tools
  const { generateGrepFilesHandler } = await import('../../tools/fs-tools.js');
  const fsCtx: FsToolsContext = {
    projectRoot: projectRoot
  };
  return generateGrepFilesHandler(fsCtx);
}

/**
 * Helper: Get run_command handler
 */
private async getRunCommandHandler(cwd: string): Promise<(args: any) => Promise<any>> {
  // Note: Nécessite d'importer generateRunCommandHandler depuis shell-tools
  const { generateRunCommandHandler } = await import('../../tools/shell-tools.js');
  const shellCtx: ShellToolsContext = {
    projectRoot: cwd,
    onConfirmationRequired: undefined
  };
  return generateRunCommandHandler(shellCtx);
}

/**
 * Helper: Get search_files handler
 */
private async getSearchFilesHandler(projectRoot: string): Promise<(args: any) => Promise<any>> {
  // Note: Nécessite d'importer generateSearchFilesHandler depuis fs-tools
  const { generateSearchFilesHandler } = await import('../../tools/fs-tools.js');
  const fsCtx: FsToolsContext = {
    projectRoot: projectRoot
  };
  return generateSearchFilesHandler(fsCtx);
}

/**
 * Helper: Parse command output (git grep, find, etc.)
 */
private parseCommandOutput(output: string, projectRoot: string): Array<{
  file: string;
  line?: number;
  content: string;
  score: number;
  charCount: number;
  confidence: number;
}> {
  const results: Array<{
    file: string;
    line?: number;
    content: string;
    score: number;
    charCount: number;
    confidence: number;
  }> = [];

  // Parser git grep output: "file:line:content"
  const gitGrepRegex = /^([^:]+):(\d+):(.+)$/gm;
  let match;
  while ((match = gitGrepRegex.exec(output)) !== null) {
    const [, file, line, content] = match;
    results.push({
      file: path.relative(projectRoot, file),
      line: parseInt(line, 10),
      content: content.trim().substring(0, 500),
      score: 0.85,
      charCount: content.length,
      confidence: 0.75
    });
  }

  // Parser find output: just file paths
  if (results.length === 0 && output.includes('\n')) {
    const lines = output.split('\n').filter(l => l.trim());
    for (const line of lines) {
      if (line.includes('.ts') || line.includes('.js') || line.includes('.tsx') || line.includes('.jsx')) {
        results.push({
          file: path.relative(projectRoot, line.trim()),
          content: `File found: ${line.trim()}`,
          score: 0.7,
          charCount: line.length,
          confidence: 0.6
        });
      }
    }
  }

  return results;
}
```

#### Étape 4 : Intégrer dans buildEnrichedContext (Option B uniquement)

```typescript
// Dans buildEnrichedContext() (ligne 2204)
// Remplacer :
if (!isProjectKnown || !locksAvailable) {
  return await this.searchCodeFuzzyWithLLM(userMessage, {
    cwd: options.cwd,
    projectRoot: options.projectRoot,
    maxChars: options?.codeSearchMaxChars ?? this.getCodeSearchMaxChars()
  });
}

// Par :
if (!isProjectKnown || !locksAvailable) {
  return await this.searchCodeWithParallelAgent(userMessage, {
    cwd: options.cwd,
    projectRoot: options.projectRoot,
    maxChars: options?.codeSearchMaxChars ?? this.getCodeSearchMaxChars()
  });
}
```

#### Étape 4 : Lancer en parallèle avec semantic search (Option B uniquement)

```typescript
// Dans buildEnrichedContext() (ligne 2160)
// Modifier pour lancer l'agent de contexte initial en parallèle avec semantic search (toujours)

// Vérifier les locks une seule fois (réutilisé pour semantic search et context initial agent)
const embeddingLockAvailable = options.embeddingLock && !options.embeddingLock.isLocked();
const ingestionLockAvailable = options.ingestionLock && !options.ingestionLock.isLocked();
const locksAvailable = embeddingLockAvailable && ingestionLockAvailable;

const [semanticResults, codeSemanticResults, contextInitialResults] = await Promise.all([
  this.searchConversationHistory(...),
  (async () => {
    if (isProjectKnown && locksAvailable) {
      return await this.searchCodeSemantic(...);
    }
    return [];
  })(),
  // Lancer l'agent de contexte initial en parallèle (toujours, pas seulement en fallback)
  (async () => {
    if (!options?.cwd || !options?.projectRoot) {
      return [];
    }
    // Toujours lancer l'agent de contexte initial pour compléter les résultats
    // Utilise 50% du budget de caractères pour ne pas dépasser la limite
    // Passe les locks pour permettre l'enrichissement depuis Neo4j si disponibles
    return await this.searchCodeWithContextInitialAgent(userMessage, {
      cwd: options.cwd,
      projectRoot: options.projectRoot,
      maxChars: Math.floor((options?.codeSearchMaxChars ?? this.getCodeSearchMaxChars()) * 0.5),
      embeddingLockAvailable,
      ingestionLockAvailable
    });
  })()
]);

// Fusionner codeSemanticResults et contextInitialResults
// Semantic search a priorité (confidence 0.5), context initial complète (confidence 0.6-0.8 selon tool)
const allCodeResults = [
  ...(codeSemanticResults || []),
  ...(contextInitialResults || [])
].sort((a, b) => {
  // Trier par confidence d'abord, puis par score
  if (b.confidence !== a.confidence) {
    return b.confidence - a.confidence;
  }
  return b.score - a.score;
});

// Appliquer limite de caractères globale
let cumulativeChars = 0;
const limitedCodeResults: typeof allCodeResults = [];
for (const result of allCodeResults) {
  if (cumulativeChars + result.charCount <= (options?.codeSearchMaxChars ?? this.getCodeSearchMaxChars())) {
    limitedCodeResults.push(result);
    cumulativeChars += result.charCount;
  } else {
    break;
  }
}

return limitedCodeResults;
```

**Note** : L'agent de contexte initial est **toujours** lancé en parallèle avec semantic search, même si semantic search est disponible. Cela permet de compléter les résultats avec des recherches complémentaires (grep pour exact matches, terminal pour file finding, etc.).

### Impact

L'agent peut maintenant utiliser plusieurs stratégies de recherche en parallèle (grep, terminal, fuzzy), améliorant significativement la couverture et les chances de trouver le code recherché.

### Fichiers à modifier

- `packages/core/src/runtime/conversation/storage.ts` :
  - Ajouter imports : `StructuredLLMExecutor`, `BaseToolExecutor`, `ToolCallRequest`, `ToolExecutionResult` depuis `structured-llm-executor`
  - Ajouter imports : `generateGrepFilesHandler`, `generateSearchFilesHandler` depuis `fs-tools`
  - Ajouter import : `generateRunCommandHandler` depuis `shell-tools`
  - Ajouter types : `FsToolsContext`, `ShellToolsContext` depuis les types appropriés
  - Ajouter classe `ContextSearchToolExecutor extends BaseToolExecutor` (gère les 3 tools)
  - Ajouter `searchCodeWithContextInitialAgent()` (remplace `searchCodeFuzzyWithLLM`)
    - Ajouter paramètres `embeddingLockAvailable` et `ingestionLockAvailable`
    - Vérifier les locks avant d'enrichir depuis Neo4j
  - Ajouter `parseCommandOutput()` pour parser git grep / find output (retourne résultats bruts)
  - **Ajouter `enrichSearchResultsBatch()`** : Enrichit plusieurs résultats en batch (cherche scopes Neo4j en une requête)
    - **IMPORTANT** : Ne s'exécute que si locks disponibles (vérifiés par l'appelant)
  - **Ajouter `readFileWithContext()`** : Lit un fichier avec contexte autour d'une ligne (fallback si pas de scope ou locks non disponibles)
  - **Ajouter `enrichSearchResultWithScope()`** : Version séquentielle (fallback si batch échoue)
  - Modifier `buildEnrichedContext()` ligne 2160 pour lancer l'agent en parallèle avec semantic search (toujours)
    - Passer les locks disponibles à `searchCodeWithContextInitialAgent()`
  - Supprimer `searchCodeFuzzyWithLLM()` (remplacé par le nouvel agent)

### Dépendances

- `StructuredLLMExecutor` (déjà disponible via `this.llmExecutor`)
- `llmProvider` (déjà disponible via `this.llmProvider`)
- `BaseToolExecutor` (déjà disponible dans `structured-llm-executor`)
- Handlers `grep_files`, `run_command`, `search_files` (à importer depuis `fs-tools` et `shell-tools`)
- Types `FsToolsContext`, `ShellToolsContext` (à importer)
- Système de fusion et déduplication des résultats
- **Locks embedding et ingestion** : Doivent être vérifiés avant d'enrichir depuis Neo4j (pour éviter données incohérentes)

### Abstractions possibles avec rag-agent

**Pattern commun** : Les deux utilisent `StructuredLLMExecutor` avec tool calling.

**Différences** :
- `rag-agent` : Agent complet avec planning, sous-agents, itérations multiples, nombreux tools
- `ContextInitialAgent` : Agent simple avec 3 tools seulement, 1 itération, pas de planning

**Abstraction possible** : Créer une classe de base `BaseAgent` qui encapsule :
- `StructuredLLMExecutor`
- `ToolExecutor` setup
- Tool calling logic

Mais pour l'instant, l'implémentation simplifiée dans `storage.ts` est suffisante. On peut abstraire plus tard si besoin.

### Tests

- Test avec requête nécessitant grep → agent propose grep_files
- Test avec requête nécessitant terminal → agent propose run_command
- Test avec requête avec typo → agent propose search_files
- Test avec requête complexe → agent propose 2-3 stratégies
- Test avec exécution parallèle → toutes les recherches s'exécutent en parallèle
- Test avec fusion de résultats → déduplication correcte
- Test avec limite de caractères → respect de la limite
- **Test avec enrichissement scope** :
  - **Locks disponibles** :
    - Ligne trouvée correspond à un scope dans Neo4j → retourne le scope entier
    - Ligne trouvée ne correspond à aucun scope → retourne contexte large (50 lignes avant/après)
    - Plusieurs scopes contiennent la ligne → choisit le plus petit (plus précis)
  - **Locks non disponibles** :
    - Pas de recherche dans Neo4j → enrichit uniquement avec lecture de fichier
    - Ligne trouvée → retourne contexte large (50 lignes avant/après)
  - Fichier non lisible → skip le résultat
  - Test avec ligne proche du début/fin du fichier → ajuste correctement les limites (max 1, min lines.length)

### Optimisations

1. **Cache des stratégies** : Mettre en cache les stratégies pour requêtes similaires
2. **Priorisation intelligente** : Donner plus de poids aux résultats de grep (exact) vs fuzzy
3. **Limite dynamique** : Ajuster le nombre de stratégies selon la complexité de la requête
4. **Early termination** : Arrêter les recherches si on trouve déjà assez de résultats
5. **Cache des scopes** : Mettre en cache les résultats de recherche de scope (file + line → scope)
6. **Batch enrichment** : ✅ Implémenté dans `enrichSearchResultsBatch()` - Enrichit plusieurs résultats en une seule requête Neo4j (au lieu d'une par résultat)
7. **Contexte large par défaut** : ✅ 50 lignes avant/après pour enrichissement fichier seul (compense l'absence de scope structuré)
8. **Contexte ajustable** : Possibilité d'ajuster selon le type de résultat (grep = moins de contexte, fuzzy = plus de contexte) - TODO
9. **Lecture de fichier en batch** : Grouper les lectures de fichiers pour réduire les appels fs - TODO
10. **Limite de caractères** : Le contexte large (50 lignes) peut dépasser maxChars, à gérer avec troncature intelligente

### Exemple d'Utilisation

**Requête utilisateur** : "Où est la fonction authenticate dans le code ?"

**Stratégies proposées par l'agent** :
1. `grep_files({ pattern: "**/*.ts", regex: "function.*authenticate|const.*authenticate" })` - Priority 1
2. `run_command({ command: "git grep -n 'authenticate' -- '*.ts'" })` - Priority 2
3. `search_files({ pattern: "**/*.ts", query: "authenticate" })` - Priority 3

**Exécution** : Les 3 recherches s'exécutent en parallèle, résultats fusionnés et triés.

---

## Métriques de Succès

- **Couverture améliorée** : Plus de résultats trouvés grâce aux recherches multiples
- **Performance** : Recherches parallèles plus rapides que séquentielles
- **Précision** : Meilleure précision grâce au choix intelligent des outils
- **Flexibilité** : L'agent adapte les stratégies selon la requête

---

## Notes

Cette feature remplace le fallback fuzzy search simple par un **agent de contexte initial** qui :
- Utilise `StructuredLLMExecutor` pour analyser la requête et choisir jusqu'à 3 recherches
- Exécute les recherches en parallèle (via `toolMode: 'global'`)
- **Enrichit les résultats** : Cherche les scopes dans Neo4j ou lit le fichier avec contexte autour
- Combine les résultats de manière intelligente

**Enrichissement du contexte** :
- **Agent de contexte initial** :
  - **Contexte extrait par les outils** : `grep_files` et `search_files` appliquent systématiquement `context_lines: 50`
  - Le contexte est déjà dans les résultats → pas besoin d'enrichissement supplémentaire
  - **Si contexte déjà extrait** : Utilise directement les résultats avec leur contexte
  - **Si contexte pas extrait** (run_command) :
    - **Si locks disponibles** : Cherche scopes dans Neo4j ou lit fichier avec contexte
    - **Si locks non disponibles** : Lit fichier avec contexte (50 lignes)
- **rag-agent normal** :
  - Le paramètre `context_lines` est exposé dans les tool definitions
  - L'agent peut choisir d'utiliser `context_lines` ou non selon ses besoins
  - Si utilisé, le contexte est extrait directement par les outils
- **Priorité** : Contexte extrait par outils > Scope entier Neo4j > Contexte fichier (meilleur score/confidence si contexte déjà extrait)
- **Avantage** : Le contexte extrait par les outils évite les requêtes Neo4j supplémentaires et les lectures de fichier redondantes

**Avantages par rapport au fallback actuel** :
1. **Choix intelligent** : L'agent compose librement les 3 outils (grep pour exact, terminal pour files, fuzzy pour typos)
2. **Parallélisme** : Jusqu'à 3 recherches simultanées au lieu d'une seule
3. **Meilleure couverture** : Combine plusieurs approches pour trouver plus de résultats
4. **Flexibilité** : Peut utiliser le même tool 3 fois ou combiner différemment
5. **Toujours actif** : Lancé en parallèle avec semantic search, quoi qu'il arrive

**Comparaison avec le système actuel** :

| Aspect | Actuel (searchCodeFuzzyWithLLM) | Nouveau (searchCodeWithContextInitialAgent) |
|--------|----------------------------------|---------------------------------------------|
| Nombre de recherches | 1 (fuzzy seulement) | Jusqu'à 3 (grep + terminal + fuzzy) |
| Parallélisme | Non | Oui (toutes en parallèle) |
| Choix des outils | Fixe (fuzzy) | Intelligent (selon requête, composition libre) |
| Couverture | Limitée | Améliorée (multi-outils) |
| Performance | Séquentiel | Parallèle (plus rapide) |
| Architecture | Fonction simple | Utilise StructuredLLMExecutor (réutilisable) |
| Lancement | Seulement en fallback | Toujours en parallèle avec semantic search |

**Abstraction avec rag-agent** :
- Les deux utilisent `StructuredLLMExecutor` avec tool calling
- `rag-agent` est un agent complet avec planning, sous-agents, nombreux tools
- `ContextInitialAgent` est un agent simple avec 3 tools seulement, 1 itération
- Pattern commun : Tool executor + StructuredLLMExecutor + tool calling
- Abstraction possible plus tard si besoin (classe de base `BaseAgent`)

L'agent de contexte initial est **toujours** lancé en parallèle avec semantic search, même si semantic search est disponible. Cela permet de compléter les résultats avec des recherches complémentaires (grep pour exact matches, terminal pour file finding, etc.).
