# Vision : Système de Validation Universel pour les Outils

## Vue d'ensemble

Ce document présente la vision d'un système de validation universel pour tous les outils de l'agent, permettant à l'utilisateur de prévisualiser et valider chaque action avant son exécution, avec une configuration flexible par défaut.

## Principe Fondamental

**Par défaut, chaque outil demande validation.** La configuration permet d'adapter ce comportement selon les préférences de l'utilisateur et le type d'opération.

---

## Classification des Outils par Niveau de Risque

### 🔴 Niveau 1 : Opérations Destructives (Validation Obligatoire)

**Caractéristiques** :
- Modifient ou suppriment des données de manière irréversible
- Impact critique sur le projet
- Validation toujours requise (même si config dit auto-approve)

**Outils** :
- `delete_path` : Suppression de fichiers/dossiers
- `write_file` : Écriture complète (écrase le fichier)
- `forget_path` : Suppression de connaissances du brain
- `run_command` avec commandes dangereuses (rm, mv, git push --force, etc.)

**Design de Validation** :
- **Preview** : Afficher ce qui sera supprimé/modifié
- **Diff** : Pour `write_file`, montrer la diff complète
- **Warning** : Message d'avertissement clair
- **Confirmation** : Toujours demander validation explicite
- **Timeout** : Pas d'auto-approve, même avec config

---

### 🟠 Niveau 2 : Opérations de Modification (Validation Recommandée)

**Caractéristiques** :
- Modifient des fichiers ou données
- Impact modéré mais visible
- Validation recommandée par défaut, mais peut être auto-approuvée avec config

**Outils** :
- `edit_file` : Modification partielle de fichier
- `create_file` : Création de nouveau fichier
- `run_command` avec `modifies_files: true` : Commandes qui modifient des fichiers
- `ingest_directory` : Ingestion initiale (longue opération)
- `ingest_web_page` : Ingestion de page web

**Design de Validation** :
- **Preview** : Diff pour `edit_file`, contenu pour `create_file`
- **Diff** : Montrer les changements proposés
- **Lien clickable** : Vers le fichier avant validation
- **Auto-approve** : Possible avec config (délai configurable)
- **Historique** : Afficher la diff appliquée après exécution

---

### 🟡 Niveau 3 : Opérations de Lecture avec Impact (Validation Optionnelle)

**Caractéristiques** :
- Lecture de fichiers ou données
- Peuvent exposer des informations sensibles
- Validation optionnelle selon config

**Outils** :
- `read_file` : Lecture de fichier (entier ou range)
- `grep_files` : Recherche avec résultats de lignes
- `brain_search` : Recherche sémantique avec résultats
- `search_files` : Recherche fuzzy avec résultats
- `read_image` : Lecture OCR d'image
- `describe_image` : Description d'image

**Design de Validation** :
- **Preview** : 
  - Pour `read_file` avec range : Afficher le contenu du range
  - Pour `read_file` fichier entier : Afficher juste le lien
  - Pour `grep/search` : Afficher les premiers résultats avec liens
- **Lien clickable** : Vers chaque fichier mentionné
- **Auto-approve** : Par défaut activé (délai court, 1-2 secondes)
- **Historique** : Afficher les fichiers lus avec liens

---

### 🟢 Niveau 4 : Opérations de Consultation (Pas de Validation)

**Caractéristiques** :
- Consultation pure, pas de modification
- Pas d'impact sur les données
- Pas de validation nécessaire

**Outils** :
- `list_directory` : Liste des fichiers
- `glob_files` : Liste des fichiers matching pattern
- `get_file_info` : Informations sur un fichier
- `git_status` : État git
- `git_diff` : Diff git (lecture seule)
- `get_working_directory` : Info contexte
- `get_environment_info` : Info environnement
- `get_project_info` : Info projet
- `list_brain_projects` : Liste des projets
- `list_watchers` : Liste des watchers
- `query_entities` : Requête base de données (lecture)
- `semantic_search` : Recherche sémantique (lecture)
- `explore_relationships` : Exploration relations (lecture)

