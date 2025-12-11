# Roadmap : Système de Preview et Confirmation (Diff + Lecture)

## Vue d'ensemble

Cette roadmap couvre l'implémentation d'un système permettant de prévisualiser les modifications de fichiers avant leur application, ainsi que de valider les lectures de fichiers (entières ou avec range de lignes), avec confirmation utilisateur et affichage en historique.

> **📋 Vision Complète** : Pour la vision globale du système de validation pour tous les outils, voir [VALIDATION_SYSTEM_VISION.md](../VALIDATION_SYSTEM_VISION.md) et [VALIDATION_DESIGN_BY_TOOL.md](../VALIDATION_DESIGN_BY_TOOL.md).

## Objectifs

- **Transparence** : L'utilisateur voit exactement ce qui va être modifié ou lu
- **Sécurité** : Confirmation avant application des modifications et lectures
- **Traçabilité** : Historique des modifications et lectures avec preview visible
- **UX** : Interface claire et intuitive pour la validation
- **Configurabilité** : Toutes les validations optionnelles avec par défaut "oui" selon config

---

## Feature 1 : Preview de Diff Avant Application

### Description

Quand un tool call affecte un fichier (`write_file`, `edit_file`, `create_file`, `delete_path`), afficher un preview de la diff avant d'appliquer la modification.

### Workflow

1. Agent appelle un outil de modification de fichier
2. Le système calcule la diff entre l'état actuel et l'état proposé
3. Affichage du preview avec :
   - Lien clickable vers le fichier (Ctrl+Click)
   - Diff colorée (ajouts en vert, suppressions en rouge)
   - Options : Approve / Reject / Edit
4. Si approuvé → application de la modification
5. Si rejeté → annulation avec feedback
6. Si modifié → retour à l'agent avec les modifications

### Implémentation

#### Composant DiffPreview

```typescript
import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { FileLink } from './FileLink'; // Voir ROADMAP_CLICKABLE_LINKS.md

interface DiffPreviewProps {
  filePath: string;
  diff: {
    oldContent: string;
    newContent: string;
    addedLines: number[];
    removedLines: number[];
  };
  onApprove: () => void;
  onReject: () => void;
  onEdit?: () => void;
  autoApprove?: boolean; // Si true, approuve automatiquement après délai
  autoApproveDelay?: number; // Délai en ms avant auto-approbation (défaut: 2000ms)
}

export const DiffPreview: React.FC<DiffPreviewProps> = ({
  filePath,
  diff,
  onApprove,
  onReject,
  onEdit,
  autoApprove = false,
  autoApproveDelay = 2000
}) => {
  const [selected, setSelected] = useState<'approve' | 'reject' | 'edit'>('approve');
  const [timeRemaining, setTimeRemaining] = useState<number | null>(
    autoApprove ? autoApproveDelay : null
  );
  
  // Auto-approve si configuré
  useEffect(() => {
    if (autoApprove && timeRemaining !== null) {
      const interval = setInterval(() => {
        setTimeRemaining(prev => {
          if (prev === null || prev <= 100) {
            onApprove();
            return null;
          }
          return prev - 100;
        });
      }, 100);
      
      return () => clearInterval(interval);
    }
  }, [autoApprove, timeRemaining, onApprove]);
  
  useInput((input, key) => {
    // Annuler l'auto-approve si l'utilisateur interagit
    if (autoApprove && timeRemaining !== null) {
      setTimeRemaining(null);
    }
    if (key.leftArrow) {
      setSelected(prev => prev === 'approve' ? 'reject' : 'approve');
    } else if (key.rightArrow) {
      setSelected(prev => prev === 'reject' ? 'approve' : 'reject');
    } else if (input === '\r') { // Enter
      if (selected === 'approve') {
        onApprove();
      } else if (selected === 'reject') {
        onReject();
      } else if (selected === 'edit' && onEdit) {
        onEdit();
      }
    } else if (input === 'e' && onEdit) {
      onEdit();
    }
  });
  
  // Calculer les lignes de diff
  const diffLines = calculateDiffLines(diff.oldContent, diff.newContent);
  
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={1}>
      {/* Lien vers le fichier */}
      <Box marginBottom={1}>
        <FileLink filePath={filePath} lineNumber={1} />
      </Box>
      
      {/* Titre */}
      <Box marginBottom={1}>
        <Text color="yellow" bold>
          ⚠️  Modification Preview: {filePath}
        </Text>
      </Box>
      
      {/* Diff */}
      <Box flexDirection="column" marginBottom={1}>
        {diffLines.map((line, idx) => (
          <Box key={idx}>
            {line.type === 'added' && (
              <Text color="green">
                + {line.content}
              </Text>
            )}
            {line.type === 'removed' && (
              <Text color="red">
                - {line.content}
              </Text>
            )}
            {line.type === 'unchanged' && (
              <Text dimColor>
                  {line.content}
              </Text>
            )}
          </Box>
        ))}
      </Box>
      
      {/* Compte à rebours si auto-approve */}
      {autoApprove && timeRemaining !== null && (
        <Box marginBottom={1}>
          <Text color="green" dimColor>
            Auto-approving in {(timeRemaining / 1000).toFixed(1)}s... (Press any key to cancel)
          </Text>
        </Box>
      )}
      
      {/* Actions */}
      <Box>
        <Text>
          {selected === 'approve' ? '→' : ' '} [
          <Text color={selected === 'approve' ? 'green' : 'white'}>
            A
          </Text>
          ]pprove
        </Text>
        <Text>  </Text>
        <Text>
          {selected === 'reject' ? '→' : ' '} [
          <Text color={selected === 'reject' ? 'red' : 'white'}>
            R
          </Text>
          ]eject
        </Text>
        {onEdit && (
          <>
            <Text>  </Text>
            <Text>
              {selected === 'edit' ? '→' : ' '} [
              <Text color={selected === 'edit' ? 'yellow' : 'white'}>
                E
              </Text>
              ]dit
            </Text>
          </>
        )}
      </Box>
    </Box>
  );
};

function calculateDiffLines(oldContent: string, newContent: string): Array<{
  type: 'added' | 'removed' | 'unchanged';
  content: string;
  lineNumber?: number;
}> {
  // Utiliser une librairie de diff (ex: diff-match-patch, jsdiff)
  // Retourner les lignes avec leur type
  // ...
}
```

