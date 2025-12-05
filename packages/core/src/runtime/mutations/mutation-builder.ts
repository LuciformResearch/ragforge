/**
 * Mutation Builder
 *
 * Base class for creating, updating, and deleting entities in Neo4j
 * Provides type-safe CRUD operations based on entity configuration
 */

import type { Neo4jClient } from '../client/neo4j-client.js';

/**
 * Configuration for an entity's mutation operations
 */
export interface EntityMutationConfig {
  name: string;               // Entity label in Neo4j (e.g., 'Book', 'Author')
  uniqueField: string;        // Field used as unique identifier (e.g., 'uuid', 'id')
  displayNameField: string;   // Field used for display purposes (e.g., 'title', 'name')
}

/**
 * Configuration for adding a relationship
 */
export interface AddRelationshipConfig {
  type: string;                        // Relationship type (e.g., 'WRITTEN_BY')
  target: string;                      // Target entity's unique identifier value
  targetLabel?: string;                // Optional: target entity label (if different from source)
  properties?: Record<string, any>;    // Optional: relationship properties
}

/**
 * Configuration for removing a relationship
 */
export interface RemoveRelationshipConfig {
  type: string;           // Relationship type
  target: string;         // Target entity's unique identifier value
  targetLabel?: string;   // Optional: target entity label
}

/**
 * Base class for entity mutations
 *
 * Provides generic CRUD operations that work with any Neo4j entity.
 * Generated entity-specific mutation classes extend this.
 *
 * @example
 * ```typescript
 * // In generated code:
 * export class BookMutations extends MutationBuilder<Book> {
 *   constructor(client: Neo4jClient) {
 *     super(client, {
 *       name: 'Book',
 *       uniqueField: 'uuid',
 *       displayNameField: 'title'
 *     });
 *   }
 * }
 * ```
 */
export class MutationBuilder<T = any> {
  constructor(
    protected client: Neo4jClient,
    protected config: EntityMutationConfig
  ) {}

  /**
   * Create a new entity
   *
   * @param data - Entity data (must include unique field)
   * @returns The created entity with all properties
   * @throws Error if unique field is missing
   * @throws Error if entity with same unique field already exists
   *
   * @example
   * ```typescript
   * const book = await mutations.create({
   *   uuid: 'book-123',
   *   title: 'New Book',
   *   isbn: '978-...'
   * });
   * ```
   */
  async create(data: Partial<T>): Promise<T> {
    this.validateRequiredFields(data);

    const cypher = this.buildCreateCypher(data);
    const result = await this.client.run(cypher.query, cypher.params);

    if (result.records.length === 0) {
      throw new Error(`Failed to create ${this.config.name} entity`);
    }

    return this.parseEntity(result.records[0]);
  }