**Design de Validation** :
- **Pas de validation** : Exécution directe
- **Affichage** : Résultats directement dans l'historique
- **Liens clickables** : Si résultats contiennent des références de fichiers

---

### 🔵 Niveau 5 : Opérations de Génération/Création (Validation Modérée)

**Caractéristiques** :
- Génèrent de nouveaux fichiers ou ressources
- Impact créatif, pas destructif
- Validation modérée (peut être auto-approuvée)

**Outils** :
- `create_project` : Création de nouveau projet
- `generate_image` : Génération d'image
- `generate_multiview_images` : Génération multi-vues
- `generate_3d_from_image` : Génération 3D depuis image
- `generate_3d_from_text` : Génération 3D depuis texte
- `render_3d_asset` : Rendu 3D

**Design de Validation** :
- **Preview** : 
  - Pour création projet : Afficher la structure qui sera créée
  - Pour génération : Afficher les paramètres et destination
- **Lien clickable** : Vers le répertoire de destination
- **Auto-approve** : Possible avec config (délai moyen, 3-5 secondes)
- **Historique** : Afficher les fichiers créés avec liens

---

### 🟣 Niveau 6 : Opérations de Planification (Validation Complexe)

**Caractéristiques** :
- Planifient plusieurs actions
- Nécessitent une validation multi-niveaux
- Validation du plan global + validation individuelle des actions

**Outils** :
- `plan_actions` : Planification avec sous-agent

**Design de Validation** :
- **Preview du plan** : Afficher toutes les actions planifiées
- **Validation globale** : Approuver/rejeter le plan entier
- **Validation individuelle** : Chaque action du plan peut être validée séparément
- **Auto-approve** : Possible avec config (délai long, 5-10 secondes)
- **Historique** : Afficher le plan exécuté avec résultats

---

### ⚪ Niveau 7 : Opérations de Notification (Pas de Validation)

**Caractéristiques** :
- Notifications ou mises à jour d'état
- Pas d'impact sur les données
- Pas de validation nécessaire

**Outils** :
- `notify_user` : Notification utilisateur
- `update_todos` : Mise à jour de la todo list

**Design de Validation** :
- **Pas de validation** : Exécution directe
- **Affichage** : Notification directement dans l'UI

---

## Matrice de Validation par Outil

