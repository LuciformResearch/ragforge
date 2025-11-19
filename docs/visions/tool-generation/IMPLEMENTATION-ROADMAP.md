# Tool Generation Implementation Roadmap

**Quick reference for implementing the config-driven tool generation system.**

Full details: [TOOL-GENERATION-ARCHITECTURE.md](./TOOL-GENERATION-ARCHITECTURE.md)

---

## Overview

Implement systematic tool generation from `ragforge.config.yaml`:
- Auto-generate database query tools during `ragforge generate`
- Expose complete entity schema (fields, unique IDs, relationships)
- Support computed fields (line_count, modified_at, etc.)
- Separate generic (auto-generated) from custom (user-coded) tools

**Goal**: Agents know exactly what data exists and how to query it.

---

## File Overview

### Files to Create (New)

```
📁 packages/core/src/tools/
  ├── 📄 tool-generator.ts              # Main tool generation logic
  ├── 📄 tool-generator.test.ts         # Unit tests
  └── 📁 types/
      └── 📄 index.ts                   # Tool type definitions

📁 packages/core/src/tools/specialized/
  ├── 📄 date-range-tool.ts             # Date range query generator
  ├── 📄 number-range-tool.ts           # Numeric range query generator
  ├── 📄 pattern-tool.ts                # Pattern matching query generator
  └── 📄 index.ts

📁 packages/core/src/tools/advanced/
  ├── 📄 change-tracking-tools.ts       # Leverage existing ChangeTracker
  ├── 📄 fulltext-tools.ts              # Neo4j full-text index tools
  ├── 📄 aggregation-tools.ts           # COUNT/AVG/SUM/GROUP BY
  ├── 📄 graph-analytics-tools.ts       # PageRank, community detection
  ├── 📄 multi-entity-join-tools.ts     # Complex cross-entity queries
  └── 📄 index.ts

📁 packages/core/src/computed/
  ├── 📄 field-evaluator.ts             # Runtime computation logic
  └── 📄 field-evaluator.test.ts

📁 packages/core/templates/tools/
  ├── 📄 database-tools.ts.template
  ├── 📄 custom-tools.ts.template
  └── 📄 index.ts.template

📁 ragforge/docs/
  ├── 📄 TOOL-GENERATION-API.md
  ├── 📄 CUSTOM-TOOLS-GUIDE.md
  ├── 📄 COMPUTED-FIELDS-GUIDE.md
  └── 📄 MIGRATION-TO-GENERATED-TOOLS.md

📁 ragforge/examples/
  ├── 📁 code-rag-complete/
  ├── 📁 product-catalog-rag/
  └── 📁 document-rag/
```

### Files to Modify (Existing)

```
✏️ packages/core/src/generator/code-generator.ts
   - Add tools to GeneratedCode interface
   - Add generateDatabaseTools() method

✏️ packages/core/src/types/config.ts
   - Add ComputedFieldConfig interface
   - Add computed_fields to EntityConfig

✏️ packages/cli/src/commands/generate.ts
   - Write tools/ directory to output
   - Preserve custom-tools.ts across regeneration

✏️ packages/runtime/src/query/query-builder.ts
   - Support ORDER BY on computed fields
   - Inject WITH clause for runtime computation

✏️ ragforge/README.md
   - Add tool generation section

✏️ ragforge/docs/QUICKSTART.md
   - Include tool generation in quick start
```

### Files to Reference (No Changes)

```
📖 examples/tool-calling-agent/database-tools-generator.ts
   - Current manual implementation (reference)

📖 packages/runtime/src/types/chat.ts
   - Tool, ToolParameter type definitions

📖 packages/runtime/src/adapters/change-tracker.ts
   - Existing change tracking (leverage for tools)
```

---

## Implementation Phases

### [Phase 1: Core Tool Generation](./TOOL-GENERATION-ARCHITECTURE.md#L1375) (Week 1-2)

**Goal**: Basic `generateToolsFromConfig()` function working

**Tasks**:
- Create `packages/core/src/tools/tool-generator.ts`
- Implement `generateToolsFromConfig(config)` function
- Extract searchable_fields, unique_field, relationships from config
- Generate enhanced tool descriptions:
  - **query_entities**: All searchable fields + types + descriptions + unique fields
  - **semantic_search**: Vector indexes + unique fields
  - **explore_relationships**: Relationship mappings (source → target) + directions + unique IDs
  - **get_entity_by_id**: Unique fields for all entities
- Generate tool handlers using RagClient
- Unit tests for tool generation
- Integration test with ToolRegistry

**Deliverable**: Runtime function `generateToolsFromConfig()` that creates tools with complete schema exposure

