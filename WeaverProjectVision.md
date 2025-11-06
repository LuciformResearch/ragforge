# Weaver: Autonomous RAG Framework Generator

**Vision**: An autonomous agent that transforms arbitrary document collections into production-ready RAG systems by discovering domain patterns, designing optimal chunking strategies, and generating custom frameworks.

## Overview

Weaver is the ultimate abstraction for RagForge - it goes from "pile of random files" to "working RAG system with demo agent" in a fully autonomous multi-phase pipeline.

### Core Innovation

Rather than requiring users to understand their data and design RAG strategies manually, Weaver:
1. **Discovers patterns** across documents through hierarchical summarization
2. **Invents RAG types** dynamically based on document characteristics
3. **Generates processing pipelines** tailored to each discovered pattern
4. **Creates the entire stack** from ingestion to query interface

---

## Phase 1: Document Normalization

**Goal**: Convert all input files into a processable format (markdown, XML, CSV, etc.)

### Tools & Strategies

**Document Conversion Libraries**:
- **Apache Tika**: Universal document parser (PDF, Office, etc.)
- **Pandoc**: Markdown conversion from various formats
- **pdf2md**: PDF to Markdown specifically
- **mammoth**: Clean DOCX to HTML/markdown conversion
- **xlsx**: Excel to CSV/JSON

**OCR & Vision**:
- **DeepSeek OCR**: For scanned documents, images, complex PDFs
- **Tesseract**: Fallback OCR engine
- **LLM Vision** (GPT-4V, Claude): For complex layouts, diagrams

### Process

```
For each file in collection:
  1. Detect file type (extension, magic bytes, content analysis)
  2. Try applicable conversion tools in order of quality:
     - Native parsers (Tika, Pandoc, etc.)
     - Format-specific tools
     - OCR as last resort
  3. Track conversion quality metadata:
     - Success/failure
     - Conversion method used
     - Confidence score
     - Warnings (e.g., "table formatting lost")
```

### Output

- Normalized documents (primarily .md, .xml, .csv)
- Conversion metadata for each file
- Quality assessment

---

## Phase 2: L0 Summaries (Document-Level Analysis)

**Goal**: Create structured summaries for each individual document with RAG recommendations

### L0 Structure

```typescript
interface L0Summary {
  documentId: string;
  originalPath: string;
  fileType: string;
  conversionMethod: string;

  // Content analysis
  summary: string;              // What the document is about
  keyTopics: string[];          // Main topics/themes
  structure: string;            // How it's structured (sections, tables, etc.)

  // RAG recommendations
  ragSuggestions: {
    chunkingStrategy: string;   // "Keep tables together", "Split by section", etc.
    indexingPriority: number;   // How important for search (0-1)
    embeddingStrategy: string;  // "Dense chunks", "Sparse key points", etc.
    metadata: string[];         // What metadata to extract
    relationships: string[];    // Potential links to other docs
  };

  // Quality metrics
  contentQuality: number;       // Readability, completeness (0-1)
  structureQuality: number;     // How well-structured (0-1)

  // Sample content
  snippet: string;              // Representative excerpt
}
```

### Process

For each normalized document, call LLM with prompt:

```
Analyze this document and provide a structured summary including:
1. What is this document about? (1-2 sentences)
2. What are the key topics/themes?
3. How is it structured? (sections, tables, lists, etc.)
4. How should we chunk this for RAG? Consider:
   - Should we preserve tables?
   - Split by sections or fixed size?
   - Keep related information together?
5. What metadata should we extract? (dates, authors, categories, etc.)
6. How might this relate to other documents?
7. Rate content and structure quality (0-1)
```

---

## Phase 3: L1 Summaries (First Aggregation)

**Goal**: Process batches of L0 summaries to discover RAG type patterns

### Process

