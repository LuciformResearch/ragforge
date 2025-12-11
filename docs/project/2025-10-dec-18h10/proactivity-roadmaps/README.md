# Roadmaps d'Amélioration de la Proactivité de l'Agent

Ce dossier contient les roadmaps détaillées pour améliorer la proactivité de l'agent, organisées par groupe de fonctionnalités.

## Structure

- **[ROADMAP_AUTO_VERIFICATION.md](./ROADMAP_AUTO_VERIFICATION.md)** : Auto-vérification et auto-correction
  - Self-Healing (Double-Check Automatique)
  - Critic Mode (Auto-Critique)
  - Response Quality Analyzer (Auto-Retry avec Query Améliorée)

- **[ROADMAP_RESILIENCE.md](./ROADMAP_RESILIENCE.md)** : Résilience et gestion des échecs
  - Replanning (Gestion Automatique des Échecs)
  - Dynamic Planning pour Sub-Agent

- **[ROADMAP_MEMORY.md](./ROADMAP_MEMORY.md)** : Mémoire et gestion du contexte
  - Context Pruning Intelligent (Mémoire Glissante)

- **[ROADMAP_PROMPT_ENGINEERING.md](./ROADMAP_PROMPT_ENGINEERING.md)** : Prompt engineering pour la proactivité
  - Manifeste de Proactivité
  - Thought-Loop Forcé
  - Détection de "Lazy Response"

- **[ROADMAP_CONFIGURATION.md](./ROADMAP_CONFIGURATION.md)** : Configuration et optimisation
  - Recommandations pour Gemini Flash 2.0
  - Few-Shot Prompting
  - Optimisations spécifiques

- **[ROADMAP_UNIFIED_ARCHITECTURE.md](./ROADMAP_UNIFIED_ARCHITECTURE.md)** : Architecture unifiée et optimisations
  - Regroupement des modifications de prompt
  - Unification des analyses avec StructuredLLMExecutor
  - Système de retry centralisé
  - Pipeline de validation extensible

- **[ROADMAP_PARALLEL_SEARCH_AGENT.md](./ROADMAP_PARALLEL_SEARCH_AGENT.md)** : Agent de contexte initial - Recherche parallèle multi-outils
  - Remplace le fallback fuzzy search par un agent simple utilisant `StructuredLLMExecutor`
  - Propose jusqu'à 3 recherches parallèles (grep, terminal, fuzzy)
  - Composition libre : peut utiliser le même tool 3 fois ou combiner différemment
  - Toujours lancé en parallèle avec semantic search, quoi qu'il arrive
  - Abstraction possible avec rag-agent (pattern commun : StructuredLLMExecutor + tool calling)

- **[ROADMAP_NEXT_STEPS_SUGGESTIONS.md](./ROADMAP_NEXT_STEPS_SUGGESTIONS.md)** : Suggestions d'Actions Suivantes
  - L'agent propose des actions supplémentaires dans sa réponse finale
  - Suggestions adaptées selon le type de projet (TypeScript, Python, Rust, Go)
  - Actions comme tests, compilation, linting, vérifications
  - Priorisation intelligente (haute/moyenne/basse)

- **[ROADMAP_DEPENDENCY_HIERARCHY_EXTRACTOR.md](./ROADMAP_DEPENDENCY_HIERARCHY_EXTRACTOR.md)** : Extracteur de Hiérarchie de Dépendances
  - Extrait la hiérarchie CONSUMES/CONSUMED_BY depuis résultats grep
  - Construit un graphe de dépendances récursif
  - Enrichit automatiquement les résultats avec leur contexte de dépendances
  - Permet d'analyser l'impact d'un changement
  - Gère les cycles et supporte INHERITS_FROM

- **[CYPHER_ANALYSIS_GEMINI_CLI_OPENCODE.md](./CYPHER_ANALYSIS_GEMINI_CLI_OPENCODE.md)** : Analyse Cypher - Structure de Code
  - Analyse comparative de Gemini CLI et OpenCode
  - Découvertes sur les patterns de dépendances, hubs, cycles, profondeur
  - Implications pour nos roadmaps et nouvelles idées de features

