# Migration : Ajout de `rootPath` pour les projets web existants

**Date**: 2025-12-11  
**Contexte**: Les projets web créés avant les modifications n'ont pas de `rootPath` défini dans le nœud `Project`.

---

## Problème

Les projets web créés via `registerWebProject()` avant les modifications utilisent un URI virtuel `web://${projectName}` comme `path` en mémoire, mais ce `path` n'était pas persisté dans le nœud `Project` avec la propriété `rootPath`.

## Solution

### Étape 1 : Identifier les projets web sans `rootPath`

```cypher
// Trouver tous les projets web sans rootPath
MATCH (p:Project)
WHERE (p.rootPath IS NULL OR p.rootPath = '')
  AND (p.type = 'web-crawl' OR p.projectId STARTS WITH 'web-')
RETURN p.projectId, p.type, p.displayName, p.rootPath
ORDER BY p.projectId;
```

### Étape 2 : Créer les répertoires et mettre à jour `rootPath`

**Note**: Cette migration doit être exécutée depuis le code TypeScript car elle nécessite la création de répertoires sur le disque.

```typescript
// Script de migration (à exécuter une fois)
async function migrateWebProjectsWithoutRootPath() {
  const brainPath = path.join(os.homedir(), '.ragforge');
  
  // Trouver tous les projets web sans rootPath
  const result = await neo4jClient.run(`
    MATCH (p:Project)
    WHERE (p.rootPath IS NULL OR p.rootPath = '')
      AND (p.type = 'web-crawl' OR p.projectId STARTS WITH 'web-')
    RETURN p.projectId, p.type, p.displayName
  `);
  
  for (const record of result.records) {
    const projectId = record.get('p.projectId');
    const displayName = record.get('p.displayName') || projectId.replace('web-', '');
    
    // Créer le répertoire réel
    const webPagesDir = path.join(brainPath, 'web-pages', projectId);
    await fs.mkdir(webPagesDir, { recursive: true });
    
    // Mettre à jour le rootPath dans Neo4j
    await neo4jClient.run(
      `MATCH (p:Project {projectId: $projectId})
       SET p.rootPath = $rootPath`,
      {
        projectId,
        rootPath: webPagesDir,
      }
    );
    
    console.log(`✅ Migrated project ${projectId} → ${webPagesDir}`);
  }
}
```

### Étape 3 : Vérifier la migration

```cypher
// Vérifier que tous les projets web ont maintenant un rootPath
MATCH (p:Project)
WHERE p.type = 'web-crawl' OR p.projectId STARTS WITH 'web-'
RETURN p.projectId, p.rootPath, p.type
ORDER BY p.projectId;
```

### Étape 4 : Mettre à jour les nœuds WebPage existants (optionnel)

Si des nœuds `WebPage` existent sans `file`, on peut les mettre à jour :

```cypher
// Trouver les WebPage sans file
MATCH (n:WebPage)
WHERE n.file IS NULL AND n.url IS NOT NULL
RETURN n.projectId, count(*) as count
ORDER BY count DESC;
```

**Note**: Les nœuds `WebPage` existants créés avant les modifications n'auront pas de `file` car ils n'étaient pas stockés sur disque. Ces nœuds peuvent être :
1. Laissés tels quels (ils fonctionneront mais sans `filePath` complet)
2. Ré-ingérés pour obtenir les fichiers sur disque et le champ `file`

---

## Requêtes Cypher pour migration manuelle

### 1. Lister les projets à migrer

```cypher
MATCH (p:Project)
WHERE (p.rootPath IS NULL OR p.rootPath = '')
  AND (p.type = 'web-crawl' OR p.projectId STARTS WITH 'web-')
RETURN p.projectId, p.type, p.displayName, p.rootPath
ORDER BY p.projectId;
```

### 2. Mettre à jour un projet spécifique (remplacer `web-web-pages` par le projectId réel)

