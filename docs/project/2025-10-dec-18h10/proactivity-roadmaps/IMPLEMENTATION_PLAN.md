# Plan d'Implémentation Global - Features de Proactivité

## Vue d'ensemble

Ce document établit un plan d'implémentation étape par étape pour toutes les features des roadmaps de proactivité, organisé par phases logiques avec dépendances, estimations de temps, et risques identifiés.

**Durée totale estimée** : ~37.5h (4.5 jours de travail à temps plein)

---

## Phase 0 : Préparation et Architecture de Base (Optionnel mais Recommandé)

### Objectif
Mettre en place l'architecture unifiée pour faciliter l'implémentation des features suivantes.

### Décision Stratégique
**Option A** : Implémenter l'architecture unifiée d'abord (ROADMAP_UNIFIED_ARCHITECTURE.md)
- ✅ Avantage : Regroupe plusieurs features en moins d'opérations (-50% de code)
- ✅ Avantage : Facilite la maintenance et l'extension
- ⚠️ Inconvénient : Plus de temps initial (8h)
- ⚠️ Risque : Refactoring plus important

**Option B** : Implémenter les features individuellement
- ✅ Avantage : Plus rapide à démarrer
- ✅ Avantage : Moins de risque de refactoring
- ⚠️ Inconvénient : Plus de duplication de code
- ⚠️ Inconvénient : Plus difficile à maintenir

**Recommandation** : **Option B** pour commencer (quick wins), puis Option A si plusieurs features sont implémentées.

---

## Phase 1 : Quick Wins - Impact Immédiat (~23.5h)

### Objectif
Implémenter les features à impact immédiat avec le moins de dépendances.

### Étape 1.1 : Agent de Contexte Initial - Recherche Parallèle (5h)

**Priorité** : 🔥 **HAUTE** (remplace le fallback actuel)

**Fichiers à modifier** :
- `packages/core/src/tools/fs-tools.ts`
- `packages/core/src/runtime/conversation/storage.ts`

**Tâches** :
1. ✅ Modifier `grep_files` et `search_files` pour ajouter `context_lines` (1h)
   - Ajouter paramètre dans tool definitions
   - Modifier handlers pour extraire contexte si `context_lines > 0`
   - Retourner `startLine` et `endLine` dans résultats

2. ✅ Créer `ContextSearchToolExecutor` dans `storage.ts` (1h)
   - Étendre `BaseToolExecutor`
   - Appliquer systématiquement `context_lines: 50` pour grep/search
   - Gérer les 3 tools (grep, terminal, fuzzy)

3. ✅ Créer `searchCodeWithContextInitialAgent()` (2h)
   - Utiliser `StructuredLLMExecutor.executeSingle` avec tool_calls
   - Parser résultats des tools
   - Vérifier si contexte déjà extrait par outils

4. ✅ Créer `enrichSearchResultsBatch()` et helpers (1h)
   - Recherche batch de scopes dans Neo4j
   - `readFileWithContext()` pour fallback
   - Intégration dans `buildEnrichedContext()`

**Tests** :
- Test avec locks disponibles → enrichissement Neo4j
- Test sans locks → enrichissement fichier uniquement
- Test avec contexte déjà extrait → pas d'enrichissement supplémentaire
- Test avec 3 recherches parallèles

**Risques** :
- ⚠️ Performance : Batch enrichment peut être lent avec beaucoup de résultats
- ⚠️ Complexité : Gestion des différents cas (contexte extrait vs enrichissement)

**Dépendances** : Aucune

---

### Étape 1.2 : Critic Mode (30 min)

**Priorité** : 🔥 **HAUTE** (améliore immédiatement la qualité)

**Fichiers à modifier** :
- `packages/core/src/runtime/agents/rag-agent.ts`

**Tâches** :
1. ✅ Ajouter protocole de qualité dans `buildSystemPrompt()` (30 min)
   - Ajouter section "CRITIC MODE" après instructions proactives
   - Protocole : Vérifier complétude, précision, pertinence avant conclusion

**Code référence** : Lignes 1351-1358 (instructions proactives existantes)

**Tests** :
- Vérifier que l'agent auto-évalue ses réponses
- Vérifier que les réponses sont plus complètes

