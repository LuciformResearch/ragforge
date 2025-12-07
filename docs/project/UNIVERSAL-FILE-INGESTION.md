# Universal File Ingestion

> Design document pour l'ingestion de tous types de fichiers dans le graphe ragforge.
> Date: 2025-12-06

## Contexte

Historiquement, ragforge se concentrait sur TypeScript/Python. On évolue vers un **agent de code généraliste** capable d'ingérer et comprendre tous types de fichiers d'un projet.

> **NOTE**: Le champ `adapter: 'typescript' | 'python' | 'html' | 'auto'` dans `CodeSourceConfig` est legacy et devient irrelevant. L'adapter auto-détecte maintenant les types de fichiers.

## Vue d'ensemble

### Fichiers de code (via @luciformresearch/codeparsers)

| Type | Parser | Statut | Nœuds créés |
|------|--------|--------|-------------|
| TypeScript/TSX | `TypeScriptLanguageParser` | ✅ Done | `File`, `Scope` |
| Python | `PythonLanguageParser` | ✅ Done | `File`, `Scope` |
| HTML | `HTMLDocumentParser` | ✅ Done | `Document`, `Scope` |
| CSS | `CSSParser` | ✅ Done | `Stylesheet`, `CSSRule`, `CSSVariable` |
| SCSS | `SCSSParser` | 🔄 Parser ready | TODO: Graph nodes |
| Vue | `VueParser` | 🔄 Parser ready | TODO: Graph nodes |
| Svelte | `SvelteParser` | 🔄 Parser ready | TODO: Graph nodes |
| Markdown | `MarkdownParser` | 🔄 Parser ready | TODO: Graph nodes |
| Generic code | `GenericCodeParser` | 🔄 Parser ready | TODO: Graph nodes |

### Fichiers de données (via ragforge data-file-parser)

| Type | Extensions | Statut |
|------|------------|--------|
| JSON | `.json` | TODO |
| YAML | `.yaml`, `.yml` | TODO |
| XML | `.xml` | TODO |
| TOML | `.toml` | TODO |
| ENV | `.env`, `.env.*` | TODO |

### Fichiers média (lazy loading)

> Voir [MEDIA-TOOLS.md](./MEDIA-TOOLS.md) pour les outils existants.

| Type | Extensions | À l'ingestion | Lazy (quand agent demande) |
|------|------------|---------------|----------------------------|
| **Images** | `.png`, `.jpg`, `.svg`, `.gif`, `.webp` | Chemin, dimensions, taille | `describe_image` → Gemini Vision |
| **3D** | `.glb`, `.gltf` | Chemin, taille | `render_3d_asset` → images → Gemini Vision |
| **PDF** | `.pdf` | Chemin, nb pages | `read_image` (OCR) ou extraction texte |
| **Vidéo** | `.mp4`, `.webm` | Chemin, durée | Thumbnails → Gemini Vision (futur) |
| **Audio** | `.mp3`, `.wav` | Chemin, durée | Transcription (futur) |

**Principe du lazy loading** : On ne consomme pas l'API Gemini à l'ingestion. On stocke uniquement les métadonnées basiques. L'analyse visuelle/OCR est faite **à la demande** quand l'agent appelle les outils.

---

## Design: Fichiers de données

### Pourquoi dans ragforge et non codeparsers ?

1. **Ce n'est pas du "code"** - JSON/YAML/XML sont des formats de données/config, pas du code avec scopes/fonctions
2. **Parsing trivial** - `JSON.parse()`, lib yaml, `fast-xml-parser` (déjà en dépendance)
3. **Logique métier spécifique** - Ce qu'on extrait est lié à comment ragforge stocke dans Neo4j
4. **Précédent** - `packageJsonFiles` est déjà traité inline dans `code-source-adapter.ts`

### Types

