# Chat Adapter - Detailed Roadmap

Cette roadmap détaille l'implémentation du **Chat Adapter** pour supporter des agents conversationnels avec compression hiérarchique.

---

## 🎯 Objectifs

1. **Adapter générique** pour n'importe quel format de chat
2. **Compression hiérarchique** automatique (L1, L2, L3)
3. **Embeddings à la volée** pour nouveaux messages
4. **RAG sur historique** avec semantic search
5. **Compatible avec n'importe quel LLM** (OpenAI, Anthropic, Gemini, etc.)

---

## 📐 Architecture

### Composants existants à réutiliser

```typescript
// ✅ Déjà disponibles
GenericSummarizer       // packages/runtime/src/summarization/generic-summarizer.ts
SummaryStorage         // packages/runtime/src/summarization/summary-storage.ts
VectorSearch           // packages/runtime/src/vector/vector-search.ts
Neo4jClient            // packages/runtime/src/client/neo4j-client.ts
```

### Nouveaux composants à créer

```
packages/runtime/src/
├── adapters/
│   └── chat-adapter.ts                    // ⏳ Nouveau
├── summarization/
│   └── hierarchical-compressor.ts         // ⏳ Nouveau
└── chat/
    ├── session-manager.ts                 // ⏳ Nouveau
    ├── message-store.ts                   // ⏳ Nouveau
    └── context-window-manager.ts          // ⏳ Nouveau
```

---

## 📊 Schéma Neo4j

### Entités de base

```cypher
// ChatSession - Une conversation
(:ChatSession {
  sessionId: STRING,
  createdAt: DATETIME,
  lastActiveAt: DATETIME,
  totalTokens: INTEGER,
  metadata: MAP  // user_id, project_id, etc.
})

// ChatTurn - Un échange (user + assistant)
(:ChatTurn {
  uuid: STRING,
  userMessage: STRING,
  assistantMessage: STRING,
  userTokens: INTEGER,
  assistantTokens: INTEGER,
  timestamp: DATETIME,
  user_embedding: VECTOR[768],      // Embedding du message user
  assistant_embedding: VECTOR[768]  // Embedding de la réponse
})

// SessionSummary - Résumé à différents niveaux
(:SessionSummary {
  uuid: STRING,
  level: STRING,  // 'L1', 'L2', 'L3'
  content: STRING,
  tokens: INTEGER,
  content_embedding: VECTOR[768],
  createdAt: DATETIME,
  coversRangeStart: DATETIME,
  coversRangeEnd: DATETIME
})

// RagReference - Références utilisées dans la réponse
(:RagReference {
  uuid: STRING,
  entityType: STRING,  // 'Scope', 'Document', etc.
  entityId: STRING,
  relevanceScore: FLOAT
})
```

### Relations

```cypher
(:ChatTurn)-[:PART_OF]->(:ChatSession)
(:ChatTurn)-[:USED_REFERENCE]->(:RagReference)
(:RagReference)-[:POINTS_TO]->(:Scope|:Document)  // Dynamic
(:SessionSummary)-[:SUMMARIZES]->(:ChatSession)
(:SessionSummary)-[:COVERS_TURNS]->(:ChatTurn)
(:SessionSummary)-[:PARENT_SUMMARY]->(:SessionSummary)  // L2 -> L1
```

---

## 🛠️ Implémentation Step-by-Step

### Step 1: Chat Adapter (Base)

**Fichier**: `packages/runtime/src/adapters/chat-adapter.ts`

