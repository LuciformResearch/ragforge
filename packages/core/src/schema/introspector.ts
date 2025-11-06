/**
 * Neo4j Schema Introspector
 *
 * Analyzes a Neo4j database to extract:
 * - Node labels and properties
 * - Relationship types and properties
 * - Indexes (including vector indexes)
 * - Constraints
 */

import neo4j, { Driver, Session } from 'neo4j-driver';
import {
  GraphSchema,
  NodeSchema,
  PropertySchema,
  RelationshipSchema,
  IndexSchema,
  ConstraintSchema,
  VectorIndexSchema,
  Neo4jType
} from '../types/schema.js';

export class SchemaIntrospector {
  private driver: Driver;

  constructor(uri: string, username: string, password: string) {
    this.driver = neo4j.driver(uri, neo4j.auth.basic(username, password));
  }

  async introspect(database?: string): Promise<GraphSchema> {
    const session = this.driver.session({ database });

    try {
      // Run sequentially to avoid session conflicts
      const nodes = await this.introspectNodes(session);
      const relationships = await this.introspectRelationships(session);
      const indexes = await this.introspectIndexes(session);
      const constraints = await this.introspectConstraints(session);
      const vectorIndexes = await this.introspectVectorIndexes(session);

      // Try to find real examples for relationships (optional, may fail silently)
      let relationshipExamples: Record<string, string> | undefined;
      try {
        relationshipExamples = await this.introspectRelationshipExamples(session, relationships);
      } catch (error) {
        // If we can't find examples, that's okay - we'll use generic names
        console.warn('Could not introspect relationship examples:', error);
      }

      // Try to find real examples for field values (optional, may fail silently)
      let fieldExamples: Record<string, string[]> | undefined;
      try {
        fieldExamples = await this.introspectFieldExamples(session, nodes);
      } catch (error) {
        // If we can't find examples, that's okay - we'll use generic values
        console.warn('Could not introspect field examples:', error);
      }

      // Try to find working example queries (optional, may fail silently)
      let workingExamples: Record<string, any> | undefined;
      try {
        workingExamples = await this.introspectWorkingExamples(session, nodes);
      } catch (error) {
        // If we can't find working examples, that's okay - we'll use basic examples
        console.warn('Could not introspect working examples:', error);
      }

      return {
        nodes,
        relationships,
        indexes,
        constraints,
        vectorIndexes,
        relationshipExamples,
        fieldExamples,
        workingExamples
      };
    } finally {
      await session.close();
    }
  }

  private async introspectNodes(session: Session): Promise<NodeSchema[]> {
    // Get all node labels
    const labelsResult = await session.run('CALL db.labels()');
    const labels = labelsResult.records.map(r => r.get(0) as string);

    const nodes: NodeSchema[] = [];

    for (const label of labels) {
      // Get properties and their types for this label
      const propsResult = await session.run(`
        MATCH (n:\`${label}\`)
        WITH n LIMIT 100
        UNWIND keys(n) AS key
        WITH DISTINCT key,
             [x IN collect(n[key]) WHERE x IS NOT NULL][0] AS sampleValue
        RETURN key, sampleValue
      `);

      const properties: PropertySchema[] = propsResult.records.map(r => {
        const key = r.get('key') as string;
        const sampleValue = r.get('sampleValue');
        const type = this.inferType(sampleValue);

        return {
          name: key,
          type,
          nullable: true // Conservative default
        };
      });

      // Get count
      const countResult = await session.run(`MATCH (n:\`${label}\`) RETURN count(n) AS count`);
      const count = countResult.records[0]?.get('count').toNumber() || 0;

      nodes.push({
        label,
        properties,
        count
      });
    }

    return nodes;
  }

  private async introspectRelationships(session: Session): Promise<RelationshipSchema[]> {
    // Get all relationship types
    const typesResult = await session.run('CALL db.relationshipTypes() YIELD relationshipType RETURN relationshipType');

    const relationships: RelationshipSchema[] = [];

    for (const record of typesResult.records) {
      const relType = record.get('relationshipType') as string;

      // Query this specific relationship type to get start/end nodes
      const detailsResult = await session.run(`
        MATCH (start)-[r:\`${relType}\`]->(end)
        WITH labels(start)[0] AS startLabel, labels(end)[0] AS endLabel, keys(r) AS props
        RETURN DISTINCT startLabel, endLabel, props
        LIMIT 10
      `);

      for (const detailRecord of detailsResult.records) {
        const startLabel = detailRecord.get('startLabel') as string;
        const endLabel = detailRecord.get('endLabel') as string;

        if (startLabel && endLabel) {
          // Check if we already have this combination
          const existing = relationships.find(
            r => r.type === relType && r.startNode === startLabel && r.endNode === endLabel
          );

          if (!existing) {
            relationships.push({
              type: relType,
              startNode: startLabel,
              endNode: endLabel,
              properties: [], // TODO: Parse properties
              count: 0 // TODO: Get count
            });
          }
        }
      }
    }

    return relationships;
  }

