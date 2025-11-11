# Complete Generation - Detailed Roadmap

Cette roadmap détaille l'option `--complete` pour **générer automatiquement TOUS les filtres et expands possibles**.

---

## 🎯 Objectif

Avec `--complete`, RagForge génère **tous les filtres et expands imaginables** pour une DX maximale:

```typescript
// Au lieu de juste .whereName()
.whereName(value)
.whereNameContains(value)
.whereNameStartsWith(value)
.whereNameEndsWith(value)
.whereNameMatches(regex)
.whereNameIn(values[])
.whereNameNotIn(values[])

// Expands conditionnels
.withDefinedIn(depth)
.withDefinedInWhere(filter, depth)
.withDefinedInSelect(fields, depth)
.withDefinedInLimit(n, depth)
```

---

## 📊 Analyse de l'existant

### Ce qui est déjà généré

```typescript
// packages/core/src/generator/code-generator.ts:444
private static generateFieldMethod(entityName: string, field: any): string[] {
  // Génère seulement:
  // - .whereFieldName(value)         pour strings
  // - .whereFieldNameIn(values[])     via whereIn()
  // - .whereFieldNamePattern(regex)   via wherePattern()
}

// packages/core/src/generator/code-generator.ts:507
private static generateRelationshipMethod(rel: any): string[] {
  // Génère seulement:
  // - .withRelationshipType(depth)
}
```

**Limitation actuelle**: Seulement les méthodes de base

---

## 🏗️ Architecture proposée

### 1. Filter Method Factory

