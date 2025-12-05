/**
 * Result Types
 */

export interface SearchResult<T = any> {
  /** The entity that matched */
  entity: T;

  /** Overall relevance score (0-1) */
  score: number;

  /** Score breakdown by strategy */
  scoreBreakdown?: {
    semantic?: number;
    vector?: number;
    llm?: number;
    llmReasoning?: string;
    previous?: number;
    topology?: number;
    custom?: Record<string, number>;
  };

  /** Additional context */
  context?: {
    /** Related entities (if expand was used) */
    related?: RelatedEntity[];

    /** Text snippet highlighting match */
    snippet?: string;

    /** Graph distance from query origin */
    distance?: number;
  };
}

export interface RelatedEntity {
  entity: any;
  relationshipType: string;
  direction: 'outgoing' | 'incoming';
  distance: number;
}

export interface VectorSearchResult {
  node: any;
  score: number;
}

export interface AggregateResult {
  count: number;
  min?: number;
  max?: number;
  avg?: number;
  sum?: number;
}

/**
 * Metadata for a single operation in the pipeline
 */
export interface OperationMetadata {
  /** Type of operation (semantic, llmRerank, expand, etc.) */
  type: string;

  /** Configuration used for this operation */
  config?: any;

  /** Number of results before this operation */
  inputCount: number;

  /** Number of results after this operation */
  outputCount: number;

  /** Time taken for this operation (ms) */
  duration: number;

  /** Operation-specific metadata */
  metadata?: {
    // For semantic search
    model?: string;
    dimension?: number;
    vectorIndex?: string;

    // For LLM reranking
    llmModel?: string;
    evaluations?: Array<{
      entityId: string;
      score: number;
      reasoning: string;
    }>;
    queryFeedback?: any;

    // For expand
    relationshipType?: string;
    depth?: number;

    // Custom metadata
    [key: string]: any;
  };
}

/**
 * Complete execution metadata - list of all operations in order
 */
export interface QueryExecutionMetadata {
  /** Operations executed in the pipeline (in order) */
  operations: OperationMetadata[];

  /** Total execution time (ms) */
  totalDuration: number;

  /** Final result count */
  finalCount: number;
}

/**
 * Search result with metadata
 */
export interface SearchResultWithMetadata<T = any> {
  /** The search results */
  results: SearchResult<T>[];

  /** Metadata about query execution */
  metadata: QueryExecutionMetadata;
}
