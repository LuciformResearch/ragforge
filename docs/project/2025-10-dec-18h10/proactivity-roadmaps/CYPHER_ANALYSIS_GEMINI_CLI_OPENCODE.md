# Analyse Cypher : Structure de Code de Gemini CLI et OpenCode

## Vue d'ensemble

Cette analyse compare la structure de code de Gemini CLI et OpenCode (projets ingérés dans le brain) avec nos roadmaps de proactivité, en utilisant des requêtes Cypher custom.

---

## 📊 Statistiques Générales

### Gemini CLI
- **Fonctions** : 1,614 (moyenne 32 lignes)
- **Méthodes** : 1,595 (moyenne 19 lignes)
- **Classes** : 283 (moyenne 130 lignes)
- **Total scopes** : ~1,897 fonctions/classes analysées
- **Dépendances totales** : 3,052 relations CONSUMES
- **Ratio** : 1.61 dépendances par scope

### OpenCode
- **Fonctions** : 1,188 (moyenne 22 lignes)
- **Méthodes** : 1,386 (moyenne 8 lignes)
- **Classes** : 227 (moyenne 72 lignes)
- **Total scopes** : ~1,415 fonctions/classes analysées
- **Dépendances totales** : 2,113 relations CONSUMES
- **Ratio** : 1.49 dépendances par scope

**Observation** : Gemini CLI a une structure légèrement plus complexe (plus de dépendances par scope).

---

## 🔗 Patterns de Dépendances

### Gemini CLI - Top Relations CONSUMES

| Consumer Type | Consumed Type | Count |
|--------------|---------------|-------|
| variable | variable | 8,465 |
| variable | function | 1,973 |
| class | method | 1,601 |
| method | method | 837 |
| function | function | 728 |
| function | variable | 701 |

**Patterns identifiés** :
- **Variables très connectées** : Les variables sont les entités les plus consommées (utilitaires, configs, mocks de test)
- **Classes → Méthodes** : Pattern classique OOP (1,601 relations)
- **Functions → Functions** : Appels de fonctions (728 relations)

### OpenCode - Top Relations CONSUMES

| Consumer Type | Consumed Type | Count |
|--------------|---------------|-------|
| class | method | 1,369 |
| variable | variable | 888 |
| function | function | 425 |
| function | variable | 323 |
| method | variable | 308 |

**Patterns identifiés** :
- **Classes → Méthodes** : Pattern dominant (1,369 relations)
- **Moins de variables connectées** : Structure plus orientée fonctions/classes
- **Méthodes courtes** : Moyenne de 8 lignes (vs 19 pour Gemini CLI)

---

## 🎯 Hubs (Scopes Très Consommés)

### Gemini CLI - Top 5 Hubs

| Name | Type | File | Consumer Count |
|------|------|------|----------------|
| `argv` | variable | `config.test.ts` | 100 |
| `baseParams` | variable | `config.test.ts` | 96 |
| `props` | variable | `InputPrompt.test.tsx` | 79 |
| `state` | variable | `vim-buffer-actions.test.ts` | 75 |
| `createTestState` | function | `vim-buffer-actions.test.ts` | 75 |

**Observation** : Les hubs sont principalement des **utilitaires de test** (variables de mock, helpers de test).

### OpenCode - Top 5 Hubs

| Name | Type | File | Consumer Count |
|------|------|------|----------------|
| `Unset` | class | `types.py` | 221 |
| `UNSET` | variable | `types.py` | 156 |
| `AuthenticatedClient` | class | `client.py` | 102 |
| `Options` | type_alias | `sdk.gen.ts` | 95 |
| `get` | method | `sdk.gen.ts` | 48 |

**Observation** : Les hubs sont des **classes utilitaires** et des **types de base** (SDK, types Python).

**Implication pour nos roadmaps** :
- ✅ **Extracteur de Hiérarchie de Dépendances** : Utile pour identifier ces hubs automatiquement
- ✅ **Enrichissement automatique** : Les hubs devraient être enrichis avec leur hiérarchie complète