**Risques** : Faible (modification de prompt uniquement)

**Dépendances** : Aucune

---

### Étape 1.3 : Historique des Fichiers Accédés (2h)

**Priorité** : 🔥 **HAUTE** (améliore la cohérence du contexte)

**Fichiers à modifier** :
- `packages/core/src/runtime/conversation/storage.ts`

**Tâches** :
1. ✅ Ajouter interface `AccessedFile` et méthodes (1h)
   - `extractAccessedFiles()` : Extraire fichiers depuis tool results
   - `getRecentlyAccessedFiles()` : Récupérer historique récent

2. ✅ Modifier `buildEnrichedContext()` et `formatContextForAgent()` (1h)
   - Ajouter `recentlyAccessedFiles` au contexte
   - Formater pour affichage dans le prompt

**Code référence** : `buildEnrichedContext()` lignes 2107-2236

**Tests** :
- Vérifier extraction depuis tool results
- Vérifier affichage dans contexte
- Vérifier limite (5% du contexte max)

**Risques** : Faible (nouvelle feature isolée)

**Dépendances** : Aucune

---

### Étape 1.4 : Manifeste de Proactivité Amélioré (1h)

**Priorité** : 🔥 **HAUTE** (structure mieux ce qui existe)

**Fichiers à modifier** :
- `packages/core/src/runtime/agents/rag-agent.ts`

**Tâches** :
1. ✅ Restructurer les instructions proactives existantes (1h)
   - Organiser en sections ANTICIPATE/DEFENSIVE
   - Améliorer la clarté et la structure

**Code référence** : Lignes 1351-1358 (instructions existantes)

**Tests** :
- Vérifier que les instructions sont plus claires
- Vérifier que l'agent est plus proactif

**Risques** : Faible (refactoring de prompt)

**Dépendances** : Aucune

---

### Étape 1.5 : Response Quality Analyzer (4h)

**Priorité** : 🔥 **HAUTE** (améliore significativement la qualité)

**Fichiers à modifier** :
- `packages/core/src/runtime/agents/rag-agent.ts`

**Tâches** :
1. ✅ Créer schéma `ResponseQualityAnalysis` (30 min)
   - `effectiveness`, `missing_tool_calls`, `improved_query`

2. ✅ Créer méthode `analyzeResponseQuality()` (2h)
   - Utiliser `StructuredLLMExecutor.executeSingle`
   - Analyser réponse pour tool calls manqués
   - Générer query améliorée si nécessaire

3. ✅ Intégrer dans `ask()` après génération de réponse (1.5h)
   - Si pas de tool calls et réponse générée → analyser
   - Si analyse suggère retry → relancer avec query améliorée

**Code référence** : `ask()` ligne 996, `StructuredLLMExecutor` disponible

**Tests** :
- Test avec réponse sans tool calls → analyse déclenchée
- Test avec réponse complète → pas d'analyse
- Test avec retry → query améliorée utilisée

**Risques** :
- ⚠️ Performance : Analyse supplémentaire peut ralentir
- ⚠️ Complexité : Gestion du retry et boucles infinies

**Dépendances** : Aucune (utilise StructuredLLMExecutor existant)

---

### Étape 1.6 : Détection de Lazy Response (1h)

**Priorité** : 🔥 **MOYENNE** (complète les instructions proactives)

**Fichiers à modifier** :
- `packages/core/src/runtime/agents/rag-agent.ts`

**Tâches** :
1. ✅ Ajouter stratégies explicites dans prompt (1h)
   - Si recherche retourne 0 résultats → essayer autres termes
   - Si recherche retourne peu de résultats → élargir la recherche
   - Combiner avec Response Quality Analyzer

**Code référence** : Lignes 1352-1358 (instructions existantes)

**Tests** :
- Vérifier que l'agent essaie plusieurs stratégies
- Vérifier que l'agent élargit ses recherches

**Risques** : Faible (modification de prompt)

**Dépendances** : Peut bénéficier de Response Quality Analyzer (Étape 1.5)

---

### Étape 1.7 : Suggestions d'Actions Suivantes (3h)

---

### Étape 1.8 : Extracteur de Hiérarchie de Dépendances (2h)