- **[COMPARISON_IMPLEMENTATION_VS_ROADMAPS.md](./COMPARISON_IMPLEMENTATION_VS_ROADMAPS.md)** : Comparaison détaillée
  - État actuel vs suggestions des roadmaps
  - Features déjà implémentées vs manquantes
  - Plan d'action recommandé

- **[IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md)** : Plan d'implémentation global ⭐
  - Plan d'implémentation étape par étape pour toutes les features
  - Organisé par phases avec dépendances, estimations, risques
  - Ordre d'exécution recommandé avec sprints
  - Checklist de validation et métriques de succès

- **[FINDINGS_GEMINI_CLI_OPENCODE.md](./FINDINGS_GEMINI_CLI_OPENCODE.md)** : Patterns d'implémentation trouvés ⭐
  - Analyse des patterns de Gemini CLI et OpenCode
  - Tracking des outils (pattern Gemini CLI)
  - Retry avec exponential backoff (pattern OpenCode)
  - Application aux roadmaps RagForge
  - Code de référence et recommandations

## Ordre d'Implémentation Recommandé

**📋 Pour un plan d'implémentation détaillé étape par étape, voir [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md)**

### Vue d'Ensemble Rapide

**Phase 1 : Quick Wins (Impact Immédiat)** - ~23.5h
- Agent de Contexte Initial - Recherche Parallèle (5h)
- Critic Mode (30 min)
- Historique des Fichiers Accédés (2h)
- Manifeste de Proactivité Amélioré (1h)
- Response Quality Analyzer (4h)
- Détection de Lazy Response (1h)
- Suggestions d'Actions Suivantes (3h)
- Extracteur de Hiérarchie de Dépendances (2h)

**Phase 2 : Résilience** - ~8h
- Replanning (2h)
- Dynamic Planning (2h)
- Context Pruning Intelligent (2h)
- Self-Healing (2h)

**Phase 3 : Affinage** - ~6h
- Thought-Loop Forcé (3h)
- Few-Shot Prompting (3h)

**Phase 4 : Architecture Unifiée (Optionnel)** - ~8h
- ProactivePromptBuilder (2h)
- QualityAnalyzer (2h)
- RetryManager (2h)
- ValidationPipeline (2h)

**Total** : ~37.5h (essentiel) + 8h (optionnel) = **~45.5h**

## Vue d'Ensemble

Ces roadmaps transforment l'agent d'un "stagiaire qui attend les ordres" en un "Tech Lead autonome". Chaque roadmap est indépendante mais complémentaire, permettant une implémentation progressive et itérative.

## Patterns Communs : Utilisation de StructuredLLMExecutor

Plusieurs features utilisent `StructuredLLMExecutor` pour obtenir des réponses structurées et vérifier l'efficacité :

- **Thought-Loop Forcé** (ROADMAP_PROMPT_ENGINEERING.md) : Force l'analyse avant l'action via schéma structuré
- **Response Quality Analyzer** (ROADMAP_AUTO_VERIFICATION.md) : Analyse la réponse après exécution et décide d'un retry

Ces deux features peuvent partager des patterns similaires :
- Schémas d'analyse structurés pour évaluer l'efficacité
- Utilisation de `executeSingle()` pour des analyses ponctuelles
- Retour de réponses structurées pour prise de décision automatique

**Recommandation** : Créer une bibliothèque commune de schémas d'analyse réutilisables pour éviter la duplication.

## Métriques Globales de Succès

- **Proactivité** : Augmentation des actions anticipées
- **Qualité** : Réduction des erreurs et amélioration du code généré
- **Résilience** : Augmentation du taux de récupération des échecs
- **Efficacité** : Réduction des interventions utilisateur

## Documentation de Référence

Pour une vue d'ensemble complète, voir :
- [AGENT_PROACTIVITY_IMPROVEMENTS.md](../AGENT_PROACTIVITY_IMPROVEMENTS.md) : Document principal avec vue d'ensemble
