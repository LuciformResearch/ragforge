# Agent Multi-Project Architecture

**Date**: 2025-12-06
**Status**: Planned
**Author**: Lucie Defraiteur

---

## Contexte

L'agent RagForge peut créer des projets avec `create_project`. Chaque projet a :
- Son propre container Neo4j (ports uniques : 7695, 7696, 7697...)
- Son propre dossier `.ragforge/generated/` avec credentials
- Sa propre configuration `ragforge.config.yaml`

**Problème** : L'agent doit pouvoir travailler sur plusieurs projets, switcher entre eux, et requêter le bon Neo4j pour chaque projet.

---

## Architecture Actuelle (problématique)

```
ragforge agent --project ./my-project
    │
    ├── Cherche .ragforge/generated/client.js  ❌ (c'est .ts)
    ├── Essaie d'importer dynamiquement        ❌ (pas compilé)
    └── RAG tools échouent                     ❌
```

Chaque projet généré :
```
my-project/
├── src/
├── package.json
└── .ragforge/
    ├── docker-compose.yml      # Neo4j container
    ├── ragforge.config.yaml    # Config source
    └── generated/
        ├── .env                # NEO4J_URI=bolt://localhost:7695
        ├── client.ts           # Client TypeScript (non compilé)
        ├── ragforge.config.yaml
        └── ...
```

---

## Architecture Proposée

### Principe : Connexion directe sans client généré

Au lieu d'importer `client.ts`, l'agent crée sa propre connexion Neo4j :

```typescript
// Lit les credentials depuis le projet
const env = dotenv.parse(fs.readFileSync('.ragforge/generated/.env'));

// Crée la connexion directement
const neo4jClient = new Neo4jClient({
  uri: env.NEO4J_URI,         // bolt://localhost:7695
  username: env.NEO4J_USERNAME,
  password: env.NEO4J_PASSWORD,
  database: env.NEO4J_DATABASE,
});

// Crée un RagClient simplifié
const ragClient = new RagClient({ neo4j: neo4jClient, config });
```

### Nouveau Tool : `load_project`

```typescript
load_project({
  path: "./another-project"
})
```

Ce tool :
1. Vérifie que le projet existe (`.ragforge/generated/.env`)
2. Lit les credentials Neo4j
3. Ferme l'ancienne connexion si existante
4. Crée une nouvelle connexion au Neo4j du projet
5. Met à jour le contexte de l'agent

---

## État de l'Agent

```typescript
interface AgentProjectContext {
  // Projet courant
  projectPath: string | null;

  // Connexion Neo4j
  neo4jClient: Neo4jClient | null;

  // Config du projet
  config: RagForgeConfig | null;

  // État
  isConnected: boolean;
}

class RagForgeAgent {
  private context: AgentProjectContext = {
    projectPath: null,
    neo4jClient: null,
    config: null,
    isConnected: false,
  };

  async loadProject(projectPath: string): Promise<void> {
    // 1. Fermer l'ancienne connexion
    if (this.context.neo4jClient) {
      await this.context.neo4jClient.close();
    }

    // 2. Lire les credentials
    const envPath = path.join(projectPath, '.ragforge/generated/.env');
    const env = dotenv.parse(fs.readFileSync(envPath));

    // 3. Créer la nouvelle connexion
    this.context.neo4jClient = new Neo4jClient({
      uri: env.NEO4J_URI,
      username: env.NEO4J_USERNAME,
      password: env.NEO4J_PASSWORD,
      database: env.NEO4J_DATABASE,
    });

    // 4. Charger la config
    const configPath = path.join(projectPath, '.ragforge/generated/ragforge.config.yaml');
    this.context.config = await ConfigLoader.load(configPath);

    // 5. Mettre à jour le contexte
    this.context.projectPath = projectPath;
    this.context.isConnected = true;
  }
}
```

---

## Tools Impactés

### RAG Tools (query_entities, semantic_search, etc.)

```typescript
// Avant : utilisait un ragClient passé à la création
const result = await ragClient.search(query);

// Après : utilise le contexte de l'agent
const result = await this.context.neo4jClient.run(cypherQuery);
```