| Outil | Niveau | Preview | Diff | Lien | Auto-Approve | Délai Défaut |
|-------|--------|---------|------|------|--------------|--------------|
| `delete_path` | 🔴 1 | ✅ Liste fichiers | ❌ | ✅ | ❌ Toujours | N/A |
| `write_file` | 🔴 1 | ✅ Diff complète | ✅ | ✅ | ❌ Toujours | N/A |
| `forget_path` | 🔴 1 | ✅ Path à oublier | ❌ | ✅ | ❌ Toujours | N/A |
| `edit_file` | 🟠 2 | ✅ Diff partielle | ✅ | ✅ | ✅ Config | 2s |
| `create_file` | 🟠 2 | ✅ Contenu | ❌ | ✅ | ✅ Config | 2s |
| `run_command` (danger) | 🔴 1 | ✅ Commande | ❌ | ❌ | ❌ Toujours | N/A |
| `run_command` (modifie) | 🟠 2 | ✅ Commande | ❌ | ❌ | ✅ Config | 2s |
| `ingest_directory` | 🟠 2 | ✅ Path + message | ❌ | ✅ | ✅ Config | 3s |
| `ingest_web_page` | 🟠 2 | ✅ URL | ❌ | ✅ | ✅ Config | 2s |
| `read_file` (range) | 🟡 3 | ✅ Contenu range | ❌ | ✅ | ✅ Config | 1s |
| `read_file` (entier) | 🟡 3 | ✅ Lien seulement | ❌ | ✅ | ✅ Config | 1s |
| `grep_files` | 🟡 3 | ✅ Premiers résultats | ❌ | ✅ | ✅ Config | 1s |
| `brain_search` | 🟡 3 | ✅ Premiers résultats | ❌ | ✅ | ✅ Config | 1s |
| `search_files` | 🟡 3 | ✅ Premiers résultats | ❌ | ✅ | ✅ Config | 1s |
| `read_image` | 🟡 3 | ✅ Path image | ❌ | ✅ | ✅ Config | 1s |
| `describe_image` | 🟡 3 | ✅ Path image | ❌ | ✅ | ✅ Config | 1s |
| `list_directory` | 🟢 4 | ❌ | ❌ | ❌ | ❌ Pas besoin | N/A |
| `glob_files` | 🟢 4 | ❌ | ❌ | ❌ | ❌ Pas besoin | N/A |
| `file_exists` | 🟢 4 | ❌ | ❌ | ✅ | ❌ Pas besoin | N/A |
| `get_file_info` | 🟢 4 | ❌ | ❌ | ✅ | ❌ Pas besoin | N/A |
| `move_file` | 🟠 2 | ✅ Source→Dest | ❌ | ✅ | ✅ Config | 2s |
| `copy_file` | 🟠 2 | ✅ Source→Dest | ❌ | ✅ | ✅ Config | 2s |
| `create_directory` | 🟢 4 | ❌ | ❌ | ✅ | ❌ Pas besoin | N/A |
| `change_directory` | 🟢 4 | ❌ | ❌ | ❌ | ❌ Pas besoin | N/A |
| `git_status` | 🟢 4 | ❌ | ❌ | ❌ | ❌ Pas besoin | N/A |
| `git_diff` | 🟢 4 | ❌ | ❌ | ✅ | ❌ Pas besoin | N/A |
| `run_npm_script` | 🟠 2 | ✅ Script + args | ❌ | ❌ | ✅ Config | 2s |
| `list_safe_commands` | 🟢 4 | ❌ | ❌ | ❌ | ❌ Pas besoin | N/A |
| `create_project` (brain) | 🔵 5 | ✅ Structure | ❌ | ✅ | ✅ Config | 3s |
| `create_project` (project) | 🔵 5 | ✅ Structure | ❌ | ✅ | ✅ Config | 3s |
| `setup_project` | 🟠 2 | ✅ Options | ❌ | ✅ | ✅ Config | 3s |
| `ingest_code` | 🟠 2 | ✅ Fichiers | ❌ | ✅ | ✅ Config | 2s |
| `generate_embeddings` | 🟠 2 | ✅ Paramètres | ❌ | ❌ | ✅ Config | 2s |
| `load_project` | 🟢 4 | ✅ Path | ❌ | ✅ | ❌ Pas besoin | N/A |
| `exclude_project` | 🟠 2 | ✅ Project ID | ❌ | ❌ | ✅ Config | 1s |
| `include_project` | 🟠 2 | ✅ Project ID | ❌ | ❌ | ✅ Config | 1s |
| `start_watcher` | 🟠 2 | ✅ Project path | ❌ | ✅ | ✅ Config | 1s |
| `stop_watcher` | 🟠 2 | ✅ Project path | ❌ | ✅ | ✅ Config | 1s |
| `brain_read_file` | 🟡 3 | ✅ Contenu | ❌ | ✅ | ✅ Config | 1s |
| `brain_write_file` | 🔴 1 | ✅ Diff | ✅ | ✅ | ❌ Toujours | N/A |
| `brain_create_file` | 🟠 2 | ✅ Contenu | ❌ | ✅ | ✅ Config | 2s |
| `brain_edit_file` | 🟠 2 | ✅ Diff | ✅ | ✅ | ✅ Config | 2s |
| `brain_delete_path` | 🔴 1 | ✅ Liste fichiers | ❌ | ✅ | ❌ Toujours | N/A |
| `set_api_key` | 🟠 2 | ✅ Key name | ❌ | ❌ | ✅ Config | 2s |
| `get_brain_status` | 🟢 4 | ❌ | ❌ | ❌ | ❌ Pas besoin | N/A |
| `cleanup_brain` | 🔴 1 | ✅ Mode + impact | ❌ | ❌ | ❌ Toujours | N/A |
| `get_schema` | 🟢 4 | ❌ | ❌ | ❌ | ❌ Pas besoin | N/A |
| `run_cypher` | 🟠 2 | ✅ Query | ❌ | ❌ | ✅ Config | 2s |
| `generate_image` | 🔵 5 | ✅ Paramètres | ❌ | ✅ | ✅ Config | 3s |
| `edit_image` | 🟠 2 | ✅ Image + prompt | ❌ | ✅ | ✅ Config | 2s |
| `generate_multiview_images` | 🔵 5 | ✅ Paramètres | ❌ | ✅ | ✅ Config | 3s |
| `list_images` | 🟢 4 | ❌ | ❌ | ✅ | ❌ Pas besoin | N/A |
| `analyze_visual` | 🟡 3 | ✅ Path + prompt | ❌ | ✅ | ✅ Config | 1s |
| `generate_3d_from_text` | 🔵 5 | ✅ Paramètres | ❌ | ✅ | ✅ Config | 5s |
| `generate_3d_from_image` | 🔵 5 | ✅ Images + output | ❌ | ✅ | ✅ Config | 3s |
| `render_3d_asset` | 🔵 5 | ✅ Model + views | ❌ | ✅ | ✅ Config | 2s |
| `analyze_3d_model` | 🟡 3 | ✅ Model path | ❌ | ✅ | ✅ Config | 1s |
| `plan_actions` | 🟣 6 | ✅ Plan complet | ❌ | ❌ | ✅ Config | 5s |
| `notify_user` | ⚪ 7 | ❌ | ❌ | ❌ | ❌ Pas besoin | N/A |
| `update_todos` | ⚪ 7 | ❌ | ❌ | ❌ | ❌ Pas besoin | N/A |
| `query_database` | 🟠 2 | ✅ Query SQL | ❌ | ❌ | ✅ Config | 2s |
| `describe_table` | 🟢 4 | ✅ Table name | ❌ | ❌ | ❌ Pas besoin | N/A |
| `list_tables` | 🟢 4 | ❌ | ❌ | ❌ | ❌ Pas besoin | N/A |
| `install_package` | 🟠 2 | ✅ Package name | ❌ | ❌ | ✅ Config | 2s |