### Fichiers à créer

- `packages/cli/src/tui/components/shared/DiffPreview.tsx`
- `packages/cli/src/tui/utils/diff.ts` (utilitaires pour calculer les diffs)

---

## Feature 2 : Affichage de Diff en Historique

### Description

Une fois la modification appliquée, afficher la diff dans l'historique des messages avec un lien clickable vers le fichier.

### Implémentation

#### Composant DiffHistory

```typescript
import React from 'react';
import { Box, Text } from 'ink';
import { FileLink } from './FileLink';

interface DiffHistoryProps {
  filePath: string;
  diff: {
    addedLines: number[];
    removedLines: number[];
    addedContent: string;
    removedContent: string;
  };
  timestamp: Date;
}

export const DiffHistory: React.FC<DiffHistoryProps> = ({
  filePath,
  diff,
  timestamp
}) => {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" padding={1} marginY={1}>
      {/* Lien vers le fichier */}
      <Box marginBottom={1}>
        <FileLink filePath={filePath} lineNumber={diff.addedLines[0] || diff.removedLines[0]} />
        <Text color="gray" dimColor>
          {' '}({timestamp.toLocaleTimeString()})
        </Text>
      </Box>
      
      {/* Titre */}
      <Box marginBottom={1}>
        <Text color="cyan" dimColor>
          ✓ Applied modification to {filePath}
        </Text>
      </Box>
      
      {/* Diff compacte */}
      <Box flexDirection="column">
        {diff.removedLines.length > 0 && (
          <Box>
            <Text color="red">
              - {diff.removedLines.length} line(s) removed
            </Text>
          </Box>
        )}
        {diff.addedLines.length > 0 && (
          <Box>
            <Text color="green">
              + {diff.addedLines.length} line(s) added
            </Text>
          </Box>
        )}
      </Box>
      
      {/* Option pour voir la diff complète */}
      <Box marginTop={1}>
        <Text color="blue" dimColor>
          Press 'D' to view full diff
        </Text>
      </Box>
    </Box>
  );
};
```

### Fichiers à créer

- `packages/cli/src/tui/components/messages/DiffHistory.tsx`

---

## Feature 3 : Intégration avec le Système d'Agent

### Description

Intégrer le système de preview dans le workflow de l'agent, interceptant les tool calls de modification de fichiers.

### Workflow Complet

