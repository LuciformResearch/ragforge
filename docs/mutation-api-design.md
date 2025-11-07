# RagForge Mutation API Design

**Status**: Draft
**Date**: 2025-01-06
**Goal**: Add type-safe CRUD operations to RagForge

## Overview

RagForge currently supports READ operations only (queries, semantic search, relationship traversal). This design adds CREATE, UPDATE, and DELETE operations to make RagForge a complete application framework.

---

## Architecture

### Current READ Architecture

```typescript
// Query Builder Pattern (fluent API for reads)
const results = await rag
  .book()                          // EntityQueryBuilder<Book>
  .semanticSearch('fantasy')       // Add semantic operation
  .whereRating({ gt: 4.0 })        // Add filter operation
  .withWrittenBy()                 // Add relationship expansion
  .execute();                      // Execute pipeline → SearchResult<Book>[]
```

**Components**:
- `QueryBuilder<T>` - Base class in runtime
- `BookQuery extends QueryBuilder<Book>` - Generated per entity
- Operations pipeline: `[semantic, filter, expand]`
- `execute()` returns `SearchResult<T>[]`

### Proposed WRITE Architecture

```typescript
// Mutation Builder Pattern (fluent API for writes)
const book = await rag
  .book()                          // BookMutations
  .create({                        // Create operation
    uuid: 'book-123',
    title: 'New Book',
    isbn: '978-...'
  });                              // Returns created Book

await rag
  .book()
  .update('book-123', {            // Update operation
    rating: 4.5
  });

await rag
  .book()
  .delete('book-123');             // Delete operation

await rag
  .book()
  .addRelationship('book-123', {   // Relationship operation
    type: 'WRITTEN_BY',
    target: 'author-456'
  });
```

**Components**:
- `MutationBuilder<T>` - Base class in runtime (NEW)
- `BookMutations extends MutationBuilder<Book>` - Generated per entity (NEW)
- Direct operations (not pipeline-based)
- Methods return the mutated entity or `void`

---

## Design Decisions

### 1. Separate Query vs Mutation Builders

**Decision**: Use separate classes for queries and mutations

**Rationale**:
- Clear separation of concerns (READ vs WRITE)
- Different return types (SearchResult vs Entity)
- Different operation patterns (pipeline vs direct)
- Easier to reason about what code does
- Follows CQRS pattern loosely

**Alternative Considered**: Single builder with both read and write methods
- ❌ Confusing API (when does execute() create vs query?)
- ❌ Return type ambiguity
- ❌ Harder to type correctly

### 2. API Structure

**Option A: Fluent API (chosen)**
```typescript
await rag.book().create({ ... })
await rag.book().update('id', { ... })
await rag.book().delete('id')
```

**Pros**:
- Consistent with query API
- Autocomplete works great
- Type-safe entity selection
- Natural chaining for batch operations

**Option B: Direct methods on client**
```typescript
await rag.createBook({ ... })
await rag.updateBook('id', { ... })
await rag.deleteBook('id')
```

**Pros**:
- Simpler for single operations
- Fewer method calls

**Cons**:
- Method explosion on main client
- Less consistent with query API
- Harder autocomplete (hundreds of methods)

**Decision**: Use Option A (fluent API) for consistency

### 3. Return Values

**Create Operations**:
```typescript
const book = await rag.book().create({ ... });
// Returns: Book (the created entity with all fields)
```

**Update Operations**:
```typescript
const book = await rag.book().update('id', { ... });
// Returns: Book (the updated entity)
```

**Delete Operations**:
```typescript
await rag.book().delete('id');
// Returns: void (or { deleted: boolean })
```

**Batch Operations**:
```typescript
const books = await rag.book().createBatch([...]);
// Returns: Book[] (all created entities)
```

**Rationale**: Returning the entity allows chaining and immediate use without refetching

### 4. Validation Strategy

**Built-in Validations**:
1. **Required fields** - Throw if unique_field is missing
2. **Type checking** - TypeScript types enforce field types
3. **Constraint violations** - Neo4j throws, we catch and wrap

**Optional Validations** (future):
- Field-level validators in YAML config
- Custom validation functions
- Range checks, regex patterns, etc.

**Decision**: Start with basic type + required field validation, extend later

---

## Implementation Plan

### Phase 1: Runtime Foundation

**Create**: `packages/runtime/src/mutations/mutation-builder.ts`