### File Tools (read_file, write_file, edit_file)

Déjà fonctionnels, utilisent `projectRoot` qui sera `context.projectPath`.

### Project Tools

| Tool | Comportement |
|------|--------------|
| `create_project` | Crée un projet, peut auto-`load_project` après |
| `setup_project` | Setup le projet courant |
| `load_project` | **NOUVEAU** - Switch vers un autre projet |
| `ingest_code` | Ré-ingère dans le Neo4j du projet courant |
| `generate_embeddings` | Génère pour le projet courant |

---

## Flux Utilisateur

### Scénario 1 : Créer et travailler sur un projet

```
User: Create a TypeScript project called my-api
Agent: [create_project] → Projet créé
       [load_project auto] → Connecté au Neo4j du projet

User: Add a greet function to src/index.ts
Agent: [read_file] → Lit le fichier
       [edit_file] → Ajoute la fonction

User: Re-ingest the code
Agent: [ingest_code] → Ingère dans le Neo4j du projet

User: Find functions that return strings
Agent: [query_entities] → Requête le Neo4j du projet
       → Trouve greet()
```

### Scénario 2 : Travailler sur plusieurs projets

```
User: Load the project at ./project-a
Agent: [load_project] → Connecté à project-a (port 7695)

User: What functions exist?
Agent: [query_entities] → Requête project-a

User: Now switch to ./project-b
Agent: [load_project] → Ferme 7695, connecte à project-b (port 7696)

User: What functions exist here?
Agent: [query_entities] → Requête project-b
```

---

## Implémentation

### Phase 1 : Connexion directe

1. Modifier `createRagForgeAgent()` pour créer `Neo4jClient` directement
2. Lire credentials depuis `.ragforge/generated/.env`
3. Ne plus dépendre de `client.ts`

### Phase 2 : Tool load_project

1. Créer le tool `load_project` dans `project-tools.ts`
2. Implémenter le switch de contexte
3. Fermer proprement les anciennes connexions

### Phase 3 : RAG Tools dynamiques

1. Modifier les RAG tools pour utiliser le contexte de l'agent
2. S'assurer que les queries vont vers le bon Neo4j
3. Gérer le cas "pas de projet chargé"

---

## Fichiers à Modifier

| Fichier | Action |
|---------|--------|
| `packages/cli/src/commands/agent.ts` | Connexion directe Neo4j |
| `packages/core/src/tools/project-tools.ts` | Ajouter `load_project` |
| `packages/core/src/runtime/agents/rag-agent.ts` | Contexte de projet dynamique |

---

## Considérations

### Gestion des erreurs

- Projet non trouvé → Erreur claire
- Neo4j non démarré → Proposer de lancer Docker
- Mauvais credentials → Relancer quickstart

### Performance

- Garder la connexion ouverte tant qu'on travaille sur un projet
- Fermer proprement lors du switch
- Timeout de connexion raisonnable

### UX

- Afficher le projet courant dans le prompt
- Confirmer le switch de projet
- Lister les projets disponibles (future)

---

## Questions Ouvertes

1. **Auto-load après create_project ?**
   - Oui, probablement souhaitable

2. **Garder plusieurs connexions ouvertes ?**
   - Non pour l'instant, un projet à la fois

3. **Détecter si Neo4j est démarré ?**
   - Oui, avec un health check avant de connecter

---

## Exemple Final

```bash
$ ragforge agent

🤖 RagForge Agent
   Project: (none)
   Tools: create_project, setup_project, load_project

> Create a project called my-api

✓ Project created at ./my-api
✓ Neo4j started on port 7695
✓ Code ingested
🔄 Auto-loading project...
✓ Connected to my-api

   Project: my-api (bolt://localhost:7695)
   Tools: + RAG tools, + File tools

> What functions exist?

[query_entities] → Found 1 function: main()

> Add a greet function

[edit_file] → Added greet()
[ingest_code] → Updated graph

> Find the greet function

[query_entities] → Found: greet(name: string): string
```
