# Agent - Outils Manquants

**Date**: 2025-12-07
**Status**: ✅ IMPLÉMENTÉ
**Priorité**: Haute - Blocages pour agent autonome

> **Note**: Tous ces outils ont été implémentés le 7 décembre 2025.
> - `fs-helpers.ts` + `fs-tools.ts` - Outils système de fichiers
> - `shell-helpers.ts` + `shell-tools.ts` - Outils commandes shell
> - `context-tools.ts` - Outils de contexte

---

## Problème

L'agent actuel a des **blocages critiques** quand :
- Aucun projet n'est encore chargé
- Neo4j est vide (rien à chercher)
- L'agent explore un nouveau codebase
- L'agent doit restructurer du code (rename, move, delete)
- L'agent doit exécuter des commandes (build, test, git)

---

## Outils Actuels

| Catégorie | Outils | Status |
|-----------|--------|--------|
| **File** | `read_file`, `write_file`, `edit_file`, `install_package` | ✅ |
| **Brain** | `ingest_directory`, `brain_search`, `forget_path`, `ingest_web_page` | ✅ |
| **Project** | `create_project`, `setup_project`, `ingest_code`, `generate_embeddings`, `load_project` | ✅ |
| **RAG** | `query_entities`, `semantic_search`, `get_schema`, `explore_relationships` | ✅ |
| **Image** | `generate_image`, `read_image`, `describe_image`, `list_images`, `generate_multiview_images` | ✅ |
| **3D** | `render_3d_asset`, `generate_3d_from_image`, `generate_3d_from_text` | ✅ |
| **Web** | `fetch_web_page`, `ingest_web_page` (avec depth récursif) | ✅ |
| **Multi-projet** | `list_projects`, `switch_project`, `unload_project` | ✅ |

---

## Outils Implémentés ✅

### 1. Exploration du système de fichiers

| Outil | Description | Status |
|-------|-------------|--------|
| `list_directory` | Lister les fichiers d'un répertoire (équivalent `ls`) | ✅ |
| `glob_files` | Trouver des fichiers par pattern (`*.ts`, `src/**/*.vue`) | ✅ |
| `file_exists` | Vérifier si un fichier/répertoire existe | ✅ |
| `get_file_info` | Métadonnées d'un fichier (taille, date modif, type) | ✅ |
| `get_working_directory` | Connaître le pwd actuel | ✅ |

**Fichiers**: `fs-helpers.ts`, `fs-tools.ts`

### 2. Manipulation de fichiers

| Outil | Description | Status |
|-------|-------------|--------|
| `delete_path` | Supprimer un fichier ou répertoire | ✅ |
| `create_directory` | Créer un répertoire vide | ✅ |
| `move_file` | Déplacer/renommer un fichier | ✅ |
| `copy_file` | Copier un fichier | ✅ |

**Fichiers**: `fs-helpers.ts`, `fs-tools.ts`

### 3. Exécution de commandes

| Outil | Description | Status |
|-------|-------------|--------|
| `run_command` | Exécuter une commande shell (avec whitelist) | ✅ |
| `run_npm_script` | Raccourci pour `npm run <script>` | ✅ |
| `git_status` | Voir l'état git | ✅ |
| `git_diff` | Voir les changements git | ✅ |
| `list_safe_commands` | Lister les commandes whitelistées | ✅ |

**Fichiers**: `shell-helpers.ts`, `shell-tools.ts`

### 4. Outils de contexte

| Outil | Description | Status |
|-------|-------------|--------|
| `get_working_directory` | Connaître le contexte actuel | ✅ |
| `get_environment_info` | Info sur l'environnement (node, os, tools) | ✅ |
| `get_project_info` | Info sur le projet (package.json, config) | ✅ |

**Fichiers**: `context-tools.ts`

---

## Détail des Implémentations

### `list_directory`

```typescript
{
  name: 'list_directory',
  description: `List files and directories in a given path.

Returns file names, types (file/directory), and sizes.
Use this to explore a new codebase or check what exists.

Parameters:
- path: Directory to list (default: project root or cwd)
- recursive: Include subdirectories (default: false)
- show_hidden: Include hidden files (default: false)

Example: list_directory({ path: "src" })`,
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Directory path' },
      recursive: { type: 'boolean', description: 'Include subdirs' },
      show_hidden: { type: 'boolean', description: 'Include .files' },
    },
  },
}
```

**Résultat type**:
```json
{
  "path": "src",
  "entries": [
    { "name": "index.ts", "type": "file", "size": 1234 },
    { "name": "utils", "type": "directory" },
    { "name": "config.json", "type": "file", "size": 567 }
  ],
  "total_files": 2,
  "total_dirs": 1
}
```

### `glob_files`

```typescript
{
  name: 'glob_files',
  description: `Find files matching a glob pattern.

Useful to find all files of a type or in a specific location.
Does NOT read file contents - just returns paths.

Parameters:
- pattern: Glob pattern (e.g., "**/*.ts", "src/**/*.vue")
- cwd: Base directory for pattern (default: project root)
- ignore: Patterns to ignore (default: node_modules, .git)

Example: glob_files({ pattern: "**/*.ts" })
Example: glob_files({ pattern: "src/components/*.vue" })`,
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern' },
      cwd: { type: 'string', description: 'Base directory' },
      ignore: { type: 'array', items: { type: 'string' } },
    },
    required: ['pattern'],
  },
}
```

### `run_command`

```typescript
{
  name: 'run_command',
  description: `Execute a shell command.