```cypher
// Note: Le chemin doit être créé manuellement sur le disque avant
MATCH (p:Project {projectId: 'web-web-pages'})
SET p.rootPath = '/home/user/.ragforge/web-pages/web-web-pages'
RETURN p.projectId, p.rootPath;
```

### 3. Mettre à jour tous les projets web (nécessite que les répertoires existent)

```cypher
// ⚠️ ATTENTION: Cette requête nécessite que les répertoires existent déjà sur le disque
// Utiliser le script TypeScript ci-dessus pour créer les répertoires automatiquement

MATCH (p:Project)
WHERE (p.rootPath IS NULL OR p.rootPath = '')
  AND (p.type = 'web-crawl' OR p.projectId STARTS WITH 'web-')
WITH p, '/home/user/.ragforge/web-pages/' + p.projectId as newRootPath
SET p.rootPath = newRootPath
RETURN p.projectId, p.rootPath;
```

**⚠️ IMPORTANT**: Remplacer `/home/user/.ragforge/` par le chemin réel du brain (généralement `~/.ragforge/`).

---

## Script de migration complet (TypeScript)

```typescript
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { Neo4jClient } from '../runtime/client/neo4j-client.js';

async function migrateWebProjectsWithoutRootPath(neo4jClient: Neo4jClient) {
  const brainPath = path.join(os.homedir(), '.ragforge');
  
  console.log('🔍 Finding web projects without rootPath...');
  
  // Trouver tous les projets web sans rootPath
  const result = await neo4jClient.run(`
    MATCH (p:Project)
    WHERE (p.rootPath IS NULL OR p.rootPath = '')
      AND (p.type = 'web-crawl' OR p.projectId STARTS WITH 'web-')
    RETURN p.projectId, p.type, p.displayName
    ORDER BY p.projectId
  `);
  
  if (result.records.length === 0) {
    console.log('✅ No projects to migrate');
    return;
  }
  
  console.log(`📦 Found ${result.records.length} projects to migrate`);
  
  for (const record of result.records) {
    const projectId = record.get('p.projectId');
    const displayName = record.get('p.displayName') || projectId.replace('web-', '');
    
    // Créer le répertoire réel
    const webPagesDir = path.join(brainPath, 'web-pages', projectId);
    try {
      await fs.mkdir(webPagesDir, { recursive: true });
      console.log(`📁 Created directory: ${webPagesDir}`);
    } catch (error: any) {
      console.error(`❌ Failed to create directory for ${projectId}: ${error.message}`);
      continue;
    }
    
    // Mettre à jour le rootPath dans Neo4j
    try {
      await neo4jClient.run(
        `MATCH (p:Project {projectId: $projectId})
         SET p.rootPath = $rootPath`,
        {
          projectId,
          rootPath: webPagesDir,
        }
      );
      console.log(`✅ Migrated project ${projectId} → ${webPagesDir}`);
    } catch (error: any) {
      console.error(`❌ Failed to update rootPath for ${projectId}: ${error.message}`);
    }
  }
  
  console.log('✅ Migration complete');
}

// Utilisation:
// await migrateWebProjectsWithoutRootPath(neo4jClient);
```

---

## Vérification post-migration

```cypher
// Vérifier que tous les projets web ont maintenant un rootPath
MATCH (p:Project)
WHERE p.type = 'web-crawl' OR p.projectId STARTS WITH 'web-'
RETURN 
  p.projectId, 
  p.rootPath, 
  p.type,
  CASE 
    WHEN p.rootPath IS NULL OR p.rootPath = '' THEN '❌ Missing'
    ELSE '✅ OK'
  END as status
ORDER BY p.projectId;
```

---

## Notes

- Les nouveaux projets web créés après les modifications auront automatiquement un `rootPath` défini
- Les projets existants doivent être migrés une seule fois
- La migration est idempotente : elle peut être exécutée plusieurs fois sans problème
- Les nœuds `WebPage` existants créés avant les modifications n'auront pas de `file` défini (ils peuvent être ré-ingérés si nécessaire)