```typescript
import type { Neo4jClient } from '../client/neo4j-client.js';
import type { EntityConfig } from '../types/index.js';

export class MutationBuilder<T = any> {
  constructor(
    protected client: Neo4jClient,
    protected entityType: string,
    protected entityConfig: EntityConfig
  ) {}

  /**
   * Create a new entity
   */
  async create(data: Partial<T>): Promise<T> {
    this.validateRequiredFields(data);

    const cypher = this.buildCreateCypher(data);
    const result = await this.client.run(cypher.query, cypher.params);

    return this.parseEntity(result.records[0]);
  }

  /**
   * Create multiple entities in batch
   */
  async createBatch(items: Partial<T>[]): Promise<T[]> {
    items.forEach(item => this.validateRequiredFields(item));

    const cypher = this.buildBatchCreateCypher(items);
    const result = await this.client.run(cypher.query, cypher.params);

    return result.records.map(r => this.parseEntity(r));
  }

  /**
   * Update an existing entity
   */
  async update(id: string, data: Partial<T>): Promise<T> {
    const cypher = this.buildUpdateCypher(id, data);
    const result = await this.client.run(cypher.query, cypher.params);

    if (result.records.length === 0) {
      throw new Error(`Entity ${this.entityType} with id ${id} not found`);
    }

    return this.parseEntity(result.records[0]);
  }

  /**
   * Delete an entity by ID
   */
  async delete(id: string): Promise<void> {
    const cypher = this.buildDeleteCypher(id);
    await this.client.run(cypher.query, cypher.params);
  }

  /**
   * Add a relationship between two entities
   */
  async addRelationship(
    sourceId: string,
    config: {
      type: string;
      target: string;
      properties?: Record<string, any>;
    }
  ): Promise<void> {
    const cypher = this.buildAddRelationshipCypher(sourceId, config);
    await this.client.run(cypher.query, cypher.params);
  }

  /**
   * Remove a relationship between two entities
   */
  async removeRelationship(
    sourceId: string,
    config: {
      type: string;
      target: string;
    }
  ): Promise<void> {
    const cypher = this.buildRemoveRelationshipCypher(sourceId, config);
    await this.client.run(cypher.query, cypher.params);
  }

  // Private helper methods
  private validateRequiredFields(data: Partial<T>): void {
    const uniqueField = this.entityConfig.unique_field || 'uuid';
    if (!data[uniqueField as keyof T]) {
      throw new Error(`Required field '${uniqueField}' is missing`);
    }
  }

  private buildCreateCypher(data: Partial<T>): { query: string; params: Record<string, any> } {
    const label = this.entityType;
    const properties = this.serializeProperties(data);

    return {
      query: `
        CREATE (n:\`${label}\` $properties)
        RETURN n
      `,
      params: { properties }
    };
  }

  private buildBatchCreateCypher(items: Partial<T>[]): { query: string; params: Record<string, any> } {
    const label = this.entityType;

    return {
      query: `
        UNWIND $items AS item
        CREATE (n:\`${label}\`)
        SET n = item
        RETURN n
      `,
      params: { items: items.map(i => this.serializeProperties(i)) }
    };
  }

  private buildUpdateCypher(id: string, data: Partial<T>): { query: string; params: Record<string, any> } {
    const label = this.entityType;
    const uniqueField = this.entityConfig.unique_field || 'uuid';
    const properties = this.serializeProperties(data);

    return {
      query: `
        MATCH (n:\`${label}\` { ${uniqueField}: $id })
        SET n += $properties
        RETURN n
      `,
      params: { id, properties }
    };
  }

  private buildDeleteCypher(id: string): { query: string; params: Record<string, any> } {
    const label = this.entityType;
    const uniqueField = this.entityConfig.unique_field || 'uuid';

    return {
      query: `
        MATCH (n:\`${label}\` { ${uniqueField}: $id })
        DETACH DELETE n
      `,
      params: { id }
    };
  }

  private buildAddRelationshipCypher(
    sourceId: string,
    config: { type: string; target: string; properties?: Record<string, any> }
  ): { query: string; params: Record<string, any> } {
    const label = this.entityType;
    const uniqueField = this.entityConfig.unique_field || 'uuid';

    const propsClause = config.properties
      ? `SET r = $relProps`
      : '';

    return {
      query: `
        MATCH (source:\`${label}\` { ${uniqueField}: $sourceId })
        MATCH (target { ${uniqueField}: $targetId })
        CREATE (source)-[r:\`${config.type}\`]->(target)
        ${propsClause}
        RETURN r
      `,
      params: {
        sourceId,
        targetId: config.target,
        relProps: config.properties || {}
      }
    };
  }

  private buildRemoveRelationshipCypher(
    sourceId: string,
    config: { type: string; target: string }
  ): { query: string; params: Record<string, any> } {
    const label = this.entityType;
    const uniqueField = this.entityConfig.unique_field || 'uuid';

    return {
      query: `
        MATCH (source:\`${label}\` { ${uniqueField}: $sourceId })
              -[r:\`${config.type}\`]->
              (target { ${uniqueField}: $targetId })
        DELETE r
      `,
      params: { sourceId, targetId: config.target }
    };
  }

  private serializeProperties(data: Partial<T>): Record<string, any> {
    // Convert TypeScript types to Neo4j compatible types
    const serialized: Record<string, any> = {};

    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue;

      // Handle dates
      if (value instanceof Date) {
        serialized[key] = value.toISOString();
      }
      // Handle arrays
      else if (Array.isArray(value)) {
        serialized[key] = value;
      }
      // Handle objects (convert to JSON string or flatten)
      else if (typeof value === 'object' && value !== null) {
        serialized[key] = JSON.stringify(value);
      }
      else {
        serialized[key] = value;
      }
    }

    return serialized;
  }

  private parseEntity(record: any): T {
    const node = record.get('n');
    return node.properties as T;
  }
}
```

### Phase 2: Code Generation

**Modify**: `packages/core/src/generator/code-generator.ts`

Add new method:

```typescript
/**
 * Generate mutation builder for an entity
 */
