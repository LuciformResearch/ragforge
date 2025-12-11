# Roadmap : Auto-Vérification et Auto-Correction

## Vue d'ensemble

Cette roadmap couvre les fonctionnalités permettant à l'agent de vérifier et corriger automatiquement ses propres actions, réduisant les erreurs et améliorant la qualité du code généré.

## Objectifs

- **Auto-vérification** : L'agent vérifie automatiquement ses modifications
- **Auto-correction** : L'agent corrige ses erreurs sans intervention utilisateur
- **Qualité** : Amélioration continue de la qualité du code généré

---

## Feature 1 : Self-Healing - Double-Check Automatique

### ✅ État Actuel : Non Implémenté (mais infrastructure existe)

**Dans `rag-agent.ts` (lignes 573, 666-720)** :
Le système gère déjà l'exécution des outils de modification de fichiers :
```typescript
const FILE_MODIFICATION_TOOLS = new Set(['write_file', 'edit_file']);

// Dans executeBatch(), les file modification tools sont exécutés séquentiellement
// Mais il n'y a pas de validation post-exécution
```

**Infrastructure disponible** :
- ✅ `GeneratedToolExecutor` avec `execute()` et `executeBatch()`
- ✅ Callbacks `onToolCall` et `onToolResult` disponibles
- ✅ Système de résultats avec `success` et `error`
- ❌ Pas de validation automatique après modification

### Description

Ajouter une logique de "Post-Hook" dans le `GeneratedToolExecutor` pour valider automatiquement les modifications de fichiers.

### Implémentation

Ajouter une logique de validation dans `GeneratedToolExecutor.execute()` pour les outils de modification de fichiers :

```typescript
// Dans rag-agent.ts, classe GeneratedToolExecutor, méthode execute()
async execute(toolCall: ToolCallRequest): Promise<any> {
  // ... code existant pour exécuter le handler ...
  
  const result = await handler(toolCall.arguments);
  
  // --- AJOUT DE LA PROACTIVITÉ : Validation automatique ---
  const FILE_MODIFICATION_TOOLS = new Set(['write_file', 'edit_file', 'create_file']);
  
  if (FILE_MODIFICATION_TOOLS.has(toolCall.tool_name)) {
    // Validation automatique pour les fichiers de code
    if (toolCall.arguments.path && toolCall.arguments.path.match(/\.(ts|js|tsx|jsx)$/)) {
      try {
        // Validation syntaxique (ex: via TypeScript compiler API)
        const syntaxErrors = await validateSyntax(toolCall.arguments.path);
        if (syntaxErrors.length > 0) {
          return {
            ...result,
            warning: `ATTENTION : Le fichier a été écrit mais contient des erreurs de syntaxe : ${syntaxErrors.join(', ')}. CORRIGE IMMÉDIATEMENT.`
          };
        }
      } catch (error) {
        // Si la validation échoue, on continue mais on log
        if (this.verbose) {
          console.debug(`Syntax validation failed: ${error.message}`);
        }
      }
    }
  }
  // -------------------------------
  
  return result;
}
```

### Impact

L'agent voit le warning dans le résultat de l'outil et se corrige automatiquement sans que l'utilisateur ait à intervenir.

### Fichiers à modifier

- `packages/core/src/tools/tool-generator.ts` (ou équivalent)
- `packages/core/src/runtime/agents/rag-agent.ts` (pour intégrer la validation)

### Dépendances

- TypeScript Compiler API pour la validation syntaxique
- Système de validation extensible pour d'autres types de fichiers

### Tests

- Test avec fichier TypeScript valide → pas de warning
- Test avec fichier TypeScript invalide → warning retourné
- Test avec fichier non-code → pas de validation

---

## Feature 2 : Critic Mode - Auto-Critique dans le System Prompt

### ✅ État Actuel : Non Implémenté

**Dans `rag-agent.ts` (lignes 1337-1404)** :
Le `buildSystemPrompt()` existe mais ne contient pas de protocole de qualité explicite.

### Description

Ajouter un protocole de qualité obligatoire dans le system prompt qui force l'agent à s'auto-évaluer avant de conclure.

### Implémentation

Modifier `buildSystemPrompt()` dans `rag-agent.ts` pour ajouter le Critic Mode après les instructions existantes :

```typescript
const PROACTIVE_CRITIC_PROMPT = `
**PROTOCOL DE QUALITÉ (CRITIC MODE)**:
Avant de donner une réponse finale ou de marquer une tâche comme terminée :

1. **Auto-Critique** : Relis ton propre code généré.
   - Y a-t-il des imports inutilisés ?
   - Des types 'any' paresseux ?
   - Des variables non utilisées ?

2. **Gestion d'Erreur** : As-tu englobé les appels risqués dans des try/catch ?
   - Les appels réseau sont-ils protégés ?
   - Les opérations fichiers ont-elles une gestion d'erreur ?