---

## Architecture du Système de Validation

### Composants Principaux

1. **ValidationManager** : Gestionnaire centralisé de toutes les validations
2. **Preview Components** : Composants React/Ink pour chaque type de preview
3. **Config System** : Système de configuration par outil
4. **History System** : Système d'historique avec affichage des actions

### Flux de Validation

```
Tool Call
    ↓
ValidationManager.checkRequiresValidation(toolName, args)
    ↓
[Oui] → Calculer Preview → Afficher Preview Component
    ↓
[Config: Auto-Approve] → Compte à rebours → Auto-Approve après délai
[Config: Manual] → Attendre validation utilisateur
    ↓
[Approve] → Exécuter outil → Ajouter à historique
[Reject] → Annuler → Feedback à l'agent
[Edit] → Retour à l'agent avec modifications
```

---

## Configuration par Défaut

### Structure de Configuration

```typescript
interface ValidationConfig {
  // Comportement global
  defaultBehavior: 'require' | 'auto-approve'; // Défaut: 'require'
  defaultDelay: number; // Délai par défaut en ms (défaut: 2000)
  
  // Configuration par outil (override le comportement global)
  tools: {
    [toolName: string]: {
      require?: boolean; // Override global (null = utiliser global)
      delay?: number; // Override délai global
      previewType?: 'diff' | 'content' | 'link' | 'plan' | 'none';
    };
  };
  
  // Configuration par niveau de risque
  riskLevels: {
    destructive: {
      require: boolean; // Toujours true (ignoré si false)
      delay: number; // Ignoré (pas d'auto-approve)
    };
    modification: {
      require: boolean; // Défaut: true
      delay: number; // Défaut: 2000ms
    };
    readWithImpact: {
      require: boolean; // Défaut: false
      delay: number; // Défaut: 1000ms
    };
    generation: {
      require: boolean; // Défaut: true
      delay: number; // Défaut: 3000ms
    };
    planning: {
      require: boolean; // Défaut: true
      delay: number; // Défaut: 5000ms
    };
  };
}
```