**Priorité** : 🔥 **MOYENNE** (améliore la compréhension du contexte)

**Fichiers à modifier** :
- `packages/core/src/tools/brain-tools.ts`
- `packages/core/src/runtime/conversation/storage.ts`

**Tâches** :
1. ✅ Créer `generateExtractDependencyHierarchyTool()` et handler (1h)
   - Trouve le scope correspondant à file:line
   - Construit requête Cypher récursive pour CONSUMES/CONSUMED_BY
   - Retourne graphe structuré avec dépendances et consumers

2. ✅ Intégrer dans enrichissement automatique (1h)
   - Ajouter dans `enrichSearchResultWithScope()` si scope trouvé
   - Extraire hiérarchie avec depth=1 par défaut
   - Ajouter dépendances/consumers au contexte

**Code référence** :
- Relations CONSUMES existantes dans Neo4j
- `whereConsumesScope()` et `whereConsumedByScope()` dans QueryBuilder
- Traversals récursifs Cypher (`[:CONSUMES*1..depth]`)

**Tests** :
- Test avec scope trouvé → hiérarchie extraite
- Test avec depth=1 → seulement dépendances directes
- Test avec direction='both' → dépendances + consumers
- Test avec scope non trouvé → erreur claire

**Risques** :
- ⚠️ Performance : Traversals récursifs peuvent être lents avec gros graphes
- ⚠️ Complexité : Gestion des cycles dans le graphe

**Dépendances** : Nécessite locks disponibles (pour accès Neo4j)

---

### Étape 1.7 : Suggestions d'Actions Suivantes (3h)

