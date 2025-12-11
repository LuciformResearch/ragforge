# Design de Validation par Outil - Détails Techniques

## Vue d'ensemble

Ce document détaille le design de validation pour chaque outil individuellement, avec les spécificités techniques, les composants nécessaires, et les cas limites.

---

## 🔴 Niveau 1 : Opérations Destructives

### `delete_path`

**Preview Type** : `deletion`

**Contenu du Preview** :
- Liste récursive des fichiers/dossiers qui seront supprimés
- Taille totale des fichiers
- Nombre de fichiers
- Avertissement clair

**Composant** : `DeletionPreview`

```typescript
interface DeletionPreviewProps {
  path: string;
  filesToDelete: Array<{
    path: string;
    type: 'file' | 'directory';
    size?: number;
  }>;
  totalSize: number;
  fileCount: number;
  onApprove: () => void;
  onReject: () => void;
}
```

**Spécificités** :
- Pas d'auto-approve (toujours validation manuelle)
- Afficher l'arborescence complète si récursif
- Calculer la taille avant affichage (peut être lent pour gros dossiers)

---

### `write_file`

**Preview Type** : `diff`

**Contenu du Preview** :
- Diff complète entre ancien et nouveau contenu
- Lien clickable vers le fichier
- Avertissement si fichier existe déjà

**Composant** : `DiffPreview` (voir ROADMAP_DIFF_PREVIEW.md)

**Spécificités** :
- Pas d'auto-approve (toujours validation manuelle)
- Si fichier n'existe pas, afficher "Nouveau fichier" au lieu de diff
- Calculer la diff avant affichage

---

### `forget_path`

**Preview Type** : `deletion` (connaissances)

**Contenu du Preview** :
- Path qui sera oublié
- Nombre de nœuds qui seront supprimés du brain
- Projets affectés
- Avertissement clair

**Composant** : `ForgetPathPreview`

```typescript
interface ForgetPathPreviewProps {
  path: string;
  nodeCount: number;
  affectedProjects: string[];
  onApprove: () => void;
  onReject: () => void;
}
```

**Spécificités** :
- Pas d'auto-approve (toujours validation manuelle)
- Requiert une requête Neo4j pour compter les nœuds
- Afficher les projets affectés

---

## 🟠 Niveau 2 : Opérations de Modification

### `edit_file`

**Preview Type** : `diff`

**Contenu du Preview** :
- Diff partielle (seulement les lignes modifiées)
- Contexte autour des modifications (quelques lignes avant/après)
- Lien clickable vers le fichier avec numéro de ligne de début

**Composant** : `DiffPreview` (avec mode partiel)

**Spécificités** :
- Auto-approve possible avec config (délai: 2s)
- Calculer la diff avant affichage
- Si plusieurs occurrences avec `replace_all`, afficher toutes

---

### `create_file`

**Preview Type** : `content`

**Contenu du Preview** :
- Contenu complet du fichier à créer
- Path du fichier avec lien clickable
- Taille estimée
- Avertissement si le répertoire parent n'existe pas

**Composant** : `CreationPreview`

```typescript
interface CreationPreviewProps {
  path: string;
  content: string;
  estimatedSize: number;
  parentExists: boolean;
  onApprove: () => void;
  onReject: () => void;
  autoApprove?: boolean;
  delay?: number;
}
```

**Spécificités** :
- Auto-approve possible avec config (délai: 2s)
- Si contenu très long, tronquer avec "..." et option "Voir plus"
- Vérifier que le répertoire parent existe

---

### `run_command` (avec `modifies_files: true`)

**Preview Type** : `command`

**Contenu du Preview** :
- Commande à exécuter
- Working directory
- Avertissement si commande dangereuse détectée
- Liste des fichiers qui pourraient être modifiés (si détectable)

**Composant** : `CommandPreview`

```typescript
interface CommandPreviewProps {
  command: string;
  cwd: string;
  isDangerous: boolean;
  potentiallyModifiedFiles?: string[];
  onApprove: () => void;
  onReject: () => void;
  autoApprove?: boolean;
  delay?: number;
}
```