  private async introspectIndexes(session: Session): Promise<IndexSchema[]> {
    const result = await session.run('SHOW INDEXES');

    const indexes: IndexSchema[] = [];

    for (const record of result.records) {
      const name = record.get('name') as string;
      const type = record.get('type') as string;
      const entityType = record.get('entityType') as 'NODE' | 'RELATIONSHIP';
      const labelsOrTypes = record.get('labelsOrTypes') as string[];
      const properties = record.get('properties') as string[];

      // Map Neo4j index types to our simplified types
      let indexType: 'BTREE' | 'FULLTEXT' | 'VECTOR' = 'BTREE';
      if (type.includes('FULLTEXT')) {
        indexType = 'FULLTEXT';
      } else if (type.includes('VECTOR')) {
        indexType = 'VECTOR';
      }

      indexes.push({
        name,
        type: indexType,
        entityType,
        labelsOrTypes,
        properties
      });
    }

    return indexes;
  }

  private async introspectConstraints(session: Session): Promise<ConstraintSchema[]> {
    const result = await session.run('SHOW CONSTRAINTS');

    const constraints: ConstraintSchema[] = [];

    for (const record of result.records) {
      const name = record.get('name') as string;
      const type = record.get('type') as string;
      const entityType = record.get('entityType') as 'NODE' | 'RELATIONSHIP';
      const labelsOrTypes = record.get('labelsOrTypes') as string[];
      const properties = record.get('properties') as string[];

      // Map constraint types
      let constraintType: 'UNIQUE' | 'EXISTS' | 'NODE_KEY' = 'UNIQUE';
      if (type.includes('UNIQUENESS')) {
        constraintType = 'UNIQUE';
      } else if (type.includes('EXISTENCE')) {
        constraintType = 'EXISTS';
      } else if (type.includes('NODE_KEY')) {
        constraintType = 'NODE_KEY';
      }

      constraints.push({
        name,
        type: constraintType,
        entityType,
        labelsOrTypes,
        properties
      });
    }

    return constraints;
  }

  private async introspectVectorIndexes(session: Session): Promise<VectorIndexSchema[]> {
    // Vector indexes are also in SHOW INDEXES, but we need to query their metadata
    const result = await session.run(`
      SHOW INDEXES
      WHERE type CONTAINS 'VECTOR'
    `);

    const vectorIndexes: VectorIndexSchema[] = [];

    for (const record of result.records) {
      const name = record.get('name') as string;
      const labelsOrTypes = record.get('labelsOrTypes') as string[];
      const properties = record.get('properties') as string[];
      const options = record.has('options') ? (record.get('options') as any) : undefined;

      let dimension: number | undefined;
      let similarity: 'cosine' | 'euclidean' | 'dot' | undefined;

      if (options?.indexConfig) {
        const indexConfig = options.indexConfig;
        const dimValue = indexConfig['vector.dimensions'];
        if (dimValue !== undefined) {
          const parsed = typeof dimValue === 'number' ? dimValue : Number(dimValue);
          if (!Number.isNaN(parsed)) {
            dimension = parsed;
          }
        }
        const simValue = indexConfig['vector.similarity_function'];
        if (typeof simValue === 'string') {
          const normalized = simValue.toLowerCase();
          if (normalized === 'cosine' || normalized === 'euclidean' || normalized === 'dot') {
            similarity = normalized;
          }
        }
      }

      // Get dimension and similarity from index options
      // This is a simplified version - actual implementation needs to parse options
      vectorIndexes.push({
        name,
        label: labelsOrTypes[0] || '',
        property: properties[0] || '',
        dimension,
        similarity
      });
    }

    return vectorIndexes;
  }

  private mapNeo4jType(type: string): Neo4jType {
    const typeMap: Record<string, Neo4jType> = {
      'String': 'String',
      'Integer': 'Integer',
      'Long': 'Integer',
      'Float': 'Float',
      'Double': 'Float',
      'Boolean': 'Boolean',
      'Date': 'Date',
      'DateTime': 'DateTime',
      'LocalDateTime': 'LocalDateTime',
      'Point': 'Point',
      'List': 'List',
      'Map': 'Map'
    };

    return typeMap[type] || 'String';
  }

  private inferType(value: any): Neo4jType {
    if (value === null || value === undefined) {
      return 'String'; // Default
    }

    // Check JavaScript type
    const jsType = typeof value;

    if (jsType === 'string') {
      return 'String';
    } else if (jsType === 'number') {
      return Number.isInteger(value) ? 'Integer' : 'Float';
    } else if (jsType === 'boolean') {
      return 'Boolean';
    } else if (Array.isArray(value)) {
      return 'List';
    } else if (jsType === 'object') {
      // Check for Neo4j-specific types
      if (value.constructor?.name === 'Integer') {
        return 'Integer';
      } else if (value.constructor?.name === 'Date') {
        return 'Date';
      } else if (value.constructor?.name === 'DateTime') {
        return 'DateTime';
      } else if (value.constructor?.name === 'LocalDateTime') {
        return 'LocalDateTime';
      } else if (value.constructor?.name === 'Point') {
        return 'Point';
      } else {
        return 'Map';
      }
    }

    return 'String'; // Fallback
  }

