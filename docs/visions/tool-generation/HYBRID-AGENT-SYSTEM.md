# Hybrid Agent Tool System

> Exposer notre API fluide/lisible à l'agent au lieu de générer du Cypher brut

## Vision

**Objectif**: Donner à l'agent une API simple et générique qu'il peut utiliser pour interroger n'importe quelle base RagForge, avec le schéma correspondant pour savoir quoi y mettre.

**Pas text2cypher** - Le LLM ne génère pas de Cypher (complexe, erreurs possibles). Il utilise notre API fluide:

```typescript
// L'agent appelle ceci (simple, lisible, typé)
query({
  entity: "Scope",
  filters: { type: "function", name: { contains: "auth" } },
  expand: ["CONSUMES"],
  semantic: { query: "authentication logic", index: "source" },
  limit: 10
})
```

**Avec le schéma** - L'agent sait exactement ce qui est disponible:
```json
{
  "entities": ["Scope", "File", "ExternalLibrary"],
  "Scope": {
    "fields": ["name", "type", "file", "source", "uuid"],
    "unique": "uuid",
    "relationships": {
      "CONSUMES": "Scope",
      "DEFINED_IN": "File",
      "HAS_PARENT": "Scope"
    },
    "semantic_indexes": {
      "source": "scopeSourceEmbeddings"
    }
  }
}
```

---

## Ce qui existe déjà

### 1. Tool Generator (`packages/core/src/tools/tool-generator.ts`)

Génère des outils depuis la config:

```typescript
import { generateToolsFromConfig } from '@luciformresearch/ragforge-core';

const { tools, handlers } = generateToolsFromConfig(config, {
  includeSemanticSearch: true,
  includeRelationships: true,
});
```

**Outils générés:**
- `query_entities` - Requête structurée avec WHERE, ORDER BY, GLOB/REGEX
- `semantic_search` - Recherche vectorielle
- `explore_relationships` - Traversée de graphe
- `get_entity_by_id` - Récupérer par ID unique

### 2. Query Builder généré (`queries/scope.ts`)

```typescript
// Ce qu'on génère pour chaque entité
class ScopeQuery extends QueryBuilder<Scope> {
  where(filter: ScopeFilter): this;
  whereName(value: string): this;
  whereNameIn(values: string[]): this;
  semanticSearchBySource(query: string, options?): this;
  withConsumes(depth?: number): this;
  withDefinedIn(depth?: number): this;
  whereConsumesScope(scopeName: string): this;
  // ... etc
}
```

### 3. Tool Registry (`packages/runtime/src/agents/tools/tool-registry.ts`)

Auto-registration depuis n'importe quel client généré.

---

## Ce qui manque

### 1. Outil `get_schema` (Discovery)

L'agent doit pouvoir découvrir ce qui existe:

```typescript
{
  name: 'get_schema',
  description: 'Get available entities, fields, relationships and indexes',
  parameters: {},
  execute: async () => {
    return {
      entities: config.entities.map(e => ({
        name: e.name,
        fields: e.searchable_fields.map(f => ({ name: f.name, type: f.type })),
        unique_field: e.unique_field,
        relationships: e.relationships?.map(r => ({
          type: r.type,
          target: r.target,
          direction: r.direction
        })),
        semantic_indexes: e.vector_indexes?.map(vi => ({
          name: vi.name,
          source_field: vi.source_field
        }))
      }))
    };
  }
}
```

### 2. Intégration avec `test-tools-basic.ts`

Le problème actuel: `test-tools-basic.ts` définit des outils **manuellement** au lieu d'utiliser `generateToolsFromConfig`.

**Avant (manuel):**
```typescript
const TOOLS = [
  { name: 'search_functions', ... },  // Hardcodé
  { name: 'get_scope_details', ... }, // Hardcodé
];

class CodeSearchToolExecutor {
  async searchFunctions(query) {
    // Implémentation manuelle
  }
}
```

**Après (généré):**
```typescript
import { generateToolsFromConfig } from '@luciformresearch/ragforge-core';
import { loadConfig } from './load-config.js';

const config = await loadConfig();
const { tools, handlers } = generateToolsFromConfig(config);

// Tools prêts à l'emploi avec schéma complet dans les descriptions
```

---

## Architecture proposée

