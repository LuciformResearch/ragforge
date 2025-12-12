# Debug Tools pour la Mémoire de Conversation

**Date**: 12 décembre 2025, 10h09
**Objectif**: Créer des outils MCP spécialisés pour debugger et tester la mémoire de conversation et le context engineering de l'agent.

> **Note technique**: Bug rencontré lors de la création initiale - les outils `mcp__ragforge__create_file` et `Write` ont échoué ("Interrupted by user"). Redémarrage PC nécessaire.

## Contexte

Le système RagForge dispose d'un système sophistiqué de mémoire de conversation avec :
- Stockage hiérarchique dans Neo4j
- Résumés multi-niveaux (L0, L1, L2)
- Recherche sémantique et fuzzy
- Context engineering pour enrichir les prompts de l'agent

Cependant, il manque des outils pour **inspecter et debugger** ce système de manière interactive.

## Documents

| Fichier | Description |
|---------|-------------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Architecture actuelle du système de mémoire |
| [PROPOSAL.md](./PROPOSAL.md) | Proposition des outils de debug |
| [IMPLEMENTATION.md](./IMPLEMENTATION.md) | Plan d'implémentation détaillé |
| [BUGS_FOUND.md](./BUGS_FOUND.md) | Bugs identifiés lors de l'analyse |

## Résumé de la proposition

7 outils MCP de debug :

| Outil | Description | Type |
|-------|-------------|------|
| **`debug_context`** | Inspecter le contexte enrichi avant injection | Lecture |
| **`debug_agent_prompt`** | Simuler le prompt complet de l'agent | Lecture |
| **`debug_conversation_search`** | Tester la recherche sémantique sur l'historique | Lecture |
| **`debug_list_summaries`** | Lister les résumés L1/L2 existants | Lecture |
| **`debug_message`** | Inspecter un message et ses embeddings | Lecture |
| **`debug_inject_turn`** | **Injecter un turn manuellement** (user + tools + assistant) | Écriture |
| **`debug_replay_conversation`** | Rejouer une conversation existante | Écriture |

## Priorité d'implémentation

### Phase 1 - Inspection (lecture seule)
1. `debug_context` (critique pour le debugging)
2. `debug_agent_prompt` (visibilité sur ce que l'agent reçoit)
3. `debug_conversation_search` (diagnostic des recherches)

### Phase 2 - Simulation (écriture)
4. **`debug_inject_turn`** (reproduire des scénarios, tester la mémoire)

### Phase 3 - Compléments
5. `debug_list_summaries` (inspection des résumés)
6. `debug_message` (inspection fine des messages)
7. `debug_replay_conversation` (bonus)