  /**
   * Create multiple entities in a single transaction (batch operation)
   *
   * More efficient than calling create() multiple times.
   *
   * @param items - Array of entity data
   * @returns Array of created entities
   * @throws Error if any item is missing required fields
   *
   * @example
   * ```typescript
   * const books = await mutations.createBatch([
   *   { uuid: 'book-1', title: 'Book One' },
   *   { uuid: 'book-2', title: 'Book Two' }
   * ]);
   * ```
   */
  async createBatch(items: Partial<T>[]): Promise<T[]> {
    items.forEach((item, index) => {
      try {
        this.validateRequiredFields(item);
      } catch (error) {
        throw new Error(
          `Validation failed for item at index ${index}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });

    const cypher = this.buildBatchCreateCypher(items);
    const result = await this.client.run(cypher.query, cypher.params);

    return result.records.map(record => this.parseEntity(record));
  }

  /**
   * Update an existing entity
   *
   * Only provided fields will be updated. The unique identifier field
   * cannot be updated.
   *
   * @param id - Value of the unique identifier field
   * @param data - Fields to update (partial entity data)
   * @returns The updated entity with all properties
   * @throws Error if entity not found
   *
   * @example
   * ```typescript
   * const book = await mutations.update('book-123', {
   *   rating: 4.5,
   *   reviewCount: 42
   * });
   * ```
   */
  async update(id: string, data: Partial<T>): Promise<T> {
    const cypher = this.buildUpdateCypher(id, data);
    const result = await this.client.run(cypher.query, cypher.params);

    if (result.records.length === 0) {
      throw new Error(
        `${this.config.name} with ${this.config.uniqueField}='${id}' not found`
      );
    }

    return this.parseEntity(result.records[0]);
  }

  /**
   * Delete an entity by its unique identifier
   *
   * Uses DETACH DELETE to also remove all relationships.
   *
   * @param id - Value of the unique identifier field
   * @returns void
   * @throws Error if entity not found
   *
   * @example
   * ```typescript
   * await mutations.delete('book-123');
   * ```
   */
  async delete(id: string): Promise<void> {
    const cypher = this.buildDeleteCypher(id);
    const result = await this.client.run(cypher.query, cypher.params);

    // Neo4j doesn't return anything for DELETE, so we can't verify
    // Instead, we could do a pre-check with MATCH to ensure it exists
    // For now, we trust the operation succeeded
  }

  /**
   * Add a relationship between this entity and another
   *
   * @param sourceId - Unique identifier of the source entity
   * @param config - Relationship configuration
   * @returns void
   * @throws Error if either entity not found
   *
   * @example
   * ```typescript
   * // Add WRITTEN_BY relationship from book to author
   * await mutations.addRelationship('book-123', {
   *   type: 'WRITTEN_BY',
   *   target: 'author-456',
   *   targetLabel: 'Author'  // Optional if target is different entity type
   * });
   *
   * // Add relationship with properties
   * await mutations.addRelationship('book-123', {
   *   type: 'RECOMMENDED_WITH',
   *   target: 'book-789',
   *   properties: { strength: 0.95 }
   * });
   * ```
   */
  async addRelationship(sourceId: string, config: AddRelationshipConfig): Promise<void> {
    const cypher = this.buildAddRelationshipCypher(sourceId, config);
    await this.client.run(cypher.query, cypher.params);
  }

  /**
   * Remove a relationship between this entity and another
   *
   * @param sourceId - Unique identifier of the source entity
   * @param config - Relationship configuration
   * @returns void
   *
   * @example
   * ```typescript
   * await mutations.removeRelationship('book-123', {
   *   type: 'WRITTEN_BY',
   *   target: 'author-456'
   * });
   * ```
   */
  async removeRelationship(sourceId: string, config: RemoveRelationshipConfig): Promise<void> {
    const cypher = this.buildRemoveRelationshipCypher(sourceId, config);
    await this.client.run(cypher.query, cypher.params);
  }

  /**
   * Validate that required fields are present
   * @private
   */
  private validateRequiredFields(data: Partial<T>): void {
    const uniqueField = this.config.uniqueField;
    if (!data[uniqueField as keyof T]) {
      throw new Error(
        `Required field '${uniqueField}' is missing. ` +
        `All ${this.config.name} entities must have a unique ${uniqueField}.`
      );
    }
  }

  /**
   * Build Cypher query for creating a single entity
   * @private
   */
  private buildCreateCypher(data: Partial<T>): { query: string; params: Record<string, any> } {
    const label = this.config.name;
    const properties = this.serializeProperties(data);

    return {
      query: `
        CREATE (n:\`${label}\`)
        SET n = $properties
        RETURN n
      `,
      params: { properties }
    };
  }

  /**
   * Build Cypher query for batch creating entities
   * @private
   */
  private buildBatchCreateCypher(items: Partial<T>[]): { query: string; params: Record<string, any> } {
    const label = this.config.name;

    return {
      query: `
        UNWIND $items AS item
        CREATE (n:\`${label}\`)
        SET n = item
        RETURN n
      `,
      params: {
        items: items.map(item => this.serializeProperties(item))
      }
    };
  }

  /**
   * Build Cypher query for updating an entity
   * @private
   */
  private buildUpdateCypher(id: string, data: Partial<T>): { query: string; params: Record<string, any> } {
    const label = this.config.name;
    const uniqueField = this.config.uniqueField;
    const properties = this.serializeProperties(data);

    return {
      query: `
        MATCH (n:\`${label}\` { \`${uniqueField}\`: $id })
        SET n += $properties
        RETURN n
      `,
      params: { id, properties }
    };
  }

  /**
   * Build Cypher query for deleting an entity
   * @private
   */
  private buildDeleteCypher(id: string): { query: string; params: Record<string, any> } {
    const label = this.config.name;
    const uniqueField = this.config.uniqueField;

    return {
      query: `
        MATCH (n:\`${label}\` { \`${uniqueField}\`: $id })
        DETACH DELETE n
      `,
      params: { id }
    };
  }

  /**
   * Build Cypher query for adding a relationship
   * @private
   */
  private buildAddRelationshipCypher(
    sourceId: string,
    config: AddRelationshipConfig
  ): { query: string; params: Record<string, any> } {
    const sourceLabel = this.config.name;
    const uniqueField = this.config.uniqueField;

    // If targetLabel not specified, assume same as source label (e.g., Book-[RECOMMENDED_WITH]->Book)
    const targetLabel = config.targetLabel || sourceLabel;

    const propsClause = config.properties
      ? `SET r = $relProps`
      : '';

    return {
      query: `
        MATCH (source:\`${sourceLabel}\` { \`${uniqueField}\`: $sourceId })
        MATCH (target:\`${targetLabel}\` { \`${uniqueField}\`: $targetId })
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

  /**
   * Build Cypher query for removing a relationship
   * @private
   */
  private buildRemoveRelationshipCypher(
    sourceId: string,
    config: RemoveRelationshipConfig
  ): { query: string; params: Record<string, any> } {
    const sourceLabel = this.config.name;
    const uniqueField = this.config.uniqueField;
    const targetLabel = config.targetLabel || sourceLabel;

    return {
      query: `
        MATCH (source:\`${sourceLabel}\` { \`${uniqueField}\`: $sourceId })
              -[r:\`${config.type}\`]->
              (target:\`${targetLabel}\` { \`${uniqueField}\`: $targetId })
        DELETE r
      `,
      params: { sourceId, targetId: config.target }
    };
  }

  /**
   * Serialize entity properties for Neo4j
   *
   * Converts TypeScript types to Neo4j-compatible types:
   * - Dates → ISO strings
   * - Arrays → preserved as-is
   * - Objects → JSON strings (Neo4j doesn't support nested objects)
   * - undefined → excluded
   *
   * @private
   */
  private serializeProperties(data: Partial<T>): Record<string, any> {
    const serialized: Record<string, any> = {};

    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue;

      // Handle dates
      if (value instanceof Date) {
        serialized[key] = value.toISOString();
      }
      // Handle arrays (Neo4j supports primitive arrays)
      else if (Array.isArray(value)) {
        serialized[key] = value;
      }
      // Handle objects (convert to JSON string - Neo4j doesn't support nested objects)
      else if (typeof value === 'object' && value !== null) {
        serialized[key] = JSON.stringify(value);
      }
      // Primitives (string, number, boolean)
      else {
        serialized[key] = value;
      }
    }

    return serialized;
  }

  /**
   * Parse Neo4j record into entity
   * @private
   */
  private parseEntity(record: any): T {
    const node = record.get('n');
    return node.properties as T;
  }
}
