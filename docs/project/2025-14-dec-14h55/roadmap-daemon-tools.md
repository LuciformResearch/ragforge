# Roadmap: Daemon Tool Routing & Content Pipeline

**Date**: 2025-12-14
**Context**: Refonte de l'architecture pour que tous les outils passent par le daemon et unification du pipeline d'analyse/création de contenu.

---

## Problèmes Identifiés

### 1. Tools Image/3D/Web ne passent pas par le Daemon

**État actuel**:
- Les handlers sont **déjà générés dans le daemon** (`daemon.ts` lignes 394-395, 566-567)
- Mais `mcp-server.ts` crée ses propres handlers locaux (lignes 511-548) au lieu de router vers le daemon
- Le callback `onContentExtracted` fait un appel HTTP séparé pour l'ingestion

**Conséquences**:
- Pas d'atomicité : fichier créé → crash possible → ingestion manquée
- Le MCP server doit redémarrer pour voir les changements de code
- Ressources consommées dans le process MCP (blocking)

### 2. Images intermédiaires supprimées dans `generate_3d_from_text`

**État actuel** (`threed-tools.ts` lignes 907-982):
```typescript
const tempDir = pathModule.join(os.tmpdir(), `ragforge-3d-${Date.now()}`);
// ... génère les images dans tempDir ...
// ... génère le modèle 3D ...
await fs.rm(tempDir, { recursive: true }); // SUPPRIME les images !
```

**Conséquences**:
- Impossible de voir les images source utilisées pour la reconstruction 3D
- Pas de traçabilité pour debug ou amélioration
- Les images (coûteuses à générer) sont perdues

### 3. Descriptions pour embeddings pas optimales

**État actuel**:
- Le prompt utilisateur (potentiellement "lazy") est utilisé comme description
- Le prompt enhancer génère un prompt riche mais il n'est pas stocké

**Solution**: Utiliser le **prompt enrichi par le prompt enhancer** (ex: perspective) comme description pour les embeddings.

### 4. Fragmentation des outils d'analyse

**État actuel**:
- `read_file` pour fichiers texte/code
- `analyze_image` / `describe_image` pour images
- `analyze_3d_model` pour 3D

**Solution**: **Tout passer par `read_file`** qui délègue au bon parser selon le type de fichier.

### 5. `generate_image` et `edit_image` sans prompt enhancer

**État actuel**:
- `generate_multiview_images` a un prompt enhancer
- `generate_image` et `edit_image` n'en ont pas (ou pas le même niveau)

**Solution**: Uniformiser le prompt enhancer et le flow d'ingestion.

---

## Architecture Cible

```
┌─────────────────┐     HTTP/6969      ┌─────────────────┐
│   MCP Server    │ ─────────────────► │     Daemon      │
│  (Claude Code)  │                    │  (Background)   │
└─────────────────┘                    └────────┬────────┘
        │                                       │
        │ Route TOUT                            │ Exécute tools
        │ (sauf fs read-only)                   │ Atomic ingestion
        ▼                                       ▼
   FS Tools (read-only)                  Brain + Image + 3D + Web
   Context Tools                         + Création + Edition
```

### Pipeline Unifié pour `read_file`

```
read_file(path)
    │
    ├─► .ts/.js/.py/... → Code Parser → Scope nodes + embeddings
    ├─► .md → Markdown Parser → Section nodes + embeddings
    ├─► .pdf/.docx/.xlsx → Document Parser → Content nodes + embeddings
    ├─► .png/.jpg/... → Image Analyzer (Gemini Vision) → ImageFile + description embedding
    └─► .glb/.gltf → 3D Analyzer (render + describe) → ThreeDFile + description embedding
```

---

## Roadmap

### Phase 1: Router TOUS les Tools via Daemon (Priorité: CRITIQUE)

**Fichiers à modifier**:
- `packages/cli/src/commands/mcp-server.ts`
- `packages/core/src/brain/daemon-client.ts`

**Tâches**:

1. **Étendre `BRAIN_TOOL_NAMES`** dans `daemon-client.ts`:
   ```typescript
   const DAEMON_TOOL_NAMES = [
     // Brain tools (existants)
     'ingest_directory', 'brain_search', ...

     // Image tools - AJOUTER
     'generate_image', 'edit_image',
     'generate_multiview_images',

     // 3D tools - AJOUTER
     'render_3d_asset', 'generate_3d_from_image',
     'generate_3d_from_text',

     // Web tools - AJOUTER
     'search_web', 'fetch_web_page',
   ] as const;
   ```

2. **Supprimer la registration locale** dans `mcp-server.ts` pour ces tools

