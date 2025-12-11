# Roadmaps de Beautification du Terminal

Ce dossier contient les roadmaps détaillées pour améliorer l'expérience visuelle du terminal, organisées par groupe de fonctionnalités.

## Structure

- **[ROADMAP_ANIMATIONS.md](./ROADMAP_ANIMATIONS.md)** : Animations ASCII pour les opérations
  - Animation Circle (Rotation)
  - Animation Transmutation (Focus Central)
  - Animation Glitch (Chaos Mathématique)
  - Animation Manager

- **[ROADMAP_INGESTION_ANIMATION.md](./ROADMAP_INGESTION_ANIMATION.md)** : Animation spéciale pour l'ingestion
  - Animation multi-phases pour ingestion longue
  - Messages informatifs et rassurants
  - Intégration avec le système d'ingestion

- **[ROADMAP_DIFF_PREVIEW.md](./ROADMAP_DIFF_PREVIEW.md)** : Système de preview et confirmation (Diff + Lecture)
  - Preview de diff avant application
  - Preview de lecture de fichiers (range et fichier entier)
  - Confirmation utilisateur (Approve/Reject/Edit)
  - Configuration des validations (optionnelles avec auto-approve par défaut)
  - Affichage en historique (diff et lectures)
  - Intégration avec le workflow de l'agent

- **[ROADMAP_CLICKABLE_LINKS.md](./ROADMAP_CLICKABLE_LINKS.md)** : Système de liens clickables
  - Composant FileLink avec support Ctrl+Click
  - Intégration dans les messages (grep, search, etc.)
  - Parsing des références de fichiers dans les réponses
  - Support multi-terminal avec fallback
  - Trimming intelligent avec click complet

## Ordre d'Implémentation Recommandé

### Phase 1 : Fondations (Base Visuelle)
1. **Animations Générales** (ROADMAP_ANIMATIONS.md)
   - Implémenter les 3 types d'animations
   - Créer l'Animation Manager
   - Intégrer dans le TUI

2. **Liens Clickables** (ROADMAP_CLICKABLE_LINKS.md)
   - Créer le composant FileLink
   - Implémenter le parsing des références
   - Intégrer dans les messages

### Phase 2 : Fonctionnalités Avancées (UX Améliorée)
3. **Diff Preview** (ROADMAP_DIFF_PREVIEW.md)
   - Créer le composant DiffPreview
   - Intégrer dans le workflow de l'agent
   - Ajouter l'affichage en historique

4. **Animation Ingestion** (ROADMAP_INGESTION_ANIMATION.md)
   - Créer l'animation multi-phases
   - Intégrer avec le système d'ingestion
   - Ajouter les messages informatifs

## Vue d'Ensemble

Ces roadmaps transforment le terminal en une interface riche et interactive, avec :
- **Feedback visuel** : Animations pour indiquer l'activité
- **Navigation rapide** : Liens clickables vers les fichiers
- **Transparence** : Preview des modifications avant application
- **Traçabilité** : Historique des modifications avec diffs

## Documentation de Référence

Pour une vue d'ensemble complète, voir :
- [AGENT_TERMINAL_BEAUTIFICATION.md](../AGENT_TERMINAL_BEAUTIFICATION.md) : Document principal avec vue d'ensemble
- [Agent_terminal_beautification.md](../Agent_terminal_beautification.md) : Exemple HTML original avec animations

Pour la vision du système de validation :
- [VALIDATION_SYSTEM_VISION.md](../VALIDATION_SYSTEM_VISION.md) : Vision globale avec classification de tous les outils
- [VALIDATION_DESIGN_BY_TOOL.md](../VALIDATION_DESIGN_BY_TOOL.md) : Design détaillé pour chaque outil
- [VALIDATION_README.md](../VALIDATION_README.md) : Vue d'ensemble de la documentation de validation

## Notes Importantes

### Liens Clickables (PS Lucie)

Les liens doivent :
1. ✅ Être affichés avant les blocs de diff pour vérifier le code source
2. ✅ Être clickables même si trimmés pour l'affichage
3. ✅ Apparaître dans les résultats de grep/search
4. ✅ Apparaître dans l'historique après modification
5. ✅ Fonctionner avec Ctrl+Click dans les terminaux modernes

### Diff Preview (PS Lucie)

Le système de diff doit :
1. ✅ Montrer la diff avant application pour les tool calls de modification
2. ✅ Afficher un lien clickable vers le fichier avant le bloc de diff
3. ✅ Afficher la diff en historique après modification
4. ✅ Inclure un lien clickable au-dessus de chaque bloc de diff

### Validation des Lectures (PS Lucie)

Le système de validation des lectures doit :
1. ✅ Lectures avec range de lignes → afficher un bloc avec contenu et demander validation
2. ✅ Lectures de fichier entier → afficher juste le lien et demander validation
3. ✅ Toutes les validations optionnelles avec par défaut "oui" (auto-approve) selon config
4. ✅ Configuration séparée pour diff, lectures range, et lectures entières
5. ✅ Délai configurable avant auto-approbation

## Dépendances Techniques

- **Ink/React** : Framework pour le rendu terminal
- **Séquences OSC 8** : Pour les liens clickables
- **Librairie de diff** : Pour calculer les diffs (ex: `diff-match-patch`, `jsdiff`)
- **Support terminal** : Détection du support des fonctionnalités avancées