⚠️ SECURITY: Only allows safe commands from a whitelist:
- npm/yarn/pnpm: install, run, test, build, lint
- git: status, diff, log, add, commit (NOT push, force)
- file ops: ls, cat, head, tail, wc
- other: echo, pwd, which

For dangerous commands, ask the user for confirmation first.

Parameters:
- command: Shell command to run
- cwd: Working directory (default: project root)
- timeout: Max execution time in ms (default: 30000)

Example: run_command({ command: "npm run build" })
Example: run_command({ command: "git status" })`,
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Command to execute' },
      cwd: { type: 'string', description: 'Working directory' },
      timeout: { type: 'number', description: 'Timeout in ms' },
    },
    required: ['command'],
  },
}
```

**Whitelist de commandes** (approche sécurisée):

```typescript
const SAFE_COMMANDS = {
  // Package managers
  npm: ['install', 'ci', 'run', 'test', 'build', 'lint', 'start', 'init'],
  yarn: ['install', 'run', 'test', 'build', 'lint', 'start'],
  pnpm: ['install', 'run', 'test', 'build', 'lint', 'start'],

  // Git (read-only + safe writes)
  git: ['status', 'diff', 'log', 'show', 'branch', 'add', 'commit', 'stash'],

  // File inspection
  ls: true,
  cat: true,
  head: true,
  tail: true,
  wc: true,
  find: true,
  grep: true,

  // Environment
  pwd: true,
  which: true,
  echo: true,
  env: true,

  // Build tools
  tsc: true,
  node: true,
  npx: true,
};

// DANGEROUS - require user confirmation
const DANGEROUS_PATTERNS = [
  /rm\s+-rf/,
  /git\s+push.*--force/,
  /git\s+reset\s+--hard/,
  /sudo/,
  /chmod\s+777/,
  /curl.*\|.*sh/,
  /wget.*\|.*sh/,
];
```

### `delete_file`

```typescript
{
  name: 'delete_file',
  description: `Delete a file or empty directory.

⚠️ Cannot delete non-empty directories (use with caution).
The deletion is tracked and the file is removed from Neo4j.

Parameters:
- path: File or empty directory to delete

Example: delete_file({ path: "src/old-file.ts" })`,
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to delete' },
    },
    required: ['path'],
  },
}
```

### `move_file`

```typescript
{
  name: 'move_file',
  description: `Move or rename a file/directory.

Creates parent directories if needed.
Updates Neo4j to reflect the new path.

Parameters:
- source: Current file/directory path
- destination: New path

Example: move_file({ source: "src/utils.ts", destination: "src/lib/utils.ts" })
Example: move_file({ source: "src/old-name.ts", destination: "src/new-name.ts" })`,
  inputSchema: {
    type: 'object',
    properties: {
      source: { type: 'string', description: 'Source path' },
      destination: { type: 'string', description: 'Destination path' },
    },
    required: ['source', 'destination'],
  },
}
```

### `get_working_directory`

```typescript
{
  name: 'get_working_directory',
  description: `Get the current working directory and project context.

Returns:
- cwd: Current working directory
- project_loaded: Whether a RagForge project is loaded
- project_path: Path to loaded project (if any)
- neo4j_connected: Whether Neo4j is connected

Example: get_working_directory()`,
  inputSchema: {
    type: 'object',
    properties: {},
  },
}
```

---

## Implémentation ✅ DONE

### Fichiers créés

| Fichier | Description |
|---------|-------------|
| `packages/core/src/tools/fs-helpers.ts` | Helpers bas niveau (listDirectory, globFiles, deletePath, moveFile, copyFile, etc.) |
| `packages/core/src/tools/fs-tools.ts` | Outils agent pour le file system (8 outils) |
| `packages/core/src/tools/shell-helpers.ts` | Helpers commandes (whitelist, validation, exécution) |
| `packages/core/src/tools/shell-tools.ts` | Outils agent pour shell (5 outils) |
| `packages/core/src/tools/context-tools.ts` | Outils agent pour contexte (3 outils) |

### Fichiers modifiés

| Fichier | Modification |
|---------|--------------|
| `packages/core/src/index.ts` | Exports des nouveaux outils |
| `packages/core/src/runtime/agents/rag-agent.ts` | Intégration des outils (activés par défaut) |

### Options RagAgentOptions ajoutées

```typescript
// Activés par défaut
includeFsTools?: boolean;      // list_directory, glob_files, delete_path, etc.
includeShellTools?: boolean;   // run_command, git_status, git_diff
includeContextTools?: boolean; // get_working_directory, get_environment_info

// Callback pour confirmation
onShellConfirmation?: (command: string, reason: string) => Promise<boolean>;
```

---

## Alternatives Considérées

### Pour `run_command`

**Option A**: Whitelist stricte (recommandée)
- Liste de commandes autorisées
- Pattern matching pour rejeter les commandes dangereuses
- Simple, prévisible

**Option B**: Sous-agent de validation
- Un LLM secondaire analyse la commande
- Plus flexible mais plus lent
- Risque de false positives/negatives

**Option C**: Mode interactif avec confirmation
- Demande toujours confirmation à l'utilisateur
- Plus sûr mais moins autonome
- Bon pour les commandes non-whitelistées

**Décision**: Option A + Option C pour les commandes hors whitelist.

---

## Liens

- [RAGFORGE-AGENT-CLI.md](./RAGFORGE-AGENT-CLI.md) - Architecture agent
- [ROADMAP-AGENT-INTEGRATION.md](./7-dec-11h29-2025/ROADMAP-AGENT-INTEGRATION.md) - Intégration
