# RagForge Terminal Agent - Roadmap

## Vision

Créer une interface terminal interactive pour agents AI avec validation humaine des actions, preview des diffs, et une UX proche de Claude Code.

---

## 1. Système de Validation des Outils

### Architecture à Deux Niveaux

#### 1.1 Validation Forcée (Tool-Declared)

Certains outils déclarent qu'ils nécessitent **toujours** une validation humaine avant exécution.

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  parameters: JSONSchema;
  requiresValidation?: boolean;  // NEW: force validation
}
```

**Outils concernés:**
- `edit_file` - Preview diff avant modification
- `create_file` - Voir le contenu avant création
- `delete_path` - Confirmation avant suppression
- `write_file` - Preview du contenu
- `generate_image` / `edit_image` - Preview du prompt utilisé
- `run_command` (commandes dangereuses) - Voir la commande

#### 1.2 Validation Optionnelle (Agent-Requested)

L'agent peut demander une validation à runtime pour n'importe quel outil via un paramètre spécial.

```typescript
// Paramètre commun à tous les outils
interface CommonToolParams {
  _requestValidation?: boolean;  // Agent demande validation
  _validationReason?: string;    // Explication pour l'utilisateur
}
```

**Cas d'usage:**
- Opérations batch importantes
- Actions irréversibles détectées par l'agent
- Incertitude de l'agent sur le résultat attendu

### 1.3 Protocole des Actions Pending

```typescript
interface PendingAction {
  id: string;
  toolName: string;
  params: Record<string, unknown>;
  preview?: ActionPreview;
  validationType: 'forced' | 'agent-requested';
  reason?: string;
  createdAt: Date;
}

interface ActionPreview {
  type: 'diff' | 'content' | 'command' | 'summary';
  data: DiffPreview | ContentPreview | CommandPreview | string;
}

interface DiffPreview {
  filePath: string;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}
```

### 1.4 Flow de Validation

```
Agent appelle outil
       │
       ▼
┌──────────────────┐
│ requiresValidation│──Yes──▶ Créer PendingAction
│ ou _requestValidation?│      avec preview
└──────────────────┘              │
       │ No                       ▼
       ▼                   Afficher au user
   Exécuter                       │
   directement              ┌─────┴─────┐
                           │           │
                        Approve     Reject
                           │           │
                           ▼           ▼
                       Exécuter    Annuler +
                       + Notifier  feedback
```

---

## 2. Interface Terminal avec Ink

### Pourquoi Ink?

- **React pour CLI** - Familier, composants réutilisables
- **Utilisé par:** Claude Code, Gemini CLI, OpenAI Codex CLI, GitHub Copilot CLI, Cloudflare Wrangler
- **Flexbox layout** via Yoga
- **Hooks React** - useState, useEffect, custom hooks

### 2.1 Structure des Composants

```
src/terminal/
├── app.tsx                 # Root component
├── components/
│   ├── Chat.tsx           # Zone de conversation
│   ├── Input.tsx          # Input utilisateur
│   ├── Spinner.tsx        # Loading states
│   ├── DiffPreview.tsx    # Preview des diffs
│   ├── ValidationPrompt.tsx # Approve/Reject UI
│   ├── TodoList.tsx       # Tasks en cours
│   └── StatusBar.tsx      # État connexion, etc.
├── hooks/
│   ├── useAgent.ts        # Communication avec l'agent
│   ├── usePendingActions.ts # Gestion actions pending
│   └── useKeyboard.ts     # Raccourcis clavier
└── themes/
    └── default.ts         # Couleurs, styles
```

### 2.2 Composant DiffPreview

```tsx
import { Box, Text } from 'ink';

interface DiffPreviewProps {
  diff: DiffPreview;
  maxLines?: number;
}

export function DiffPreview({ diff, maxLines = 20 }: DiffPreviewProps) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray">
      <Box paddingX={1}>
        <Text bold>{diff.filePath}</Text>
        <Text color="green"> +{diff.additions}</Text>
        <Text color="red"> -{diff.deletions}</Text>
      </Box>
      
      {diff.hunks.slice(0, maxLines).map((hunk, i) => (
        <Box key={i} flexDirection="column">
          <Text color="cyan">@@ {hunk.header} @@</Text>
          {hunk.lines.map((line, j) => (
            <Text 
              key={j}
              color={line.type === 'add' ? 'green' : line.type === 'del' ? 'red' : undefined}
            >
              {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}{line.content}
            </Text>
          ))}
        </Box>
      ))}
    </Box>
  );
}
```

### 2.3 Composant ValidationPrompt

```tsx
import { Box, Text, useInput } from 'ink';

interface ValidationPromptProps {
  action: PendingAction;
  onApprove: () => void;
  onReject: (reason?: string) => void;
}