```
┌─────────────────────────────────────────────────────────────────┐
│                        AGENT                                    │
│                                                                 │
│  Reçoit: tools[] avec descriptions riches + schéma             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    GENERATED TOOLS                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ get_schema   │  │query_entities│  │semantic_     │          │
│  │              │  │              │  │search        │          │
│  │ Discovery:   │  │ Filtres:     │  │              │          │
│  │ - entities   │  │ - =, !=, >   │  │ - query      │          │
│  │ - fields     │  │ - CONTAINS   │  │ - entity     │          │
│  │ - relations  │  │ - GLOB/REGEX │  │ - top_k      │          │
│  │ - indexes    │  │ - IN         │  │ - min_score  │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐                            │
│  │explore_      │  │get_entity_   │                            │
│  │relationships │  │by_id         │                            │
│  │              │  │              │                            │
│  │ - start      │  │ - entity     │                            │
│  │ - rel_type   │  │ - id_value   │                            │
│  │ - direction  │  │              │                            │
│  │ - depth      │  │              │                            │
│  └──────────────┘  └──────────────┘                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              GENERATED QUERY BUILDER                            │
│                                                                 │
│  ScopeQuery, FileQuery, etc. avec méthodes fluides             │
│  .where() .semantic() .withConsumes() .limit() .execute()      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        NEO4J                                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Exemple d'interaction agent

```
User: "Quelles fonctions gèrent l'authentification et qu'est-ce qu'elles appellent?"

Agent thinking:
1. D'abord, découvrir le schéma...
   → get_schema()

   Résultat: Scope avec semantic sur "source", relation CONSUMES

2. Recherche sémantique pour "authentication"...
   → semantic_search({
       entity_type: "Scope",
       query: "authentication login JWT token validation",
       top_k: 10
     })

   Résultat: 10 scopes liés à l'auth

3. Filtrer les fonctions uniquement...
   → query_entities({
       entity_type: "Scope",
       conditions: [
         { field: "type", operator: "=", value: "function" },
         { field: "uuid", operator: "IN", value: [...uuids from step 2] }
       ]
     })

   Résultat: 5 fonctions d'authentification

4. Explorer leurs dépendances...
   → explore_relationships({
       start_entity_type: "Scope",
       start_conditions: [{ field: "uuid", operator: "IN", value: [...] }],
       relationship_type: "CONSUMES",
       direction: "outgoing"
     })

Agent response:
"J'ai trouvé 5 fonctions liées à l'authentification:
1. validateJWT - valide les tokens JWT, consomme: jsonwebtoken, UserRepository
2. authenticateUser - flow de login principal, consomme: bcrypt, SessionManager
..."
```

---

## Plan d'implémentation

### Phase 1: get_schema tool

**Fichier**: `packages/core/src/tools/discovery-tools.ts`

```typescript
export function generateDiscoveryTools(config: RagForgeConfig): GeneratedToolDefinition[] {
  return [{
    name: 'get_schema',
    description: 'Get the database schema: entities, fields, relationships, and semantic indexes available for querying.',
    inputSchema: {
      type: 'object',
      properties: {
        entity_filter: {
          type: 'string',
          description: 'Optional: filter to specific entity name'
        }
      }
    }
  }];
}
```

**Tâches:**
- [ ] Créer `discovery-tools.ts`
- [ ] Ajouter `generateDiscoveryTools` à `tool-generator.ts`
- [ ] Inclure par défaut dans `generateToolsFromConfig`

### Phase 2: Intégrer dans test-tools-basic.ts

**Remplacer les outils manuels par les outils générés:**

```typescript
// AVANT
const TOOLS = [...]; // Hardcodé
class CodeSearchToolExecutor { ... } // Manuel

// APRÈS
import { generateToolsFromConfig } from '@luciformresearch/ragforge-core';
import { loadConfig } from './load-config.js';

const config = await loadConfig();
const { tools, handlers } = generateToolsFromConfig(config, {
  includeSemanticSearch: true,
  includeRelationships: true,
  includeDiscovery: true,  // NEW
});

