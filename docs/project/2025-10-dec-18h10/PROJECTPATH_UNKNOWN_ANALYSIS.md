# Analyse : Cas où `projectPath` est "unknown"

**Date**: 2025-12-11  
**Auteur**: Analyse automatique  
**Contexte**: Investigation sur les cas où `projectPath: "unknown"` apparaît dans les résultats de `brain_search`

---

## Problème identifié

Lors des recherches avec `brain_search`, certains résultats retournent `projectPath: "unknown"`, ce qui empêche de construire le chemin absolu du fichier (`filePath`).

## Causes identifiées

### 1. **Projets web non persistés avec `rootPath`**

**Problème principal** : Les projets web créés via `registerWebProject()` utilisent un URI virtuel `web://${projectName}` comme `path`, mais ce `path` n'est **jamais persisté dans le nœud Project de Neo4j** avec la propriété `rootPath`.

**Code concerné** :
```typescript
// packages/core/src/brain/brain-manager.ts:1636-1659
private async registerWebProject(projectName: string): Promise<string> {
  const projectId = `web-${projectName.toLowerCase().replace(/\s+/g, '-')}`;
  
  if (!this.registeredProjects.has(projectId)) {
    const registered: RegisteredProject = {
      id: projectId,
      path: `web://${projectName}`,  // ⚠️ URI virtuel, pas un chemin réel
      type: 'web-crawl',
      // ...
    };
    this.registeredProjects.set(projectId, registered);
    
    // ⚠️ PROBLÈME : updateProjectMetadataInDb ne définit PAS rootPath
    await this.updateProjectMetadataInDb(projectId, {
      type: 'web-crawl',
      lastAccessed: new Date(),
      autoCleanup: true,
      displayName: projectName,
    });
  }
  
  return projectId;
}
```

**Conséquence** :
- Le projet est enregistré en mémoire avec `path: "web://web-pages"`
- Mais dans Neo4j, le nœud `Project` n'a **pas de propriété `rootPath`** (ou `rootPath` est `null`)
- Quand `refreshProjectsCache()` charge les projets depuis Neo4j :
  ```typescript
  // packages/core/src/brain/brain-manager.ts:1127
  RETURN p.projectId as id, p.rootPath as path, ...
  ```
  Si `p.rootPath` est `null`, alors `path` devient `null`, et ensuite `project?.path || 'unknown'` donne `"unknown"`

### 2. **Pages web stockées uniquement en base, pas sur disque**

**État actuel** : Les pages web sont stockées **uniquement dans Neo4j** :
- `rawHtml` : HTML complet dans la propriété du nœud
- `textContent` : Texte extrait dans la propriété du nœud
- **Aucun fichier sur disque** n'est créé

**Code concerné** :
```typescript
// packages/core/src/brain/brain-manager.ts:1563-1582
await this.neo4jClient.run(
  `MERGE (n:WebPage {url: $url})
   SET n.uuid = $uuid,
       n.title = $title,
       n.domain = $domain,
       n.textContent = $textContent,  // ⚠️ Stocké en DB uniquement
       n.rawHtml = $rawHtml,          // ⚠️ Stocké en DB uniquement
       n.projectId = $projectId,
       n.ingestedAt = $ingestedAt`,
  // ...
);
```

**Conséquence** :
- Pas de fichier physique à référencer
- `node.file` ou `node.path` n'existe pas pour les `WebPage`
- Même si `projectPath` était correct, `filePath` ne pourrait pas être construit

### 3. **Projets créés avant la persistance de `rootPath`**

**Scénario** : Des projets ont pu être créés avant que `rootPath` ne soit systématiquement défini dans les nœuds `Project`.

**Vérification** :
```cypher
MATCH (p:Project) WHERE p.rootPath IS NULL OR p.rootPath = '' 
RETURN p.projectId, p.rootPath, p.type
```
→ Résultat : Aucun projet avec `rootPath` null trouvé dans la base actuelle

**Note** : Les projets existants semblent avoir `rootPath` défini correctement.

---

## Solutions proposées

### Solution 1 : Persister `rootPath` pour les projets web

**Modifier `registerWebProject()`** pour créer/mettre à jour le nœud `Project` avec `rootPath` :

```typescript
private async registerWebProject(projectName: string): Promise<string> {
  const projectId = `web-${projectName.toLowerCase().replace(/\s+/g, '-')}`;
  
  if (!this.registeredProjects.has(projectId)) {
    // Créer un chemin virtuel mais cohérent
    const virtualPath = `web://${projectName}`;
    
    const registered: RegisteredProject = {
      id: projectId,
      path: virtualPath,
      type: 'web-crawl',
      // ...
    };
    this.registeredProjects.set(projectId, registered);
    
    // ✅ CRÉER/MERGE le nœud Project avec rootPath
    await this.neo4jClient.run(
      `MERGE (p:Project {projectId: $projectId})
       SET p.rootPath = $rootPath,
           p.type = $type,
           p.lastAccessed = $lastAccessed,
           p.autoCleanup = $autoCleanup,
           p.displayName = $displayName`,
      {
        projectId,
        rootPath: virtualPath,  // ✅ Persister le path
        type: 'web-crawl',
        lastAccessed: new Date().toISOString(),
        autoCleanup: true,
        displayName: projectName,
      }
    );
  }
  
  return projectId;
}
```

**Avantage** : Les projets web auront un `rootPath` persistant, même si c'est un URI virtuel.

**Limitation** : `filePath` sera toujours `"web://web-pages/..."` ce qui n'est pas un chemin de fichier réel.

### Solution 2 : Stocker les pages web dans des fichiers

**Créer un système de stockage de fichiers pour les pages web** :

```typescript
// Structure proposée :
~/.ragforge/
  web-pages/
    {projectId}/
      {domain}/
        {url-hash}.html      // rawHtml
        {url-hash}.txt       // textContent
        {url-hash}.json      // metadata (title, domain, etc.)
