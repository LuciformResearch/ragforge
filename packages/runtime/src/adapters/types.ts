/**
 * Source Adapter Types
 *
 * Types and interfaces for RagForge source adapters that parse various
 * sources (code, documents, APIs, etc.) into Neo4j graph structures.
 */

/**
 * Configuration for a source to be parsed
 */
export interface SourceConfig {
  /** Type of source (code, documents, database, api) */
  type: string;

  /** Specific adapter to use for this source type */
  adapter: string;

  /** Root directory or path to source */
  root?: string;

  /** Glob patterns to include */
  include?: string[];

  /** Glob patterns to exclude */
  exclude?: string[];

  /** Adapter-specific options */
  options?: Record<string, any>;
}

/**
 * A node to be created in Neo4j
 */
export interface ParsedNode {
  /** Node label(s) */
  labels: string[];

  /** Unique identifier for the node */
  id: string;

  /** All properties for this node */
  properties: Record<string, any>;
}

/**
 * A relationship to be created in Neo4j
 */
export interface ParsedRelationship {
  /** Relationship type */
  type: string;

  /** Source node ID */
  from: string;

  /** Target node ID */
  to: string;

  /** Optional relationship properties */
  properties?: Record<string, any>;
}

/**
 * Complete parsed graph structure ready for Neo4j ingestion
 */
export interface ParsedGraph {
  /** All nodes to be created */
  nodes: ParsedNode[];

  /** All relationships to be created */
  relationships: ParsedRelationship[];

  /** Metadata about the parsing operation */
  metadata: {
    /** Total files parsed */
    filesProcessed: number;

    /** Total nodes generated */
    nodesGenerated: number;

    /** Total relationships generated */
    relationshipsGenerated: number;

    /** Time taken to parse (ms) */
    parseTimeMs: number;

    /** Any warnings during parsing */
    warnings?: string[];
  };
}

/**
 * Statistics about incremental update
 */
export interface UpdateStats {
  /** Nodes added */
  nodesAdded: number;

  /** Nodes updated */
  nodesUpdated: number;

  /** Nodes deleted */
  nodesDeleted: number;

  /** Relationships added */
  relationshipsAdded: number;

  /** Relationships deleted */
  relationshipsDeleted: number;
}

/**
 * Result of parsing source with incremental update info
 */
export interface ParseResult {
  /** The parsed graph */
  graph: ParsedGraph;

  /** Incremental update statistics (if applicable) */
  updateStats?: UpdateStats;

  /** Whether this was an incremental update */
  isIncremental: boolean;
}

/**
 * Options for parsing
 */
export interface ParseOptions {
  /** Source configuration */
  source: SourceConfig;

  /** Whether to perform incremental update */
  incremental?: boolean;

  /** Neo4j connection for incremental updates */
  neo4jUri?: string;
  neo4jUser?: string;
  neo4jPassword?: string;
  neo4jDatabase?: string;

  /** Progress callback */
  onProgress?: (progress: ParseProgress) => void;
}

/**
 * Progress information during parsing
 */
export interface ParseProgress {
  /** Current phase */
  phase: 'discovering' | 'parsing' | 'building_graph' | 'complete';

  /** Current file being processed */
  currentFile?: string;

  /** Files processed so far */
  filesProcessed: number;

  /** Total files to process */
  totalFiles: number;

  /** Percentage complete (0-100) */
  percentComplete: number;
}

/**
 * Abstract base class for source adapters
 */
export class SourceAdapter {
  /** Type of source this adapter handles */
  readonly type: string = '';

  /** Name of this specific adapter implementation */
  readonly adapterName: string = '';

  /**
   * Parse source into Neo4j graph structure
   */
  async parse(options: ParseOptions): Promise<ParseResult> {
    throw new Error('Not implemented');
  }

  /**
   * Validate source configuration before parsing
   */
  async validate(config: SourceConfig): Promise<ValidationResult> {
    throw new Error('Not implemented');
  }
}

/**
 * Validation result
 */
export interface ValidationResult {
  /** Whether validation passed */
  valid: boolean;

  /** Validation errors */
  errors?: string[];

  /** Validation warnings */
  warnings?: string[];
}