private static generateMutationBuilder(entity: EntityConfig, config: RagForgeConfig): string {
  const className = `${this.capitalize(entity.name)}Mutations`;
  const entityType = this.capitalize(entity.name);
  const uniqueField = entity.unique_field || 'uuid';
  const displayNameField = entity.display_name_field || 'name';

  const lines: string[] = [];

  // Imports
  lines.push(`import { MutationBuilder } from '@luciformresearch/ragforge-runtime';`);
  lines.push(`import type { ${entityType}, ${entityType}Create, ${entityType}Update } from '../types.js';`);
  lines.push(``);

  // Class definition
  lines.push(`/**`);
  lines.push(` * Mutation operations for ${entityType} entities`);
  lines.push(` */`);
  lines.push(`export class ${className} extends MutationBuilder<${entityType}> {`);
  lines.push(``);

  // Create method (override with entity-specific types)
  lines.push(`  /**`);
  lines.push(`   * Create a new ${entityType}`);
  lines.push(`   */`);
  lines.push(`  async create(data: ${entityType}Create): Promise<${entityType}> {`);
  lines.push(`    return super.create(data);`);
  lines.push(`  }`);
  lines.push(``);

  // Create batch
  lines.push(`  /**`);
  lines.push(`   * Create multiple ${entityType} entities in batch`);
  lines.push(`   */`);
  lines.push(`  async createBatch(items: ${entityType}Create[]): Promise<${entityType}[]> {`);
  lines.push(`    return super.createBatch(items);`);
  lines.push(`  }`);
  lines.push(``);

  // Update method
  lines.push(`  /**`);
  lines.push(`   * Update an existing ${entityType}`);
  lines.push(`   * @param ${uniqueField} - Unique identifier`);
  lines.push(`   * @param data - Fields to update`);
  lines.push(`   */`);
  lines.push(`  async update(${uniqueField}: string, data: ${entityType}Update): Promise<${entityType}> {`);
  lines.push(`    return super.update(${uniqueField}, data);`);
  lines.push(`  }`);
  lines.push(``);

  // Delete method
  lines.push(`  /**`);
  lines.push(`   * Delete a ${entityType} by ${uniqueField}`);
  lines.push(`   * @param ${uniqueField} - Unique identifier`);
  lines.push(`   */`);
  lines.push(`  async delete(${uniqueField}: string): Promise<void> {`);
  lines.push(`    return super.delete(${uniqueField});`);
  lines.push(`  }`);
  lines.push(``);

  // Relationship methods (if entity has relationships)
  if (entity.relationships && entity.relationships.length > 0) {
    for (const rel of entity.relationships) {
      const methodName = this.camelCase(`add_${rel.type}`);
      const targetType = rel.target;

      lines.push(`  /**`);
      lines.push(`   * Add ${rel.type} relationship to ${targetType}`);
      lines.push(`   */`);
      lines.push(`  async ${methodName}(${uniqueField}: string, target${targetType}Id: string${rel.properties ? ', properties?: any' : ''}): Promise<void> {`);
      lines.push(`    return this.addRelationship(${uniqueField}, {`);
      lines.push(`      type: '${rel.type}',`);
      lines.push(`      target: target${targetType}Id${rel.properties ? ',\n      properties' : ''}`);
      lines.push(`    });`);
      lines.push(`  }`);
      lines.push(``);

      const removeMethodName = this.camelCase(`remove_${rel.type}`);
      lines.push(`  /**`);
      lines.push(`   * Remove ${rel.type} relationship to ${targetType}`);
      lines.push(`   */`);
      lines.push(`  async ${removeMethodName}(${uniqueField}: string, target${targetType}Id: string): Promise<void> {`);
      lines.push(`    return this.removeRelationship(${uniqueField}, {`);
      lines.push(`      type: '${rel.type}',`);
      lines.push(`      target: target${targetType}Id`);
      lines.push(`    });`);
      lines.push(`  }`);
      lines.push(``);
    }
  }

  lines.push(`}`);

  return lines.join('\n');
}
```

### Phase 3: Type Generation

**Modify**: `packages/core/src/generator/type-generator.ts`

Add creation and update types:

```typescript
// For each entity, generate:
// 1. Full type (existing)
// 2. Create type (all fields optional except unique_field)
// 3. Update type (all fields optional)