```

**Modifier `ingestWebPage()`** :

```typescript
async ingestWebPage(params: {
  url: string;
  title: string;
  textContent: string;
  rawHtml: string;
  projectName?: string;
  generateEmbeddings?: boolean;
}): Promise<{ success: boolean; nodeId?: string }> {
  // ... code existant ...
  
  // ✅ NOUVEAU : Stocker sur disque
  const webPagesDir = path.join(this.brainPath, 'web-pages', projectId);
  await fs.mkdir(webPagesDir, { recursive: true });
  
  const urlHash = crypto.createHash('sha256').update(params.url).digest('hex').slice(0, 16);
  const domain = urlParsed.hostname.replace(/[^a-zA-Z0-9]/g, '_');
  const domainDir = path.join(webPagesDir, domain);
  await fs.mkdir(domainDir, { recursive: true });
  
  const htmlPath = path.join(domainDir, `${urlHash}.html`);
  const txtPath = path.join(domainDir, `${urlHash}.txt`);
  const jsonPath = path.join(domainDir, `${urlHash}.json`);
  
  await fs.writeFile(htmlPath, params.rawHtml, 'utf-8');
  await fs.writeFile(txtPath, params.textContent, 'utf-8');
  await fs.writeFile(jsonPath, JSON.stringify({
    url: params.url,
    title: params.title,
    domain,
    ingestedAt: new Date().toISOString(),
  }), 'utf-8');
  
  // Stocker le chemin relatif dans le nœud
  const relativePath = path.relative(this.brainPath, htmlPath);
  
  await this.neo4jClient.run(
    `MERGE (n:WebPage {url: $url})
     SET n.uuid = $uuid,
         n.title = $title,
         n.domain = $domain,
         n.textContent = $textContent,
         n.rawHtml = $rawHtml,
         n.projectId = $projectId,
         n.file = $file,  // ✅ NOUVEAU : chemin relatif vers le fichier
         n.ingestedAt = $ingestedAt`,
    {
      // ...
      file: relativePath,  // ✅ Ex: "web-pages/web-web-pages/example_com/a3f2b9c1.html"
    }
  );
  
  // ...
}
```

**Avantage** :
- Les pages web sont persistées sur disque
- `node.file` existe et pointe vers un fichier réel
- `filePath` peut être construit : `path.join(projectPath, node.file)`

**Inconvénient** :
- Consomme de l'espace disque
- Nécessite une gestion de nettoyage (avec `autoCleanup`)

### Solution 3 : Utiliser un chemin absolu pour les projets web

**Au lieu de `web://${projectName}`, utiliser un chemin réel** :