// Créer executor depuis handlers
const executor = createExecutorFromHandlers(handlers, rag);
```

**Tâches:**
- [ ] Modifier `test-tools-basic.ts` pour utiliser `generateToolsFromConfig`
- [ ] Ajouter option `includeDiscovery`
- [ ] Vérifier que les descriptions sont assez riches pour l'agent

### Phase 3: Améliorer les descriptions de tools

Les descriptions actuelles dans `tool-generator.ts` sont bonnes mais pourraient inclure:
- Exemples de valeurs pour les enums (types de Scope, etc.)
- Exemples de queries
- Tips pour l'agent ("use semantic_search first, then filter with query_entities")

### Phase 4: Documentation générée

Générer un fichier `tools-reference.md` ou `agent-tools.json` dans le client généré avec:
- Liste complète des outils
- Schéma détaillé
- Exemples d'utilisation

---

## Fichiers existants à modifier

| Fichier | Modification |
|---------|--------------|
| `packages/core/src/tools/tool-generator.ts` | Ajouter option `includeDiscovery`, importer discovery tools |
| `packages/core/src/tools/types/index.ts` | Ajouter types pour discovery |
| `packages/core/src/index.ts` | Exporter discovery tools |
| `examples/tool-calling-agent/test-tools-basic.ts` | Utiliser `generateToolsFromConfig` au lieu d'outils manuels |

## Nouveaux fichiers à créer

| Fichier | Contenu |
|---------|---------|
| `packages/core/src/tools/discovery-tools.ts` | `generateDiscoveryTools()` |

---

## Avantages vs text2cypher

| Aspect | text2cypher | Notre API fluide |
|--------|-------------|------------------|
| Complexité pour l'agent | Doit apprendre Cypher | API simple et documentée |
| Risque d'erreurs | Syntax Cypher invalide | Validation par types |
| Performance | Variable | Paths optimisés |
| Sécurité | Risque injection | Outils sandboxés |
| Découverte | L'agent doit deviner | `get_schema` explicite |
| Token usage | Schema en prompt | Description dans tool |

---

## Problème identifié: L'agent ne lit pas le contenu complet

### Symptôme

L'agent répond avec des formulations comme "likely...", "probably...", "suggests..." au lieu de donner des réponses précises basées sur le contenu réel.

**Exemple de log:**
```json
{
  "question": "What is the purpose of StructuredLLMExecutor?",
  "toolsUsed": ["get_schema", "semantic_search"],
  "finalAnswer": "The StructuredLLMExecutor is a class, likely related to executing structured calls..."
}
```

### Cause racine

1. `semantic_search` retourne uniquement des **métadonnées** (uuid, name, file, snippet)
2. L'agent ne sait pas quel champ contient le **contenu complet** à lire
3. Pas de moyen efficace de récupérer le contenu de **plusieurs entités à la fois**

### Solution: `content_field` + `get_entities_by_ids`

---

## Nouveau champ de config: `content_field`

Le champ `content_field` indique à l'agent quel champ contient le contenu principal à lire pour comprendre l'entité.

### Configuration

```yaml
entities:
  Scope:
    unique_field: uuid
    display_name_field: name
    query_field: name
    content_field: source      # <-- NEW: contenu complet à lire
    searchable_fields:
      - name: name
        type: string
      - name: source
        type: string
```

**Exemples par domaine:**

| Domaine | Entity | content_field |
|---------|--------|---------------|
| Code | Scope | `source` |
| Documents | Document | `body` ou `content` |
| Products | Product | `description` |
| Articles | Article | `text` |
| Emails | Email | `body` |

### Dans le schéma retourné par `get_schema`

```json
{
  "entities": {
    "Scope": {
      "unique_field": "uuid",
      "display_name_field": "name",
      "query_field": "name",
      "content_field": "source",
      "fields": [...],
      "semantic_indexes": [...]
    }
  },
  "usage_tips": [
    "Use semantic_search to find relevant items (returns metadata + snippet)",
    "Use get_entities_by_ids to fetch full content_field for items you want to understand in detail"
  ]
}
```

---

## Nouvel outil: `get_entities_by_ids`

Récupère plusieurs entités à la fois avec sélection des champs.

### Signature

```typescript
{
  name: 'get_entities_by_ids',
  description: 'Fetch multiple entities by their IDs. Use this to get full content after semantic_search returns snippets.',
  inputSchema: {
    type: 'object',
    properties: {
      entity_type: {
        type: 'string',
        description: 'The entity type to query'
      },
      ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of unique IDs to fetch'
      },
      fields: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional: specific fields to return. If omitted, returns content_field + display_name_field'
      }
    },
    required: ['entity_type', 'ids']
  }
}
```

### Comportement

```typescript
// Si fields n'est pas spécifié, retourne automatiquement:
// - unique_field (toujours)
// - display_name_field
// - content_field (si défini)

get_entities_by_ids({
  entity_type: 'Scope',
  ids: ['uuid1', 'uuid2', 'uuid3']
})
// → [{ uuid: 'uuid1', name: 'foo', source: '...' }, ...]

// Avec fields spécifiques:
get_entities_by_ids({
  entity_type: 'Scope',
  ids: ['uuid1', 'uuid2'],
  fields: ['name', 'file', 'source']
})
// → [{ uuid: 'uuid1', name: 'foo', file: 'bar.ts', source: '...' }, ...]
```

---

## Workflow agent amélioré

```
User: "What is the purpose of StructuredLLMExecutor?"

Agent:
1. get_schema()
   → Apprend: Scope.content_field = "source"

2. semantic_search({ query: "StructuredLLMExecutor purpose", top_k: 5 })
   → Obtient: [{ uuid: 'xxx', name: 'StructuredLLMExecutor', snippet: '...' }]