```typescript
// ragforge/packages/core/src/runtime/adapters/data-file-parser.ts

/**
 * Formats de fichiers de données supportés
 */
type DataFormat = 'json' | 'yaml' | 'xml' | 'toml' | 'env';

/**
 * Information sur un fichier de données
 */
interface DataFileInfo {
  uuid: string;
  file: string;
  format: DataFormat;
  hash: string;
  linesOfCode: number;

  /** Contenu brut pour recherche full-text */
  rawContent: string;

  /** Sections de premier niveau (gros blocs) */
  sections: DataSection[];

  /** Références extraites (chemins, URLs, packages...) */
  references: DataReference[];
}

/**
 * Section dans un fichier de données (récursive)
 *
 * Exemple pour { "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }
 * → Section "compilerOptions" contient Section "paths" contient "@/*"
 */
interface DataSection {
  uuid: string;

  /** Chemin complet: "compilerOptions.paths" */
  path: string;

  /** Clé locale: "paths" */
  key: string;

  /** Contenu sérialisé du bloc */
  content: string;

  startLine: number;
  endLine: number;

  /** Niveau d'imbrication (0 = racine) */
  depth: number;

  /** Chemin du parent: "compilerOptions" */
  parentPath?: string;

  /** Sous-sections (récursif) */
  children: DataSection[];

  /** Type de valeur */
  valueType: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
}

/**
 * Référence vers une ressource externe
 */
interface DataReference {
  /** Type de ressource */
  type: 'code' | 'image' | 'directory' | 'url' | 'package' | 'config' | 'file';

  /** Valeur brute: "./src/index.ts" */
  value: string;

  /** Chemin dans le fichier: "services.web.volumes[0]" */
  path: string;

  line: number;

  /** Est-ce un chemin relatif ? */
  isRelative: boolean;
}
```

### Règles de découpage en sous-sections

Créer un sous-scope si :
- C'est un **objet avec ≥ 2 propriétés**
- OU c'est un **array avec ≥ 3 éléments**
- OU le contenu sérialisé fait **> 5 lignes**

Sinon, garder la valeur inline dans le parent.

### Détection des types de références

| Pattern | Type | Exemples |
|---------|------|----------|
| `*.ts`, `*.js`, `*.py`, `*.tsx`, `*.jsx` | `code` | `./src/index.ts` |
| `*.png`, `*.jpg`, `*.svg`, `*.gif`, `*.webp` | `image` | `./assets/logo.png` |
| Se termine par `/` ou pattern glob `**/` | `directory` | `./src/`, `./components/` |
| `http://`, `https://`, `ftp://` | `url` | `https://api.example.com` |
| Dans `dependencies`/`devDependencies` | `package` | `lodash`, `@types/node` |
| `*.json`, `*.yaml`, `*.yml`, `*.xml`, `*.toml` | `config` | `./tsconfig.base.json` |
| Autre chemin relatif `./`, `../` | `file` | `./README.md` |

### Exemples concrets

#### docker-compose.yml

```yaml
services:
  web:
    build: ./app           # → reference: directory
    volumes:
      - ./src:/app/src     # → reference: directory
    env_file:
      - ./.env             # → reference: config
```

Sections créées:
```
📁 (root) depth=0
  📁 services depth=1
    📁 web depth=2
      📄 build → "./app"
      📁 volumes depth=3
      📁 env_file depth=3
```