  private async introspectRelationshipExamples(
    session: Session,
    relationships: RelationshipSchema[]
  ): Promise<Record<string, string>> {
    const examples: Record<string, string> = {};

    // Group relationships by type to avoid duplicate queries
    const uniqueTypes = new Set(relationships.map(r => r.type));

    for (const relType of uniqueTypes) {
      try {
        // Query to find a real target node for this relationship type
        // Try common property names: name, id, uuid, title, etc.
        const result = await session.run(`
          MATCH ()-[r:\`${relType}\`]->(target)
          WITH target LIMIT 1
          RETURN COALESCE(
            target.name,
            target.id,
            target.uuid,
            target.title,
            target.label,
            toString(id(target))
          ) AS targetName
        `);

        if (result.records.length > 0) {
          const targetName = result.records[0].get('targetName');
          if (targetName) {
            examples[relType] = String(targetName);
          }
        }
      } catch (error) {
        // If query fails for this relationship type, skip it
        console.warn(`Could not find example for relationship type ${relType}:`, error);
      }
    }

    return examples;
  }

  private async introspectFieldExamples(
    session: Session,
    nodes: NodeSchema[]
  ): Promise<Record<string, string[]>> {
    const fieldExamples: Record<string, string[]> = {};

    // For each node label, collect example values for commonly used fields
    for (const node of nodes) {
      const label = node.label;

      // Fields we want to collect examples for (commonly used in queries and filters)
      const fieldsToSample = ['name', 'fileName', 'source', 'signature', 'title', 'label', 'type', 'description', 'summary', 'content'];

      for (const fieldName of fieldsToSample) {
        try {
          // Check if this field exists on this node type
          const hasField = node.properties.some(p => p.name === fieldName);
          if (!hasField) continue;

          // Collect up to 10 distinct example values for this field
          const result = await session.run(`
            MATCH (n:\`${label}\`)
            WHERE n.${fieldName} IS NOT NULL
            RETURN DISTINCT n.${fieldName} AS value
            LIMIT 10
          `);

          if (result.records.length > 0) {
            const values = result.records
              .map(r => {
                const val = r.get('value');
                return val !== null && val !== undefined ? String(val) : null;
              })
              .filter((v): v is string => v !== null);

            if (values.length > 0) {
              // Store with key format: label.fieldName (e.g., "Scope.fileName")
              const key = `${label}.${fieldName}`;
              fieldExamples[key] = values;
            }
          }
        } catch (error) {
          // Skip this field if query fails
          console.warn(`Could not collect examples for ${label}.${fieldName}:`, error);
        }
      }
    }

    return fieldExamples;
  }

  /**
   * Find working example queries that are GUARANTEED to return results
   * This helps generate better examples that actually work
   */
  private async introspectWorkingExamples(
    session: Session,
    nodes: NodeSchema[]
  ): Promise<Record<string, any>> {
    const workingExamples: Record<string, any> = {};

    for (const node of nodes) {
      const label = node.label;

      try {
        // Find entities that have specific relationships (for relationship examples)
        // Example: find a Scope that has DEFINED_IN relationship
        const relationshipCounts = await session.run(`
          MATCH (n:\`${label}\`)
          WITH n
          OPTIONAL MATCH (n)-[r]->()
          WITH n, type(r) AS relType, count(*) AS relCount
          WHERE relCount > 0
          RETURN n.name AS entityName,
                 n.uuid AS uuid,
                 collect({type: relType, count: relCount}) AS relationships
          ORDER BY size(relationships) DESC
          LIMIT 5
        `);

        if (relationshipCounts.records.length > 0) {
          const examples = relationshipCounts.records.map(r => ({
            name: r.get('entityName'),
            uuid: r.get('uuid'),
            relationships: r.get('relationships')
          }));
          workingExamples[`${label}.entitiesWithRelationships`] = examples;
        }

        // Find specific relationship examples with actual connected entities
        const relExamples = await session.run(`
          MATCH (source:\`${label}\`)-[r]->(target)
          WITH source, type(r) AS relType, target, labels(target)[0] AS targetLabel
          RETURN DISTINCT
            relType,
            source.name AS sourceName,
            target.name AS targetName,
            targetLabel,
            count(*) AS count
          ORDER BY count DESC
          LIMIT 10
        `);

        if (relExamples.records.length > 0) {
          const relData = relExamples.records.map(r => ({
            relType: r.get('relType'),
            sourceName: r.get('sourceName'),
            targetName: r.get('targetName'),
            targetLabel: r.get('targetLabel'),
            count: r.get('count').toNumber()
          }));
          workingExamples[`${label}.relationshipExamplesWithTargets`] = relData;
        }

      } catch (error) {
        console.warn(`Could not introspect working examples for ${label}:`, error);
      }
    }

    return workingExamples;
  }

  async close(): Promise<void> {
    await this.driver.close();
  }
}