**Files to Create**:
```
📁 packages/core/src/tools/
  └── 📄 tool-generator.ts              # Main tool generation logic
      └── 📄 tool-generator.test.ts     # Unit tests

📁 packages/core/src/tools/types/
  └── 📄 index.ts                       # Tool type definitions
```

**Files to Reference/Modify**:
- 📖 Read: [`examples/tool-calling-agent/database-tools-generator.ts`](../../../examples/tool-calling-agent/database-tools-generator.ts)
  - Current manual implementation (lines 12-344)
  - Shows tool structure and handler patterns
- 📖 Read: [`packages/core/src/types/config.ts`](../../../packages/core/src/types/config.ts)
  - RagForgeConfig type definition
  - EntityConfig, searchable_fields structure
- 📖 Read: [`packages/runtime/src/types/chat.ts`](../../../packages/runtime/src/types/chat.ts)
  - Tool, ToolParameter type definitions (lines 113-139)

---

### [Phase 2: ragforge generate Integration](./TOOL-GENERATION-ARCHITECTURE.md#L1398) (Week 2-3)

**Goal**: Auto-generate tools alongside client code during `ragforge generate`

**Tasks**:
- Add `tools` to `GeneratedCode` interface in code-generator.ts
- Create template files:
  - `templates/tools/database-tools.ts.template` (auto-generated, regenerated)
  - `templates/tools/custom-tools.ts.template` (user-editable, preserved)
  - `templates/tools/index.ts.template` (combines both)
- Modify `CodeGenerator.generate()` to call `generateDatabaseTools()`
- Update CLI to include tools in output directory structure
- Test generation with example config

**Deliverable**: `ragforge generate` creates `generated-client/tools/` directory

**Output Structure** (in user project after `ragforge generate`):
```
generated-client/
├─ tools/
│  ├─ database-tools.ts      # Auto-generated, DO NOT EDIT
│  ├─ custom-tools.ts        # User-editable, preserved
│  └─ index.ts               # setupToolRegistry function
```

**Files to Create**:
```
📁 packages/core/templates/tools/
  ├── 📄 database-tools.ts.template      # Template for generated tools
  ├── 📄 custom-tools.ts.template        # Template for user custom tools
  └── 📄 index.ts.template               # Template for setupToolRegistry
```

**Files to Modify**:
- ✏️ Modify: [`packages/core/src/generator/code-generator.ts`](../../../packages/core/src/generator/code-generator.ts)
  - Lines 43-78: Add `tools` to `GeneratedCode` interface
  - Add `generateDatabaseTools()` method (around line 300+)
  - Modify `generate()` to include tools in output
- ✏️ Modify: [`packages/cli/src/commands/generate.ts`](../../../packages/cli/src/commands/generate.ts)
  - Update to write tools/ directory to output
  - Handle preservation of custom-tools.ts across regeneration

---

### [Phase 3: Computed Fields](./TOOL-GENERATION-ARCHITECTURE.md#L1412) (Week 3-4)

**Goal**: Support computed fields in config (line_count, modified_at, change_count, etc.)

**Tasks**:
- Extend config schema to include `computed_fields`
- Implement runtime computation strategies:
  - Simple expressions: `endLine - startLine`
  - Cypher queries: `OPTIONAL MATCH (n)-[:HAS_CHANGE]->(c:Change) RETURN c.timestamp`
- Include computed fields in tool descriptions
- Generate proper TypeScript types (readonly for computed fields)
- Test ORDER BY with computed fields
- Documentation for computed fields

**Config Example**:
```yaml
entities:
  - name: Scope
    computed_fields:
      - name: line_count
        type: number
        expression: "endLine - startLine"

      - name: modified_at
        type: timestamp
        cypher: |
          OPTIONAL MATCH (n)-[:HAS_CHANGE]->(c:Change)
          WITH n, c ORDER BY c.timestamp DESC LIMIT 1
          RETURN c.timestamp AS modified_at
```

**Deliverable**: Computed fields working end-to-end (config → tools → queries)

**Files to Create**:
```
📁 packages/core/src/computed/
  ├── 📄 field-evaluator.ts             # Runtime computation logic
  └── 📄 field-evaluator.test.ts        # Tests for expressions & cypher
```

**Files to Modify**:
- ✏️ Modify: [`packages/core/src/types/config.ts`](../../../packages/core/src/types/config.ts)
  - Add `ComputedFieldConfig` interface
  - Add `computed_fields?: ComputedFieldConfig[]` to `EntityConfig`
- ✏️ Modify: [`packages/core/src/tools/tool-generator.ts`](../../../packages/core/src/tools/tool-generator.ts)
  - Include computed fields in tool descriptions
  - Mark computed fields with "(computed)" tag
- ✏️ Modify: [`packages/runtime/src/query/query-builder.ts`](../../../packages/runtime/src/query/query-builder.ts)
  - Support ORDER BY on computed fields
  - Inject WITH clause for runtime computation