#### tsconfig.json

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "paths": {
      "@utils/*": ["./src/utils/*"],
      "@components/*": ["./src/components/*"]
    },
    "target": "ES2020"
  }
}
```

Sections créées:
```
📁 (root) depth=0
  📄 extends → "./tsconfig.base.json"  // reference: config
  📁 compilerOptions depth=1
    📁 paths depth=2
      📄 @utils/* → ["./src/utils/*"]     // reference: directory
      📄 @components/* → ["./src/components/*"]
    📄 target → "ES2020"
```

#### package.json (déjà géré, à unifier)

Actuellement traité séparément avec `PackageJsonInfo`. À terme, unifier avec `DataFileInfo` + extraction spéciale des dépendances.

---

## Design: Fichiers média

### Outils existants (voir MEDIA-TOOLS.md)

| Outil | Statut | Description |
|-------|--------|-------------|
| `read_image` | ✅ Done | OCR avec Gemini Vision |
| `describe_image` | ✅ Done | Description visuelle avec Gemini Vision |
| `list_images` | ✅ Done | Liste les images d'un répertoire |
| `generate_image` | ✅ Done | Text → Image (`gemini-2.5-flash-image-preview`) |
| `generate_multiview_images` | ✅ Done | 4 vues cohérentes (prompt enhancer + generate_image × 4) |
| `render_3d_asset` | ✅ Done | GLTF/GLB → Images multi-vues (Three.js/Playwright) |
| `generate_3d_from_image` | ✅ Done | Images → 3D avec Trellis (Replicate) |

> **Note** : `generate_3d_from_text` (MVDream) existe dans le code mais n'est **pas recommandé** car trop cher (~$3/modèle). Utiliser `generate_multiview_images` + `generate_3d_from_image` à la place (~$0.11 total).

### Workflow Text-to-3D existant

```
Text prompt
    ↓ StructuredLLMExecutor + GeminiAPIProvider (gemini-2.0-flash)
    ↓ Génère prompts cohérents pour 4 vues (front, right, top, perspective)
Enhanced view prompts
    ↓ generate_image × 4 (gemini-2.5-flash-image-preview)
4 consistent view images
    ↓ generate_3d_from_image (Trellis via Replicate)
GLB/GLTF model
```

**Fichiers source** :
- `packages/core/src/tools/image-tools.ts` : `generate_image`, `generate_multiview_images`
- `packages/core/src/tools/threed-tools.ts` : `render_3d_asset`, `generate_3d_from_image`, `generate_3d_from_text`

### Types pour fichiers média

```typescript
interface MediaFileInfo {
  uuid: string;
  file: string;
  type: 'image' | '3d' | 'pdf' | 'video' | 'audio';
  hash: string;
  sizeBytes: number;

  /** Métadonnées basiques (extraites à l'ingestion, sans API) */
  metadata: {
    // Images
    width?: number;
    height?: number;
    format?: string;  // png, jpg, svg...

    // 3D
    hasAnimations?: boolean;
    meshCount?: number;

    // PDF
    pageCount?: number;

    // Video/Audio
    duration?: number;  // seconds
    codec?: string;
  };

  /**
   * Analyse lazy (générée à la demande via outils)
   * Stockée pour cache et éviter re-appels API
   */
  analysis?: {
    /** Description visuelle (Gemini Vision) */
    description?: string;

    /** Texte extrait (OCR) */
    extractedText?: string;

    /** Chemins vers previews générées (pour 3D) */
    generatedPreviews?: string[];

    /** Timestamp de l'analyse */
    analyzedAt?: string;

    /** Coût estimé de l'analyse */
    analysisCost?: number;
  };
}
```

### Lazy loading workflow

```
1. INGESTION (rapide, gratuit)
   ├── Scan fichiers média
   ├── Extraire métadonnées basiques (dimensions, taille, etc.)
   └── Créer nœuds MediaFile dans Neo4j

2. AGENT DEMANDE "décris l'image logo.png"
   ├── Check si analysis.description existe
   ├── Si non → appeler describe_image (Gemini Vision)
   ├── Stocker résultat dans analysis
   └── Retourner description

3. AGENT DEMANDE "montre le modèle scene.glb"
   ├── Check si generatedPreviews existe
   ├── Si non → appeler render_3d_asset (Three.js)
   ├── Stocker chemins des previews
   ├── Optionnel: describe_image sur les previews
   └── Retourner description + chemins previews