```typescript
// Dans useAgent.ts ou App.tsx
const [pendingDiff, setPendingDiff] = useState<{
  toolName: string;
  args: Record<string, any>;
  diff: DiffData;
  autoApprove?: boolean;
  delay?: number;
} | null>(null);

const handleToolCall = async (toolName: string, args: Record<string, any>) => {
  const FILE_MODIFICATION_TOOLS = new Set(['write_file', 'edit_file', 'create_file', 'delete_path']);
  
  if (FILE_MODIFICATION_TOOLS.has(toolName)) {
    // Calculer la diff avant d'appliquer
    const currentContent = await readFileIfExists(args.path);
    const newContent = toolName === 'delete_path' ? '' : args.content;
    
    const diff = calculateDiff(currentContent || '', newContent);
    
    // Vérifier la config pour auto-approve
    const config = getValidationConfig();
    const requiresApproval = config.requireDiffApproval;
    
    // Afficher le preview
    setPendingDiff({
      toolName,
      args,
      diff: {
        oldContent: currentContent || '',
        newContent,
        addedLines: diff.addedLines,
        removedLines: diff.removedLines
      },
      autoApprove: !requiresApproval,
      delay: config.diffApprovalDelay
    });
    
    // Si auto-approve, déclencher après délai
    if (!requiresApproval) {
      setTimeout(() => {
        handleApprove();
      }, config.diffApprovalDelay);
    }
    
    // Ne pas exécuter immédiatement, attendre confirmation ou auto-approve
    return;
  }
  
  // Pour les autres outils, exécution normale
  await executeTool(toolName, args);
};

const handleApprove = async () => {
  if (!pendingDiff) return;
  
  // Appliquer la modification
  await executeTool(pendingDiff.toolName, pendingDiff.args);
  
  // Ajouter à l'historique avec diff
  addToHistory({
    type: 'diff_applied',
    filePath: pendingDiff.args.path,
    diff: pendingDiff.diff,
    timestamp: new Date()
  });
  
  setPendingDiff(null);
};

const handleReject = () => {
  // Annuler et donner feedback à l'agent
  addToHistory({
    type: 'diff_rejected',
    filePath: pendingDiff?.args.path,
    timestamp: new Date()
  });
  
  setPendingDiff(null);
};
```

### Fichiers à modifier

- `packages/cli/src/tui/hooks/useAgent.ts`
- `packages/cli/src/tui/App.tsx`

---

## Feature 4 : Affichage dans l'Historique

### Description

Afficher les diffs appliquées dans l'historique des messages, avec possibilité de voir la diff complète.

### Implémentation

```typescript
// Dans App.tsx ou MessageList.tsx
{history.map((message, idx) => {
  if (message.type === 'diff_applied') {
    return (
      <DiffHistory
        key={idx}
        filePath={message.filePath}
        diff={message.diff}
        timestamp={message.timestamp}
      />
    );
  }
  // ... autres types de messages
})}
```

---

## Optimisations

### Performance

1. **Calcul de diff asynchrone** : Calculer la diff en arrière-plan pour ne pas bloquer l'UI
2. **Limitation de lignes** : Limiter l'affichage à N lignes avec option "voir plus"
3. **Cache** : Mettre en cache les diffs calculées

### UX

1. **Raccourcis clavier** : A/R/E pour Approve/Reject/Edit
2. **Navigation** : Flèches pour naviguer dans les options
3. **Feedback visuel** : Highlight de la sélection

---

## Tests

### Scénarios de Test

#### Pour les Diff Preview
1. **Preview simple** : Afficher une diff pour un fichier simple
2. **Approve** : Approuver et vérifier l'application
3. **Reject** : Rejeter et vérifier l'annulation
4. **Edit** : Modifier et vérifier le retour à l'agent
5. **Historique** : Vérifier l'affichage dans l'historique
6. **Lien clickable** : Vérifier que le lien fonctionne

#### Pour les Lectures de Fichiers
7. **Lecture avec range** : Afficher preview avec contenu du range
8. **Lecture fichier entier** : Afficher juste le lien
9. **Auto-approve** : Vérifier l'auto-approbation selon config
10. **Validation manuelle** : Vérifier la validation si configurée
11. **Historique lecture** : Vérifier l'affichage dans l'historique
12. **Config** : Vérifier que la config est respectée

---

## Métriques de Succès

- Preview clair et lisible (diff et lectures)
- Confirmation fonctionnelle (manuelle et auto)
- Diff précise (pas de faux positifs)
- Performance acceptable (calcul rapide)
- UX intuitive
- Configuration respectée (auto-approve par défaut)
- Liens clickables fonctionnels

---