```typescript
export interface ChatAdapterConfig {
  sessionIdField: string;
  userMessageField: string;
  assistantMessageField: string;
  timestampField: string;
  embeddingModel?: string;
}

export class ChatAdapter {
  constructor(
    private client: Neo4jClient,
    private config: ChatAdapterConfig = {
      sessionIdField: 'sessionId',
      userMessageField: 'userMessage',
      assistantMessageField: 'assistantMessage',
      timestampField: 'timestamp'
    }
  ) {}

  /**
   * Créer une nouvelle session de chat
   */
  async createSession(metadata?: Record<string, any>): Promise<string> {
    const sessionId = crypto.randomUUID();

    await this.client.run(`
      CREATE (s:ChatSession {
        sessionId: $sessionId,
        createdAt: datetime(),
        lastActiveAt: datetime(),
        totalTokens: 0,
        metadata: $metadata
      })
    `, { sessionId, metadata: metadata || {} });

    return sessionId;
  }

  /**
   * Ajouter un tour de conversation
   */
  async addChatTurn(
    sessionId: string,
    userMessage: string,
    assistantMessage: string,
    options?: {
      ragReferences?: Array<{ entityType: string; entityId: string; score: number }>;
      metadata?: Record<string, any>;
    }
  ): Promise<string> {
    const turnId = crypto.randomUUID();

    // 1. Calculer tokens (approximation)
    const userTokens = this.estimateTokens(userMessage);
    const assistantTokens = this.estimateTokens(assistantMessage);

    // 2. Créer le turn
    await this.client.run(`
      MATCH (s:ChatSession {sessionId: $sessionId})
      CREATE (t:ChatTurn {
        uuid: $turnId,
        userMessage: $userMessage,
        assistantMessage: $assistantMessage,
        userTokens: $userTokens,
        assistantTokens: $assistantTokens,
        timestamp: datetime()
      })
      CREATE (t)-[:PART_OF]->(s)
      SET s.lastActiveAt = datetime(),
          s.totalTokens = s.totalTokens + $userTokens + $assistantTokens
    `, {
      sessionId,
      turnId,
      userMessage,
      assistantMessage,
      userTokens,
      assistantTokens
    });

    // 3. Ajouter les références RAG si présentes
    if (options?.ragReferences) {
      await this.addRagReferences(turnId, options.ragReferences);
    }

    return turnId;
  }

  /**
   * Récupérer l'historique d'une session
   */
  async getSessionHistory(
    sessionId: string,
    options?: {
      limit?: number;
      includeReferences?: boolean;
    }
  ): Promise<ChatTurn[]> {
    const query = `
      MATCH (t:ChatTurn)-[:PART_OF]->(s:ChatSession {sessionId: $sessionId})
      ${options?.includeReferences ? `
        OPTIONAL MATCH (t)-[:USED_REFERENCE]->(ref:RagReference)
        OPTIONAL MATCH (ref)-[:POINTS_TO]->(entity)
      ` : ''}
      RETURN t
      ${options?.includeReferences ? `, collect({ref: ref, entity: entity}) as references` : ''}
      ORDER BY t.timestamp DESC
      ${options?.limit ? 'LIMIT $limit' : ''}
    `;

    const result = await this.client.run(query, {
      sessionId,
      limit: options?.limit
    });

    return result.records.map(r => ({
      uuid: r.get('t').properties.uuid,
      userMessage: r.get('t').properties.userMessage,
      assistantMessage: r.get('t').properties.assistantMessage,
      timestamp: r.get('t').properties.timestamp,
      references: options?.includeReferences ? r.get('references') : undefined
    }));
  }

  private estimateTokens(text: string): number {
    // Approximation: 1 token ≈ 4 caractères
    return Math.ceil(text.length / 4);
  }

  private async addRagReferences(
    turnId: string,
    references: Array<{ entityType: string; entityId: string; score: number }>
  ): Promise<void> {
    for (const ref of references) {
      const refId = crypto.randomUUID();

      await this.client.run(`
        MATCH (t:ChatTurn {uuid: $turnId})
        MATCH (entity:${ref.entityType} {uuid: $entityId})
        CREATE (r:RagReference {
          uuid: $refId,
          entityType: $entityType,
          entityId: $entityId,
          relevanceScore: $score
        })
        CREATE (t)-[:USED_REFERENCE]->(r)
        CREATE (r)-[:POINTS_TO]->(entity)
      `, {
        turnId,
        refId,
        entityId: ref.entityId,
        entityType: ref.entityType,
        score: ref.score
      });
    }
  }
}
```

**Tests**: `packages/runtime/src/adapters/__tests__/chat-adapter.test.ts`