**Priorité** : 🔥 **HAUTE** (améliore l'expérience utilisateur)

**Fichiers à modifier** :
- `packages/core/src/runtime/agents/rag-agent.ts`

**Tâches** :
1. ✅ Créer interface `NextStepSuggestion` et `SessionMetrics` (1h)
   - `SessionMetrics` : Pattern inspiré de Gemini CLI `UiTelemetryService`
   - `generateNextStepsSuggestions()` : Génère suggestions avec StructuredLLMExecutor
   - `detectProjectType()` : Détecte TypeScript/Python/Rust/Go/etc.
   - `formatAnswerWithNextSteps()` : Formate réponse avec suggestions

2. ✅ Ajouter tracking des outils et fichiers modifiés (30 min)
   - `sessionMetrics` avec `tools.byName` et `files.modified` (pattern Gemini CLI)
   - `trackToolUsage()` pour tracker depuis `onToolResult` callback
   - Track lignes ajoutées/supprimées si disponibles dans metadata

3. ✅ Intégrer dans `ask()` pour ajouter suggestions à la réponse (1h)
   - Générer suggestions après réponse normale
   - Formater avec priorités (haute/moyenne/basse)
   - Exposer `stats` dans `AskResult` (format JSON comme Gemini CLI)
   - Reset tracking après réponse

4. ✅ Adapter suggestions selon type de projet (30 min)
   - TypeScript → npm test, npm run lint, npm run build
   - Python → pytest, pylint, mypy
   - Rust → cargo test, cargo build
   - Go → go test, go build

**Code référence** : 
- `ask()` ligne 996, `StructuredLLMExecutor` disponible
- **Pattern Gemini CLI** : `references/gemini-cli/packages/core/src/telemetry/uiTelemetry.ts`
- **Voir** : [FINDINGS_GEMINI_CLI_OPENCODE.md](./FINDINGS_GEMINI_CLI_OPENCODE.md)

**Tests** :
- Test avec modification code TypeScript → suggère tests, lint, build
- Test avec modification Python → suggère pytest, pylint
- Test avec modification documentation → suggère review seulement
- Test sans modifications → pas de suggestions
- Test avec projet sans tests → ne suggère pas run_tests
- Test tracking stats → vérifier `stats.tools.byName` et `stats.files.modified`

**Risques** :
- ⚠️ Performance : Génération supplémentaire peut ralentir
- ⚠️ Pertinence : Suggestions doivent être pertinentes

**Dépendances** : Aucune (utilise StructuredLLMExecutor existant, pattern Gemini CLI)

---

## Phase 2 : Résilience et Robustesse (~8h)

### Objectif
Améliorer la capacité de l'agent à récupérer des échecs et à s'adapter.

### Étape 2.1 : Replanning (2h)

**Priorité** : 🔥 **MOYENNE** (améliore la robustesse)

**Fichiers à modifier** :
- `packages/core/src/runtime/agents/rag-agent.ts`

**Tâches** :
1. ✅ Ajouter retry automatique dans `executeSubAgent()` (2h)
   - Dans le catch block (ligne 1845)
   - Analyser l'erreur
   - Si récupérable → replanifier et retry
   - Limiter nombre de retries (max 3)

**Code référence** : `executeSubAgent()` lignes 1716-1867, catch block ligne 1845

**Tests** :
- Test avec erreur récupérable → replanification
- Test avec erreur non récupérable → pas de retry
- Test avec max retries atteint → arrêt

**Risques** :
- ⚠️ Boucles infinies : Limiter retries strictement
- ⚠️ Performance : Retries peuvent ralentir

**Dépendances** : Aucune (infrastructure prête)

---

### Étape 2.2 : Dynamic Planning (2h)

**Priorité** : 🔥 **MOYENNE** (améliore la flexibilité)

**Fichiers à modifier** :
- `packages/core/src/runtime/agents/rag-agent.ts`

**Tâches** :
1. ✅ Ajouter permission explicite dans `buildTaskPrompt()` (2h)
   - Autoriser modification du plan si nécessaire
   - Ajouter instructions pour adaptation dynamique

**Code référence** : `buildTaskPrompt()` lignes 1766-1791

**Tests** :
- Vérifier que le sous-agent peut modifier son plan
- Vérifier que les modifications sont pertinentes

**Risques** : Faible (modification de prompt)

**Dépendances** : Aucune

---

### Étape 2.3 : Context Pruning Intelligent (2h)

**Priorité** : 🔥 **MOYENNE** (optimise la mémoire)

**Fichiers à modifier** :
- `packages/core/src/runtime/agents/rag-agent.ts`

**Tâches** :
1. ✅ Améliorer `buildHistoryContext()` fallback (2h)
   - Garder contexte initial (premiers messages)
   - Garder messages récents
   - Élaguer le milieu intelligemment

**Code référence** : `buildHistoryContext()` ligne 1301 (fallback `slice(-10)`)

**Tests** :
- Vérifier que le contexte initial est préservé
- Vérifier que les messages récents sont préservés
- Vérifier que l'élagage est intelligent

**Risques** : Faible (amélioration du fallback)

**Dépendances** : Aucune (le système principal est déjà bon)

---

### Étape 2.4 : Self-Healing (2h)

**Priorité** : 🔥 **MOYENNE** (améliore la robustesse)

**Fichiers à modifier** :
- `packages/core/src/runtime/agents/rag-agent.ts`

**Tâches** :
1. ✅ Ajouter validation dans `GeneratedToolExecutor.execute()` (2h)
   - Valider résultats des tools critiques
   - Si résultat invalide → retry automatique avec exponential backoff (pattern OpenCode)
   - Si retry échoue → signaler erreur claire
   - Implémenter `executeWithRetry()` avec exponential backoff

**Code référence** : 
- `GeneratedToolExecutor.execute()` ligne 605
- **Pattern OpenCode** : Retry avec exponential backoff (2 retries par défaut)
- **Voir** : [FINDINGS_GEMINI_CLI_OPENCODE.md](./FINDINGS_GEMINI_CLI_OPENCODE.md)

**Tests** :
- Test avec résultat invalide → retry avec backoff
- Test avec retry échoué → erreur claire
- Test avec résultat valide → pas de retry
- Test avec erreur non retryable → pas de retry

**Risques** :
- ⚠️ Performance : Validation supplémentaire peut ralentir
- ⚠️ Complexité : Définir quels tools sont "critiques"
- ⚠️ Retry loops : Limiter strictement le nombre de retries

**Dépendances** : Aucune (infrastructure prête, pattern OpenCode)

---

## Phase 3 : Affinage et Optimisation (~6h)

### Objectif
Affiner les features existantes et optimiser les performances.

### Étape 3.1 : Thought-Loop Forcé (3h)

**Priorité** : 🔥 **FAIBLE** (améliore la réflexion)

**Fichiers à modifier** :
- `packages/core/src/runtime/agents/rag-agent.ts`

**Tâches** :
1. ✅ Ajouter `context_analysis` au schéma de sortie (1h)
   - Modifier `outputSchema` dans `ask()`
   - Ajouter champ `context_analysis` obligatoire

2. ✅ Modifier prompt pour forcer l'analyse (2h)
   - Ajouter instructions pour analyser avant d'agir
   - Intégrer dans `buildSystemPrompt()`

**Code référence** : `ask()` lignes 1026-1040 (outputSchema)

**Tests** :
- Vérifier que l'analyse est toujours présente
- Vérifier que l'analyse est pertinente

**Risques** :
- ⚠️ Performance : Analyse supplémentaire peut ralentir
- ⚠️ Complexité : Modification du schéma de sortie

**Dépendances** : Peut bénéficier de Response Quality Analyzer (Phase 1.5)

---

### Étape 3.2 : Few-Shot Prompting (3h)

**Priorité** : 🔥 **FAIBLE** (optimisation)

**Fichiers à modifier** :
- `packages/core/src/runtime/agents/rag-agent.ts`
- Configuration

**Tâches** :
1. ✅ Ajouter exemples dans `buildSystemPrompt()` (2h)
   - Exemples de bonnes pratiques
   - Exemples de proactivité

2. ✅ Configurer pour Gemini Flash 2.0 (1h)
   - Optimiser pour modèle spécifique
   - Ajuster température et autres paramètres

**Code référence** : `buildSystemPrompt()` ligne 1337

**Tests** :
- Vérifier que les exemples améliorent les réponses
- Vérifier que la configuration est optimale

**Risques** : Faible (ajout d'exemples)

**Dépendances** : Peut bénéficier de toutes les features précédentes

---

## Phase 4 : Architecture Unifiée (Optionnel - 8h)

### Objectif
Refactoriser pour regrouper les features en architecture unifiée.

### Étape 4.1 : ProactivePromptBuilder (2h)

**Tâches** :
1. ✅ Créer classe `ProactivePromptBuilder`
2. ✅ Regrouper toutes les modifications de prompt
3. ✅ Migrer `buildSystemPrompt()` pour utiliser le builder

**Gain** : -80% d'opérations (5 modifications → 1)

---

### Étape 4.2 : QualityAnalyzer (2h)

**Tâches** :
1. ✅ Créer classe `QualityAnalyzer`
2. ✅ Centraliser Response Quality Analyzer et Thought-Loop
3. ✅ Schémas d'analyse réutilisables

**Gain** : -50% d'instances, schémas centralisés

---

### Étape 4.3 : RetryManager (2h)

**Tâches** :
1. ✅ Créer classe `RetryManager`
2. ✅ Centraliser Replanning et Self-Healing
3. ✅ Stratégies de retry configurables

**Gain** : -50% de duplication

---

### Étape 4.4 : ValidationPipeline (2h)

**Tâches** :
1. ✅ Créer classe `ValidationPipeline`
2. ✅ Pipeline extensible pour validations
3. ✅ Intégrer Self-Healing

**Gain** : Extensible et modulaire

---

## Ordre d'Exécution Recommandé

### Sprint 1 : Quick Wins (Semaine 1) - 21.5h

**Jour 1-2** :
- ✅ Étape 1.1 : Agent de Contexte Initial (5h)
- ✅ Étape 1.2 : Critic Mode (30 min)
- ✅ Étape 1.3 : Historique des Fichiers (2h)

**Jour 3** :
- ✅ Étape 1.4 : Manifeste de Proactivité (1h)
- ✅ Étape 1.5 : Response Quality Analyzer (4h)

**Jour 4** :
- ✅ Étape 1.6 : Détection de Lazy Response (1h)
- ✅ Étape 1.7 : Suggestions d'Actions Suivantes (3h)
- ✅ Étape 1.8 : Extracteur de Hiérarchie de Dépendances (2h)
- ✅ Tests et ajustements (3h)

**Livrable** : Agent plus proactif avec meilleure qualité de réponse et suggestions d'actions

---

### Sprint 2 : Résilience (Semaine 2) - 8h

**Jour 1** :
- ✅ Étape 2.1 : Replanning (2h)
- ✅ Étape 2.2 : Dynamic Planning (2h)

**Jour 2** :
- ✅ Étape 2.3 : Context Pruning (2h)
- ✅ Étape 2.4 : Self-Healing (2h)

**Livrable** : Agent plus robuste et résilient

---

### Sprint 3 : Affinage (Semaine 3) - 6h

**Jour 1** :
- ✅ Étape 3.1 : Thought-Loop Forcé (3h)
- ✅ Étape 3.2 : Few-Shot Prompting (3h)

**Livrable** : Agent optimisé et affiné

---

### Sprint 4 : Architecture Unifiée (Optionnel - Semaine 4) - 8h

**Jour 1-2** :
- ✅ Étape 4.1-4.4 : Architecture unifiée (8h)

**Livrable** : Code plus maintenable et extensible

---

## Risques Globaux et Mitigation

### Risques Techniques

1. **Performance** :
   - ⚠️ Risque : Analyses supplémentaires peuvent ralentir l'agent
   - ✅ Mitigation : Limiter analyses, utiliser cache, optimiser requêtes

2. **Complexité** :
   - ⚠️ Risque : Code plus complexe, plus difficile à maintenir
   - ✅ Mitigation : Architecture unifiée (Phase 4), tests complets

3. **Boucles infinies** :
   - ⚠️ Risque : Retries et analyses peuvent créer des boucles
   - ✅ Mitigation : Limites strictes (max retries, max analyses)

### Risques Fonctionnels

1. **Qualité des réponses** :
   - ⚠️ Risque : Modifications peuvent dégrader la qualité
   - ✅ Mitigation : Tests complets, validation manuelle, rollback possible

2. **Compatibilité** :
   - ⚠️ Risque : Changements peuvent casser l'existant
   - ✅ Mitigation : Tests de régression, migration progressive

---

## Métriques de Succès

### Métriques Techniques

- **Proactivité** : +50% d'actions anticipées
- **Qualité** : -30% d'erreurs, +20% de code généré correct
- **Résilience** : +40% de récupération d'échecs
- **Efficacité** : -25% d'interventions utilisateur

### Métriques de Code

- **Couverture de tests** : >80%
- **Complexité cyclomatique** : <10 par fonction
- **Temps de réponse** : <2s pour analyses

---

## Checklist de Validation

### Phase 1
- [ ] Agent de contexte initial fonctionne avec 3 recherches parallèles
- [ ] Critic Mode améliore la qualité des réponses
- [ ] Historique des fichiers accédés apparaît dans le contexte
- [ ] Manifeste de proactivité est mieux structuré
- [ ] Response Quality Analyzer détecte les réponses incomplètes
- [ ] Détection de lazy response fonctionne
- [ ] Suggestions d'actions suivantes apparaissent dans les réponses
- [ ] Extracteur de hiérarchie de dépendances fonctionne depuis grep

### Phase 2
- [ ] Replanning récupère automatiquement des échecs
- [ ] Dynamic Planning permet adaptation du plan
- [ ] Context Pruning garde contexte initial et récent
- [ ] Self-Healing valide et retry automatiquement

### Phase 3
- [ ] Thought-Loop Forcé force l'analyse avant action
- [ ] Few-Shot Prompting améliore les réponses

### Phase 4 (Optionnel)
- [ ] Architecture unifiée regroupe toutes les features
- [ ] Code plus maintenable et extensible

---

## Notes Finales

- **Priorité** : Commencer par Phase 1 (Quick Wins) pour impact immédiat
- **Architecture Unifiée** : Implémenter Phase 4 seulement si plusieurs features sont ajoutées
- **Tests** : Tester chaque feature individuellement avant de passer à la suivante
- **Documentation** : Mettre à jour la documentation à chaque étape
- **Rollback** : Garder possibilité de rollback pour chaque feature

**Durée totale** : ~32.5h (4 jours) + Phase 4 optionnelle (8h) = **~40.5h total**