export function ValidationPrompt({ action, onApprove, onReject }: ValidationPromptProps) {
  useInput((input, key) => {
    if (input === 'y' || key.return) onApprove();
    if (input === 'n' || key.escape) onReject();
  });

  return (
    <Box flexDirection="column" borderStyle="double" borderColor="yellow">
      <Box paddingX={1}>
        <Text bold color="yellow">⚠ Validation Required</Text>
      </Box>
      
      <Box paddingX={1}>
        <Text>Tool: <Text bold>{action.toolName}</Text></Text>
      </Box>
      
      {action.reason && (
        <Box paddingX={1}>
          <Text dimColor>Reason: {action.reason}</Text>
        </Box>
      )}
      
      {action.preview && <ActionPreviewComponent preview={action.preview} />}
      
      <Box paddingX={1} marginTop={1}>
        <Text color="green">[Y]es</Text>
        <Text> / </Text>
        <Text color="red">[N]o</Text>
      </Box>
    </Box>
  );
}
```

---

## 3. Intégration MCP

### 3.1 Modifier le Tool Handler

```typescript
// Dans mcp-server/tool-handler.ts

async function handleToolCall(
  toolName: string,
  params: Record<string, unknown>
): Promise<ToolResult> {
  const toolDef = getToolDefinition(toolName);
  const needsValidation = toolDef.requiresValidation || params._requestValidation;
  
  if (needsValidation) {
    // Générer preview selon le type d'outil
    const preview = await generatePreview(toolName, params);
    
    // Créer action pending
    const pendingAction: PendingAction = {
      id: crypto.randomUUID(),
      toolName,
      params,
      preview,
      validationType: toolDef.requiresValidation ? 'forced' : 'agent-requested',
      reason: params._validationReason as string,
      createdAt: new Date(),
    };
    
    // Retourner au client pour validation
    return {
      status: 'pending_validation',
      pendingAction,
    };
  }
  
  // Exécution directe
  return executeToolDirectly(toolName, params);
}
```

### 3.2 Preview Generators

```typescript
async function generatePreview(
  toolName: string, 
  params: Record<string, unknown>
): Promise<ActionPreview | undefined> {
  switch (toolName) {
    case 'edit_file':
      return {
        type: 'diff',
        data: await computeDiff(
          params.path as string,
          params.old_string as string,
          params.new_string as string
        ),
      };
      
    case 'create_file':
    case 'write_file':
      return {
        type: 'content',
        data: {
          path: params.path as string,
          content: params.content as string,
          language: detectLanguage(params.path as string),
        },
      };
      
    case 'run_command':
      return {
        type: 'command',
        data: {
          command: params.command as string,
          cwd: params.cwd as string,
          danger: assessDanger(params.command as string),
        },
      };
      
    default:
      return {
        type: 'summary',
        data: JSON.stringify(params, null, 2),
      };
  }
}
```

---

## 4. Planning d'Implémentation

### Phase 1: Foundation (Semaine 1-2)
- [ ] Setup projet Ink avec TypeScript
- [ ] Composants de base: Chat, Input, StatusBar
- [ ] Hook useAgent pour communication
- [ ] Theme system basique

### Phase 2: Validation System (Semaine 3-4)
- [ ] Interface PendingAction
- [ ] Modifier tool definitions avec requiresValidation
- [ ] Ajouter _requestValidation aux common params
- [ ] Preview generators pour edit/create/delete
- [ ] Composant DiffPreview

### Phase 3: Terminal UI (Semaine 5-6)
- [ ] ValidationPrompt component
- [ ] Keyboard shortcuts (y/n, arrows, etc.)
- [ ] Queue de pending actions
- [ ] Notifications de succès/échec

### Phase 4: Polish (Semaine 7-8)
- [ ] Syntax highlighting dans les diffs
- [ ] Scrolling pour longs fichiers
- [ ] History des actions validées/rejetées
- [ ] Configuration utilisateur (auto-approve certains outils)

---

## 5. Alternatives Considérées

| Framework | Pros | Cons |
|-----------|------|------|
| **Ink** (choisi) | React, écosystème, utilisé par Claude/OpenAI | Memory usage |
| **Bubble Tea** | Performance, Go natif | Pas Node.js |
| **terminal-kit** | Léger, natif | API moins moderne |
| **Textual** | CSS-like, beau | Python only |
| **blessed** | Puissant | API complexe, moins maintenu |

---

## 6. Métriques de Succès

- [ ] Temps de réponse validation < 100ms
- [ ] Diff preview pour fichiers jusqu'à 1000 lignes
- [ ] Support Unicode complet
- [ ] Pas de memory leaks sur sessions longues
- [ ] UX comparable à Claude Code pour l'approval flow

---

## Notes

- OpenAI migre Codex CLI vers Rust pour performance - à surveiller si Ink devient limitant
- Possibilité future: WebSocket pour UI web en parallèle du terminal
- Le système de validation peut être réutilisé pour d'autres clients (VSCode extension, web)
