# RagForge - État Actuel

> **Note**: Ce document est un snapshot du 5 décembre 2025. Pour l'état actuel, voir:
> - [7-dec-11h29-2025/README.md](./7-dec-11h29-2025/README.md) - Session du 7 décembre
> - [7-dec-11h29-2025/ROADMAP-AGENT-BRAIN.md](./7-dec-11h29-2025/ROADMAP-AGENT-BRAIN.md) - Brain architecture
> - [MEDIA-TOOLS.md](./MEDIA-TOOLS.md) - Media tools (à jour)

---

# Archive: État au 5 décembre 2025

## Merge Accompli !

**core + runtime → @luciformresearch/ragforge** (package unifié)

- `@luciformresearch/ragforge` - Package principal (était core, contient maintenant tout)
- `@luciformresearch/ragforge-runtime` - Shim qui re-exporte depuis ragforge (backwards compat)
- CLI mis à jour pour importer depuis `@luciformresearch/ragforge`

Voir `TYPE-CONFLICTS-TODO.md` pour le détail des types en conflit et le plan de refactoring.

## Contexte de la Session

On travaillait sur les **media tools** pour l'agent RAG (génération d'images, rendu 3D, reconstruction 3D).

### Ce qui a été fait

1. **Rendu 3D avec Three.js** (session précédente)
   - Fixed perspective camera framing
   - Fixed WebGL race conditions in headless browser
   - Fonctionne: `render_3d_asset` génère des PNG depuis des GLB

2. **Intégration Replicate API**
   - Installé le package `replicate` npm dans core
   - Trellis (image-to-3D): `firtoz/trellis:e8f6c45206993f297372f5436b90350817bd9b4a0d52d2a76df50c1c8afa2b3c`
   - Config: `useFileOutput: false` pour avoir des URLs au lieu de ReadableStreams
   - Input: `images` (array de data URIs), `generate_model: true`
   - **Testé et fonctionnel** - génère des GLB depuis des images

3. **Génération d'images Gemini**
   - Tool `generate_image` avec `gemini-2.5-flash-image-preview`
   - Config: `responseModalities: ['TEXT', 'IMAGE']`
   - **Testé et fonctionnel** - génère des PNG depuis du texte

4. **Intégration dans l'agent RAG**
   - Ajouté `includeMediaTools` option dans `RagAgentOptions`
   - Les image tools et 3D tools sont injectés quand activé
   - Dans `packages/runtime/src/agents/rag-agent.ts`

5. **Tool generate_multiview_images** (en cours)
   - Génère 4 vues cohérentes (front, right, top, perspective) pour reconstruction 3D
   - Utilise un prompt enhancer inspiré de lr-tchatagent-web/PromptEnhancerAgent
   - **Bloqué**: besoin de StructuredLLMExecutor qui est dans runtime, mais on est dans core

### Ce qui reste à faire

1. **Merger core et runtime** (décidé maintenant)
   - Résout les problèmes de dépendances circulaires
   - Un seul package `@luciformresearch/ragforge`

2. **Finir generate_multiview_images**
   - Le code est prêt, juste besoin d'accéder à StructuredLLMExecutor

3. **Tester le workflow complet text-to-3D**
   - Texte → Gemini (4 images multi-vues) → Trellis (reconstruction 3D)

4. **Tester les media tools via l'agent**
   - Demander à l'agent de créer un asset 3D depuis une description

## Structure Actuelle des Packages

```
packages/
├── core/           (31 fichiers .ts)
│   ├── config/     # YAML config loading
│   ├── schema/     # Neo4j schema introspection
│   ├── generator/  # Code generation
│   ├── tools/      # File tools, Image tools, 3D tools
│   ├── computed/   # Computed fields
│   └── types/
│
└── runtime/        (78 fichiers .ts)
    ├── agents/     # RAG agent, code agent
    ├── llm/        # StructuredLLMExecutor, provider adapters
    ├── embedding/  # Embedding generation
    ├── reranking/  # LLM reranking
    ├── query/      # Query execution
    ├── ocr/        # OCR service
    └── types/
```

## Fichiers Clés Modifiés Cette Session

- `packages/core/src/tools/image-tools.ts` - Ajout generate_image, generate_multiview_images
- `packages/core/src/tools/threed-tools.ts` - Fix Replicate/Trellis integration
- `packages/runtime/src/agents/rag-agent.ts` - includeMediaTools option
- `packages/core/src/index.ts` - Exports des nouveaux tools

## Fichiers de Test

- `examples/test-project/.ragforge/generated/test-replicate.ts` - Test render + Trellis
- `examples/test-project/.ragforge/generated/test-generate-image.ts` - Test Gemini image gen
- `examples/test-project/.ragforge/generated/test-render-result.ts` - Test rendu du GLB reconstruit

## Notes Techniques

### Replicate API
```typescript
const replicate = new Replicate({ auth: apiToken, useFileOutput: false });
const output = await replicate.run('firtoz/trellis:...', {
  input: {
    images: dataUris,  // Array de "data:image/png;base64,..."
    generate_model: true,
    texture_size: 1024,
  },
});
const modelUrl = output?.model_file;  // URL du GLB
```

### Gemini Image Generation
```typescript
const { GoogleGenAI } = await import('@google/genai');
const genAI = new GoogleGenAI({ apiKey });
const response = await genAI.models.generateContent({
  model: 'gemini-2.5-flash-image-preview',
  contents: prompt,
  config: { responseModalities: ['TEXT', 'IMAGE'] },
});
const imgPart = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data);
const buffer = Buffer.from(imgPart.inlineData.data, 'base64');
```

## Prochaine Étape Immédiate

**Merger les packages core et runtime en un seul package `@luciformresearch/ragforge`**