---

### Step 2: Hierarchical Compressor

**Fichier**: `packages/runtime/src/summarization/hierarchical-compressor.ts`

```typescript
export interface CompressionLevel {
  name: 'L1' | 'L2' | 'L3';
  threshold: number;  // tokens
  chunkSize: number;  // nombre de turns par chunk
}

export interface CompressionConfig {
  levels: CompressionLevel[];
  embeddingModel: string;
  summaryModel: string;
}

export class HierarchicalCompressor {
  private summarizer: GenericSummarizer;
  private storage: SummaryStorage;
  private vectorSearch: VectorSearch;

  constructor(
    private client: Neo4jClient,
    private config: CompressionConfig
  ) {
    this.summarizer = new GenericSummarizer(client, {
      llmProvider: config.summaryModel,
      // ... config
    });
    this.storage = new SummaryStorage(client);
    this.vectorSearch = new VectorSearch(client);
  }

  /**
   * Compresser automatiquement une session
   */
  async compressSession(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);

    // Vérifier si compression nécessaire
    for (const level of this.config.levels) {
      const needsCompression = await this.needsCompression(
        sessionId,
        level
      );

      if (needsCompression) {
        await this.compressToLevel(sessionId, level);
      }
    }
  }

  /**
   * Créer summaries L1 (résumés de chunks de messages)
   */
  private async compressToLevel(
    sessionId: string,
    level: CompressionLevel
  ): Promise<void> {
    if (level.name === 'L1') {
      await this.createL1Summaries(sessionId, level);
    } else if (level.name === 'L2') {
      await this.createL2Summary(sessionId, level);
    } else if (level.name === 'L3') {
      await this.createL3Summary(sessionId, level);
    }
  }

  /**
   * L1: Résumer des chunks de N messages
   */
  private async createL1Summaries(
    sessionId: string,
    level: CompressionLevel
  ): Promise<void> {
    // 1. Récupérer les turns qui n'ont pas encore de L1 summary
    const uncoveredTurns = await this.getUncoveredTurns(sessionId, 'L1');

    // 2. Grouper en chunks
    const chunks = this.chunkArray(uncoveredTurns, level.chunkSize);

    // 3. Créer un summary par chunk
    for (const chunk of chunks) {
      const summary = await this.summarizer.summarizeField(
        'ChatTurn',
        chunk.map(t => ({
          userMessage: t.userMessage,
          assistantMessage: t.assistantMessage
        })),
        {
          strategy: 'CHAT_TURN_SUMMARY',
          maxTokens: 500
        }
      );

      // 4. Stocker le summary avec embedding
      const summaryId = await this.storage.storeSummary({
        entityType: 'ChatSession',
        entityId: sessionId,
        level: 'L1',
        content: summary,
        coversRangeStart: chunk[0].timestamp,
        coversRangeEnd: chunk[chunk.length - 1].timestamp
      });

      // 5. Générer embedding
      await this.vectorSearch.generateEmbeddings('SessionSummary', [
        { uuid: summaryId, content: summary }
      ]);

      // 6. Créer les relations COVERS_TURNS
      await this.linkSummaryToTurns(summaryId, chunk.map(t => t.uuid));
    }
  }

  /**
   * L2: Résumer les summaries L1
   */
  private async createL2Summary(
    sessionId: string,
    level: CompressionLevel
  ): Promise<void> {
    // 1. Récupérer tous les summaries L1
    const l1Summaries = await this.getL1Summaries(sessionId);

    // 2. Créer un meta-summary
    const l2Summary = await this.summarizer.summarizeField(
      'SessionSummary',
      l1Summaries.map(s => ({ content: s.content })),
      {
        strategy: 'META_SUMMARY',
        maxTokens: 1000
      }
    );

    // 3. Stocker
    const summaryId = await this.storage.storeSummary({
      entityType: 'ChatSession',
      entityId: sessionId,
      level: 'L2',
      content: l2Summary,
      coversRangeStart: l1Summaries[0].coversRangeStart,
      coversRangeEnd: l1Summaries[l1Summaries.length - 1].coversRangeEnd
    });

    // 4. Embedding
    await this.vectorSearch.generateEmbeddings('SessionSummary', [
      { uuid: summaryId, content: l2Summary }
    ]);

    // 5. Relations PARENT_SUMMARY
    await this.linkL2ToL1(summaryId, l1Summaries.map(s => s.uuid));
  }

  /**
   * L3: Summary ultra-condensé de toute la session
   */
  private async createL3Summary(
    sessionId: string,
    level: CompressionLevel
  ): Promise<void> {
    const l2Summary = await this.getL2Summary(sessionId);

    const l3Summary = await this.summarizer.summarizeField(
      'SessionSummary',
      [{ content: l2Summary.content }],
      {
        strategy: 'ULTRA_CONDENSED_SUMMARY',
        maxTokens: 200
      }
    );

    const summaryId = await this.storage.storeSummary({
      entityType: 'ChatSession',
      entityId: sessionId,
      level: 'L3',
      content: l3Summary,
      coversRangeStart: l2Summary.coversRangeStart,
      coversRangeEnd: l2Summary.coversRangeEnd
    });

    await this.vectorSearch.generateEmbeddings('SessionSummary', [
      { uuid: summaryId, content: l3Summary }
    ]);

    await this.linkL3ToL2(summaryId, l2Summary.uuid);
  }

  // ... helper methods
}
```

