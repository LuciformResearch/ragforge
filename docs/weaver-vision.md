# Weaver: Conversational Config Generator for RagForge

**Date**: 2025-11-02
**Status**: Vision / Future Work

## Concept

**Weaver** est un agent conversationnel dont l'unique but est de guider l'utilisateur vers la création de la configuration RagForge optimale pour son domaine.

## Problème

Créer une config RagForge demande de comprendre:
- La structure de son graphe Neo4j
- Quels champs rendre searchable
- Quelles stratégies de reranking utiliser
- Comment configurer les embeddings
- Quels tools MCP exposer

→ **Courbe d'apprentissage** même avec RagForge

## Solution: Weaver

Un agent qui **pose les bonnes questions** et **génère la config automatiquement**.

## Workflow

```
User: "I want to build a RAG system for my e-commerce store"

Weaver: Great! Let me help you configure RagForge for e-commerce.
        First, do you already have a Neo4j database? (yes/no)

User: "yes"

Weaver: Perfect! What's your Neo4j connection URI?
        (I'll analyze your schema to understand your data)

User: "bolt://localhost:7687"

Weaver: *analyzes schema*

        I found these node types in your database:
        - Product (12,450 nodes)
        - Category (84 nodes)
        - Customer (5,230 nodes)
        - Order (18,920 nodes)

        Which entities do you want to make searchable?

User: "Products mainly, and maybe categories"

Weaver: Got it! For Products, I found these properties:
        - name (string)
        - description (string, long text)
        - price (number)
        - category (string)
        - brand (string)
        - inStock (boolean)
        - rating (number)

        Which ones should be searchable/filterable?

User: "name, category, brand, price range, and only in-stock items"

Weaver: Perfect! Now, do you want semantic search on product
        descriptions? This requires embeddings.

User: "yes"

Weaver: Great! I'll configure a vector index. What embedding model
        are you using? (OpenAI ada-002 / Vertex / Custom)

User: "OpenAI ada-002"

Weaver: Got it (dimension: 1536). Now for reranking strategies,
        which factors matter for product ranking?

        Suggestions based on your schema:
        - Popularity (rating × review count)
        - Price relevance
        - Availability (in-stock boost)
        - Brand preference

        Which ones?

User: "all of them"

Weaver: Perfect! Let me generate your config...

        ✅ Generated ecommerce-rag.config.yaml

        Summary:
        - 2 searchable entities (Product, Category)
        - 5 filterable fields
        - Semantic search on descriptions
        - 4 reranking strategies
        - MCP tools: search_products, get_similar, filter_by_category

        Want to preview the config? (yes/no)

User: "yes"

Weaver: *shows config*

        Looks good? I can also:
        - Add more reranking strategies
        - Configure cross-sell recommendations (BOUGHT_TOGETHER)
        - Add seasonal boosting
        - Set up A/B testing configs

        Or should I generate the framework now?

User: "generate"

Weaver: Running: npx ragforge generate ecommerce-rag.config.yaml

        ✅ Framework generated in ./generated/ecommerce-rag/

        Next steps:
        1. cd generated/ecommerce-rag
        2. npm install
        3. npm run dev

        Your RAG framework is ready! 🎉
```

## Capacités de Weaver

### 1. Schema Analysis
- Se connecte au Neo4j
- Analyse la structure (nodes, relations, propriétés)
- Détecte les patterns (e-commerce, social graph, etc.)
- Suggère les entités à rendre searchable

### 2. Guided Configuration
- Questions contextuelles basées sur le domaine
- Suggestions intelligentes (reranking, index, etc.)
- Validation en temps réel
- Explications pédagogiques

### 3. Config Generation
- Génère la YAML config optimale
- Documente les choix faits
- Suggère des améliorations
- Valide avec RagForge

### 4. Iteration & Refinement
- "Add a reranking strategy for recency"
- "Make the 'tags' field searchable"
- "Generate MCP tool for recommendations"
- Version control des configs

## Architecture

```
┌─────────────────────────────────────────┐
│         Weaver (Conversational AI)      │
│                                         │
│  - Natural language understanding      │
│  - Domain detection                    │
│  - Config generation                   │
│  - Validation                          │
└────────────┬────────────────────────────┘
             │
             ├──────> Neo4j (schema analysis)
             │
             ├──────> RagForge (validation & generation)
             │
             └──────> User (conversation)
```