**Details**: [Computed Fields Solution](./TOOL-GENERATION-ARCHITECTURE.md#L848)

---

### [Phase 4: Specialized Tools](./TOOL-GENERATION-ARCHITECTURE.md#L1425) (Week 4-5)

**Goal**: Auto-generate specialized query tools based on field types

**Tasks**:
- Detect timestamp fields → generate `query_entities_by_date_range`
- Detect numeric fields → generate `query_entities_by_number_range`
- Detect string fields → generate `query_entities_by_pattern` (regex/glob)
- Conditional generation based on field types in config
- Tool description quality improvements
- Examples using specialized tools

**Generated Tools**:
- `query_entities_by_date_range` - For modified_at, created_at
- `query_entities_by_number_range` - For line_count, change_count, complexity scores
- `query_entities_by_pattern` - Regex/glob/fuzzy matching on string fields

**Deliverable**: 3+ specialized tools auto-generated based on config schema

**Files to Create**:
```
📁 packages/core/src/tools/specialized/
  ├── 📄 date-range-tool.ts             # Date range query generator
  ├── 📄 number-range-tool.ts           # Numeric range query generator
  ├── 📄 pattern-tool.ts                # Pattern matching query generator
  └── 📄 index.ts                       # Exports all specialized generators
```

**Files to Modify**:
- ✏️ Modify: [`packages/core/src/tools/tool-generator.ts`](../../../packages/core/src/tools/tool-generator.ts)
  - Add `includeSpecializedTools` option processing
  - Detect field types and conditionally generate tools
  - Import specialized generators

**Example Config Detection**:
```typescript
// If config has timestamp fields → generate date range tool
// If config has numeric fields → generate number range tool
// If config has string fields → generate pattern tool
```

**Details**: [Specialized Tools](./TOOL-GENERATION-ARCHITECTURE.md#L336)

---

### [Phase 5: Advanced Features](./TOOL-GENERATION-ARCHITECTURE.md#L1438) (Week 6+)

**Goal**: Advanced tools for full-text, analytics, aggregations, change tracking

**Tasks**:

**Change Tracking Tools** (leverages existing ChangeTracker):
- `get_entity_change_history` - View modification history with diffs
- `find_recently_modified_entities` - Find recent changes
- `get_most_modified_entities` - Identify code churn hot spots
- `get_change_statistics` - Aggregate change metrics
- `compare_entity_versions` - Diff between timestamps

**Other Advanced Tools**:
- Full-text search tool (when `full_text_index` in config)
- Aggregation tools (`aggregate_entities` - COUNT/AVG/SUM/GROUP BY)
- Graph analytics (PageRank, community detection - when Neo4j GDS available)
- Multi-entity join tool (complex cross-entity queries)
- Performance optimization (query planning, caching)
- Telemetry for auto-materialization of computed fields

**Deliverable**: Advanced tool suite with change tracking

**Files to Create**:
```
📁 packages/core/src/tools/advanced/
  ├── 📄 change-tracking-tools.ts       # Leverage existing ChangeTracker
  ├── 📄 fulltext-tools.ts              # Neo4j full-text index tools
  ├── 📄 aggregation-tools.ts           # COUNT/AVG/SUM/GROUP BY
  ├── 📄 graph-analytics-tools.ts       # PageRank, community detection
  ├── 📄 multi-entity-join-tools.ts     # Complex cross-entity queries
  └── 📄 index.ts                       # Exports all advanced tools
```

**Files to Reference**:
- 📖 Read: [`packages/runtime/src/adapters/change-tracker.ts`](../../../packages/runtime/src/adapters/change-tracker.ts)
  - Existing ChangeTracker implementation (lines 29-428)
  - Methods: `getEntityHistory()`, `getRecentChanges()`, `getMostModifiedEntities()`
  - Already provides all needed functionality - just expose as tools!

**Files to Modify**:
- ✏️ Modify: [`packages/core/src/tools/tool-generator.ts`](../../../packages/core/src/tools/tool-generator.ts)
  - Add options: `includeChangeTracking`, `includeAggregations`, etc.
  - Import advanced tool generators
  - Conditionally include based on config (e.g., detect if change tracking enabled)

**Details**:
- [Change Tracking Tools](./TOOL-GENERATION-ARCHITECTURE.md#L1268)
- [Full-Text Search](./TOOL-GENERATION-ARCHITECTURE.md#L1070)
- [Graph Analytics](./TOOL-GENERATION-ARCHITECTURE.md#L1114)
- [Aggregations](./TOOL-GENERATION-ARCHITECTURE.md#L416)

---

### [Phase 6: Documentation & Examples](./TOOL-GENERATION-ARCHITECTURE.md#L1457) (Ongoing)

**Goal**: Comprehensive documentation and examples

**Tasks**:
- API documentation for `generateToolsFromConfig()`
- Guide: "Writing Custom Tools"
- Guide: "Computed Fields Best Practices"
- Example: Code RAG with all tool types
- Example: Product catalog RAG with custom tools
- Migration guide from manual to generated tools
- Video/tutorial on tool generation workflow

**Deliverable**: Complete documentation suite

**Files to Create**:
```
📁 ragforge/docs/
  ├── 📄 TOOL-GENERATION-API.md         # API reference for generateToolsFromConfig
  ├── 📄 CUSTOM-TOOLS-GUIDE.md          # How to write custom tools
  ├── 📄 COMPUTED-FIELDS-GUIDE.md       # Best practices for computed fields
  └── 📄 MIGRATION-TO-GENERATED-TOOLS.md # Migration guide

📁 ragforge/examples/
  ├── 📁 code-rag-complete/              # Full example with all tool types
  │   ├── ragforge.config.yaml
  │   ├── test-all-tools.ts
  │   └── README.md
  │
  ├── 📁 product-catalog-rag/            # E-commerce example
  │   ├── ragforge.config.yaml
  │   ├── custom-tools.ts                # Custom business logic
  │   └── README.md
  │
  └── 📁 document-rag/                   # Documentation RAG example
      ├── ragforge.config.yaml
      └── README.md
```

**Files to Modify**:
- ✏️ Modify: [`ragforge/README.md`](../../../README.md)
  - Add section on tool generation
  - Link to detailed guides
- ✏️ Modify: [`ragforge/docs/QUICKSTART.md`](../../../docs/QUICKSTART.md) (if exists)
  - Include tool generation in quick start flow

---

## Key Architectural Decisions

| Decision | Rationale | Reference |
|----------|-----------|-----------|
| **Separate generic and custom tools** | Clear boundaries, preserves custom code across regeneration | [Generic vs Custom](./TOOL-GENERATION-ARCHITECTURE.md#L591) |
| **Runtime `generateToolsFromConfig()`** | Enables dynamic tool creation, testing, flexibility | [Core Proposal](./TOOL-GENERATION-ARCHITECTURE.md#L140) |
| **Integrate with `ragforge generate`** | Zero manual setup, tools always in sync with schema | [Integration](./TOOL-GENERATION-ARCHITECTURE.md#L455) |
| **Computed fields in config** | Config as single source of truth for schema | [Computed Fields](./TOOL-GENERATION-ARCHITECTURE.md#L848) |
| **Runtime computation by default** | Simpler, no migration, always accurate | [Implementation Strategies](./TOOL-GENERATION-ARCHITECTURE.md#L921) |
| **Expose complete schema in tools** | Agents need to know fields, unique IDs, relationships | [Enhanced Descriptions](./TOOL-GENERATION-ARCHITECTURE.md#L197) |
| **Change tracking via computed fields** | Leverage existing ChangeTracker, no manual updates | [Change Tracking](./TOOL-GENERATION-ARCHITECTURE.md#L1268) |

---

## Expected Outcomes

### For Agents
- ✅ Know exactly what fields exist on each entity
- ✅ Know unique identifiers for all entity types
- ✅ Know available relationships (with source → target mappings)
- ✅ Can query by any searchable field (including computed)
- ✅ Can track code changes and evolution
- ✅ Get specialized tools automatically based on field types

### For Developers
- ✅ Zero boilerplate - tools auto-generated
- ✅ Type-safe tools matching config
- ✅ Easy to add custom tools alongside generated ones
- ✅ Config-driven schema means single source of truth
- ✅ Tools stay in sync with database schema

### For RagForge
- ✅ Consistent tool generation across all projects
- ✅ Better agent performance out-of-the-box
- ✅ Easier onboarding (one config generates everything)
- ✅ Extensible system for future tool types

---

## Quick Start (After Implementation)

```bash
# 1. Define entities in config
vim ragforge.config.yaml

# 2. Generate client + tools
ragforge generate

# 3. Use in agent
import { setupToolRegistry } from './generated-client/tools/index.js';
const toolRegistry = setupToolRegistry(rag);

# 4. Add custom tools (optional)
vim generated-client/tools/custom-tools.ts
```

---

## Status Tracking

- [ ] Phase 1: Core Tool Generation
- [ ] Phase 2: ragforge generate Integration
- [ ] Phase 3: Computed Fields
- [ ] Phase 4: Specialized Tools
- [ ] Phase 5: Advanced Features
- [ ] Phase 6: Documentation & Examples

**Current Status**: PROPOSAL (awaiting approval)

---

**Full Technical Details**: [TOOL-GENERATION-ARCHITECTURE.md](./TOOL-GENERATION-ARCHITECTURE.md)
