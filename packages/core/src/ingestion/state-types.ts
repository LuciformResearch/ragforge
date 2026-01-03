/**
 * State Machine Types
 *
 * Types and constants for the universal node state machine.
 * All nodes (Scope, File, MarkdownSection, etc.) use this state system.
 */

import { NODE_SCHEMAS } from '../utils/node-schema.js';

/**
 * Node states in the ingestion pipeline
 */
export type NodeState =
  | 'pending'    // Detected, waiting for parsing
  | 'parsing'    // Currently being parsed
  | 'parsed'     // Parsing complete, waiting for linking
  | 'linking'    // Creating relationships (CONSUMES, etc.)
  | 'linked'     // Relationships created, ready for embedding
  | 'embedding'  // Generating embeddings
  | 'ready'      // Fully processed
  | 'skip'       // No embedding needed (binary files, etc.)
  | 'error';     // Failed at some stage

/**
 * Error types for the error state
 */
export type StateErrorType = 'parse' | 'link' | 'embed';

/**
 * Valid state transitions
 */
export const VALID_TRANSITIONS: Record<NodeState, NodeState[]> = {
  pending:   ['parsing', 'skip'],
  parsing:   ['parsed', 'error'],
  parsed:    ['linking'],
  linking:   ['linked', 'error'],
  linked:    ['embedding', 'skip'],
  embedding: ['ready', 'error'],
  ready:     ['pending'],  // Reset if content changed
  skip:      ['pending'],  // Reset if content changed
  error:     ['pending'],  // Retry
};

/**
 * Check if a transition is valid
 */
export function isValidTransition(from: NodeState, to: NodeState): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Get the next expected state in the normal flow
 */
export function getNextState(current: NodeState): NodeState | null {
  const normalFlow: NodeState[] = [
    'pending', 'parsing', 'parsed', 'linking', 'linked', 'embedding', 'ready'
  ];
  const idx = normalFlow.indexOf(current);
  if (idx === -1 || idx === normalFlow.length - 1) return null;
  return normalFlow[idx + 1];
}

/**
 * State priority for sorting (lower = earlier in pipeline)
 */
export const STATE_PRIORITY: Record<NodeState, number> = {
  pending:   1,
  parsing:   2,
  parsed:    3,
  linking:   4,
  linked:    5,
  embedding: 6,
  ready:     7,
  skip:      8,
  error:     9,
};

/**
 * Check if a state is terminal (no further processing needed)
 */
export function isTerminalState(state: NodeState): boolean {
  return state === 'ready' || state === 'skip';
}

/**
 * Check if a state indicates an error
 */
export function isErrorState(state: NodeState): boolean {
  return state === 'error';
}

/**
 * Check if a state is in-progress (actively being processed)
 */
export function isInProgressState(state: NodeState): boolean {
  return state === 'parsing' || state === 'linking' || state === 'embedding';
}

/**
 * Options for state transitions
 */
export interface TransitionOptions {
  /** Error type (required if transitioning to 'error') */
  errorType?: StateErrorType;

  /** Error message (optional, for debugging) */
  errorMessage?: string;

  /** Content hash (for tracking content changes) */
  contentHash?: string;

  /** Embedding provider (when transitioning to 'ready') */
  embeddingProvider?: string;

  /** Embedding model (when transitioning to 'ready') */
  embeddingModel?: string;
}

/**
 * Information about a node's state
 */
export interface NodeStateInfo {
  /** Node UUID */
  uuid: string;

  /** Node label (Scope, File, MarkdownSection, etc.) */
  label: string;

  /** Current state */
  state: NodeState;

  /** Error type (if state is 'error') */
  errorType?: StateErrorType;

  /** Error message (if state is 'error') */
  errorMessage?: string;

  /** Number of retry attempts */
  retryCount: number;

  /** When the state last changed */
  stateChangedAt: Date;

  /** When the node was first detected */
  detectedAt?: Date;

  /** When parsing completed */
  parsedAt?: Date;

  /** When linking completed */
  linkedAt?: Date;

  /** When embedding completed */
  embeddedAt?: Date;

  /** Content hash for change detection */
  contentHash?: string;

  /** Embedding provider used */
  embeddingProvider?: string;

  /** Embedding model used */
  embeddingModel?: string;

  /** Project ID (if applicable) */
  projectId?: string;

  /** File path (if applicable) */
  file?: string;

  /** Node name (if applicable) */
  name?: string;
}

/**
 * Batch transition entry
 */
export interface BatchTransition {
  /** Node UUID */
  uuid: string;

  /** Node label */
  label: string;

  /** Target state */
  state: NodeState;

  /** Transition options */
  options?: TransitionOptions;
}

/**
 * State count by type (for dashboards)
 */
export interface StateCounts {
  pending: number;
  parsing: number;
  parsed: number;
  linking: number;
  linked: number;
  embedding: number;
  ready: number;
  skip: number;
  error: number;
}

/**
 * Query options for finding nodes by state
 */
export interface StateQueryOptions {
  /** Filter by node label */
  label?: string;

  /** Filter by project ID */
  projectId?: string;

  /** Filter by error type (if querying errors) */
  errorType?: StateErrorType;

  /** Maximum results */
  limit?: number;

  /** Offset for pagination */
  offset?: number;

  /** Include node content (name, file, etc.) */
  includeDetails?: boolean;
}

/**
 * Options for retrying errors
 */
export interface RetryOptions {
  /** Only retry specific error type */
  errorType?: StateErrorType;

  /** Maximum retry count (skip nodes with more retries) */
  maxRetries?: number;

  /** Filter by project ID */
  projectId?: string;

  /** Filter by node label */
  label?: string;
}

/**
 * Node labels that support state tracking.
 * Derived from NODE_SCHEMAS where stateful: true.
 * This is the single source of truth - modify NODE_SCHEMAS to add/remove stateful labels.
 */
export const STATEFUL_NODE_LABELS = Object.entries(NODE_SCHEMAS)
  .filter(([, schema]) => schema.stateful === true)
  .map(([label]) => label) as StatefulNodeLabel[];

/**
 * All known stateful node labels (compile-time type)
 */
export type StatefulNodeLabel =
  | 'Scope'
  | 'File'
  | 'Project'
  | 'MarkdownDocument'
  | 'MarkdownSection'
  | 'CodeBlock'
  | 'DataFile'
  | 'ImageFile'
  | 'ThreeDFile'
  | 'DocumentFile'
  | 'WebPage'
  | 'WebDocument'
  | 'Stylesheet'
  | 'VueSFC'
  | 'SvelteComponent'
  | 'PDFDocument'
  | 'WordDocument'
  | 'SpreadsheetDocument'
  | 'MediaFile'
  | 'GenericFile';

/**
 * Check if a label supports state tracking
 */
export function isStatefulLabel(label: string): label is StatefulNodeLabel {
  return STATEFUL_NODE_LABELS.includes(label as StatefulNodeLabel);
}

/**
 * Property names used for state tracking (prefixed with _ to avoid conflicts)
 */
export const STATE_PROPERTIES = {
  state: '_state',
  stateChangedAt: '_stateChangedAt',
  errorType: '_errorType',
  errorMessage: '_errorMessage',
  retryCount: '_retryCount',
  createdAt: '_createdAt',
  updatedAt: '_updatedAt',
  detectedAt: '_detectedAt',
  parsedAt: '_parsedAt',
  linkedAt: '_linkedAt',
  embeddedAt: '_embeddedAt',
  contentHash: '_contentHash',
  embeddingProvider: '_embeddingProvider',
  embeddingModel: '_embeddingModel',
  embeddingHash: '_embeddingHash',
} as const;