### Configuration par Défaut Recommandée

```typescript
const DEFAULT_VALIDATION_CONFIG: ValidationConfig = {
  defaultBehavior: 'require', // Par défaut, demander validation
  defaultDelay: 2000, // 2 secondes par défaut
  
  tools: {
    // Niveau 1 : Toujours valider (override)
    'delete_path': { require: true, delay: 0 }, // Pas d'auto-approve
    'write_file': { require: true, delay: 0 },
    'brain_write_file': { require: true, delay: 0 },
    'forget_path': { require: true, delay: 0 },
    'brain_delete_path': { require: true, delay: 0 },
    'cleanup_brain': { require: true, delay: 0 },
    
    // Niveau 2 : Valider par défaut, mais auto-approve possible
    'edit_file': { require: true, delay: 2000, previewType: 'diff' },
    'brain_edit_file': { require: true, delay: 2000, previewType: 'diff' },
    'create_file': { require: true, delay: 2000, previewType: 'content' },
    'brain_create_file': { require: true, delay: 2000, previewType: 'content' },
    'move_file': { require: true, delay: 2000, previewType: 'move' },
    'copy_file': { require: true, delay: 2000, previewType: 'copy' },
    'ingest_directory': { require: true, delay: 3000, previewType: 'link' },
    'ingest_web_page': { require: true, delay: 2000, previewType: 'link' },
    'ingest_code': { require: true, delay: 2000, previewType: 'ingestion' },
    'setup_project': { require: true, delay: 3000, previewType: 'plan' },
    'generate_embeddings': { require: true, delay: 2000, previewType: 'generation' },
    'run_command': { require: true, delay: 2000, previewType: 'command' },
    'run_npm_script': { require: true, delay: 2000, previewType: 'command' },
    'run_cypher': { require: true, delay: 2000, previewType: 'query' },
    'query_database': { require: true, delay: 2000, previewType: 'query' },
    'install_package': { require: true, delay: 2000, previewType: 'action' },
    'set_api_key': { require: true, delay: 2000, previewType: 'action' },
    'exclude_project': { require: true, delay: 1000, previewType: 'action' },
    'include_project': { require: true, delay: 1000, previewType: 'action' },
    'start_watcher': { require: true, delay: 1000, previewType: 'action' },
    'stop_watcher': { require: true, delay: 1000, previewType: 'action' },
    'edit_image': { require: true, delay: 2000, previewType: 'image_edit' },
    
    // Niveau 3 : Auto-approve par défaut (validation optionnelle)
    'read_file': { require: false, delay: 1000, previewType: 'content' },
    'brain_read_file': { require: false, delay: 1000, previewType: 'content' },
    'grep_files': { require: false, delay: 1000, previewType: 'search_results' },
    'brain_search': { require: false, delay: 1000, previewType: 'search_results' },
    'search_files': { require: false, delay: 1000, previewType: 'search_results' },
    'read_image': { require: false, delay: 1000, previewType: 'image' },
    'describe_image': { require: false, delay: 1000, previewType: 'image' },
    'analyze_visual': { require: false, delay: 1000, previewType: 'analysis' },
    'analyze_3d_model': { require: false, delay: 1000, previewType: 'analysis' },
    
    // Niveau 4 : Pas de validation
    'list_directory': { require: false, delay: 0, previewType: 'none' },
    'glob_files': { require: false, delay: 0, previewType: 'none' },
    'file_exists': { require: false, delay: 0, previewType: 'none' },
    'get_file_info': { require: false, delay: 0, previewType: 'none' },
    'create_directory': { require: false, delay: 0, previewType: 'none' },
    'change_directory': { require: false, delay: 0, previewType: 'none' },
    'git_status': { require: false, delay: 0, previewType: 'none' },
    'git_diff': { require: false, delay: 0, previewType: 'none' },
    'list_safe_commands': { require: false, delay: 0, previewType: 'none' },
    'load_project': { require: false, delay: 0, previewType: 'none' },
    'get_brain_status': { require: false, delay: 0, previewType: 'none' },
    'get_schema': { require: false, delay: 0, previewType: 'none' },
    'list_brain_projects': { require: false, delay: 0, previewType: 'none' },
    'list_watchers': { require: false, delay: 0, previewType: 'none' },
    'get_working_directory': { require: false, delay: 0, previewType: 'none' },
    'get_environment_info': { require: false, delay: 0, previewType: 'none' },
    'get_project_info': { require: false, delay: 0, previewType: 'none' },
    'list_images': { require: false, delay: 0, previewType: 'none' },
    'describe_table': { require: false, delay: 0, previewType: 'none' },
    'list_tables': { require: false, delay: 0, previewType: 'none' },
    
    // Niveau 5 : Valider par défaut
    'create_project': { require: true, delay: 3000, previewType: 'plan' },
    'generate_image': { require: true, delay: 3000, previewType: 'generation' },
    'generate_multiview_images': { require: true, delay: 3000, previewType: 'generation' },
    'generate_3d_from_text': { require: true, delay: 5000, previewType: 'generation' },
    'generate_3d_from_image': { require: true, delay: 3000, previewType: 'generation' },
    'render_3d_asset': { require: true, delay: 2000, previewType: 'generation' },
    
    // Niveau 6 : Valider avec délai long
    'plan_actions': { require: true, delay: 5000, previewType: 'plan' },
    
    // Niveau 7 : Pas de validation
    'notify_user': { require: false, delay: 0, previewType: 'none' },
    'update_todos': { require: false, delay: 0, previewType: 'none' },
  },
  
  riskLevels: {
    destructive: {
      require: true, // Toujours true (ignoré)
      delay: 0 // Ignoré
    },
    modification: {
      require: true,
      delay: 2000
    },
    readWithImpact: {
      require: false, // Auto-approve par défaut
      delay: 1000
    },
    generation: {
      require: true,
      delay: 3000
    },
    planning: {
      require: true,
      delay: 5000
    }
  }
};
```

