# Tool Generation System - Documentation Index

This directory contains the complete architecture and implementation plan for RagForge's config-driven tool generation system.

---

## 📋 Quick Links

### Primary Documents

1. **[IMPLEMENTATION-ROADMAP.md](./IMPLEMENTATION-ROADMAP.md)** ⭐ **START HERE**
   - Concise phase-by-phase implementation plan
   - Quick reference with clickable links to detailed sections
   - Status tracking

2. **[TOOL-GENERATION-ARCHITECTURE.md](./TOOL-GENERATION-ARCHITECTURE.md)**
   - Complete technical specification (1800+ lines)
   - Detailed architectural decisions
   - Implementation strategies
   - Code examples and use cases

3. **[HYBRID-AGENT-SYSTEM.md](./HYBRID-AGENT-SYSTEM.md)** 🆕
   - Hybrid approach combining text2cypher + generated tools + semantic search
   - Discovery tools for schema awareness
   - Decision matrix: when to use which tool
   - Integration with ragforge.config.yaml

---

## 🎯 What This System Does

**Generate database query tools automatically from `ragforge.config.yaml`:**

- ✅ Auto-generate tools during `ragforge generate`
- ✅ Expose complete schema (fields, unique IDs, relationships) to agents
- ✅ Support computed fields (line_count, modified_at from change tracking)
- ✅ Separate generic (config-driven) from custom (user-coded) tools
- ✅ Generate specialized tools based on field types (date ranges, number ranges, patterns)
- ✅ Integrate with existing change tracking system

**Result**: Agents know exactly what data exists and how to query it, with zero boilerplate.

---

## 📚 Related Documentation

### In Parent Directory (`/visions/`)

- **[AGENT-TOOLS-FROM-CONFIG.md](../AGENT-TOOLS-FROM-CONFIG.md)**
  - Earlier vision document on agent tool exposition
  - Fluent API design concepts
  - Generic query builder architecture

### In `/visions/exposed_tools/`

- **[AGENT-TOOL-FEEDBACK-SYSTEM.md](../exposed_tools/AGENT-TOOL-FEEDBACK-SYSTEM.md)**
  - Tool feedback and debug mode design
  - Post-loop structured responses

- **[SPECIALIZED-SEARCH-TOOLS-ROADMAP.md](../exposed_tools/SPECIALIZED-SEARCH-TOOLS-ROADMAP.md)**
  - Specialized search capabilities
  - Date ranges, number ranges, pattern matching

---

## 🚀 Implementation Status

Current: **PROPOSAL** (awaiting approval)

### Phases

- [ ] **Phase 1**: Core Tool Generation (Week 1-2)
- [ ] **Phase 2**: ragforge generate Integration (Week 2-3)
- [ ] **Phase 3**: Computed Fields (Week 3-4)
- [ ] **Phase 4**: Specialized Tools (Week 4-5)
- [ ] **Phase 5**: Advanced Features (Week 6+)
- [ ] **Phase 6**: Documentation & Examples (Ongoing)

See [IMPLEMENTATION-ROADMAP.md](./IMPLEMENTATION-ROADMAP.md) for detailed task breakdowns.

---

## 🔑 Key Concepts

### 1. Config-Driven Tool Generation

**Before** (manual):
```typescript
// Manually code each tool
const tools = [
  { name: 'query_entities', description: '...' },
  // ... tedious manual work
];
```

**After** (automatic):
```yaml
# ragforge.config.yaml
entities:
  - name: Scope
    searchable_fields:
      - name: name
        type: string
```

```bash
$ ragforge generate
✓ Generated client
✓ Generated 8 database tools  # ← Automatic!
✓ Generated tool registry setup
```

### 2. Complete Schema Exposure

Tools automatically document:
- All searchable fields with types and descriptions
- Unique identifiers for each entity
- Available relationships (source → target entity mappings)
- Vector indexes and what fields they cover
- Computed fields (derived from existing data)

### 3. Generic vs Custom Tools

**Generic** (auto-generated, regenerated on every `ragforge generate`):
- `query_entities` - Flexible WHERE/ORDER BY queries
- `semantic_search` - Vector similarity search
- `explore_relationships` - Graph traversal
- `query_entities_by_date_range` - Temporal queries
- `query_entities_by_number_range` - Numeric range filters
- ... auto-generated based on config

**Custom** (user-coded, preserved across regeneration):
```typescript
// generated-client/tools/custom-tools.ts
export const customTools = [
  {
    name: 'calculate_complexity_score',
    // Your domain-specific logic
  }
];
```

### 4. Computed Fields

Define derived values in config:

```yaml
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

Agents can then query/order by these fields automatically.

---

## 📖 Reading Guide

### For Product/Leadership
1. Read [IMPLEMENTATION-ROADMAP.md](./IMPLEMENTATION-ROADMAP.md) - "Overview" and "Expected Outcomes"
2. Skim [TOOL-GENERATION-ARCHITECTURE.md](./TOOL-GENERATION-ARCHITECTURE.md) - "Executive Summary"

### For Architects
1. Read [IMPLEMENTATION-ROADMAP.md](./IMPLEMENTATION-ROADMAP.md) in full
2. Read [TOOL-GENERATION-ARCHITECTURE.md](./TOOL-GENERATION-ARCHITECTURE.md) sections:
   - Executive Summary
   - Current State Analysis
   - Core Proposal
   - Key Architectural Decisions

### For Implementers
1. Start with [IMPLEMENTATION-ROADMAP.md](./IMPLEMENTATION-ROADMAP.md)
2. Use as index to navigate [TOOL-GENERATION-ARCHITECTURE.md](./TOOL-GENERATION-ARCHITECTURE.md)
3. Focus on your current phase:
   - Phase 1 → [Core Tool Generation](./TOOL-GENERATION-ARCHITECTURE.md#L1375)
   - Phase 2 → [Integration](./TOOL-GENERATION-ARCHITECTURE.md#L1398)
   - Phase 3 → [Computed Fields](./TOOL-GENERATION-ARCHITECTURE.md#L1412)
   - etc.

---

## 🤝 Contributing

When implementing:
1. Check off tasks in [IMPLEMENTATION-ROADMAP.md](./IMPLEMENTATION-ROADMAP.md)
2. Update status sections
3. Add implementation notes or gotchas
4. Link to PRs and code references

---

## 📝 Document History

- **2025-11-19**: Initial architecture and roadmap created
- **Status**: Proposal phase, awaiting approval

---

**Questions?** See full details in [TOOL-GENERATION-ARCHITECTURE.md](./TOOL-GENERATION-ARCHITECTURE.md)