```typescript
private async registerWebProject(projectName: string): Promise<string> {
  const projectId = `web-${projectName.toLowerCase().replace(/\s+/g, '-')}`;
  
  // ✅ Utiliser un chemin réel dans ~/.ragforge/web-pages/{projectId}
  const webPagesDir = path.join(this.brainPath, 'web-pages', projectId);
  await fs.mkdir(webPagesDir, { recursive: true });
  
  const registered: RegisteredProject = {
    id: projectId,
    path: webPagesDir,  // ✅ Chemin absolu réel
    type: 'web-crawl',
    // ...
  };
  
  // Persister avec rootPath = chemin absolu
  await this.neo4jClient.run(
    `MERGE (p:Project {projectId: $projectId})
     SET p.rootPath = $rootPath, ...`,
    {
      projectId,
      rootPath: webPagesDir,  // ✅ Chemin absolu
      // ...
    }
  );
  
  return projectId;
}
```

**Avantage** :
- `projectPath` est un chemin de fichier réel
- Compatible avec `path.join(projectPath, node.file)`
- Cohérent avec les autres projets

---

## Recommandation

**Combiner Solution 2 + Solution 3** :

1. **Utiliser un chemin absolu réel** pour `projectPath` des projets web (`~/.ragforge/web-pages/{projectId}`)
2. **Stocker les pages web dans des fichiers** dans ce répertoire
3. **Définir `node.file`** avec le chemin relatif depuis `projectPath`
4. **Persister `rootPath`** dans le nœud `Project`

**Résultat attendu** :
- `projectPath`: `"/home/user/.ragforge/web-pages/web-web-pages"`
- `node.file`: `"example.com/a3f2b9c1.html"`
- `filePath`: `"/home/user/.ragforge/web-pages/web-web-pages/example.com/a3f2b9c1.html"` ✅

---

## Cas d'ingestion incrémentale

**Question** : Est-ce que l'ingestion incrémentale peut créer des projets sans `rootPath` ?

**Réponse** : Non, l'ingestion incrémentale utilise `registerProject()` qui définit toujours `rootPath` via `updateProjectMetadataInDb()`. Cependant, `updateProjectMetadataInDb()` ne définit **pas** `rootPath` actuellement (seulement `type`, `excluded`, `lastAccessed`, `autoCleanup`, `displayName`).

**Problème** : `updateProjectMetadataInDb()` devrait aussi permettre de définir `rootPath` :

```typescript
private async updateProjectMetadataInDb(
  projectId: string,
  metadata: {
    type?: ProjectType | 'web-crawl';
    excluded?: boolean;
    lastAccessed?: Date;
    autoCleanup?: boolean;
    displayName?: string;
    rootPath?: string;  // ✅ AJOUTER
  }
): Promise<void> {
  // ...
  if (metadata.rootPath !== undefined) {
    setClause.push('p.rootPath = $rootPath');
    params.rootPath = metadata.rootPath;
  }
  // ...
}
```

---

## Actions à prendre

1. ✅ **Modifier `updateProjectMetadataInDb()`** pour supporter `rootPath`
2. ✅ **Modifier `registerWebProject()`** pour :
   - Créer un répertoire réel dans `~/.ragforge/web-pages/{projectId}`
   - Utiliser ce chemin comme `projectPath`
   - Persister `rootPath` dans le nœud `Project`
3. ✅ **Modifier `ingestWebPage()`** pour :
   - Stocker `rawHtml` et `textContent` dans des fichiers
   - Définir `node.file` avec le chemin relatif
4. ✅ **Migration** : Pour les projets web existants sans `rootPath`, les mettre à jour lors du prochain accès

---

## Notes supplémentaires

- Les projets "quick-ingest" et "ragforge-project" ont déjà `rootPath` défini correctement via `code-source-adapter.ts` (ligne 883)
- Le problème est spécifique aux projets web créés via `registerWebProject()`
- Les pages web ingérées via `ingest_web_page` MCP tool utilisent `registerWebProject()` et sont donc affectées