```

### Coûts API (référence)

| Opération | Coût estimé |
|-----------|-------------|
| `describe_image` / `read_image` | ~$0.001/image |
| `generate_image` | ~$0.002/image |
| `generate_3d_from_image` (Trellis) | ~$0.10/modèle |
| `render_3d_asset` | Gratuit (local) |
| **Text-to-3D complet** | ~$0.11 total |

---

## Design: Nœuds Neo4j

### Nouveaux labels de nœuds

```cypher
// Fichiers média (lazy loading)
(:MediaFile {
  uuid, file, type, hash, sizeBytes,
  // Métadonnées basiques
  width, height, format,           // images
  hasAnimations, meshCount,        // 3D
  pageCount,                       // PDF
  duration, codec                  // video/audio
})

// Analyse lazy (créée à la demande)
(:MediaAnalysis {
  uuid, mediaFileUuid,
  description,          // Gemini Vision
  extractedText,        // OCR
  generatedPreviews,    // Chemins previews 3D
  analyzedAt,
  analysisCost
})

// Fichiers de données
(:DataFile {
  uuid, file, format, hash, linesOfCode, rawContent
})

(:DataSection {
  uuid, path, key, content, startLine, endLine, depth, valueType
})

// Composants Vue/Svelte (extension de Document existant)
(:VueComponent {
  uuid, file, hash, componentName, hasScript, hasStyle, hasTemplate,
  scriptLang, isScriptSetup, props, emits, slots
})

(:SvelteComponent {
  uuid, file, hash, componentName, hasScript, hasStyle,
  props, events, slots
})

// SCSS (extension de Stylesheet)
(:SCSSStylesheet {
  uuid, file, hash, linesOfCode,
  variables, mixins, functions, imports
})

// Markdown
(:MarkdownDocument {
  uuid, file, hash, linesOfCode, title, description,
  wordCount, readingTime
})

(:MarkdownSection {
  uuid, title, level, slug, content, startLine, endLine
})

// Generic code (fallback)
(:GenericFile {
  uuid, file, hash, linesOfCode, languageHint
})

(:GenericScope {
  uuid, name, type, source, startLine, endLine, confidence
})
```

### Nouvelles relations

```cypher
// DataFile → DataSection
(:DataFile)-[:HAS_SECTION]->(:DataSection)
(:DataSection)-[:HAS_CHILD]->(:DataSection)

// Références
(:DataFile)-[:REFERENCES_FILE {path, line}]->(:File|:DataFile|:Document)
(:DataFile)-[:REFERENCES_DIRECTORY {path, line}]->(path: String)
(:DataFile)-[:REFERENCES_URL {path, line}]->(url: String)
(:DataFile)-[:REFERENCES_PACKAGE {path, line}]->(:Package)

// Markdown
(:MarkdownDocument)-[:HAS_SECTION]->(:MarkdownSection)
(:MarkdownSection)-[:PARENT_SECTION]->(:MarkdownSection)
(:MarkdownDocument)-[:LINKS_TO]->(:File|:URL)
(:MarkdownDocument)-[:EMBEDS_IMAGE]->(:Image)

// Vue/Svelte
(:VueComponent)-[:USES_COMPONENT]->(:VueComponent|:Component)
(:VueComponent)-[:IMPORTS]->(:File|:Package)

