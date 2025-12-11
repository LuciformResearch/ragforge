# Système de Validation - Documentation

## Vue d'ensemble

Ce dossier contient la vision et le design détaillé du système de validation universel pour tous les outils de l'agent.

## Documents

- **[VALIDATION_SYSTEM_VISION.md](./VALIDATION_SYSTEM_VISION.md)** : Vision globale du système
  - Classification des outils par niveau de risque (7 niveaux)
  - Matrice complète de validation pour tous les outils
  - Architecture du système
  - Configuration par défaut (validation requise par défaut)
  - Exemples de design par outil

- **[VALIDATION_DESIGN_BY_TOOL.md](./VALIDATION_DESIGN_BY_TOOL.md)** : Design détaillé par outil
  - Design spécifique pour chaque outil
  - Composants React/Ink nécessaires
  - Cas limites et spécificités
  - Tests à effectuer

## Principe Fondamental

**Par défaut, chaque outil demande validation.** La configuration permet d'adapter ce comportement selon les préférences de l'utilisateur et le type d'opération.

## Classification par Niveau de Risque

1. **🔴 Niveau 1 : Destructif** - Validation toujours requise (pas d'auto-approve)
2. **🟠 Niveau 2 : Modification** - Validation par défaut, auto-approve possible avec config
3. **🟡 Niveau 3 : Lecture avec Impact** - Auto-approve par défaut, validation optionnelle
4. **🟢 Niveau 4 : Consultation** - Pas de validation nécessaire
5. **🔵 Niveau 5 : Génération** - Validation par défaut, auto-approve possible
6. **🟣 Niveau 6 : Planification** - Validation complexe (plan + actions individuelles)
7. **⚪ Niveau 7 : Notification** - Pas de validation nécessaire

## Configuration

### Comportement par Défaut

```yaml
validation:
  default_behavior: require  # require | auto-approve
  default_delay: 2000  # ms
```

### Configuration par Outil

Chaque outil peut override le comportement global :

```yaml
tools:
  write_file:
    require: true  # Toujours valider (même si global = auto-approve)
    delay: 0  # Pas d'auto-approve
  
  read_file:
    require: false  # Auto-approve (même si global = require)
    delay: 1000
```

## Types de Preview

- **`diff`** : Diff complète ou partielle (write_file, edit_file)
- **`content`** : Contenu à créer ou lire (create_file, read_file)
- **`link`** : Juste un lien clickable (read_file entier, ingest)
- **`search_results`** : Résultats de recherche (grep, brain_search)
- **`plan`** : Plan d'actions (plan_actions, create_project)
- **`deletion`** : Liste de fichiers à supprimer (delete_path)
- **`command`** : Commande à exécuter (run_command)
- **`generation`** : Paramètres de génération (generate_image, etc.)
- **`none`** : Pas de preview (opérations de consultation)

## Intégration avec les Roadmaps

Ces documents de vision complètent les roadmaps d'implémentation :

- **[beautification-roadmaps/ROADMAP_DIFF_PREVIEW.md](./beautification-roadmaps/ROADMAP_DIFF_PREVIEW.md)** : Implémentation du système de diff preview
- **[beautification-roadmaps/ROADMAP_CLICKABLE_LINKS.md](./beautification-roadmaps/ROADMAP_CLICKABLE_LINKS.md)** : Système de liens clickables

## Prochaines Étapes

1. **Validation de la Vision** : Valider avec l'utilisateur
2. **Implémentation du ValidationManager** : Gestionnaire centralisé
3. **Création des Preview Components** : Composants pour chaque type
4. **Système de Configuration** : Chargement et sauvegarde
5. **Intégration dans le TUI** : Workflow complet

## Notes

- **Sécurité par défaut** : Par défaut, tout demande validation (sécurité maximale)
- **Flexibilité** : Configuration adaptée à chaque workflow
- **Transparence** : Toujours voir ce qui va être fait avant validation
- **Performance** : Auto-approve pour les opérations sûres et fréquentes
