/**
 * Topic Management Types
 *
 * Types for LLM-based topic extraction and merging
 */

/**
 * A chunk of text from a document
 */
export interface TextChunk {
  uuid: string;
  content: string;
  chunk_index: number;
  document_path: string;
}

/**
 * Extracted topic from LLM
 */
export interface ExtractedTopic {
  name: string;
  description: string;
  keywords: string[];
  confidence: number; // 0-1
}

/**
 * Result of topic extraction for a chunk
 */
export interface ChunkTopicResult {
  chunk_uuid: string;
  topics: ExtractedTopic[];
}

/**
 * A topic entity stored in Neo4j
 */
export interface Topic {
  uuid: string;
  name: string;
  description: string;
  keywords: string[];
  confidence: number;
  extraction_prompt?: string;
  extracted_at: string;
  is_merged: boolean;
  merge_reason?: string;
  embedding?: number[];
}

/**
 * Options for topic extraction
 */
export interface TopicExtractionOptions {
  /** Minimum chunk length to trigger extraction */
  min_chunk_length: number;
  /** Maximum topics per chunk */
  max_topics_per_chunk: number;
  /** Minimum confidence to keep topic */
  min_confidence: number;
  /** Number of previous chunks for context */
  context_window: number;
  /** Similarity threshold for deduplication */
  similarity_threshold: number;
  /** Use embeddings for similarity */
  use_embeddings: boolean;
}

/**
 * Options for topic merging
 */
export interface TopicMergingOptions {
  /** Similarity threshold for clustering */
  similarity_threshold: number;
  /** Minimum cluster size */
  min_cluster_size: number;
  /** Maximum cluster size */
  max_cluster_size: number;
  /** Minimum chunk overlap ratio */
  min_chunk_overlap?: number;
  /** Require keyword overlap */
  require_keyword_overlap?: boolean;
  /** Batch size */
  batch_size: number;
}

/**
 * Topic cluster for merging
 */
export interface TopicCluster {
  topics: Topic[];
  similarity_score: number;
}

/**
 * LLM decision for merging topics
 */
export interface MergeDecision {
  should_merge: boolean;
  merged_topic?: {
    name: string;
    description: string;
    keywords: string[];
    reasoning: string;
  };
  topics_to_merge: string[]; // UUIDs
}

/**
 * Result of topic merging
 */
export interface MergeResult {
  merged_count: number;
  new_topic_uuid: string;
  old_topic_uuids: string[];
  reasoning: string;
}