---

## 📈 Profondeur des Dépendances

### Gemini CLI - Distribution par Profondeur

| Depth | Path Count |
|-------|------------|
| 1 | 15,947 |
| 2 | 10,789 |
| 3 | 6,864 |
| 4 | 5,897 |
| 5 | 6,735 |

**Pattern** : Beaucoup de dépendances directes (depth 1-2), puis décroissance jusqu'à depth 4, puis légère augmentation à depth 5 (cycles ?).

### OpenCode - Distribution par Profondeur

| Depth | Path Count |
|-------|------------|
| 1 | 4,566 |
| 2 | 4,406 |
| 3 | 5,576 |
| 4 | 8,748 |
| 5 | 15,504 |

**Pattern** : **Structure plus profonde** ! Les chaînes de dépendances sont plus longues (beaucoup de paths à depth 4-5).

**Implication pour nos roadmaps** :
- ⚠️ **Extracteur de Hiérarchie** : Par défaut `depth=2` est bon, mais pour OpenCode, `depth=3` serait plus utile
- ✅ **Paramètre ajustable** : Le `depth` doit être configurable selon le projet

---

## 🔄 Cycles de Dépendances

### Gemini CLI - Cycles Détectés

**Cycle principal** : `buildSettingSchema` → `buildSchemaForType` → `buildObjectDefinitionSchema` → `buildObjectProperties` → `buildSettingSchema` (cycle length: 4)

**Autres cycles** :
- `buildCollectionSchema` ↔ `buildSchemaForType` (cycle length: 2)
- Plusieurs variantes autour de `buildSettingSchema` et `buildSchemaForType`

**Observation** : Ces cycles sont dans le système de **génération de schémas de configuration**, probablement récursif par design.

**Implication pour nos roadmaps** :
- ⚠️ **Extracteur de Hiérarchie** : Doit gérer les cycles (éviter boucles infinies)
- ✅ **Détection de cycles** : Pourrait être une feature utile pour identifier des problèmes architecturaux

---

## 🏝️ Scopes Isolés

### Gemini CLI - Scopes Sans Dépendances

**Exemples** :
- `itIf` (function) - `integration-tests/extensions-reload.test.ts`
- `createToolCallErrorMessage` (function) - `integration-tests/test-helper.ts`
- `utf8BOM`, `utf16LE`, etc. (functions) - `integration-tests/utf-bom-encoding.test.ts`
- `copyFilesRecursive` (function) - `scripts/copy_files.js`

**Pattern** : Principalement des **utilitaires de test** et des **scripts standalone**.

**Implication pour nos roadmaps** :
- ✅ **Enrichissement conditionnel** : Les scopes isolés n'ont pas besoin d'enrichissement de dépendances
- ✅ **Optimisation** : Éviter de chercher des dépendances pour ces scopes

---

## 📁 Distribution par Fichier

### Gemini CLI - Fichiers avec le Plus de Dépendances

| File | Scopes | Deps | Avg Deps/Scope |
|------|--------|------|----------------|
| `config/config.ts` | 167 | 160 | 0.96 |
| `telemetry/metrics.ts` | 133 | 94 | 0.71 |
| `telemetry/clearcut-logger.ts` | 66 | 63 | 0.95 |
| `core/coreToolScheduler.test.ts` | 305 | 50 | 0.16 |

**Observation** : Les fichiers de **configuration** et **télémétrie** ont beaucoup de dépendances internes.

---

## 🎨 Patterns d'Héritage

### Gemini CLI - Hiérarchies d'Héritage

**Top hiérarchies** :
1. `BaseToolInvocation` → 24 classes enfants (SubagentInvocation, EditToolInvocation, etc.)
2. `BaseDeclarativeTool` → 23 classes enfants
3. `HookInput` → 11 classes enfants
4. `FatalError` → 7 classes enfants

**Pattern** : Utilisation intensive de **classes de base** pour l'architecture (tools, hooks, errors).