## Modes d'Interaction

### Mode 1: Conversational (Chat)
```
User: Help me build a RAG for my legal documents
Weaver: *guided conversation*
```

### Mode 2: Quick Start (Prompts)
```
$ npx weaver init
? What domain? legal
? Neo4j URI? bolt://localhost:7687
? Embedding provider? OpenAI
*generates config*
```

### Mode 3: Iterative (Commands)
```
$ npx weaver add-entity Contract
$ npx weaver add-reranker jurisdiction-relevance
$ npx weaver preview
$ npx weaver generate
```

## Intelligence de Weaver

### Domain Detection
```yaml
# Détecte automatiquement le domaine basé sur:
- Noms des nodes (Product → e-commerce)
- Relations (BOUGHT_TOGETHER → e-commerce)
- Properties (jurisdiction → legal)
```

### Smart Suggestions
```typescript
// Si détecte Product + Category:
weaver.suggest({
  reranking: ['popularity', 'price-relevance'],
  relationships: ['SIMILAR_TO', 'IN_CATEGORY'],
  mcpTools: ['search_products', 'get_recommendations']
});

// Si détecte datetime properties:
weaver.suggest({
  reranking: ['recency'],
  filters: ['dateRange']
});
```

### Learning from Examples
```typescript
// Weaver apprend des configs existantes
weaver.learnFrom('examples/code-rag.yaml');
weaver.learnFrom('examples/doc-rag.yaml');

// Utilise les patterns pour suggérer
```

## Technologies

- **LLM**: Claude/GPT pour conversation
- **Schema Analysis**: Neo4j driver + introspection
- **Validation**: RagForge CLI
- **UI**: CLI conversationnel (Inquirer.js) + Web UI optionnelle

## Exemples de Conversations

### E-commerce
```
Weaver: I see you have BOUGHT_TOGETHER relationships.
        Want to add a "frequently bought together" reranker?
User: yes
Weaver: ✅ Added collaborative-filtering reranker
```

### Code RAG
```
Weaver: I notice you have CONSUMES relations forming a dependency graph.
        Should I configure topology-based reranking (PageRank)?
User: yes, and also prefer functions with documentation
Weaver: ✅ Added pagerank + code-quality rerankers
```

### Legal
```
Weaver: Your Contract nodes have 'jurisdiction' property.
        Should I create a jurisdiction-relevance reranker?
User: yes, California law
Weaver: ✅ Configured to boost California contracts
```

## Roadmap

### Phase 1: MVP
- [ ] CLI conversationnel
- [ ] Schema analysis
- [ ] Config generation pour 1 domaine (code-rag)
- [ ] Validation avec RagForge

### Phase 2: Intelligence
- [ ] Domain detection automatique
- [ ] Smart suggestions
- [ ] Learning from examples
- [ ] Multiple domains supportés

### Phase 3: Advanced
- [ ] Web UI
- [ ] Config versioning
- [ ] A/B testing configs
- [ ] Performance predictions

### Phase 4: Ecosystem
- [ ] Config marketplace
- [ ] Community templates
- [ ] Best practices learning
- [ ] Auto-tuning

## Vision Finale

**Weaver + RagForge** = Le stack complet pour RAG sur Neo4j

1. **Weaver** pose les questions → Génère la config
2. **RagForge** prend la config → Génère le framework
3. **Utilisateur** utilise le framework → RAG production-ready

**De "je ne sais pas par où commencer" à "framework prêt à l'emploi" en 5 minutes de conversation** 🚀

## Relation avec RagForge

```
Weaver (UX Layer)
    ↓ generates
Config YAML
    ↓ feeds
RagForge (Technical Layer)
    ↓ generates
Domain-Specific Framework
    ↓ used by
End User / Agent
```

Weaver n'est PAS un remplacement de RagForge, c'est une **interface conversationnelle** pour faciliter la création de configs RagForge.

## Nom "Weaver"

**Pourquoi "Weaver"?**
- Tisse la configuration parfaite pour votre domaine
- Poétique, évoque le craftsmanship
- Complémentaire à "Forge" (weaver + forge = création complète)
- Court, mémorable

**Package naming:**
- `@ragforge/weaver` ou
- `@weaver/cli` (standalone)