```typescript
// packages/core/src/generator/filter-method-factory.ts

export interface FilterMethodTemplate {
  name: string;
  description: string;
  parameters: ParameterTemplate[];
  cypher: (params: any) => string;
  applicableTypes: string[];  // ['string', 'number', 'datetime']
}

export class FilterMethodFactory {
  private templates: Map<string, FilterMethodTemplate> = new Map();

  constructor() {
    this.registerBuiltInTemplates();
  }

  /**
   * Templates built-in pour différents types
   */
  private registerBuiltInTemplates(): void {
    // String methods
    this.register({
      name: 'contains',
      description: 'Filter by substring match (case-insensitive)',
      parameters: [
        { name: 'value', type: 'string', required: true }
      ],
      cypher: (params) => `toLower(n.${params.field}) CONTAINS toLower($${params.varName})`,
      applicableTypes: ['string']
    });

    this.register({
      name: 'startsWith',
      description: 'Filter by prefix match',
      parameters: [
        { name: 'value', type: 'string', required: true }
      ],
      cypher: (params) => `n.${params.field} STARTS WITH $${params.varName}`,
      applicableTypes: ['string']
    });

    this.register({
      name: 'endsWith',
      description: 'Filter by suffix match',
      parameters: [
        { name: 'value', type: 'string', required: true }
      ],
      cypher: (params) => `n.${params.field} ENDS WITH $${params.varName}`,
      applicableTypes: ['string']
    });

    this.register({
      name: 'matches',
      description: 'Filter by regex pattern',
      parameters: [
        { name: 'pattern', type: 'RegExp | string', required: true }
      ],
      cypher: (params) => `n.${params.field} =~ $${params.varName}`,
      applicableTypes: ['string']
    });

    this.register({
      name: 'in',
      description: 'Filter by value in array',
      parameters: [
        { name: 'values', type: 'T[]', required: true }
      ],
      cypher: (params) => `n.${params.field} IN $${params.varName}`,
      applicableTypes: ['string', 'number', 'datetime']
    });

    this.register({
      name: 'notIn',
      description: 'Filter by value not in array',
      parameters: [
        { name: 'values', type: 'T[]', required: true }
      ],
      cypher: (params) => `NOT n.${params.field} IN $${params.varName}`,
      applicableTypes: ['string', 'number', 'datetime']
    });

    // Number methods
    this.register({
      name: 'greaterThan',
      description: 'Filter by greater than',
      parameters: [
        { name: 'value', type: 'number', required: true }
      ],
      cypher: (params) => `n.${params.field} > $${params.varName}`,
      applicableTypes: ['number']
    });

    this.register({
      name: 'lessThan',
      description: 'Filter by less than',
      parameters: [
        { name: 'value', type: 'number', required: true }
      ],
      cypher: (params) => `n.${params.field} < $${params.varName}`,
      applicableTypes: ['number']
    });

    this.register({
      name: 'between',
      description: 'Filter by range (inclusive)',
      parameters: [
        { name: 'min', type: 'number', required: true },
        { name: 'max', type: 'number', required: true }
      ],
      cypher: (params) => `n.${params.field} >= $${params.varName}_min AND n.${params.field} <= $${params.varName}_max`,
      applicableTypes: ['number', 'datetime']
    });

    // DateTime methods
    this.register({
      name: 'after',
      description: 'Filter by datetime after',
      parameters: [
        { name: 'date', type: 'Date | string', required: true }
      ],
      cypher: (params) => `n.${params.field} > datetime($${params.varName})`,
      applicableTypes: ['datetime']
    });

    this.register({
      name: 'before',
      description: 'Filter by datetime before',
      parameters: [
        { name: 'date', type: 'Date | string', required: true }
      ],
      cypher: (params) => `n.${params.field} < datetime($${params.varName})`,
      applicableTypes: ['datetime']
    });

    // Boolean methods
    this.register({
      name: 'isTrue',
      description: 'Filter by true value',
      parameters: [],
      cypher: (params) => `n.${params.field} = true`,
      applicableTypes: ['boolean']
    });

    this.register({
      name: 'isFalse',
      description: 'Filter by false value',
      parameters: [],
      cypher: (params) => `n.${params.field} = false`,
      applicableTypes: ['boolean']
    });

    // Null checks
    this.register({
      name: 'isNull',
      description: 'Filter by null value',
      parameters: [],
      cypher: (params) => `n.${params.field} IS NULL`,
      applicableTypes: ['string', 'number', 'datetime', 'boolean']
    });

    this.register({
      name: 'isNotNull',
      description: 'Filter by non-null value',
      parameters: [],
      cypher: (params) => `n.${params.field} IS NOT NULL`,
      applicableTypes: ['string', 'number', 'datetime', 'boolean']
    });
  }

  /**
   * Générer toutes les méthodes applicables pour un field
   */
  generateMethodsForField(
    entityName: string,
    field: SearchableField
  ): string[] {
    const methods: string[] = [];

    // Trouver les templates applicables
    const applicableTemplates = Array.from(this.templates.values())
      .filter(t => t.applicableTypes.includes(field.type));

    for (const template of applicableTemplates) {
      methods.push(this.generateMethod(entityName, field, template));
    }

    return methods;
  }

  private generateMethod(
    entityName: string,
    field: SearchableField,
    template: FilterMethodTemplate
  ): string {
    const methodName = `where${this.capitalize(field.name)}${this.capitalize(template.name)}`;

    // Type des paramètres
    const paramTypes = template.parameters
      .map(p => `${p.name}: ${p.type}`)
      .join(', ');

    // Documentation
    const docs = `
  /**
   * ${template.description}
   * @param ${template.parameters.map(p => p.name).join(' @param ')}
   * @returns this for chaining
   * @example
   * \`\`\`typescript
   * const results = await rag.${this.camelCase(entityName)}()
   *   .${methodName}(${template.parameters.map(p => `'example'`).join(', ')})
   *   .execute();
   * \`\`\`
   */`;

    // Génération TypeScript
    return `${docs}
  ${methodName}(${paramTypes}): this {
    const condition = \`${template.cypher({ field: field.name, varName: field.name })}\`;
    this.addFilter('${field.name}', ${template.parameters.map(p => p.name).join(', ')}, condition);
    return this;
  }`;
  }

  register(template: FilterMethodTemplate): void {
    this.templates.set(template.name, template);
  }
}
```

---

### 2. Expand Method Factory

```typescript
// packages/core/src/generator/expand-method-factory.ts