3. **Dépendances** : Si tu modifies un fichier de config, as-tu vérifié les fichiers qui en dépendent ?
   - Les imports sont-ils à jour ?
   - Les exports sont-ils corrects ?

SI TU TROUVES UNE FAILLE DANS TON PROPRE PLAN : 
Ne demande pas pardon. Corrige-la et mentionne "J'ai auto-corrigé X pour éviter Y".
`;

// Concaténer à basePrompt
basePrompt += PROACTIVE_CRITIC_PROMPT;
```

### Impact

L'agent s'auto-évalue systématiquement avant de conclure, améliorant la qualité du code généré.

### Fichiers à modifier

- `packages/core/src/runtime/agents/rag-agent.ts` (méthode `buildSystemPrompt`)

### Dépendances

- Aucune (modification de prompt uniquement)

### Tests

- Vérifier que le prompt contient bien le Critic Mode
- Tester que l'agent mentionne les auto-corrections dans ses réponses

---

## Feature 3 : Response Quality Analyzer - Auto-Retry avec Query Améliorée

### Description

Quand l'agent retourne une réponse sans tool calls alors qu'il aurait dû utiliser des outils pour répondre efficacement, un système externe analyse la réponse et décide automatiquement s'il faut relancer l'agent avec une query améliorée qui force l'utilisation des outils appropriés.

### Problème Actuel

L'agent peut parfois répondre directement sans utiliser les outils disponibles, même quand une recherche ou une lecture de fichier serait nécessaire pour donner une réponse complète et précise.

### Solution

Créer un "Response Quality Analyzer" qui utilise `StructuredLLMExecutor` pour analyser la réponse de l'agent et décider s'il faut relancer avec une query améliorée.

### Implémentation

#### Étape 1 : Créer le schéma d'analyse structurée

```typescript
// Dans rag-agent.ts ou un nouveau fichier response-analyzer.ts
interface ResponseQualityAnalysis {
  /** La réponse était-elle complète et efficace ? */
  is_effective: boolean;
  
  /** Score d'efficacité (0-1) */
  effectiveness_score: number;
  
  /** L'agent aurait-il dû utiliser des outils ? */
  should_have_used_tools: boolean;
  
  /** Quels outils auraient été pertinents ? */
  suggested_tools: Array<{
    tool_name: string;
    reason: string;
    suggested_query: string;
  }>;
  
  /** Termes/clés qui auraient dû être recherchés */
  missing_searches: string[];
  
  /** Fichiers qui auraient dû être lus */
  missing_file_reads: string[];
  
  /** Query améliorée pour relancer l'agent */
  improved_query?: string;
  
  /** Raison du retry recommandé */
  retry_reason?: string;
}
```

#### Étape 2 : Créer l'analyzer avec StructuredLLMExecutor

```typescript
import { StructuredLLMExecutor } from '../llm/structured-llm-executor.js';

class ResponseQualityAnalyzer {
  private executor: StructuredLLMExecutor;
  
  constructor(llmProvider: LLMProvider) {
    this.executor = new StructuredLLMExecutor(llmProvider);
  }
  
  async analyzeResponse(
    userQuery: string,
    agentResponse: string,
    toolsUsed: string[],
    availableTools: string[]
  ): Promise<ResponseQualityAnalysis> {
    const outputSchema: OutputSchema<ResponseQualityAnalysis> = {
      is_effective: {
        type: 'boolean',
        description: 'Was the response complete and effective?',
        required: true,
      },
      effectiveness_score: {
        type: 'number',
        description: 'Effectiveness score from 0 to 1',
        required: true,
      },
      should_have_used_tools: {
        type: 'boolean',
        description: 'Should the agent have used tools to answer better?',
        required: true,
      },
      suggested_tools: {
        type: 'array',
        description: 'Tools that should have been used',
        required: false,
        items: {
          tool_name: { type: 'string', required: true },
          reason: { type: 'string', required: true },
          suggested_query: { type: 'string', required: true },
        },
      },
      missing_searches: {
        type: 'array',
        description: 'Search terms that should have been searched',
        required: false,
        items: { type: 'string' },
      },
      missing_file_reads: {
        type: 'array',
        description: 'Files that should have been read',
        required: false,
        items: { type: 'string' },
      },
      improved_query: {
        type: 'string',
        description: 'Improved query to retry with if retry is recommended',
        required: false,
      },
      retry_reason: {
        type: 'string',
        description: 'Reason why a retry is recommended',
        required: false,
      },
    };
    
    const systemPrompt = `You are a quality analyzer for AI agent responses.
Your job is to evaluate if the agent's response was effective and if it should have used tools.

AVAILABLE TOOLS: ${availableTools.join(', ')}

TOOLS USED: ${toolsUsed.length > 0 ? toolsUsed.join(', ') : 'None'}