// Media
(:MediaFile)-[:HAS_ANALYSIS]->(:MediaAnalysis)
(:MediaFile)-[:GENERATED_PREVIEW]->(:MediaFile)  // 3D → images previews
(:File)-[:REFERENCES_MEDIA {line}]->(:MediaFile)
(:MarkdownDocument)-[:EMBEDS_IMAGE]->(:MediaFile)
```

---

## Plan d'implémentation

### Phase 1: Compléter les parsers existants (codeparsers)
- [x] MarkdownParser - parser créé
- [x] GenericCodeParser - parser créé
- [x] VueParser, SvelteParser, SCSSParser - déjà existants

### Phase 2: Intégration dans code-source-adapter
- [x] Ajouter imports des nouveaux parsers
- [x] Ajouter détection de types de fichiers
- [x] Mettre à jour `parseFiles()` pour retourner tous les types
- [ ] Mettre à jour `buildGraph()` pour créer les nœuds

### Phase 3: Data file parser (nouveau)
- [ ] Créer `data-file-parser.ts`
- [ ] Implémenter parsing JSON
- [ ] Implémenter parsing YAML (avec lib `yaml`)
- [ ] Implémenter parsing XML (avec `fast-xml-parser`)
- [ ] Implémenter parsing TOML (avec lib `toml`)
- [ ] Implémenter parsing ENV
- [ ] Extraction récursive des sections
- [ ] Détection des références

### Phase 4: Création des nœuds de graphe
- [ ] DataFile, DataSection nodes
- [ ] VueComponent, SvelteComponent nodes
- [ ] SCSSStylesheet nodes
- [ ] MarkdownDocument, MarkdownSection nodes
- [ ] GenericFile, GenericScope nodes
- [ ] Toutes les relations

### Phase 5: Fichiers média
- [ ] Créer `media-file-parser.ts` (extraction métadonnées basiques)
- [ ] Intégrer détection images (dimensions via sharp ou image-size)
- [ ] Intégrer détection 3D (parse GLTF header)
- [ ] Intégrer détection PDF (nb pages)
- [ ] Créer nœuds MediaFile dans Neo4j
- [ ] Implémenter cache d'analyse lazy (MediaAnalysis)
- [ ] Connecter avec outils existants (describe_image, render_3d_asset)

### Phase 6: Unification
- [ ] Migrer PackageJsonInfo vers DataFileInfo
- [ ] Refactorer les patterns de découverte de fichiers
- [ ] Ajouter configuration pour include/exclude par type
- [ ] Unifier le pipeline d'ingestion (code + data + media)

---

## Fichiers concernés

```
ragforge/packages/core/src/runtime/adapters/
├── code-source-adapter.ts    # Orchestration principale
├── data-file-parser.ts       # NOUVEAU: parsing JSON/YAML/XML/TOML/ENV
├── media-file-parser.ts      # NOUVEAU: métadonnées images/3D/PDF/video
└── types.ts                  # Types partagés

ragforge/packages/core/src/tools/
├── image-tools.ts            # ✅ Existant (read_image, describe_image, generate_image, generate_multiview_images)
└── threed-tools.ts           # ✅ Existant (render_3d_asset, generate_3d_from_image) + generate_3d_from_text (DEPRECATED)

@luciformresearch/codeparsers/src/
├── markdown/                 # ✅ Créé
├── generic/                  # ✅ Créé
├── vue/                      # ✅ Existant
├── svelte/                   # ✅ Existant
└── scss/                     # ✅ Existant
```

---

## Notes

- Le champ `adapter` dans `CodeSourceConfig` est deprecated, utiliser `'auto'`
- Les types legacy `ScopeInfo`/`ScopeFileAnalysis` sont encore utilisés dans code-source-adapter (voir TODO de migration vers `UniversalScope`/`FileAnalysis`)
- `fast-xml-parser` est déjà en dépendance du projet principal
- Les outils média existants sont documentés dans [MEDIA-TOOLS.md](./MEDIA-TOOLS.md)
- Le workflow text-to-3D utilise `gemini-2.0-flash` (prompt enhancer) + `gemini-2.5-flash-image-preview` (images) + Trellis (3D)
- L'analyse lazy des médias permet d'économiser les coûts API Gemini Vision

## Documents liés

- [MEDIA-TOOLS.md](./MEDIA-TOOLS.md) - Outils images et 3D existants
- [CODEPARSERS.md](./CODEPARSERS.md) - Package @luciformresearch/codeparsers
- [HTML-PARSER-DESIGN.md](./HTML-PARSER-DESIGN.md) - Design du parser HTML