export interface ExpandMethodTemplate {
  name: string;
  description: string;
  parameters: ParameterTemplate[];
  cypher: (params: any) => string;
}

export class ExpandMethodFactory {
  private templates: Map<string, ExpandMethodTemplate> = new Map();

  constructor() {
    this.registerBuiltInTemplates();
  }

  private registerBuiltInTemplates(): void {
    // Basic expand (déjà existant)
    this.register({
      name: 'base',
      description: 'Expand relationship to specified depth',
      parameters: [
        { name: 'depth', type: 'number', required: false, default: 1 }
      ],
      cypher: (params) => `
        OPTIONAL MATCH path = (n)-[:${params.relType}*1..${params.depth || 1}]->(related:${params.targetType})
        WITH n, collect(DISTINCT related) as ${params.relVar}
      `
    });

    // Conditional expand
    this.register({
      name: 'where',
      description: 'Expand with filter on related entities',
      parameters: [
        { name: 'filter', type: `(entity: ${params.targetType}) => boolean`, required: true },
        { name: 'depth', type: 'number', required: false, default: 1 }
      ],
      cypher: (params) => `
        OPTIONAL MATCH path = (n)-[:${params.relType}*1..${params.depth || 1}]->(related:${params.targetType})
        WHERE ${params.filterCondition}
        WITH n, collect(DISTINCT related) as ${params.relVar}
      `
    });

    // Select specific fields
    this.register({
      name: 'select',
      description: 'Expand and return only specific fields',
      parameters: [
        { name: 'fields', type: `Array<keyof ${params.targetType}>`, required: true },
        { name: 'depth', type: 'number', required: false, default: 1 }
      ],
      cypher: (params) => `
        OPTIONAL MATCH path = (n)-[:${params.relType}*1..${params.depth || 1}]->(related:${params.targetType})
        WITH n, collect(DISTINCT {${params.selectedFields}}) as ${params.relVar}
      `
    });

    // Limit expansion
    this.register({
      name: 'limit',
      description: 'Expand with limit on number of related entities',
      parameters: [
        { name: 'limit', type: 'number', required: true },
        { name: 'depth', type: 'number', required: false, default: 1 }
      ],
      cypher: (params) => `
        OPTIONAL MATCH path = (n)-[:${params.relType}*1..${params.depth || 1}]->(related:${params.targetType})
        WITH n, collect(DISTINCT related)[0..${params.limit}] as ${params.relVar}
      `
    });

    // Order expansion
    this.register({
      name: 'orderBy',
      description: 'Expand with ordering',
      parameters: [
        { name: 'field', type: 'string', required: true },
        { name: 'direction', type: '"ASC" | "DESC"', required: false, default: 'ASC' },
        { name: 'depth', type: 'number', required: false, default: 1 }
      ],
      cypher: (params) => `
        OPTIONAL MATCH path = (n)-[:${params.relType}*1..${params.depth || 1}]->(related:${params.targetType})
        WITH n, related
        ORDER BY related.${params.orderField} ${params.direction}
        WITH n, collect(DISTINCT related) as ${params.relVar}
      `
    });
  }

  /**
   * Générer toutes les expand methods pour une relation
   */
  generateMethodsForRelationship(
    entityName: string,
    rel: RelationshipConfig,
    targetEntity: EntityConfig
  ): string[] {
    const methods: string[] = [];

    for (const template of this.templates.values()) {
      methods.push(this.generateExpandMethod(
        entityName,
        rel,
        targetEntity,
        template
      ));
    }

    return methods;
  }