3. **Router via daemon proxy** comme les brain tools existants

**Note**: `read_file`, `describe_image`, `analyze_visual`, `analyze_3d_model` seront fusionnés dans `read_file` (Phase 4).

**Effort estimé**: 2 heures

---

### Phase 2: Conserver Images Intermédiaires + Prompt Enrichi (Priorité: HAUTE)

**Fichiers à modifier**:
- `packages/core/src/tools/threed-tools.ts`

**Tâches**:

1. **Stocker les images à côté du modèle** (pas dans temp):
   ```typescript
   // output_path: "models/my-model.glb"
   // → images dans: "models/my-model-sources/"
   const sourcesDir = absoluteOutputPath.replace('.glb', '-sources');
   ```

2. **Utiliser le prompt enrichi comme description** pour embeddings:
   ```typescript
   // Le prompt enhancer génère un prompt détaillé pour la perspective
   const enhancedPrompt = multiviewResult.view_prompts.perspective;

   await ctx.onContentExtracted({
     filePath: result3D.absolute_path,
     description: enhancedPrompt,  // PAS le prompt utilisateur !
     extractionMethod: 'ai-generated-3d-from-text',
   });
   ```

3. **Ingérer les images sources** avec leur prompt enrichi respectif:
   ```typescript
   for (const img of multiviewResult.images) {
     await ctx.onContentExtracted({
       filePath: img.absolute_path,
       description: multiviewResult.view_prompts[img.view],  // Prompt enrichi
       extractionMethod: 'ai-generated-multiview',
     });
   }
   ```

4. **Retourner les infos complètes**:
   ```typescript
   return {
     model_path,
     source_images: imagePaths,
     enhanced_prompt: enhancedPrompt,  // Pour debug/référence
     // ...
   };
   ```

**Effort estimé**: 1.5 heures

---

### Phase 3: Abstraction Prompt Enhancer + Modes de Génération (Priorité: HAUTE)

**Fichiers à modifier**:
- `packages/core/src/tools/image-tools.ts`
- Nouveau: `packages/core/src/tools/prompt-enhancers/` (dossier)

**Objectif**: Créer une abstraction pour les prompt enhancers avec des modes spécialisés.

#### 3.1 Modes de Génération Prévus

| Mode | Use Case | Spécificités du Prompt Enhancer |
|------|----------|--------------------------------|
| `logo` | Logos d'entreprise, icônes d'app | Simplicité, vectorisable, fond transparent, mémorable |
| `fantasy_art` | Illustrations, concept art | Détails riches, éclairage dramatique, composition |
| `realistic` | Photos réalistes | Photorealistic, lighting naturel, textures |
| `button` | Boutons UI, call-to-action | Lisibilité, états (hover, active), taille compacte |
| `html_element` | Éléments UI génériques | Clean, web-safe colors, responsive-friendly |
| `general` | Défaut, tout usage | Équilibré, polyvalent |

#### 3.2 Architecture Prompt Enhancer

```typescript
// packages/core/src/tools/prompt-enhancers/types.ts
export type ImageGenerationMode =
  | 'logo'
  | 'fantasy_art'
  | 'realistic'
  | 'button'
  | 'html_element'
  | 'general';

export interface PromptEnhancerConfig {
  mode: ImageGenerationMode;
  systemPrompt: string;      // Instructions spécialisées pour le LLM
  outputSchema: object;      // Schema de sortie (object_description, colors, etc.)
  defaultStyle: string;      // Style par défaut pour ce mode
}

// packages/core/src/tools/prompt-enhancers/index.ts
export async function enhancePrompt(
  basePrompt: string,
  mode: ImageGenerationMode,
  apiKey: string
): Promise<EnhancedPromptResult> {
  const config = getEnhancerConfig(mode);
  // ... utiliser StructuredLLMExecutor avec config.systemPrompt
}
```

#### 3.3 Exemples de System Prompts par Mode

**Mode `logo`**:
```
You are an expert logo designer. Create prompts for simple, memorable, vectorizable logos.
Rules:
- Prefer solid shapes over complex gradients
- Consider how it looks at small sizes (favicon)
- Ensure high contrast for readability
- Suggest transparent or solid color backgrounds
- Think about brand identity (professional, playful, tech, etc.)
```

**Mode `fantasy_art`**:
```
You are a fantasy art director. Create rich, detailed prompts for illustration.
Rules:
- Describe dramatic lighting and atmosphere
- Include composition guidelines (rule of thirds, focal point)
- Suggest color palettes that evoke emotion
- Add environmental details and mood
```

