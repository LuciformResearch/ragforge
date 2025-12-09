# Persona System Roadmap

## Objectif

Permettre aux utilisateurs de créer, gérer et personnaliser des personas pour l'agent RagForge. Chaque persona définit le nom, la couleur d'affichage, la langue et la personnalité de l'agent.

## Structure de données

### PersonaDefinition
```typescript
interface PersonaDefinition {
  id: string;           // UUID unique
  name: string;         // Nom d'affichage (ex: "Ragnarök", "CodeBot", "Assistant")
  color: string;        // Couleur terminal ('magenta', 'cyan', 'green', etc.)
  language: string;     // Langue des réponses ('fr', 'en', 'es', etc.)
  description: string;  // Description courte (user input)
  persona: string;      // Persona complet (LLM enhanced)
  isDefault?: boolean;  // Persona par défaut du système
  createdAt: string;    // Date de création
}
```

### BrainConfig.agentSettings (mise à jour)
```typescript
agentSettings: {
  activePersonaId?: string;      // ID de la persona active
  personas: PersonaDefinition[]; // Liste des personas
}
```

## Personas par défaut

### 1. Ragnarök (default, folkloric)
- **Name**: Ragnarök
- **Color**: magenta
- **Style**: Mystique, daemon du knowledge graph
- **Pour**: Utilisateurs qui aiment le côté fun/roleplay

### 2. Assistant (minimal)
- **Name**: Assistant
- **Color**: cyan
- **Style**: Sobre, professionnel, direct
- **Pour**: Utilisateurs qui veulent du factuel sans fioritures

### 3. Dev (technique)
- **Name**: Dev
- **Color**: green
- **Style**: Technique, concis, orienté code
- **Pour**: Développeurs expérimentés

## Commandes CLI

### `/list-personas`
Liste toutes les personas disponibles avec leur index.

```
📋 Personas disponibles:

  [1] ✶ Ragnarök (active)
      Mystique daemon du knowledge graph

  [2] Assistant
      Assistant sobre et professionnel

  [3] Dev
      Assistant technique orienté code

  [4] MonBot (custom)
      Ma persona personnalisée

Utilisez /set-persona <nom|index> pour changer
```

### `/set-persona <name|index>`
Change la persona active.

```
> /set-persona 2
✓ Persona changée: Assistant

> /set-persona Dev
✓ Persona changée: Dev
```

### `/create-persona`
Wizard interactif pour créer une nouvelle persona.

```
> /create-persona

🎭 Création d'une nouvelle persona

1. Nom de l'agent: MonBot
2. Couleur (red/green/yellow/blue/magenta/cyan/white/gray): cyan
3. Langue des réponses (fr/en/es/...): fr
4. Décrivez la personnalité en quelques mots:
   > Un assistant sympa et décontracté qui utilise parfois de l'humour

⏳ Génération de la persona...

✓ Persona créée: MonBot

Aperçu:
"Tu es MonBot, un assistant de développement sympa et décontracté.
Tu aides les développeurs avec une touche d'humour tout en restant précis..."

Utiliser cette persona maintenant? (o/n): o
✓ Persona active: MonBot
```

### `/delete-persona <name|index>`
Supprime une persona (sauf les defaults).

## LLM Persona Enhancer

Fonction qui prend une description courte et génère un persona complet.

**Input**:
```typescript
{
  name: "MonBot",
  language: "fr",
  description: "Un assistant sympa et décontracté qui utilise parfois de l'humour"
}
```

**Prompt LLM**:
```
Tu dois créer une description de persona pour un assistant IA de développement.

Nom de l'assistant: {name}
Langue: {language}
Description utilisateur: {description}

Génère une description de persona en 3-5 phrases qui:
- Définit le ton et le style de communication
- Reste cohérent avec la description donnée
- Est adaptée à un contexte de développement logiciel
- Est écrite à la 2ème personne ("Tu es...")

Retourne UNIQUEMENT la description, sans préambule.
```

**Output**:
```
Tu es MonBot, un assistant de développement sympa et décontracté.
Tu aides les développeurs avec une touche d'humour tout en restant précis et utile.
Quand tu expliques du code, tu gardes un ton accessible sans être condescendant.
Tu n'hésites pas à glisser une petite blague quand c'est approprié, mais tu restes
toujours focalisé sur la tâche à accomplir.
```

## Plan d'implémentation

### Phase 1: Structure de données
- [ ] Modifier `BrainConfig.agentSettings` pour `personas[]` + `activePersonaId`
- [ ] Ajouter méthodes `BrainManager`: `listPersonas()`, `getActivePersona()`, `setActivePersona()`, `addPersona()`, `deletePersona()`
- [ ] Créer les 3 personas par défaut
- [ ] Migration: si ancien format, convertir vers nouveau

### Phase 2: LLM Enhancer
- [ ] Créer `enhancePersonaDescription(name, lang, description, llm)`
- [ ] Template de prompt sobre et efficace
- [ ] Gestion d'erreur (fallback sur description brute)

### Phase 3: Commandes CLI
- [ ] `/list-personas` - affichage formaté
- [ ] `/set-persona` - avec autocomplétion nom/index
- [ ] `/create-persona` - wizard interactif avec prompts
- [ ] `/delete-persona` - avec confirmation

### Phase 4: Intégration TUI
- [ ] Utiliser `agent.identity` pour afficher le nom/couleur
- [ ] Rafraîchir l'affichage si persona change en cours de session

## Fichiers à modifier

```
packages/core/src/brain/brain-manager.ts    # Structure + méthodes
packages/core/src/runtime/agents/rag-agent.ts # AgentIdentitySettings, defaults
packages/cli/src/commands/persona.ts         # Nouvelles commandes (à créer)
packages/cli/src/index.ts                    # Enregistrer les commandes
```

## Notes

- Les personas par défaut ne peuvent pas être supprimées
- La persona active est persistée dans `~/.ragforge/config.yaml`
- Le LLM enhancer utilise le même provider que l'agent (Gemini)
- Support futur: import/export de personas (JSON)