---

## Design des Composants de Preview

### 1. DiffPreview (Niveau 1 & 2)

**Usage** : `write_file`, `edit_file`

**Contenu** :
- Lien clickable vers le fichier
- Diff colorée (ajouts vert, suppressions rouge)
- Options : Approve / Reject / Edit
- Compte à rebours si auto-approve configuré

### 2. FileReadPreview (Niveau 3)

**Usage** : `read_file` (range ou entier)

**Contenu** :
- Lien clickable vers le fichier
- Pour range : Contenu du range (premiers 20 lignes + "...")
- Pour entier : Message "Full file read requested"
- Options : Approve / Reject
- Compte à rebours si auto-approve configuré

### 3. SearchResultsPreview (Niveau 3)

**Usage** : `grep_files`, `brain_search`, `search_files`

**Contenu** :
- Liste des premiers résultats avec liens clickables
- Pour chaque résultat : fichier:ligne avec lien
- Option "Voir plus" si beaucoup de résultats
- Options : Approve / Reject
- Compte à rebours si auto-approve configuré

### 4. CreationPreview (Niveau 5)

**Usage** : `create_file`, `create_project`, générations

**Contenu** :
- Lien clickable vers le répertoire de destination
- Structure qui sera créée (pour projets)
- Paramètres de génération (pour images/3D)
- Options : Approve / Reject
- Compte à rebours si auto-approve configuré

### 5. PlanPreview (Niveau 6)

**Usage** : `plan_actions`

**Contenu** :
- Liste de toutes les actions planifiées
- Pour chaque action : description, outil, arguments
- Stratégie d'exécution (séquentiel/batch/parallèle)
- Options : Approve Plan / Reject Plan / Edit Plan
- Validation individuelle possible pour chaque action
- Compte à rebours si auto-approve configuré

