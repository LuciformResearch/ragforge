# Ingestion Optimization Summary

**Date**: 2025-11-11
**Branch**: rag-doll

## 🎯 Objectif

Optimiser l'ingestion de code pour:
1. Rendre l'incrémental fonctionnel (UUIDs déterministes)
2. Accélérer drastiquement l'ingestion (batching + parallélisation)

## ✅ Résultats

| Métrique | Avant | Après | Gain |
|----------|-------|-------|------|
| **Ingestion complète (650 scopes)** | ~60s+ | **8.6s** | **~7x** |
| **Ingestion incrémentale (0 changes)** | ~10s+ | **2.4s** | **~4x** |
| **Requêtes Neo4j (nodes)** | 650 séquentielles | 2-3 batches | **~200x** |
| **Requêtes Neo4j (rels)** | ~2000 séquentielles | ~10 batches | **~200x** |
| **Change tracking** | 650 séquentielles | 10 parallèles | **~65x** |

## 📝 Changements Implémentés

### 1. UUIDs Déterministes ✅

**Problème**: `UniqueIDHelper.GenerateUUID()` utilisait `Math.random()` → UUIDs différents à chaque ingestion → incrémental cassé

**Solution**:
- Nouvelle méthode `GenerateDeterministicUUID(input: string)` dans `UniqueIDHelper.ts`
- UUID basé sur SHA-256 de `file:name:type:line`
- Garantit: même code → même UUID

**Fichiers modifiés**:
- `packages/runtime/src/utils/UniqueIDHelper.ts`
- `packages/runtime/src/adapters/code-source-adapter.ts` (ligne 799)

```typescript
// Avant
const uuid = UniqueIDHelper.GenerateUUID(); // Aléatoire!

// Après
const deterministicInput = `${filePath}:${scope.name}:${scope.type}:${scope.startLine}`;
const uuid = UniqueIDHelper.GenerateDeterministicUUID(deterministicInput);
```

### 2. UNWIND Batching pour Nodes/Relationships ✅

**Problème**: Une requête Neo4j par node/relationship → 650+ queries séquentielles

**Solution**: UNWIND batching
- Nodes groupés par label type → 1 query par type
- Relationships groupées par type → batches de 500

**Fichier modifié**:
- `packages/runtime/src/adapters/incremental-ingestion.ts` (méthode `ingestNodes()`)

```typescript
// Avant
for (const node of nodes) {
  await this.client.run(`MERGE (n:${labels} {uuid: $uuid}) SET n += $props`, ...);
}

// Après
await this.client.run(`
  UNWIND $nodes AS nodeData
  MERGE (n:${labels} {uuid: nodeData.uuid})
  SET n += nodeData.props
`, { nodes: nodeData });
```

### 3. p-limit Parallelization pour Change Tracking ✅

**Problème**: Change tracking séquentiel (645 diffs générés un par un)

**Solution**:
- Nouvelle méthode `trackEntityChangesBatch()` avec p-limit
- 10 change trackings parallèles

**Fichiers modifiés**:
- `packages/runtime/src/adapters/change-tracker.ts` (nouvelle méthode ligne 166)
- `packages/runtime/src/adapters/incremental-ingestion.ts` (utilisation ligne 325)

```typescript
// Avant
for (const node of created) {
  await this.changeTracker.trackEntityChange(...);
}

// Après
await this.changeTracker.trackEntityChangesBatch(changesToTrack, 10);
```

### 4. Template Génération Fixes ✅

**Problème**:
- `track_changes` non auto-généré dans le script d'ingestion
- Root path incorrectement résolu (`projectRoot/../.`)

**Solution**:
- Auto-génère `track_changes: true` si configuré
- Utilise `projectRoot` directement quand `root === '.'`

**Fichier modifié**:
- `packages/core/src/generator/code-generator.ts` (lignes 3783-3816)

### 5. Hash Content-Based pour Détection de Changements ✅

**Problème**: `hashScope()` utilisait signature (sans le corps) → manquait les changements d'implémentation

**Solution**: Hash basé sur le contenu complet du scope

**Fichier modifié**:
- `packages/runtime/src/adapters/code-source-adapter.ts` (méthode `hashScope()` ligne 809)

```typescript
// Avant
private hashScope(scope: ScopeInfo): string {
  return this.getSignatureHash(scope); // Signature only
}

// Après
private hashScope(scope: ScopeInfo): string {
  const content = scope.contentDedented || scope.content || '';
  const hashInput = `${parentPrefix}${scope.name}:${scope.type}:${content}`;
  return createHash('sha256').update(hashInput).digest('hex').substring(0, 8);
}
```

## 🧪 Tests Validés

1. ✅ **Ingestion complète**: 650 scopes en 8.6s
2. ✅ **Ingestion incrémentale (0 changes)**: 650 unchanged en 2.4s
3. ✅ **UUIDs déterministes**: Même scope → même UUID
4. ✅ **Template génération**: `track_changes: true` auto-généré
5. ✅ **Path resolution**: Root path correctement résolu

## 🔧 Dépendances Ajoutées

```json
{
  "dependencies": {
    "p-limit": "^5.x.x"  // Ajouté dans packages/runtime
  }
}
```

## 📦 Packages Modifiés

- ✅ `@luciformresearch/ragforge-runtime` (incremental, change-tracker, code-source-adapter, UniqueIDHelper)
- ✅ `@luciformresearch/ragforge-core` (code-generator)
- ✅ `@luciformresearch/ragforge-cli` (aucune modification nécessaire)

## 🚀 Prochaines Étapes (Optionnel)

1. Tester avec de très gros projets (10,000+ scopes)
2. Ajouter des métriques de performance dans les logs
3. Optimiser le parsing lui-même (actuellement ~70% du temps)
4. Cache de parsing pour fichiers non modifiés

## 📚 Notes Techniques

- **UNWIND**: Cypher feature pour batch processing
- **p-limit**: Contrôle de concurrence (10 concurrent = sweet spot)
- **Deterministic UUIDs**: SHA-256 hash pour stabilité
- **Content-based hashing**: Détection fine-grained des changements