**Mode `button`**:
```
You are a UI/UX designer. Create prompts for clickable button elements.
Rules:
- Keep it simple and readable
- Consider hover/active states if applicable
- Use web-safe, accessible colors
- Ensure text contrast meets WCAG guidelines
- Specify border-radius and shadow preferences
```

#### 3.4 Intégration avec `generate_image`

```typescript
// Nouveaux paramètres
const {
  prompt,
  output_path,
  mode = 'general',              // NEW - mode de génération
  disable_enhance = false        // NEW - désactiver prompt enhancer (default: false = enhancer actif)
} = params;

if (!disable_enhance) {
  const enhanced = await enhancePrompt(prompt, mode, apiKey);
  actualPrompt = enhanced.fullPrompt;
  enhancedDescription = enhanced.description;  // Pour embeddings
} else {
  actualPrompt = prompt;
  enhancedDescription = prompt;  // Prompt brut si enhancer désactivé
}

// Ingestion avec le prompt enrichi
await ctx.onContentExtracted({
  filePath: outputPath,
  description: enhancedDescription,
  metadata: { mode, originalPrompt: prompt }
});
```

#### 3.5 Pas de Tools Wrappés

On garde **un seul tool `generate_image`** avec le paramètre `mode`. Pas de tools séparés (`generate_logo`, etc.) - trop dur à maintenir.

L'agent choisit le mode approprié selon le contexte de la demande utilisateur.

**Effort estimé**: 3-4 heures (abstraction + 2-3 modes initiaux)

---

### Phase 4: Unifier Analyse via `read_file` (Priorité: MOYENNE)

**Fichiers à modifier**:
- `packages/core/src/tools/fs-tools.ts`
- `packages/core/src/brain/brain-manager.ts`

**Objectif**: `read_file` devient le point d'entrée unique pour analyser tout type de fichier.

**Tâches**:

1. **Étendre `read_file`** pour détecter le type et déléguer:
   ```typescript
   async function readFile(path: string) {
     const ext = pathModule.extname(path).toLowerCase();

     switch (ext) {
       case '.png': case '.jpg': case '.jpeg': case '.gif': case '.webp':
         return analyzeImage(path);  // Gemini Vision

       case '.glb': case '.gltf':
         return analyze3DModel(path);  // Render + describe

       case '.pdf':
         return analyzePDF(path);

       default:
         return readTextFile(path);  // Comportement actuel
     }
   }
   ```

2. **Déprécier les tools séparés**:
   - `describe_image` → utiliser `read_file`
   - `analyze_visual` → utiliser `read_file`
   - `analyze_3d_model` → utiliser `read_file`

   Garder temporairement comme alias pour compatibilité.

3. **Ingestion automatique** lors de la lecture:
   - Si le fichier n'est pas dans le graph → l'ingérer
   - Si déjà présent → retourner le contenu existant

**Effort estimé**: 3-4 heures

---

### Phase 5: Router Web Tools via Daemon (Priorité: BASSE)

Même pattern que Phase 1 pour `search_web` et `fetch_web_page`.

**Effort estimé**: 1 heure

---

## Résumé des Priorités

| Phase | Description | Effort | Impact |
|-------|-------------|--------|--------|
| **1** | Router TOUS les tools via Daemon | 2h | **CRITIQUE** - Atomicité, reload |
| **2** | Images intermédiaires + Prompt enrichi pour 3D | 1.5h | **HAUT** - Traçabilité, meilleurs embeddings |
| **3** | Abstraction Prompt Enhancer + Modes (logo, fantasy, realistic, button, html_element) | 3-4h | **HAUT** - Qualité génération, spécialisation |
| **4** | Unifier via read_file | 3-4h | MOYEN - UX simplifiée |
| **5** | Router Web via Daemon | 1h | BAS |

**Total estimé**: ~11-13 heures

---

## Principes Clés

1. **Tout passe par le daemon** (sauf lecture FS pure)
2. **Prompt enrichi = description** pour les embeddings (pas le prompt lazy de l'utilisateur)
3. **Traçabilité**: garder les fichiers intermédiaires, retourner les prompts enrichis
4. **Point d'entrée unique**: `read_file` pour toute analyse de fichier
5. **Atomicité**: création fichier + ingestion dans une même transaction

---

## Quick Win Immédiat

Pour tester le routing daemon sans tout refactorer:

```typescript
// Dans mcp-server.ts, pour generate_3d_from_text:
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === 'generate_3d_from_text') {
    return await callToolViaDaemon('generate_3d_from_text', request.params.arguments);
  }
  // ... reste du code
});
```

Nécessite d'ajouter `'generate_3d_from_text'` à `BRAIN_TOOL_NAMES`.
