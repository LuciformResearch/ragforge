# Type Conflicts - Analyse et Refactoring

## Neo4jConfig

**Core:**
```typescript
interface Neo4jConfig {
  uri: string;
  database?: string;
  username?: string;  // optional
  password?: string;  // optional
}
```

**Runtime:**
```typescript
interface Neo4jConfig {
  uri: string;
  username: string;   // required
  password: string;   // required
  database?: string;
  maxConnectionPoolSize?: number;  // extra
  connectionTimeout?: number;      // extra
}
```

**Refactor:** Unifier → credentials required + options de pool

---

## ComputedFieldConfig

**Core:**
```typescript
interface ComputedFieldConfig {
  name: string;
  type: FieldType;  // enum strict
  description?: string;
  expression?: string;
  cypher?: string;
  materialized?: boolean;
  cache_property?: string;  // extra
}
```

**Runtime:**
```typescript
interface ComputedFieldConfig {
  name: string;
  type: string;  // string loose
  description?: string;
  expression?: string;
  cypher?: string;
  materialized?: boolean;
  // pas de cache_property
}
```

**Refactor:** Presque identiques → utiliser version Core avec `type: string | FieldType`

---

## SourceConfig

**Core:**
```typescript
interface SourceConfig {
  type: 'code' | 'document';           // literals stricts
  adapter: 'typescript' | 'python' | 'tika';
  root?: string;
  include: string[];                    // required
  exclude?: string[];
  track_changes?: boolean;
  options?: SourceAdapterOptions;       // type strict
}
```

**Runtime:**
```typescript
interface SourceConfig {
  type: string;                         // loose
  adapter: string;                      // loose
  root?: string;
  include?: string[];                   // optional
  exclude?: string[];
  track_changes?: boolean;
  options?: Record<string, any>;        // generic
}
```

**Refactor:** Garder Core strict mais ajouter flexibilité pour adapters custom via union type

---

## LLMProviderConfig

**Core:**
```typescript
interface LLMProviderConfig {
  provider: string;
  model?: string;
  api_key?: string;
  temperature?: number;
  max_tokens?: number;
}
```

**Runtime (reranking):**
```typescript
interface LLMProviderConfig {
  model: string;          // required, pas de provider
  temperature?: number;
  maxOutputTokens?: number;  // nom différent
}
```

**Refactor:** Unifier noms (`max_tokens` vs `maxOutputTokens`), runtime peut utiliser subset de Core

---

## Plan de Refactoring

1. **Phase 1 (fait):** Aliases pour éviter conflits immédiats
2. **Phase 2:** Unifier `ComputedFieldConfig` (quasi identiques)
3. **Phase 3:** Unifier `Neo4jConfig` (ajouter options pool à Core)
4. **Phase 4:** Unifier `LLMProviderConfig` (standardiser noms)
5. **Phase 5:** `SourceConfig` - garder 2 versions ou créer union type