## Feature 5 : Validation des Lectures de Fichiers

### Description

Pour les lectures de fichiers (`read_file`), afficher un preview avec validation avant d'afficher le contenu complet.

### Cas d'Usage

1. **Lecture avec range de lignes** : Afficher un bloc avec le contenu du range et demander validation
2. **Lecture de fichier entier** : Afficher juste le lien du fichier et demander validation
3. **Configuration** : Toutes les validations optionnelles avec par défaut "oui"

### Implémentation

#### Composant FileReadPreview

```typescript
import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { FileLink } from './FileLink';

interface FileReadPreviewProps {
  filePath: string;
  startLine?: number;
  endLine?: number;
  content?: string; // Contenu du range si spécifié
  isFullFile: boolean;
  onApprove: () => void;
  onReject: () => void;
  autoApprove?: boolean; // Si true, approuve automatiquement après délai
  autoApproveDelay?: number; // Délai en ms avant auto-approbation (défaut: 2000ms)
}

export const FileReadPreview: React.FC<FileReadPreviewProps> = ({
  filePath,
  startLine,
  endLine,
  content,
  isFullFile,
  onApprove,
  onReject,
  autoApprove = false,
  autoApproveDelay = 2000
}) => {
  const [selected, setSelected] = useState<'approve' | 'reject'>('approve');
  const [timeRemaining, setTimeRemaining] = useState<number | null>(
    autoApprove ? autoApproveDelay : null
  );
  
  // Auto-approve si configuré
  useEffect(() => {
    if (autoApprove && timeRemaining !== null) {
      const interval = setInterval(() => {
        setTimeRemaining(prev => {
          if (prev === null || prev <= 100) {
            onApprove();
            return null;
          }
          return prev - 100;
        });
      }, 100);
      
      return () => clearInterval(interval);
    }
  }, [autoApprove, timeRemaining, onApprove]);
  
  useInput((input, key) => {
    if (key.leftArrow || key.rightArrow) {
      setSelected(prev => prev === 'approve' ? 'reject' : 'approve');
    } else if (input === '\r') { // Enter
      if (selected === 'approve') {
        onApprove();
      } else {
        onReject();
      }
    } else if (input === 'a' || input === 'A') {
      onApprove();
    } else if (input === 'r' || input === 'R') {
      onReject();
    }
  });
  
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="blue" padding={1}>
      {/* Lien vers le fichier */}
      <Box marginBottom={1}>
        <FileLink 
          filePath={filePath} 
          lineNumber={startLine || 1}
          displayText={`File: ${filePath}${startLine ? `:${startLine}${endLine ? `-${endLine}` : ''}` : ''}`}
        />
      </Box>
      
      {/* Titre */}
      <Box marginBottom={1}>
        <Text color="cyan" bold>
          📖 File Read Request: {filePath}
        </Text>
      </Box>
      
      {/* Contenu du range si spécifié */}
      {!isFullFile && content && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color="yellow" dimColor>
            Lines {startLine}-{endLine}:
          </Text>
          <Box marginTop={1}>
            <Text>
              {content.split('\n').slice(0, 20).map((line, idx) => (
                <Text key={idx}>
                  {line}
                  {'\n'}
                </Text>
              ))}
              {content.split('\n').length > 20 && (
                <Text color="gray" dimColor>
                  ... ({content.split('\n').length - 20} more lines)
                </Text>
              )}
            </Text>
          </Box>
        </Box>
      )}
      
      {/* Message pour fichier entier */}
      {isFullFile && (
        <Box marginBottom={1}>
          <Text color="yellow" dimColor>
            Full file read requested
          </Text>
        </Box>
      )}
      
      {/* Compte à rebours si auto-approve */}
      {autoApprove && timeRemaining !== null && (
        <Box marginBottom={1}>
          <Text color="green" dimColor>
            Auto-approving in {(timeRemaining / 1000).toFixed(1)}s... (Press any key to cancel)
          </Text>
        </Box>
      )}
      
      {/* Actions */}
      <Box>
        <Text>
          {selected === 'approve' ? '→' : ' '} [
          <Text color={selected === 'approve' ? 'green' : 'white'}>
            A
          </Text>
          ]pprove
        </Text>
        <Text>  </Text>
        <Text>
          {selected === 'reject' ? '→' : ' '} [
          <Text color={selected === 'reject' ? 'red' : 'white'}>
            R
          </Text>
          ]eject
        </Text>
      </Box>
    </Box>
  );
};
```