```
1. Group L0 summaries into batches (e.g., 10-20 per batch)

2. For each batch, call LLM:
   "Review these document summaries and their RAG suggestions.
    Identify common patterns and propose RAG types.

    For example, you might discover:
    - 'Legal Contracts': Dense documents, preserve clause structure,
       extract parties/dates, link by references
    - 'Technical Manuals': Hierarchical sections, extract diagrams separately,
       index procedures, cross-reference by topic
    - 'Meeting Notes': Chronological, extract action items,
       link by attendees/projects"

3. Extract RAG type definitions:
   - Type name
   - Description
   - Chunking strategy
   - Metadata schema
   - Relationship patterns

4. Assign best-matching RAG type to each L0 in batch

5. Create L1 summary combining patterns from the batch
```

### L1 Structure

```typescript
interface L1Summary {
  batchId: string;
  l0Ids: string[];              // Which L0s this summarizes

  // Discovered patterns
  ragTypes: RAGType[];          // New RAG types discovered
  commonThemes: string[];       // Cross-document themes
  structuralPatterns: string[]; // Common structures

  // Aggregated recommendations
  typeAssignments: Map<string, string>; // L0 ID -> RAG type
  crossDocLinks: {              // Potential relationships
    fromL0: string;
    toL0: string;
    linkType: string;
  }[];

  // Meta
  summary: string;              // What this batch represents
}

interface RAGType {
  name: string;                 // e.g., "Legal Contracts"
  description: string;
  confidence: number;           // How confident (0-1)

  // Processing strategy
  chunkingStrategy: {
    method: 'semantic' | 'structural' | 'fixed' | 'hybrid';
    preserveElements: string[]; // "tables", "code blocks", etc.
    splitOn: string[];          // "sections", "paragraphs", etc.
    targetSize: number;         // Approximate chunk size
  };

  // Schema
  metadataSchema: {
    field: string;
    type: string;
    extraction: string;         // How to extract
  }[];

  // Relationships
  relationshipTypes: {
    type: string;               // e.g., "REFERENCES", "SIMILAR_TO"
    description: string;
    detectionMethod: string;    // How to detect this relationship
  }[];

  // Graph modeling
  nodeLabels: string[];         // Neo4j node types to create
  properties: string[];         // What properties to store
}
```

---

## Phase 4: L2...LX Summaries (Recursive Aggregation)

**Goal**: Continue aggregating until we have one global summary with refined RAG types

### Process

```
Level N (starting from 2):
  1. Group L(N-1) summaries into batches

  2. For each batch, call LLM:
     "Review these aggregate summaries.
      Refine the RAG types - merge similar ones, split complex ones.
      Identify higher-level patterns across batches.
      Update type definitions based on broader context."

  3. Create LN summary:
     - Refined RAG type definitions
     - Updated type assignments for all L0s
     - Cross-batch patterns
     - Higher-level themes

  4. If only one LN summary remains: DONE
     Else: N++ and repeat
```

### Final LX Summary

```typescript
interface LXFinalSummary {
  // Complete corpus analysis
  globalSummary: string;                // What the entire collection represents
  documentCount: number;

  // Final RAG types
  ragTypes: RAGType[];                  // Refined, non-overlapping types

  // Complete mapping
  typeAssignments: Map<string, string>; // Every L0 -> RAG type

  // Global relationship graph
  documentGraph: {                      // How documents relate
    nodes: { id: string; type: string; }[];
    edges: { from: string; to: string; type: string; }[];
  };

  // Recommendations
  ingestionOrder: string[];             // Optimal order to process types
  indexingStrategies: Map<string, string>; // Type -> index config
  queryPatterns: string[];              // Expected query types
}
```

---

## Phase 5: Processing Pipeline Generation

**Goal**: For each RAG type, generate custom processing code

### 5.1: Code Generation per RAG Type

For each discovered RAG type:

```
1. Call specialized code generation LLM (e.g., Gemini 2.0 Flash Thinking):

   Prompt:
   "Generate a complete processing script for RAG type: {type.name}

    Description: {type.description}
    Chunking strategy: {type.chunkingStrategy}
    Metadata schema: {type.metadataSchema}

    The script should:
    1. Read markdown/xml input files
    2. Apply the chunking strategy
    3. Extract metadata per the schema
    4. Use an LLM to:
       - Generate summaries for each chunk
       - Extract structured data
       - Identify relationships
    5. Output standardized XML format:
       <documents>
         <document id="..." type="...">
           <metadata>...</metadata>
           <chunks>
             <chunk id="...">
               <content>...</content>
               <summary>...</summary>
               <embedding_text>...</embedding_text>
             </chunk>
           </chunks>
           <relationships>
             <relationship type="..." target="..." />
           </relationships>
         </document>
       </documents>

    Use TypeScript and include error handling."

2. Review and validate generated script
3. Test on sample documents
4. Refine if needed
```

### 5.2: Process All Documents

```
For each RAG type:
  1. Get all L0s assigned to this type
  2. Run the generated processing script on each
  3. Collect XML outputs
  4. Validate XML against schema
```

### 5.3: Neo4j Ingestion Script Generation

```
For each RAG type's XML output:
  1. Analyze XML structure
  2. Generate Neo4j ingestion script:
     - Node creation (documents, chunks, metadata entities)
     - Relationship creation
     - Index creation (full-text, vector)
     - Constraint creation (uniqueness)

  3. Run ingestion script
  4. Validate graph structure
```

---

## Phase 6: RagForge Config Generation

**Goal**: Generate RagForge configuration from ingested Neo4j graph

### Process

```
1. Use SchemaIntrospector to analyze the Neo4j database
2. Use ConfigGenerator to create initial config
3. Enhance with LX summary insights:
   - Add custom reranking strategies based on query patterns
   - Configure vector indexes per RAG type recommendations
   - Set up MCP tools for discovered relationship types
4. Generate TypeScript types
```

### Enhanced Config

The auto-generated config gets enriched with:
- **Custom reranking**: Based on document quality scores, recency, relationship centrality
- **Domain-specific tools**: Extracted from relationship types
- **Query templates**: Common query patterns from LX analysis

---

## Phase 7: Demo Agent Generation

**Goal**: Create a specialized agent that demonstrates the RAG system

### Agent Capabilities

```typescript
interface WeaverDemoAgent {
  // Core RAG operations
  search(query: string, options?: SearchOptions): SearchResult[];

  // Relationship traversal
  findRelated(documentId: string, relationshipType?: string): Document[];

  // Metadata queries
  filterByMetadata(filters: Record<string, any>): Document[];

  // Explanations
  explainRelevance(resultId: string): RelevanceExplanation;
  showSources(resultId: string): Source[];

  // Stats
  getCorpusStats(): CorpusStatistics;
  getRAGTypeBreakdown(): { type: string; count: number; }[];
}
```

### Agent Generation

```
1. Generate agent code using the RagForge framework
2. Include system prompt with:
   - Corpus description from LX summary
   - Available RAG types and their purposes
   - Common query patterns
   - Relationship explanations
3. Connect to Neo4j and vector indexes
4. Add conversation memory for multi-turn queries
5. Package as MCP server for easy integration
```

### Demo Interface

```
User: "What documents do we have about authentication?"

Agent:
"I found 12 documents across 3 RAG types:

**Technical Documentation** (7 docs):
- OAuth 2.0 Implementation Guide (relevance: 0.95)
- JWT Best Practices (relevance: 0.89)
...

**API Specifications** (3 docs):
- Auth API Endpoints v2.3 (relevance: 0.92)
...

**Meeting Notes** (2 docs):
- Security Review 2024-01 (relevance: 0.76)
...

Would you like me to:
1. Show summaries
2. Find related documents
3. Filter by a specific type
4. Explain the relevance scores"
```

---

## Technology Stack

### Phase 1 (Normalization)
- Apache Tika, Pandoc, pdf2md
- DeepSeek OCR API
- Tesseract OCR

### Phase 2-4 (Analysis & Summarization)
- Claude Sonnet (structured analysis)
- Parallel processing with batching
- Structured output with schema validation

### Phase 5 (Code Generation)
- Gemini 2.0 Flash Thinking (code generation)
- TypeScript/Node.js runtime
- XML schema validation