---

### Step 3: Context Window Manager

**Fichier**: `packages/runtime/src/chat/context-window-manager.ts`

```typescript
export class ContextWindowManager {
  constructor(
    private client: Neo4jClient,
    private compressor: HierarchicalCompressor,
    private maxContextTokens: number = 8000
  ) {}

  /**
   * Construire le contexte optimal pour le LLM
   */
  async buildContext(
    sessionId: string,
    currentMessage: string
  ): Promise<{
    messages: ChatTurn[];
    summaries: SessionSummary[];
    totalTokens: number;
  }> {
    let totalTokens = this.estimateTokens(currentMessage);
    let context: any = {
      messages: [],
      summaries: [],
      totalTokens
    };

    // 1. Toujours inclure les N derniers messages
    const recentMessages = await this.getRecentMessages(sessionId, 5);
    context.messages = recentMessages;
    totalTokens += recentMessages.reduce((sum, m) =>
      sum + m.userTokens + m.assistantTokens, 0
    );

    // 2. Si encore de la place, ajouter des summaries pertinents
    if (totalTokens < this.maxContextTokens * 0.7) {
      const relevantSummaries = await this.getRelevantSummaries(
        sessionId,
        currentMessage,
        this.maxContextTokens - totalTokens
      );

      context.summaries = relevantSummaries;
      totalTokens += relevantSummaries.reduce((sum, s) => sum + s.tokens, 0);
    }

    // 3. Si toujours de la place, inclure plus de messages
    if (totalTokens < this.maxContextTokens * 0.8) {
      const moreMessages = await this.getOlderMessages(
        sessionId,
        recentMessages[recentMessages.length - 1].timestamp,
        Math.floor((this.maxContextTokens - totalTokens) / 100)
      );

      context.messages.push(...moreMessages);
      totalTokens += moreMessages.reduce((sum, m) =>
        sum + m.userTokens + m.assistantTokens, 0
      );
    }

    context.totalTokens = totalTokens;
    return context;
  }

  /**
   * RAG semantic search sur summaries
   */
  private async getRelevantSummaries(
    sessionId: string,
    query: string,
    maxTokens: number
  ): Promise<SessionSummary[]> {
    // Générer embedding pour la query
    const queryEmbedding = await this.vectorSearch.generateEmbedding(query);

    // Recherche dans les summaries (priorité L1 > L2 > L3)
    const summaries = await this.client.run(`
      MATCH (s:SessionSummary)-[:SUMMARIZES]->(session:ChatSession {sessionId: $sessionId})
      WITH s, vector.similarity.cosine(s.content_embedding, $queryEmbedding) as score
      WHERE score > 0.7
      RETURN s, score
      ORDER BY
        CASE s.level
          WHEN 'L1' THEN 1
          WHEN 'L2' THEN 2
          WHEN 'L3' THEN 3
        END,
        score DESC
    `, { sessionId, queryEmbedding });

    // Prendre autant que possible sans dépasser maxTokens
    const result: SessionSummary[] = [];
    let tokens = 0;

    for (const record of summaries.records) {
      const summary = record.get('s').properties;
      if (tokens + summary.tokens <= maxTokens) {
        result.push(summary);
        tokens += summary.tokens;
      } else {
        break;
      }
    }

    return result;
  }
}
```

