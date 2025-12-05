/**
 * Document Adapter Module
 *
 * Provides document parsing and chunking capabilities:
 * - TikaParser: Extract text from any document format (PDF, DOCX, images with OCR, etc.)
 * - Chunker: Split text into overlapping chunks for RAG
 * - TikaSourceAdapter: Full adapter for document ingestion pipeline
 */

export {
  TikaParser,
  type TikaParserConfig,
  type ParsedDocument,
  type DocumentMetadata,
  SUPPORTED_EXTENSIONS,
} from './tika-parser.js';

export {
  Chunker,
  chunkText,
  type ChunkerConfig,
  type Chunk,
} from './chunker.js';

export {
  TikaSourceAdapter,
  type TikaSourceConfig,
} from './tika-source-adapter.js';