**Implication pour nos roadmaps** :
- ✅ **Extracteur de Hiérarchie** : Devrait aussi inclure `INHERITS_FROM` (pas seulement CONSUMES)
- ✅ **Enrichissement** : Les classes de base sont importantes pour comprendre le contexte

---

## 🔀 Scopes Intermédiaires Complexes

### Gemini CLI - Scopes avec Beaucoup de Consommateurs ET Dépendances

| Name | Type | Consumers | Deps | Total |
|------|------|-----------|------|-------|
| `setupProcessorHook` | function | 31 | 10 | 41 |
| `renderTestHook` | function | 24 | 9 | 33 |
| `renderProcessorHook` | function | 20 | 7 | 27 |

**Pattern** : Ces scopes sont des **points d'intégration** (hooks, renderers) qui connectent plusieurs parties du système.

**Implication pour nos roadmaps** :
- ✅ **Extracteur de Hiérarchie** : Ces scopes sont critiques pour comprendre l'architecture
- ✅ **Priorisation** : Devraient être enrichis en priorité

---

## 🆚 Comparaison Gemini CLI vs OpenCode

| Métrique | Gemini CLI | OpenCode |
|----------|------------|----------|
| **Complexité moyenne** | 1.61 deps/scope | 1.49 deps/scope |
| **Profondeur max** | Depth 5 (décroissance) | Depth 5 (croissance) |
| **Hubs principaux** | Utilitaires de test | Classes utilitaires |
| **Pattern dominant** | Variables connectées | Classes → Méthodes |
| **Cycles** | Oui (génération schémas) | Non détectés |
| **Isolation** | Beaucoup de scopes isolés | Moins de scopes isolés |

---

## 💡 Implications pour Nos Roadmaps

### ✅ Confirmations

1. **Extracteur de Hiérarchie de Dépendances** :
   - ✅ Utile pour identifier les hubs automatiquement
   - ✅ Doit gérer les cycles (éviter boucles infinies)
   - ✅ Doit inclure `INHERITS_FROM` (pas seulement CONSUMES)
   - ✅ Paramètre `depth` doit être ajustable (default=2, mais 3 pour projets profonds)

2. **Enrichissement Automatique** :
   - ✅ Les hubs devraient être enrichis avec leur hiérarchie complète
   - ✅ Les scopes isolés n'ont pas besoin d'enrichissement
   - ✅ Les scopes intermédiaires complexes sont prioritaires

3. **Agent de Contexte Initial** :
   - ✅ Les résultats de grep devraient être enrichis avec leur hiérarchie
   - ✅ Les hubs trouvés devraient être explorés plus profondément

### 🆕 Nouvelles Idées

1. **Détection de Cycles** :
   - Nouvelle feature : `detect_dependency_cycles`
   - Utile pour identifier des problèmes architecturaux
   - Peut être intégré dans l'analyse de qualité de code

2. **Analyse de Complexité** :
   - Nouvelle feature : `analyze_code_complexity`
   - Calcule la complexité cyclomatique basée sur les dépendances
   - Identifie les scopes "intermédiaires complexes" (beaucoup de consumers + deps)

3. **Exploration de Hubs** :
   - Nouvelle feature : `explore_dependency_hubs`
   - Identifie automatiquement les hubs (scopes très consommés)
   - Enrichit automatiquement leur contexte

4. **Analyse Comparative** :
   - Nouvelle feature : `compare_project_structure`
   - Compare la structure de deux projets
   - Utile pour comprendre les différences architecturales

5. **Détection de Patterns** :
   - Nouvelle feature : `detect_architectural_patterns`
   - Détecte les patterns (Factory, Strategy, Observer, etc.) basés sur les relations
   - Utile pour comprendre l'architecture d'un projet

---

## 📝 Requêtes Cypher Utiles pour Nos Roadmaps

### 1. Trouver les Hubs (pour enrichissement prioritaire)