---

### Step 4: Generated Client API

**Configuration**: `ragforge.config.yaml`

```yaml
source:
  type: chat
  adapter: generic

entities:
  - name: ChatTurn
    unique_field: uuid
    searchable_fields:
      - name: userMessage
        type: string
      - name: assistantMessage
        type: string
    vector_indexes:
      - name: userMessageEmbeddings
        field: user_embedding
        source_field: userMessage
        dimension: 768
        similarity: cosine
      - name: assistantMessageEmbeddings
        field: assistant_embedding
        source_field: assistantMessage

  - name: SessionSummary
    unique_field: uuid
    searchable_fields:
      - name: content
        type: string
      - name: level
        type: string
    vector_indexes:
      - name: summaryEmbeddings
        field: content_embedding
        source_field: content
```

**Client généré**:

```typescript
const chat = createRagClient();

// RAG sur messages utilisateur
const relevantUserMessages = await chat.chatTurn()
  .semanticSearchByUserMessage("authentication", { topK: 10 })
  .execute();

// RAG sur réponses assistant
const relevantResponses = await chat.chatTurn()
  .semanticSearchByAssistantMessage("OAuth implementation", { topK: 10 })
  .execute();

// RAG sur summaries L1
const relevantL1 = await chat.sessionSummary()
  .whereLevel('L1')
  .semanticSearchByContent("security best practices", { topK: 5 })
  .execute();

// Créer un nouveau turn
await chat.chatTurnMutations().create({
  uuid: crypto.randomUUID(),
  userMessage: "How do I implement OAuth?",
  assistantMessage: "Here's how...",
  userTokens: 20,
  assistantTokens: 150
});
```

---

## ✅ Testing Strategy

### Unit Tests

```typescript
// packages/runtime/src/adapters/__tests__/chat-adapter.test.ts
describe('ChatAdapter', () => {
  test('creates session', async () => {
    const sessionId = await adapter.createSession();
    expect(sessionId).toBeDefined();
  });

  test('adds chat turn', async () => {
    const turnId = await adapter.addChatTurn(sessionId, "Hello", "Hi!");
    expect(turnId).toBeDefined();
  });

  test('retrieves history', async () => {
    const history = await adapter.getSessionHistory(sessionId);
    expect(history).toHaveLength(1);
  });
});
```

### Integration Tests

```typescript
// Test full compression pipeline
test('compresses session hierarchically', async () => {
  // Create session with 50 turns
  for (let i = 0; i < 50; i++) {
    await adapter.addChatTurn(sessionId, `Message ${i}`, `Response ${i}`);
  }

  // Trigger compression
  await compressor.compressSession(sessionId);

  // Verify L1 summaries created
  const l1Count = await getL1Count(sessionId);
  expect(l1Count).toBeGreaterThan(0);
});
```

---

## 📈 Performance Considerations

1. **Batch embeddings**: Générer embeddings par batch de 10-20 messages
2. **Lazy compression**: Compresser seulement quand threshold atteint
3. **Cache summaries**: Garder L3 en mémoire pour accès rapide
4. **Async processing**: Queue pour compression en background

---

## 🚀 Migration Path

1. **Phase 1**: ChatAdapter seul (1-2 semaines)
2. **Phase 2**: HierarchicalCompressor (1-2 semaines)
3. **Phase 3**: ContextWindowManager (1 semaine)
4. **Phase 4**: Client generation + docs (1 semaine)

**Total**: ~5-7 semaines