**Spécificités** :
- Auto-approve possible avec config (délai: 2s)
- Détecter les commandes dangereuses (rm, mv, git push, etc.)
- Si commande dangereuse détectée, passer en Niveau 1 (pas d'auto-approve)

---

### `ingest_directory`

**Preview Type** : `ingestion`

**Contenu du Preview** :
- Path du répertoire à ingérer
- Estimation du nombre de fichiers
- Patterns inclus/exclus
- Message informatif sur la durée

**Composant** : `IngestionPreview` (voir ROADMAP_INGESTION_ANIMATION.md)

**Spécificités** :
- Auto-approve possible avec config (délai: 3s)
- Afficher l'animation spéciale pendant l'ingestion
- Message clair que c'est une opération initiale

---

### `ingest_web_page`

**Preview Type** : `link`

**Contenu du Preview** :
- URL à ingérer
- Options (depth, maxPages, etc.)
- Lien clickable vers l'URL
- Estimation du nombre de pages

**Composant** : `WebIngestionPreview`

```typescript
interface WebIngestionPreviewProps {
  url: string;
  depth: number;
  maxPages?: number;
  includePatterns?: string[];
  excludePatterns?: string[];
  onApprove: () => void;
  onReject: () => void;
  autoApprove?: boolean;
  delay?: number;
}
```

**Spécificités** :
- Auto-approve possible avec config (délai: 2s)
- Si depth > 0, afficher le nombre estimé de pages
- Lien clickable vers l'URL (ouvre dans le navigateur)

---

## 🟡 Niveau 3 : Opérations de Lecture avec Impact

### `read_file` (avec range)

**Preview Type** : `content`

**Contenu du Preview** :
- Lien clickable vers le fichier avec numéros de lignes
- Contenu du range (premiers 20 lignes + "...")
- Total de lignes dans le range
- Option "Voir plus" pour voir tout le range

**Composant** : `FileReadPreview` (voir ROADMAP_DIFF_PREVIEW.md)

**Spécificités** :
- Auto-approve par défaut (délai: 1s)
- Pré-charger le contenu pour le preview
- Si range très long, tronquer intelligemment

---

### `read_file` (fichier entier)

**Preview Type** : `link`

**Contenu du Preview** :
- Lien clickable vers le fichier
- Taille du fichier
- Nombre de lignes
- Message "Full file read requested"

**Composant** : `FileReadPreview` (mode fichier entier)

**Spécificités** :
- Auto-approve par défaut (délai: 1s)
- Afficher juste le lien, pas le contenu (trop long)
- Avertir si fichier très gros (>10MB)

---

### `grep_files`

**Preview Type** : `search_results`

**Contenu du Preview** :
- Pattern recherché
- Nombre total de matches
- Premiers résultats (10-20) avec :
  - Lien clickable vers fichier:ligne
  - Ligne de contenu avec highlight
- Option "Voir plus" si beaucoup de résultats

**Composant** : `SearchResultsPreview`

```typescript
interface SearchResultsPreviewProps {
  pattern: string;
  totalMatches: number;
  results: Array<{
    file: string;
    line: number;
    content: string;
    match: string;
  }>;
  maxPreview: number; // Nombre de résultats à afficher
  onApprove: () => void;
  onReject: () => void;
  autoApprove?: boolean;
  delay?: number;
}
```

**Spécificités** :
- Auto-approve par défaut (délai: 1s)
- Limiter le preview à 20 résultats max
- Highlight le match dans le contenu
- Liens clickables vers chaque résultat

---

### `brain_search`

**Preview Type** : `search_results`

**Contenu du Preview** :
- Query de recherche
- Nombre total de résultats
- Premiers résultats avec :
  - Type (turn/summary/code)
  - Score de similarité
  - Lien clickable si fichier
  - Extrait de contenu
- Option "Voir plus"

**Composant** : `SearchResultsPreview` (mode brain_search)

**Spécificités** :
- Auto-approve par défaut (délai: 1s)
- Afficher le score de similarité
- Différencier les types de résultats (turn vs code)
- Liens clickables vers fichiers avec numéros de lignes

---

### `search_files` (fuzzy)

**Preview Type** : `search_results`

**Contenu du Preview** :
- Query de recherche
- Nombre total de matches
- Premiers résultats avec :
  - Lien clickable vers fichier:ligne
  - Score de similarité
  - Mot matché
  - Ligne de contenu

**Composant** : `SearchResultsPreview` (mode fuzzy)

**Spécificités** :
- Auto-approve par défaut (délai: 1s)
- Afficher le score de similarité (0-1)
- Highlight le mot matché

---

### `read_image`

**Preview Type** : `image`

**Contenu du Preview** :
- Lien clickable vers l'image
- Path de l'image
- Taille de l'image
- Provider utilisé (gemini/deepseek)

**Composant** : `ImageReadPreview`

```typescript
interface ImageReadPreviewProps {
  path: string;
  imageSize?: { width: number; height: number };
  fileSize: number;
  provider: string;
  onApprove: () => void;
  onReject: () => void;
  autoApprove?: boolean;
  delay?: number;
}
```

**Spécificités** :
- Auto-approve par défaut (délai: 1s)
- Optionnellement afficher un thumbnail si possible
- Lien clickable vers l'image

---

### `describe_image`

**Preview Type** : `image`

**Contenu du Preview** :
- Lien clickable vers l'image
- Path de l'image
- Prompt utilisé (si fourni)
- Taille de l'image

**Composant** : `ImageReadPreview` (mode describe)

**Spécificités** :
- Auto-approve par défaut (délai: 1s)
- Afficher le prompt si fourni
- Lien clickable vers l'image

---

## 🟢 Niveau 4 : Opérations de Consultation

### `list_directory`, `glob_files`, `get_file_info`

**Validation** : ❌ Aucune

**Affichage** : Résultats directement dans l'historique avec liens clickables si fichiers mentionnés

---

### `git_status`, `git_diff`

**Validation** : ❌ Aucune

**Affichage** : Résultats directement dans l'historique avec liens clickables vers fichiers modifiés

---

### `get_working_directory`, `get_environment_info`, `get_project_info`

**Validation** : ❌ Aucune

**Affichage** : Résultats directement dans l'historique

---

### `list_brain_projects`, `list_watchers`

**Validation** : ❌ Aucune

**Affichage** : Liste directement dans l'historique

---

### `query_entities`, `semantic_search`, `explore_relationships`

**Validation** : ❌ Aucune

**Affichage** : Résultats directement dans l'historique avec liens clickables si fichiers mentionnés

---

## 🔵 Niveau 5 : Opérations de Génération/Création

### `create_project`

**Preview Type** : `plan`

**Contenu du Preview** :
- Nom du projet
- Path de création
- Structure qui sera créée :
  - Fichiers à créer (package.json, tsconfig.json, src/index.ts, etc.)
  - Options (install_deps, ingest, generate_embeddings)
- Lien clickable vers le répertoire parent

**Composant** : `ProjectCreationPreview`

```typescript
interface ProjectCreationPreviewProps {
  name: string;
  path: string;
  filesToCreate: string[];
  options: {
    installDeps: boolean;
    ingest: boolean;
    generateEmbeddings: boolean;
  };
  onApprove: () => void;
  onReject: () => void;
  autoApprove?: boolean;
  delay?: number;
}
```

**Spécificités** :
- Auto-approve possible avec config (délai: 3s)
- Afficher la structure complète du projet
- Lien clickable vers le répertoire parent

---

### `generate_image`

**Preview Type** : `generation`

**Contenu du Preview** :
- Prompt utilisé
- Output path
- Aspect ratio
- Options (enhance_prompt, etc.)
- Lien clickable vers le répertoire de sortie

**Composant** : `GenerationPreview`

```typescript
interface GenerationPreviewProps {
  type: 'image' | '3d' | 'multiview';
  prompt: string;
  outputPath: string;
  parameters: Record<string, any>;
  estimatedCost?: number;
  estimatedTime?: number;
  onApprove: () => void;
  onReject: () => void;
  autoApprove?: boolean;
  delay?: number;
}
```

**Spécificités** :
- Auto-approve possible avec config (délai: 3s)
- Afficher le coût estimé si disponible
- Afficher le temps estimé si disponible
- Lien clickable vers le répertoire de sortie

---

### `generate_multiview_images`

**Preview Type** : `generation`

**Contenu du Preview** :
- Prompt utilisé
- Output directory
- Style
- Nombre de vues (4)
- Lien clickable vers le répertoire de sortie

**Composant** : `GenerationPreview` (mode multiview)

**Spécificités** :
- Auto-approve possible avec config (délai: 3s)
- Afficher les 4 vues qui seront générées
- Coût estimé plus élevé (4 images)

---

### `generate_3d_from_image`, `generate_3d_from_text`

**Preview Type** : `generation`

**Contenu du Preview** :
- Input (image path ou text prompt)
- Output path
- Paramètres
- Coût estimé (~$0.11)
- Temps estimé (60-120s ou 3-4min)

**Composant** : `GenerationPreview` (mode 3d)

**Spécificités** :
- Auto-approve possible avec config (délai: 5s pour text, 3s pour image)
- Afficher le coût et temps estimés
- Avertir que c'est une opération longue

---

### `render_3d_asset`

**Preview Type** : `generation`

**Contenu du Preview** :
- Model path (lien clickable)
- Output directory (lien clickable)
- Views à rendre
- Dimensions
- Background

**Composant** : `GenerationPreview` (mode render)

**Spécificités** :
- Auto-approve possible avec config (délai: 2s)
- Liens clickables vers model et output directory
- Afficher les vues qui seront générées

---

## 🟣 Niveau 6 : Opérations de Planification

### `plan_actions`

**Preview Type** : `plan`

**Contenu du Preview** :
- Goal du plan
- Liste de toutes les actions avec :
  - Description
  - Tool prévu (si spécifié)
  - Arguments prévus (si spécifiés)
  - Complexité
  - Batchable ou non
- Stratégie d'exécution
- Option de validation individuelle par action

**Composant** : `PlanPreview`

```typescript
interface PlanPreviewProps {
  goal: string;
  actions: Array<{
    description: string;
    tool?: string;
    arguments?: Record<string, any>;
    complexity?: 'simple' | 'medium' | 'complex';
    batchable?: boolean;
  }>;
  strategy: 'sequential' | 'batch_when_possible' | 'all_at_once';
  onApprove: () => void;
  onReject: () => void;
  onEdit: () => void;
  onValidateAction?: (actionIndex: number) => void;
  autoApprove?: boolean;
  delay?: number;
}
```

**Spécificités** :
- Auto-approve possible avec config (délai: 5s)
- Validation globale du plan OU validation individuelle de chaque action
- Option "Edit Plan" pour modifier avant validation
- Afficher la stratégie d'exécution

---

## 🟠 Niveau 2 (Suite) : Autres Opérations de Modification

### `move_file`

**Preview Type** : `move`

**Contenu du Preview** :
- Source path (lien clickable)
- Destination path (lien clickable)
- Avertissement si destination existe déjà
- Impact sur les fichiers

**Composant** : `MovePreview`

**Spécificités** :
- Auto-approve possible avec config (délai: 2s)
- Vérifier si destination existe
- Afficher l'impact (fichiers qui seront déplacés)

---

### `copy_file`

**Preview Type** : `copy`

**Contenu du Preview** :
- Source path (lien clickable)
- Destination path (lien clickable)
- Avertissement si destination existe déjà
- Option overwrite

**Composant** : `CopyPreview`

**Spécificités** :
- Auto-approve possible avec config (délai: 2s)
- Vérifier si destination existe
- Afficher option overwrite si configuré

---

### `setup_project`

**Preview Type** : `plan`

**Contenu du Preview** :
- Options de setup (sourceType, language, etc.)
- Actions qui seront effectuées
- Fichiers qui seront créés/modifiés
- Lien clickable vers le répertoire

**Composant** : `ProjectSetupPreview`

**Spécificités** :
- Auto-approve possible avec config (délai: 3s)
- Afficher la structure qui sera créée
- Avertir si force=true

---

### `ingest_code`

**Preview Type** : `ingestion`

**Contenu du Preview** :
- Fichiers à ingérer (si spécifiés)
- Mode (incremental ou full)
- Lien clickable vers le répertoire

**Composant** : `IngestionPreview` (mode code)

**Spécificités** :
- Auto-approve possible avec config (délai: 2s)
- Afficher la liste des fichiers si spécifiée
- Message sur le mode (incremental vs full)

---

### `generate_embeddings`

**Preview Type** : `generation`

**Contenu du Preview** :
- Entity cible (si spécifiée)
- Options (force, indexOnly)
- Estimation du nombre d'embeddings à générer

**Composant** : `EmbeddingsPreview`

**Spécificités** :
- Auto-approve possible avec config (délai: 2s)
- Afficher l'estimation si disponible
- Avertir si force=true (regénération complète)

---

### `run_npm_script`

**Preview Type** : `command`

**Contenu du Preview** :
- Script name
- Arguments additionnels
- Commande complète qui sera exécutée
- Lien vers package.json

**Composant** : `CommandPreview` (mode npm)

**Spécificités** :
- Auto-approve possible avec config (délai: 2s)
- Vérifier que le script existe dans package.json
- Afficher la commande complète

---

### `exclude_project`, `include_project`

**Preview Type** : `action`

**Contenu du Preview** :
- Project ID
- Action (exclude/include)
- Impact (projet sera caché/visible dans les recherches)

**Composant** : `ProjectActionPreview`

**Spécificités** :
- Auto-approve possible avec config (délai: 1s)
- Afficher le nom du projet si disponible
- Message clair sur l'impact

---

### `start_watcher`, `stop_watcher`

**Preview Type** : `action`

**Contenu du Preview** :
- Project path
- Action (start/stop)
- Impact (watcher sera démarré/arrêté)

**Composant** : `WatcherActionPreview`

**Spécificités** :
- Auto-approve possible avec config (délai: 1s)
- Lien clickable vers le projet
- Message sur l'impact

---

### `set_api_key`

**Preview Type** : `action`

**Contenu du Preview** :
- Key name (gemini/replicate)
- Avertissement que la clé sera stockée
- Impact (fonctionnalités activées)

**Composant** : `ApiKeyPreview`

**Spécificités** :
- Auto-approve possible avec config (délai: 2s)
- Avertissement de sécurité
- Masquer la valeur de la clé dans le preview

---

### `run_cypher`

**Preview Type** : `query`

**Contenu du Preview** :
- Query Cypher complète
- Paramètres (si fournis)
- Avertissement si query modifie des données (WRITE)

**Composant** : `CypherPreview`

**Spécificités** :
- Auto-approve possible avec config (délai: 2s)
- Détecter si query est READ ou WRITE
- Si WRITE, passer en Niveau 1 (pas d'auto-approve)
- Afficher la query formatée

---

### `install_package`

**Preview Type** : `action`

**Contenu du Preview** :
- Package name
- Version (si spécifiée)
- Dev dependency (si true)
- Impact (package.json sera modifié)

**Composant** : `PackageInstallPreview`

**Spécificités** :
- Auto-approve possible avec config (délai: 2s)
- Lien clickable vers package.json
- Afficher si c'est une dev dependency

---

### `edit_image`

**Preview Type** : `image_edit`

**Contenu du Preview** :
- Image path (lien clickable)
- Prompt d'édition
- Output path (lien clickable)
- Coût estimé

**Composant** : `ImageEditPreview`

**Spécificités** :
- Auto-approve possible avec config (délai: 2s)
- Liens clickables vers image source et destination
- Afficher le coût estimé

---

### `analyze_visual`, `analyze_3d_model`

**Preview Type** : `analysis`

**Contenu du Preview** :
- Path (lien clickable)
- Prompt/Question (si fourni)
- Type d'analyse
- Coût estimé

**Composant** : `AnalysisPreview`

**Spécificités** :
- Auto-approve possible avec config (délai: 1s)
- Lien clickable vers le fichier
- Afficher le prompt si fourni

---

### `query_database`

**Preview Type** : `query`

**Contenu du Preview** :
- Connection name
- Query SQL
- Paramètres (si fournis)
- Avertissement si query modifie des données

**Composant** : `DatabaseQueryPreview`

**Spécificités** :
- Auto-approve possible avec config (délai: 2s)
- Détecter si query est SELECT (read) ou INSERT/UPDATE/DELETE (write)
- Si write, passer en Niveau 1 (pas d'auto-approve)
- Afficher la query formatée

---

## ⚪ Niveau 7 : Opérations de Notification

### `notify_user`, `update_todos`

**Validation** : ❌ Aucune

**Affichage** : Notification directement dans l'UI

---

## Composants Réutilisables

### Composants de Base

1. **ValidationContainer** : Container commun pour tous les previews
   - Bordure colorée selon niveau de risque
   - Header avec icône et titre
   - Footer avec actions (Approve/Reject/Edit)

2. **FileLink** : Lien clickable vers fichier (voir ROADMAP_CLICKABLE_LINKS.md)

3. **CountdownTimer** : Compte à rebours pour auto-approve
   - Affiche le temps restant
   - Permet d'annuler avec n'importe quelle touche

4. **ActionButtons** : Boutons d'action standardisés
   - Navigation avec flèches
   - Sélection avec Enter
   - Raccourcis clavier (A/R/E)

---

## Gestion des Cas Limites

### Fichiers Très Gros

- **read_file** fichier entier > 10MB : Avertir et suggérer un range
- **Diff** très longue > 1000 lignes : Tronquer avec option "Voir plus"
- **Preview** très long : Limiter à N lignes avec pagination

### Opérations Longues

- **ingest_directory** : Animation spéciale pendant l'exécution
- **generate_3d** : Afficher la progression si possible
- **plan_actions** : Afficher la progression de chaque action

### Erreurs de Calcul de Preview

- Si erreur lors du calcul de diff : Afficher message d'erreur et permettre validation quand même
- Si fichier n'existe pas pour read : Afficher "File not found" et permettre validation
- Si calcul trop lent : Timeout et afficher "Calculating..." avec option d'attendre

### Multiples Validations Simultanées

- Gérer une queue de validations
- Afficher une seule validation à la fois
- Indiquer "X more validations pending"

---

## Tests par Outil

### Tests à Effectuer pour Chaque Outil

1. **Preview correct** : Le preview affiche les bonnes informations
2. **Lien clickable** : Le lien fonctionne et ouvre le bon fichier
3. **Auto-approve** : Respecte la config (délai, activation)
4. **Validation manuelle** : Approve/Reject fonctionnent
5. **Historique** : Affichage correct après exécution
6. **Cas limites** : Fichiers gros, erreurs, etc.

---

## Notes d'Implémentation

### Ordre de Priorité

1. **Niveau 1** (Destructif) : Priorité maximale, sécurité critique
2. **Niveau 2** (Modification) : Priorité haute, impact visible
3. **Niveau 3** (Lecture) : Priorité moyenne, UX importante
4. **Niveau 5** (Génération) : Priorité moyenne, coût/temps importants
5. **Niveau 6** (Planification) : Priorité basse, complexité élevée

### Réutilisabilité

- Les composants de preview doivent être réutilisables
- Un système de "preview types" permet de mapper outil → composant
- Configuration centralisée pour éviter la duplication

---

## Conclusion

Ce design garantit que chaque outil a une validation adaptée à son niveau de risque et son impact, avec une configuration flexible qui permet à l'utilisateur d'adapter le comportement selon ses besoins, tout en maintenant la sécurité par défaut.
