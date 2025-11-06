## Mini Roadmap — RagForge vers un générateur complet

### 1. MVP CLI (Priorité très haute)
- **Livrer** `ragforge` en CLI (package workspace `packages/cli`) avec commandes `generate`, `introspect`, `init`.
- **Brancher** la CLI sur `SchemaIntrospector`, `ConfigGenerator`, `CodeGenerator` pour un run bout-en-bout (config + client + types).
- **Ajouter** un quickstart (docs + exemple workflow) et publier le binaire npm (version 0.1.0).

### 2. Introspection & Modèle de données (Haute)
- **Compléter** `SchemaIntrospector` : propriétés de relations, comptages réels, dimensions/similarité des index vectoriels, contraintes supplémentaires.
- **Gérer** plusieurs bases / options Neo4j (SSL, auth, cloud) et modes sans introspection (chargement YAML direct).
- **Écrire** tests d’intégration (Neo4j testcontainer) pour garantir la qualité des métadonnées.

### 3. Génération de framework (Haute)
- **Produire** automatiquement types, client, index, tests, scripts d’ingestion, guide README pour chaque config générée.
- **Générer** la doc d’API (Markdown) et un plan d’indexation (vector/fulltext) utilisable immédiatement.
- **Supporter** la configuration multi-vector (`vector_indexes`) et relations enrichies dans la génération.

### 4. Runtime & Connecteurs (Moyenne)
- **Abstraire** les fournisseurs d’embeddings / rerankers (OpenAI, Vertex, Azure, local) et couvrir le fallback sans LLM.
- **Ajouter** un mode offline (vector search mock) + instrumentation (logs, métriques).
- **Renforcer** la couverture de tests unitaires/contractuels et documenter les usages avancés.

### 5. MCP & Écosystème (Moyenne)
- **Implémenter** `packages/mcp` : génération d’un serveur MCP basé sur la config (outillage de recherche, enrichissement).
- **Fournir** des exemples end-to-end (code, documentation, e-commerce) et scénarios de déploiement Docker.
- **Préparer** l’intégration future avec Weaver (import/export de configs, hooks).

### 6. Release & Maintenance (Basse mais continue)
- **Mettre en place** CI (lint, tests, build, publication npm) + versioning sémantique.
- **Identifier** un format de configuration stable (schema JSON/YAML + changelog).
- **Centraliser** la documentation (docs/INDEX.md, quickstarts, guides décisionnels) pour faciliter l’adoption.

> Objectif : viser une release 0.5 qui fournit un CLI fonctionnel, une génération complète et un runtime modulable, puis itérer vers Weaver/production.
