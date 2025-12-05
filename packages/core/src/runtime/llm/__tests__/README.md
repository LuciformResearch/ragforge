# StructuredLLMExecutor Tests

Unit tests for the unified LLM API in RagForge.

## Running Tests

### With Mock LLM (fast, no API key required)
```bash
USE_REAL_LLM=false npm test
```

### With Real Gemini API
```bash
USE_REAL_LLM=true npm test
```

The tests automatically load `GEMINI_API_KEY` from `~/LR_CodeRag/.env`.

### Debug Mode
```bash
DEBUG_XML=true USE_REAL_LLM=true npm test
```

This will print the raw XML responses from Gemini to help debug parsing issues.

## Test Coverage

### ✅ Passing Tests (8)
- **executeLLMBatch with input fields** - Tests batch processing with field-based input
- **executeLLMBatch with EntityContext** - Tests schema-based entity formatting
- **Parallel batch processing** - Tests concurrent batch execution
- **Token-based packing** - Tests intelligent batching based on token budget
- **executeReranking** - Tests item ranking with LLM evaluation
- **Empty items handling** - Tests graceful handling of empty input
- **LLM error handling** - Tests error propagation from LLM provider
- **Token estimation** - Tests token budget calculations

### ⏭️ Skipped Tests (5)
- **generateEmbeddings** (2 tests) - Require real embedding provider setup
- **queryFeedback** - Not yet implemented in executeReranking
- **Malformed XML handling** - Depends on LuciformXMLParser error behavior
- **Optional fields validation** - Needs custom provider investigation

## Test Features

### Mock LLM Provider
The mock provider intelligently parses prompts to extract expected XML schema and generates valid responses. It detects:
- Field names from XML example format
- Number of items to generate (from `[Item N]` markers)
- Root element name

### Real LLM Testing
Tests use Gemini API with configuration:
- Model: `gemini-2.0-flash-exp`
- Max output tokens: 2048
- Temperature: 0.1 (deterministic)
- Timeout: 30 seconds per test

### XML Parsing Features
The executor handles Gemini's varied XML output:
- **ID-based merging**: When Gemini generates multiple `<item id="0">` elements with different fields, they're merged into one object
- **Flexible attribute access**: Handles both Map-based and object-based attributes
- **Text extraction**: Properly extracts text content from nested XML elements
- **Markdown code blocks**: Automatically strips ```xml...``` wrappers

## Common Warnings

These warnings are informational and don't cause test failures:

```
Required field "X" missing in XML response
```

This occurs when Gemini doesn't generate all optional fields. The executor handles this gracefully by using default values or leaving fields undefined.

## Implementation Status

### ✅ Complete
- `executeLLMBatch()` - Full batch LLM processing
- `executeReranking()` - Item ranking and evaluation
- EntityContext integration
- Token packing and parallel execution
- XML/JSON parsing with schema validation

### 🚧 TODO
- `queryFeedback` in executeReranking (lines 276-280)
- `generateEmbeddings()` - Real provider integration tests
- JSON output format support (currently XML-only in tests)

## Architecture

The tests validate three migration paths:

1. **LLMReranker** → `StructuredLLMExecutor.executeReranking()`
   - Validates relevance scoring
   - Ensures EntityContext formatting works

2. **GenericSummarizer** → `StructuredLLMExecutor.executeLLMBatch()`
   - Tests field summarization
   - Validates strategy-based prompting

3. **Direct Usage** → `StructuredLLMExecutor.executeLLMBatch()`
   - Generic structured output generation
   - Custom schema validation