export interface Book {
  uuid: string;      // unique_field (required)
  title: string;
  isbn: string;
  rating?: number;
  // ... other fields
}

// NEW: Create type (unique_field required, others optional)
export interface BookCreate {
  uuid: string;      // Required
  title?: string;
  isbn?: string;
  rating?: number;
}

// NEW: Update type (all optional, uuid not updatable)
export interface BookUpdate {
  title?: string;
  isbn?: string;
  rating?: number;
  // uuid is NOT included (can't update unique identifier)
}
```

### Phase 4: Client Integration

**Modify**: Generated `client.ts` to expose mutation builders

```typescript
export class RagClient {
  private neo4j: Neo4jClient;
  private mutationsEnabled: boolean;

  constructor(config: RagClientConfig) {
    this.neo4j = new Neo4jClient(config.neo4j);
    this.mutationsEnabled = config.enableMutations ?? false;
  }

  // Existing query methods
  book(): BookQuery {
    return new BookQuery(this.neo4j, 'Book', ...);
  }

  // NEW: Mutation methods
  mutations = {
    book: (): BookMutations => {
      if (!this.mutationsEnabled) {
        throw new Error('Mutations are disabled. Enable with { enableMutations: true }');
      }
      return new BookMutations(this.neo4j, 'Book', bookEntityConfig);
    },

    author: (): AuthorMutations => {
      if (!this.mutationsEnabled) {
        throw new Error('Mutations are disabled');
      }
      return new AuthorMutations(this.neo4j, 'Author', authorEntityConfig);
    }
  };
}

// Usage:
const book = await rag.mutations.book().create({ uuid: '123', title: 'New' });
```

**Alternative (simpler, chosen)**:
```typescript
// Just return mutation builder directly from entity method with flag
book(mode: 'query' | 'mutate' = 'query'): BookQuery | BookMutations {
  if (mode === 'mutate') {
    return new BookMutations(this.neo4j, 'Book', bookEntityConfig);
  }
  return new BookQuery(this.neo4j, 'Book', ...);
}

// Usage:
const book = await rag.book('mutate').create({ ... });
const results = await rag.book().semanticSearch('fantasy').execute();
```

**Final Decision**: Separate methods for clarity
```typescript
// Query operations
book(): BookQuery { ... }

// Mutation operations
bookMutations(): BookMutations { ... }

// Usage (clear and type-safe):
const results = await rag.book().semanticSearch('fantasy').execute();
const newBook = await rag.bookMutations().create({ uuid: '123', title: 'New' });
```

---

## Vector Index Integration (Future Phase)

When creating/updating entities with vector indexes, auto-generate embeddings:

```typescript
await rag.bookMutations().create({
  uuid: 'book-123',
  title: 'New Book',
  description: 'Long description...'
}, {
  generateEmbeddings: true  // Auto-generate for vector-indexed fields
});
```

This will be Phase 6.8 from the roadmap.

---

## Testing Strategy

1. **Unit Tests**: Test MutationBuilder methods in isolation
2. **Integration Tests**: Test against real Neo4j with bookstore schema
3. **Generated Code Tests**: Ensure generated mutations compile and work
4. **Example Tests**: Run generated examples to verify end-to-end

---

## Breaking Changes

None - this is a purely additive change. Existing query API remains unchanged.

---

## Migration Path

No migration needed. Users opt-in by:
1. Regenerating their project with new CLI version
2. Using the new mutation APIs

Existing query-only code continues to work as-is.

---

## Next Steps

1. ✅ Complete this design doc
2. Implement `MutationBuilder` in runtime package
3. Add mutation generation to `CodeGenerator`
4. Update type generator for Create/Update types
5. Generate example mutations in examples
6. Test with bookstore example
7. Document mutation API in generated docs
8. Update CLI to include mutations in `ragforge init`