### Fichiers à créer

- `packages/cli/src/tui/components/shared/FileReadPreview.tsx`

---

## Feature 6 : Configuration des Validations

### Description

Système de configuration pour rendre toutes les validations optionnelles avec par défaut "oui" (auto-approve).

### Implémentation

#### Configuration

```typescript
// packages/cli/src/tui/config/validation.ts
export interface ValidationConfig {
  // Validation des modifications de fichiers
  requireDiffApproval: boolean; // Défaut: false (auto-approve)
  diffApprovalDelay?: number; // Délai avant auto-approve en ms (défaut: 2000)
  
  // Validation des lectures de fichiers
  requireReadApproval: boolean; // Défaut: false (auto-approve)
  readApprovalDelay?: number; // Délai avant auto-approve en ms (défaut: 2000)
  
  // Validation spécifique pour lectures avec range
  requireRangeReadApproval: boolean; // Défaut: false (auto-approve)
  rangeReadApprovalDelay?: number; // Délai avant auto-approve en ms (défaut: 2000)
  
  // Validation spécifique pour lectures de fichiers entiers
  requireFullFileReadApproval: boolean; // Défaut: false (auto-approve)
  fullFileReadApprovalDelay?: number; // Délai avant auto-approve en ms (défaut: 2000)
}

export const DEFAULT_VALIDATION_CONFIG: ValidationConfig = {
  requireDiffApproval: false, // Auto-approve par défaut
  diffApprovalDelay: 2000,
  requireReadApproval: false, // Auto-approve par défaut
  readApprovalDelay: 2000,
  requireRangeReadApproval: false, // Auto-approve par défaut
  rangeReadApprovalDelay: 2000,
  requireFullFileReadApproval: false, // Auto-approve par défaut
  fullFileReadApprovalDelay: 2000,
};
```

#### Utilisation dans le TUI

```typescript
// Dans useAgent.ts ou App.tsx
import { ValidationConfig, DEFAULT_VALIDATION_CONFIG } from '../config/validation';

const [validationConfig, setValidationConfig] = useState<ValidationConfig>(
  DEFAULT_VALIDATION_CONFIG
);

// Charger la config depuis les settings utilisateur
useEffect(() => {
  // Charger depuis ~/.ragforge/config.json ou équivalent
  loadValidationConfig().then(config => {
    setValidationConfig(config);
  });
}, []);

// Utiliser la config pour les validations
const handleToolCall = async (toolName: string, args: Record<string, any>) => {
  // Pour les modifications de fichiers
  if (['write_file', 'edit_file', 'create_file'].includes(toolName)) {
    if (validationConfig.requireDiffApproval) {
      // Afficher le preview et attendre validation
      showDiffPreview(toolName, args);
    } else {
      // Auto-approve après délai
      showDiffPreview(toolName, args, {
        autoApprove: true,
        delay: validationConfig.diffApprovalDelay
      });
    }
    return;
  }
  
  // Pour les lectures de fichiers
  if (toolName === 'read_file') {
    const isFullFile = !args.startLine && !args.endLine;
    const isRangeRead = args.startLine || args.endLine;
    
    if (isFullFile && validationConfig.requireFullFileReadApproval) {
      showFileReadPreview(args.path, { isFullFile: true });
    } else if (isRangeRead && validationConfig.requireRangeReadApproval) {
      showFileReadPreview(args.path, {
        startLine: args.startLine,
        endLine: args.endLine,
        isFullFile: false
      });
    } else {
      // Auto-approve selon config
      const delay = isFullFile 
        ? validationConfig.fullFileReadApprovalDelay 
        : validationConfig.rangeReadApprovalDelay;
      
      showFileReadPreview(args.path, {
        startLine: args.startLine,
        endLine: args.endLine,
        isFullFile,
        autoApprove: !validationConfig.requireReadApproval,
        delay
      });
    }
    return;
  }
  
  // Autres outils...
};
```

### Fichiers à créer

- `packages/cli/src/tui/config/validation.ts`
- `packages/cli/src/tui/utils/configLoader.ts`

---

## Feature 7 : Intégration des Lectures dans le Workflow

### Description

Intégrer le système de validation des lectures dans le workflow de l'agent.

### Workflow Complet

