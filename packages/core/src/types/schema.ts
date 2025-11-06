/**
 * Type definitions for Neo4j schema introspection results
 */

export interface GraphSchema {
  nodes: NodeSchema[];
  relationships: RelationshipSchema[];
  indexes: IndexSchema[];
  constraints: ConstraintSchema[];
  vectorIndexes: VectorIndexSchema[];
  relationshipExamples?: Record<string, string>; // relationshipType -> example target name (optional, only when Neo4j available)
  fieldExamples?: Record<string, string[]>; // fieldName -> array of example values from database (optional, only when Neo4j available)
  workingExamples?: Record<string, any>; // Working example queries guaranteed to return results (optional, only when Neo4j available)
}

export interface NodeSchema {
  label: string;
  properties: PropertySchema[];
  count?: number;
}

export interface PropertySchema {
  name: string;
  type: Neo4jType;
  nullable: boolean;
  unique?: boolean;
  indexed?: boolean;
}

export type Neo4jType =
  | 'String'
  | 'Integer'
  | 'Float'
  | 'Boolean'
  | 'Date'
  | 'DateTime'
  | 'LocalDateTime'
  | 'Point'
  | 'List'
  | 'Map';

export interface RelationshipSchema {
  type: string;
  startNode: string;
  endNode: string;
  properties: PropertySchema[];
  count?: number;
}

export interface IndexSchema {
  name: string;
  type: 'BTREE' | 'FULLTEXT' | 'VECTOR';
  entityType: 'NODE' | 'RELATIONSHIP';
  labelsOrTypes: string[];
  properties: string[];
}

export interface ConstraintSchema {
  name: string;
  type: 'UNIQUE' | 'EXISTS' | 'NODE_KEY';
  entityType: 'NODE' | 'RELATIONSHIP';
  labelsOrTypes: string[];
  properties: string[];
}

export interface VectorIndexSchema {
  name: string;
  label: string;
  property: string;
  dimension?: number;
  similarity?: 'cosine' | 'euclidean' | 'dot';
}