  private generateExpandMethod(
    entityName: string,
    rel: RelationshipConfig,
    targetEntity: EntityConfig,
    template: ExpandMethodTemplate
  ): string {
    const baseName = this.camelCase(rel.type);
    const methodName = template.name === 'base'
      ? `with${this.capitalize(baseName)}`
      : `with${this.capitalize(baseName)}${this.capitalize(template.name)}`;

    // Paramètres TypeScript
    const paramTypes = template.parameters
      .map(p => {
        let paramStr = `${p.name}${p.required ? '' : '?'}: ${p.type}`;
        if (p.default !== undefined) {
          paramStr += ` = ${p.default}`;
        }
        return paramStr;
      })
      .join(', ');

    // Documentation
    const docs = `
  /**
   * ${template.description}
   * @param ${template.parameters.map(p => p.name).join(' @param ')}
   * @returns this for chaining
   * @example
   * \`\`\`typescript
   * const results = await rag.${this.camelCase(entityName)}()
   *   .${methodName}(${template.parameters.map(p => p.default || 'value').join(', ')})
   *   .execute();
   * \`\`\`
   */`;

    return `${docs}
  ${methodName}(${paramTypes}): this {
    this.addExpansion({
      relType: '${rel.type}',
      targetType: '${targetEntity.name}',
      template: '${template.name}',
      params: { ${template.parameters.map(p => p.name).join(', ')} }
    });
    return this;
  }`;
  }

  register(template: ExpandMethodTemplate): void {
    this.templates.set(template.name, template);
  }
}
```

---

## 🔧 Intégration dans CodeGenerator

```typescript
// packages/core/src/generator/code-generator.ts

static generate(config: RagForgeConfig, schema: GraphSchema): GeneratedCode {
  // ... existing code

  // Initialiser les factories
  const filterFactory = new FilterMethodFactory();
  const expandFactory = new ExpandMethodFactory();

  // Permettre aux users d'ajouter des templates custom
  if (config.generation?.customFilters) {
    config.generation.customFilters.forEach(t => filterFactory.register(t));
  }

  if (config.generation?.customExpands) {
    config.generation.customExpands.forEach(t => expandFactory.register(t));
  }

  for (const entity of config.entities) {
    const queryCode: string[] = [];

    // Génération des filtres
    for (const field of entity.searchable_fields) {
      if (config.generation?.complete) {
        // Générer TOUTES les méthodes applicables
        queryCode.push(...filterFactory.generateMethodsForField(entity.name, field));
      } else {
        // Seulement les méthodes de base (comportement actuel)
        queryCode.push(...this.generateFieldMethod(entity.name, field));
      }
    }

    // Génération des expands
    if (entity.relationships) {
      for (const rel of entity.relationships) {
        const targetEntity = config.entities.find(e => e.name === rel.target);
        if (!targetEntity) continue;

        if (config.generation?.complete) {
          // Générer TOUTES les variantes d'expand
          queryCode.push(...expandFactory.generateMethodsForRelationship(
            entity.name,
            rel,
            targetEntity
          ));
        } else {
          // Seulement expand de base (comportement actuel)
          queryCode.push(...this.generateRelationshipMethod(rel));
        }
      }
    }

    queries.set(entity.name, queryCode.join('\n\n'));
  }

  // ... rest of generation
}
```

---

## 📝 Configuration

```yaml
# ragforge.config.yaml

generation:
  # Générer toutes les méthodes possibles
  complete: true

  # Templates custom (optionnel)
  customFilters:
    - name: soundsLike
      description: Fuzzy string matching
      parameters:
        - name: value
          type: string
          required: true
      cypher: "apoc.text.fuzzyMatch(n.${field}, $${varName}) > 0.8"
      applicableTypes: [string]

  customExpands:
    - name: topN
      description: Expand and return top N by score
      parameters:
        - name: n
          type: number
          required: true
        - name: scoreField
          type: string
          required: true
      cypher: |
        OPTIONAL MATCH (n)-[:${relType}]->(related:${targetType})
        WITH n, related
        ORDER BY related.${scoreField} DESC
        LIMIT ${n}
        WITH n, collect(related) as ${relVar}