Analyze the response and determine:
1. Was the response complete and accurate?
2. Should the agent have used tools (search, read files, etc.)?
3. What specific tools/queries would have improved the response?
4. Should we retry with an improved query that forces tool usage?`;

    const userTask = `USER QUERY: "${userQuery}"

AGENT RESPONSE: "${agentResponse}"

Analyze this response and provide your structured analysis.`;

    const result = await this.executor.executeSingle<ResponseQualityAnalysis>({
      systemPrompt,
      userTask,
      outputSchema,
      outputFormat: 'xml',
      llmProvider: this.executor.llmProvider,
    });
    
    return result;
  }
}
```

#### Étape 3 : Intégrer dans le workflow de l'agent

```typescript
// Dans rag-agent.ts, méthode ask() ou équivalent
async ask(query: string): Promise<AgentResponse> {
  // 1. Exécuter la requête normale
  const response = await this.executeQuery(query);
  
  // 2. Si aucun tool call n'a été utilisé, analyser la réponse
  if (response.toolsUsed.length === 0) {
    const analyzer = new ResponseQualityAnalyzer(this.llmProvider);
    const analysis = await analyzer.analyzeResponse(
      query,
      response.answer,
      response.toolsUsed,
      this.getAvailableToolNames()
    );
    
    // 3. Si l'analyse recommande un retry, relancer avec query améliorée
    if (!analysis.is_effective && analysis.should_have_used_tools && analysis.improved_query) {
      console.log(`⚠️  Response quality low (score: ${analysis.effectiveness_score}). Retrying with improved query...`);
      
      // Construire la query améliorée qui force l'utilisation des outils
      const forcedQuery = `${analysis.improved_query}

IMPORTANT: You MUST use tools to answer this question. Specifically:
${analysis.suggested_tools.map(t => `- Use ${t.tool_name} to ${t.reason}. Query: "${t.suggested_query}"`).join('\n')}

Do not answer without using these tools first.`;
      
      // Relancer avec la query améliorée
      return await this.executeQuery(forcedQuery);
    }
    
    // 4. Si pas de retry mais des suggestions, ajouter un warning
    if (analysis.suggested_tools.length > 0) {
      response.warnings = response.warnings || [];
      response.warnings.push(
        `Consider using: ${analysis.suggested_tools.map(t => t.tool_name).join(', ')}`
      );
    }
  }
  
  return response;
}
```

### Impact

L'agent est automatiquement relancé avec une query améliorée quand sa réponse initiale n'utilise pas les outils appropriés, améliorant significativement la qualité et la précision des réponses.

### Fichiers à créer/modifier

- `packages/core/src/runtime/agents/response-analyzer.ts` (nouveau fichier)
- `packages/core/src/runtime/agents/rag-agent.ts` (intégrer l'analyzer dans `ask()`)

### Dépendances

- `StructuredLLMExecutor` (déjà disponible)
- Schéma d'analyse structurée pour évaluer l'efficacité
- Système de retry avec query améliorée

### Tests

- Test avec réponse efficace sans tools → pas de retry
- Test avec réponse incomplète sans tools → retry avec query améliorée
- Test avec réponse qui aurait dû utiliser `brain_search` → retry avec query forcée
- Test avec réponse qui aurait dû lire des fichiers → retry avec `read_file` forcé
- Vérifier que le retry utilise bien les outils suggérés

### Optimisations

1. **Cache des analyses** : Ne pas analyser si la réponse est similaire à une précédente analyse
2. **Seuil configurable** : Permettre de configurer le seuil d'efficacité minimum avant retry
3. **Limite de retries** : Éviter les boucles infinies (max 1-2 retries par query)
4. **Mode verbose** : Logger les analyses pour debug et amélioration continue

---

## Ordre d'Implémentation

1. **Critic Mode** (facile, impact immédiat)
2. **Response Quality Analyzer** (utilise StructuredLLMExecutor, impact élevé)
3. **Self-Healing** (nécessite infrastructure de validation)

---

## Métriques de Succès

- Réduction des erreurs de syntaxe dans le code généré
- Augmentation des mentions d'auto-correction dans les réponses
- Réduction des interventions utilisateur pour corriger les erreurs
- **Augmentation du taux d'utilisation des outils appropriés**
- **Amélioration de la qualité des réponses (moins de réponses "lazy")**
- **Réduction des cas où l'agent répond sans vérifier les faits**

---

## Notes

Ces trois features travaillent ensemble pour améliorer la qualité :
- Le **Critic Mode** force l'auto-évaluation au niveau du prompt
- Le **Response Quality Analyzer** vérifie l'efficacité après la réponse et relance si nécessaire
- Le **Self-Healing** ajoute une vérification technique automatique

L'implémentation du Critic Mode est la plus rapide et peut être déployée immédiatement. Le Response Quality Analyzer utilise `StructuredLLMExecutor` (déjà disponible) et peut être implémenté rapidement avec un impact élevé. Le Self-Healing nécessite une infrastructure de validation plus robuste.