3. get_entities_by_ids({ entity_type: 'Scope', ids: ['xxx'] })
   → Obtient: [{ uuid: 'xxx', name: 'StructuredLLMExecutor', source: '// Full class source code...' }]

4. Répond avec le VRAI contenu lu, pas des suppositions
```

---

## Architecture mise à jour

```
┌─────────────────────────────────────────────────────────────────┐
│                        GENERATED TOOLS                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ get_schema   │  │query_entities│  │semantic_     │          │
│  │              │  │              │  │search        │          │
│  │ Discovery:   │  │ Filtres:     │  │              │          │
│  │ - entities   │  │ - =, !=, >   │  │ - query      │          │
│  │ - fields     │  │ - CONTAINS   │  │ - entity     │          │
│  │ - relations  │  │ - GLOB/REGEX │  │ - top_k      │          │
│  │ - indexes    │  │ - IN         │  │ - min_score  │          │
│  │ + content_   │  └──────────────┘  │              │          │
│  │   field      │                    │ Returns:     │          │
│  └──────────────┘                    │ metadata +   │          │
│                                      │ snippet only │          │
│  ┌──────────────┐  ┌──────────────┐  └──────────────┘          │
│  │explore_      │  │get_entity_   │                            │
│  │relationships │  │by_id         │  ┌──────────────┐          │
│  │              │  │              │  │get_entities_ │  <-- NEW │
│  │ - start      │  │ - entity     │  │by_ids        │          │
│  │ - rel_type   │  │ - id_value   │  │              │          │
│  │ - direction  │  │              │  │ - ids[]      │          │
│  │ - depth      │  │ Returns:     │  │ - fields[]?  │          │
│  └──────────────┘  │ full entity  │  │              │          │
│                    └──────────────┘  │ Returns:     │          │
│                                      │ full content │          │
│                                      │ for multiple │          │
│                                      └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Plan d'implémentation mis à jour

### Phase 1: Discovery tools ✅ DONE
- [x] Créer `discovery-tools.ts` avec `get_schema` et `describe_entity`
- [x] Intégrer dans `tool-generator.ts`
- [x] Inclure par défaut

### Phase 2: RagAgent ✅ DONE
- [x] Créer `RagAgent` dans `packages/runtime/src/agents/rag-agent.ts`
- [x] Support `toolCallMode: 'native' | 'structured'`
- [x] Support `logPath` pour debugging
- [x] Factory function `createRagAgent()`

### Phase 3: Content Field + Batch Fetch 🚧 IN PROGRESS
- [ ] Ajouter `content_field` au type `EntityConfig`
- [ ] Exposer `content_field` dans `get_schema`
- [ ] Implémenter `get_entities_by_ids` dans `tool-generator.ts`
- [ ] Mettre à jour les descriptions des outils pour guider l'agent

### Phase 4: Agent Prompts
- [ ] Améliorer le system prompt pour guider le workflow
- [ ] Inclure des exemples dans les descriptions d'outils
- [ ] Ajouter des "usage tips" contextuels

---

## Future: Outils composés (streamlined)

Actuellement l'agent doit faire 3 appels séparés:
1. `semantic_search` → IDs + snippets
2. `get_entities_by_ids` → full content
3. `batch_analyze` → LLM analysis sur chaque item

### Idée: `search_and_analyze`

Un outil composé qui fait tout en un:

```typescript
search_and_analyze({
  entity_type: 'Scope',
  query: 'authentication logic',
  top_k: 5,
  analysis_prompt: 'Extract the main purpose and list dependencies',
  output_schema: {
    purpose: 'string',
    dependencies: 'array<string>'
  }
})
```

**Fonctionnement interne:**
1. semantic_search avec query
2. get_entities_by_ids pour récupérer content_field
3. batch LLM call avec analysis_prompt sur chaque item
4. Retourne résultats enrichis

**Avantages:**
- Moins de round-trips agent ↔ tools
- L'agent n'a pas besoin de gérer les IDs intermédiaires
- Plus rapide pour les use cases courants

**À implémenter après validation du workflow de base.**

---

## Questions ouvertes

1. **Caching du schéma**: Le tool `get_schema` devrait-il cacher le résultat?
2. **Suggestions**: Ajouter un outil qui suggère quel outil utiliser selon la question?
3. **Exemples dynamiques**: Inclure des exemples de données réelles dans les descriptions?
4. **Limite de contenu**: Tronquer les `content_field` trop longs? Retourner par chunks?
5. **Outils composés**: Quand implémenter `search_and_analyze`? Après validation du workflow de base.

---

*Created: 2025-12-03*
*Updated: 2025-12-03*
*Status: In Progress (Phase 3)*
*Related: [TOOL-GENERATION-ARCHITECTURE.md](./TOOL-GENERATION-ARCHITECTURE.md)*