```

---

## 🧪 Testing

### Unit Tests

```typescript
// packages/core/src/generator/__tests__/filter-method-factory.test.ts
describe('FilterMethodFactory', () => {
  test('generates contains method for string field', () => {
    const factory = new FilterMethodFactory();
    const methods = factory.generateMethodsForField('Scope', {
      name: 'name',
      type: 'string'
    });

    expect(methods).toContain('whereNameContains');
    expect(methods).toContain('whereNameStartsWith');
    expect(methods).toContain('whereNameMatches');
  });

  test('generates range methods for number field', () => {
    const factory = new FilterMethodFactory();
    const methods = factory.generateMethodsForField('Scope', {
      name: 'lineCount',
      type: 'number'
    });

    expect(methods).toContain('whereLineCountGreaterThan');
    expect(methods).toContain('whereLineCountBetween');
  });

  test('allows custom templates', () => {
    const factory = new FilterMethodFactory();
    factory.register({
      name: 'custom',
      description: 'Custom filter',
      parameters: [],
      cypher: () => 'n.field = "custom"',
      applicableTypes: ['string']
    });

    const methods = factory.generateMethodsForField('Scope', {
      name: 'name',
      type: 'string'
    });

    expect(methods).toContain('whereNameCustom');
  });
});
```

### Integration Tests

```typescript
// Test that generated code compiles and works
test('generated complete methods work', async () => {
  // Generate with --complete
  const generated = await CodeGenerator.generate(config, schema);

  // Write to temp directory
  await writeTempProject(generated);

  // Compile TypeScript
  await execAsync('tsc', { cwd: tempDir });

  // Import and test
  const { createRagClient } = await import(tempDir + '/client.js');
  const rag = createRagClient();

  // Test contains
  const results1 = await rag.scope()
    .whereNameContains('Query')
    .execute();
  expect(results1.length).toBeGreaterThan(0);

  // Test between
  const results2 = await rag.scope()
    .whereLineCountBetween(10, 100)
    .execute();
  expect(results2.length).toBeGreaterThan(0);

  // Test conditional expand
  const results3 = await rag.scope()
    .whereName('QueryBuilder')
    .withConsumesWhere(s => s.file.endsWith('.ts'), 2)
    .execute();
  expect(results3.length).toBeGreaterThan(0);
});
```

---

## 📊 Impact Analysis

### Generated Code Size

**Without `--complete`**:
- Scope entity: ~30 methods
- Total lines: ~1,500

**With `--complete`**:
- Scope entity: ~120 methods
- Total lines: ~6,000

**Mitigation**: Tree-shaking permet d'éliminer méthodes non utilisées

### Type Safety

Tous les méthodes sont **fully typed**:

```typescript
// Type inference works perfectly
const results = await rag.scope()
  .whereNameContains('Query')          // string param required
  .whereLineCountBetween(10, 100)      // two number params required
  .withConsumesWhere(                  // predicate with correct type
    (scope: Scope) => scope.file.endsWith('.ts')
  )
  .execute();  // Returns SearchResult<Scope>[]
```

### Bundle Size

- **Without optimization**: +200KB
- **With tree-shaking**: +10KB (only used methods)
- **Gzipped**: +3KB

---

## 🚀 Migration Path

### Phase 1: Factory infrastructure (1 week)
- Create `FilterMethodFactory`
- Create `ExpandMethodFactory`
- Unit tests

### Phase 2: Integration (1 week)
- Integrate into `CodeGenerator`
- Add `generation.complete` config option
- Update CLI to support `--complete` flag

### Phase 3: Templates (1 week)
- Implement all built-in templates
- Add custom template support
- Documentation

### Phase 4: Testing & Polish (1 week)
- Integration tests
- Performance optimization
- User docs + examples

**Total**: ~4 weeks