### Phase 6 (Ingestion)
- Neo4j with APOC
- Vector indexes (OpenAI embeddings)
- Full-text search indexes

### Phase 7 (Framework & Agent)
- RagForge generated framework
- MCP (Model Context Protocol)
- TypeScript client library

---

## Example End-to-End Flow

### Input
```
my_documents/
├── contracts/
│   ├── vendor_agreement_2024.pdf
│   └── employment_contracts/
├── manuals/
│   ├── product_guide.docx
│   └── troubleshooting.md
└── research/
    ├── market_analysis.xlsx
    └── whitepaper.pdf
```

### Weaver Execution

```bash
$ weaver generate my_documents/
```

**Phase 1**: Converts all PDFs, DOCX, XLSX to markdown/CSV

**Phase 2**: Creates 50 L0 summaries with RAG suggestions

**Phase 3**: Discovers 3 RAG types from 5 L1 batches:
- "Legal Contracts" (12 docs)
- "Technical Documentation" (25 docs)
- "Business Analytics" (13 docs)

**Phase 4**: Creates L2, then L3 (final) summary, refines types

**Phase 5**: Generates 3 processing scripts, creates structured XML, ingests to Neo4j

**Phase 6**: Generates RagForge config with:
- 8 entity types
- 12 relationship types
- 3 vector indexes
- 5 reranking strategies
- 7 MCP tools

**Phase 7**: Creates demo agent

### Output

```bash
$ weaver chat

Weaver Demo Agent ready!
Corpus: 50 documents across 3 RAG types
Ask me anything about your documents.

> What vendor agreements do we have?
...
```

---

## Future Enhancements

### Weaver Studio (UI)
- Visual corpus explorer
- RAG type editor (refine discovered types)
- Query builder
- Relationship graph visualization

### Weaver Learn
- Feedback loop: track which results users click
- Refine chunking strategies based on usage
- Auto-tune reranking weights

### Weaver Connect
- Cross-corpus queries (multiple RAG systems)
- Federated search
- Knowledge graph merging

### Weaver Cloud
- Hosted service
- Collaborative corpus building
- Pre-trained RAG type detectors

---

## Why This Is Revolutionary

**Before Weaver**:
1. Manually analyze documents → weeks
2. Design chunking strategy → days
3. Write ingestion code → days
4. Configure indexes → hours
5. Build query interface → days
6. Test and refine → weeks

**Total**: 1-2 months of expert work

**With Weaver**:
1. Point at folder
2. Wait 30-60 minutes
3. Get production-ready RAG system

**Total**: 1 hour, zero expertise required

---

## Implementation Roadmap

### MVP (v0.1)
- [ ] Phase 1: Basic normalization (Tika + Pandoc)
- [ ] Phase 2: L0 generation with Claude
- [ ] Phase 3: L1 generation with simple batching
- [ ] Phase 5: Manual template-based processing
- [ ] Phase 6: Use existing RagForge ConfigGenerator
- [ ] Phase 7: Basic agent with MCP

### v0.2
- [ ] Phase 4: Full LX recursive aggregation
- [ ] Phase 5: LLM-generated processing code
- [ ] Enhanced RAG type detection
- [ ] Quality metrics and validation

### v0.3
- [ ] Phase 1: OCR support (DeepSeek)
- [ ] Advanced relationship detection
- [ ] Multi-modal support (images, diagrams)
- [ ] Performance optimization (parallel processing)

### v1.0
- [ ] Weaver Studio (web UI)
- [ ] Feedback loop integration
- [ ] Production deployment guides
- [ ] Enterprise features (auth, monitoring)

---

## Conclusion

Weaver represents the ultimate abstraction for RAG systems: from unstructured documents to production-ready knowledge base with **zero manual configuration**.

By combining hierarchical analysis, pattern discovery, code generation, and framework automation, Weaver makes sophisticated RAG accessible to anyone with a folder of documents.

**The vision**: In the future, building a RAG system should be as simple as:
```bash
weaver create my_documents/
```

And that's it. Weaver handles everything else.