```typescript
// Dans useAgent.ts ou App.tsx
const [pendingRead, setPendingRead] = useState<{
  toolName: string;
  args: Record<string, any>;
  content?: string; // Contenu pré-chargé pour preview si range
} | null>(null);

const handleToolCall = async (toolName: string, args: Record<string, any>) => {
  if (toolName === 'read_file') {
    const isFullFile = !args.startLine && !args.endLine;
    const isRangeRead = args.startLine || args.endLine;
    
    // Pré-charger le contenu si c'est un range (pour preview)
    let previewContent: string | undefined;
    if (isRangeRead) {
      try {
        const fullContent = await fs.readFile(args.path, 'utf-8');
        const lines = fullContent.split('\n');
        const start = (args.startLine || 1) - 1;
        const end = args.endLine || lines.length;
        previewContent = lines.slice(start, end).join('\n');
      } catch (error) {
        // Si erreur, on continue sans preview
      }
    }
    
    // Afficher le preview selon la config
    const config = getValidationConfig();
    const requiresApproval = isFullFile 
      ? config.requireFullFileReadApproval 
      : config.requireRangeReadApproval;
    
    setPendingRead({
      toolName,
      args,
      content: previewContent
    });
    
    // Si auto-approve, déclencher après délai
    if (!requiresApproval) {
      const delay = isFullFile 
        ? config.fullFileReadApprovalDelay 
        : config.rangeReadApprovalDelay;
      
      setTimeout(() => {
        handleApproveRead();
      }, delay);
    }
    
    return;
  }
  
  // ... autres outils
};

const handleApproveRead = async () => {
  if (!pendingRead) return;
  
  // Exécuter la lecture
  const result = await executeTool(pendingRead.toolName, pendingRead.args);
  
  // Ajouter à l'historique
  addToHistory({
    type: 'file_read',
    filePath: pendingRead.args.path,
    startLine: pendingRead.args.startLine,
    endLine: pendingRead.args.endLine,
    isFullFile: !pendingRead.args.startLine && !pendingRead.args.endLine,
    timestamp: new Date()
  });
  
  setPendingRead(null);
};

const handleRejectRead = () => {
  // Annuler la lecture
  addToHistory({
    type: 'file_read_rejected',
    filePath: pendingRead?.args.path,
    timestamp: new Date()
  });
  
  setPendingRead(null);
};
```

### Affichage dans App.tsx

```typescript
// Dans App.tsx
{pendingRead && (
  <Box marginY={1}>
    <FileReadPreview
      filePath={pendingRead.args.path}
      startLine={pendingRead.args.startLine}
      endLine={pendingRead.args.endLine}
      content={pendingRead.content}
      isFullFile={!pendingRead.args.startLine && !pendingRead.args.endLine}
      onApprove={handleApproveRead}
      onReject={handleRejectRead}
      autoApprove={!getValidationConfig().requireReadApproval}
      autoApproveDelay={getValidationConfig().readApprovalDelay}
    />
  </Box>
)}
```

---

## Feature 8 : Affichage des Lectures dans l'Historique

### Description

Afficher les lectures de fichiers dans l'historique avec le lien clickable.

### Implémentation

```typescript
import React from 'react';
import { Box, Text } from 'ink';
import { FileLink } from './FileLink';

interface FileReadHistoryProps {
  filePath: string;
  startLine?: number;
  endLine?: number;
  isFullFile: boolean;
  timestamp: Date;
}

export const FileReadHistory: React.FC<FileReadHistoryProps> = ({
  filePath,
  startLine,
  endLine,
  isFullFile,
  timestamp
}) => {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="blue" padding={1} marginY={1}>
      {/* Lien vers le fichier */}
      <Box marginBottom={1}>
        <FileLink 
          filePath={filePath} 
          lineNumber={startLine || 1}
          displayText={`📖 Read: ${filePath}${startLine ? `:${startLine}${endLine ? `-${endLine}` : ''}` : ''}`}
        />
        <Text color="gray" dimColor>
          {' '}({timestamp.toLocaleTimeString()})
        </Text>
      </Box>
      
      {/* Info */}
      <Box>
        <Text color="cyan" dimColor>
          {isFullFile ? 'Full file read' : `Lines ${startLine}-${endLine} read`}
        </Text>
      </Box>
    </Box>
  );
};
```

### Fichiers à créer

- `packages/cli/src/tui/components/messages/FileReadHistory.tsx`

---

## Dépendances

- Système de liens clickables (voir ROADMAP_CLICKABLE_LINKS.md)
- Librairie de diff (ex: `diff-match-patch`, `jsdiff`)
- Gestion d'état pour les pending diffs et reads
- Système de configuration utilisateur