```cypher
MATCH (p:Project {projectId: $projectId})
MATCH (consumer:Scope)-[:CONSUMES]->(hub:Scope)
WHERE (consumer)-[:BELONGS_TO]->(p) AND (hub)-[:BELONGS_TO]->(p)
WITH hub, count(DISTINCT consumer) AS consumerCount
WHERE consumerCount >= 5
RETURN hub.uuid AS uuid, hub.name AS name, hub.type AS type, 
       hub.file AS file, consumerCount
ORDER BY consumerCount DESC
LIMIT 20
```

### 2. Trouver les Scopes Intermédiaires Complexes

```cypher
MATCH (p:Project {projectId: $projectId})
MATCH (s:Scope)-[:BELONGS_TO]->(p)
WHERE s.type IN ['function', 'class']
OPTIONAL MATCH (consumer:Scope)-[:CONSUMES]->(s)
OPTIONAL MATCH (s)-[:CONSUMES]->(dep:Scope)
WITH s, 
     count(DISTINCT consumer) AS consumerCount,
     count(DISTINCT dep) AS depCount
WHERE consumerCount >= 5 AND depCount >= 5
RETURN s.uuid AS uuid, s.name AS name, s.type AS type, 
       s.file AS file, consumerCount, depCount
ORDER BY consumerCount + depCount DESC
LIMIT 20
```

### 3. Détecter les Cycles

```cypher
MATCH (p:Project {projectId: $projectId})
MATCH path = (s:Scope)-[:CONSUMES*2..5]->(s)
WHERE (s)-[:BELONGS_TO]->(p)
WITH path, nodes(path) AS cycleNodes, length(path) AS cycleLength
RETURN [n IN cycleNodes | n.name] AS cycle, cycleLength
LIMIT 10
```

### 4. Analyser la Profondeur des Dépendances

```cypher
MATCH (p:Project {projectId: $projectId})
MATCH path = (start:Scope)-[:CONSUMES*1..5]->(end:Scope)
WHERE (start)-[:BELONGS_TO]->(p) AND (end)-[:BELONGS_TO]->(p)
WITH length(path) AS depth, count(*) AS pathCount
RETURN depth, pathCount
ORDER BY depth
```

### 5. Trouver les Scopes Isolés (pour optimisation)

```cypher
MATCH (p:Project {projectId: $projectId})
MATCH (s:Scope)
WHERE (s)-[:BELONGS_TO]->(p)
  AND s.type IN ['function', 'class']
  AND NOT (s)-[:CONSUMES]->()
  AND NOT ()-[:CONSUMES]->(s)
RETURN s.uuid AS uuid, s.name AS name, s.type AS type, s.file AS file
LIMIT 50
```

---

## 🎯 Recommandations

1. **Implémenter l'Extracteur de Hiérarchie** avec :
   - Gestion des cycles (limite de profondeur, détection)
   - Support de `INHERITS_FROM` en plus de `CONSUMES`
   - Paramètre `depth` ajustable selon le projet

2. **Ajouter la Détection de Cycles** :
   - Feature séparée ou intégrée dans l'extracteur
   - Utile pour identifier des problèmes architecturaux

3. **Prioriser l'Enrichissement** :
   - Hubs → enrichissement complet
   - Scopes intermédiaires complexes → enrichissement prioritaire
   - Scopes isolés → pas d'enrichissement

4. **Analyser la Profondeur** :
   - Détecter automatiquement la profondeur moyenne du projet
   - Ajuster le `depth` par défaut selon le projet

5. **Explorer les Patterns** :
   - Détecter les patterns architecturaux basés sur les relations
   - Enrichir le contexte avec ces patterns

---

## 📚 Références

- **Roadmap Extracteur de Hiérarchie** : `ROADMAP_DEPENDENCY_HIERARCHY_EXTRACTOR.md`
- **Roadmap Agent de Contexte Initial** : `ROADMAP_PARALLEL_SEARCH_AGENT.md`
- **Plan d'Implémentation** : `IMPLEMENTATION_PLAN.md`