### 6. DeletionPreview (Niveau 1)

**Usage** : `delete_path`, `forget_path`

**Contenu** :
- Liste des fichiers/chemins qui seront supprimés
- Avertissement clair (rouge, ⚠️)
- Impact estimé (nombre de fichiers, taille)
- Options : Approve / Reject (pas d'auto-approve)
- Pas de compte à rebours (toujours validation manuelle)

---

## Système d'Historique

### Affichage Post-Exécution

Chaque action validée et exécutée doit apparaître dans l'historique avec :

1. **Actions de Modification** :
   - Bloc avec diff appliquée
   - Lien clickable vers le fichier
   - Timestamp
   - Option "Voir diff complète"

2. **Actions de Lecture** :
   - Bloc avec fichiers lus
   - Liens clickables vers chaque fichier
   - Timestamp
   - Option "Voir contenu complet"

3. **Actions de Génération** :
   - Bloc avec fichiers créés
   - Liens clickables vers chaque fichier
   - Timestamp
   - Paramètres utilisés

4. **Actions de Planification** :
   - Bloc avec plan exécuté
   - Résultats de chaque action
   - Timestamp
   - Option "Voir détails"

---

## Intégration avec le TUI

### Workflow dans App.tsx

```typescript
// État pour les validations en attente
const [pendingValidations, setPendingValidations] = useState<Map<string, ValidationState>>(new Map());

// Handler pour les tool calls
const handleToolCall = async (toolName: string, args: Record<string, any>) => {
  const config = getValidationConfig();
  const toolConfig = config.tools[toolName] || {};
  const requiresValidation = toolConfig.require ?? 
    (getRiskLevel(toolName) === 'destructive' ? true : config.defaultBehavior === 'require');
  
  if (!requiresValidation) {
    // Exécution directe
    await executeTool(toolName, args);
    return;
  }
  
  // Calculer le preview
  const preview = await calculatePreview(toolName, args);
  
  // Afficher le preview
  setPendingValidations(prev => {
    const newMap = new Map(prev);
    newMap.set(toolName, {
      toolName,
      args,
      preview,
      autoApprove: !toolConfig.require && config.defaultBehavior === 'auto-approve',
      delay: toolConfig.delay || config.defaultDelay
    });
    return newMap;
  });
};

// Rendu des previews
{pendingValidations.size > 0 && Array.from(pendingValidations.values()).map(validation => (
  <ValidationPreview
    key={validation.toolName}
    validation={validation}
    onApprove={handleApprove}
    onReject={handleReject}
    onEdit={handleEdit}
  />
))}
```

---

## Exemples de Design par Outil

### Exemple 1 : `write_file` (Niveau 1)

```
┌─────────────────────────────────────────────────────────┐
│ ⛧ file:///project/src/utils.ts:1                      │
│                                                         │
│ ⚠️  Modification Preview: src/utils.ts                 │
│                                                         │
│ - export const old = () => {};                        │
│ + export const new = () => {};                        │
│                                                         │
│ → [A]pprove  [R]eject  [E]dit                         │
└─────────────────────────────────────────────────────────┘
```

### Exemple 2 : `read_file` avec range (Niveau 3)

```
┌─────────────────────────────────────────────────────────┐
│ ⛧ file:///project/src/index.ts:10-30                  │
│                                                         │
│ 📖 File Read Request: src/index.ts                      │
│ Lines 10-30:                                            │
│                                                         │
│ function example() {                                    │
│   // ... code ...                                       │
│ }                                                       │
│                                                         │
│ Auto-approving in 1.0s... (Press any key to cancel)    │
│                                                         │
│ → [A]pprove  [R]eject                                   │
└─────────────────────────────────────────────────────────┘
```

### Exemple 3 : `grep_files` (Niveau 3)

```
┌─────────────────────────────────────────────────────────┐
│ 📋 Search Results Preview                               │
│                                                         │
│ Found 15 matches in 3 files:                           │
│                                                         │
│ ⛧ file:///project/src/auth.ts:42                       │
│   const authenticate = () => { ... }                   │
│                                                         │
│ ⛧ file:///project/src/auth.ts:78                        │
│   const login = authenticate;                           │
│                                                         │
│ ⛧ file:///project/src/user.ts:12                       │
│   authenticate(user);                                   │
│                                                         │
│ ... (12 more matches)                                  │
│                                                         │
│ Auto-approving in 0.5s...                              │
│                                                         │
│ → [A]pprove  [R]eject                                   │
└─────────────────────────────────────────────────────────┘
```

### Exemple 4 : `delete_path` (Niveau 1)

```
┌─────────────────────────────────────────────────────────┐
│ ⛧ file:///project/temp/old-file.ts                   │
│                                                         │
│ 🗑️  Deletion Request: temp/old-file.ts                │
│                                                         │
│ ⚠️  WARNING: This will permanently delete:             │
│    - temp/old-file.ts (1 file, 2.3 KB)                 │
│                                                         │
│ This action cannot be undone.                          │
│                                                         │
│ → [A]pprove  [R]eject                                   │
│    (No auto-approve - manual confirmation required)    │
└─────────────────────────────────────────────────────────┘
```

### Exemple 5 : `plan_actions` (Niveau 6)

```
┌─────────────────────────────────────────────────────────┐
│ 📋 Action Plan Preview                                  │
│                                                         │
│ Goal: Create a web app with HTML and CSS               │
│                                                         │
│ Actions:                                                │
│ 1. [write_file] Write index.html                       │
│ 2. [write_file] Write style.css                        │
│ 3. [ingest_directory] Ingest new files                 │
│                                                         │
│ Strategy: batch_when_possible                          │
│                                                         │
│ Auto-approving in 4.2s...                              │
│                                                         │
│ → [A]pprove Plan  [R]eject Plan  [E]dit Plan           │
│    [V]iew individual actions                           │
└─────────────────────────────────────────────────────────┘
```

---

## Configuration Utilisateur

### Fichier de Configuration

```yaml
# ~/.ragforge/validation-config.yaml
validation:
  # Comportement global
  default_behavior: require  # require | auto-approve
  default_delay: 2000  # ms
  
  # Configuration par outil
  tools:
    write_file:
      require: true
      delay: 0  # Pas d'auto-approve
      preview_type: diff
    
    edit_file:
      require: true
      delay: 2000
      preview_type: diff
    
    read_file:
      require: false  # Auto-approve par défaut
      delay: 1000
      preview_type: content
    
    grep_files:
      require: false
      delay: 1000
      preview_type: content
    
    create_project:
      require: true
      delay: 3000
      preview_type: plan
  
  # Configuration par niveau de risque
  risk_levels:
    destructive:
      require: true  # Toujours
      delay: 0
    
    modification:
      require: true
      delay: 2000
    
    read_with_impact:
      require: false
      delay: 1000
    
    generation:
      require: true
      delay: 3000
    
    planning:
      require: true
      delay: 5000
```

---

## Métriques de Succès

- **Transparence** : L'utilisateur voit toujours ce qui va être fait
- **Sécurité** : Les opérations destructives nécessitent toujours validation
- **Flexibilité** : Configuration adaptée à chaque workflow
- **Performance** : Auto-approve pour les opérations sûres
- **UX** : Interface claire et intuitive

---

## Prochaines Étapes

1. **Implémentation du ValidationManager** : Gestionnaire centralisé
2. **Création des Preview Components** : Composants pour chaque type
3. **Système de Configuration** : Chargement et sauvegarde de la config
4. **Intégration dans le TUI** : Workflow complet dans App.tsx
5. **Tests** : Tests pour chaque type de validation

---

## Notes

Cette vision garantit que :
- **Par défaut** : Chaque outil demande validation (sécurité maximale)
- **Configurable** : L'utilisateur peut adapter selon ses besoins
- **Intelligent** : Les niveaux de risque déterminent le comportement
- **Transparent** : Toujours voir ce qui va être fait avant validation
