# Bugs et Corrections Identifiés

Document créé lors de l'analyse pour les debug tools.

## Bug 1 : `messagesToTurns` ignore les messages assistant intermédiaires

### Statut: **CORRIGÉ** (12 déc 2025)

### Localisation
`packages/core/src/runtime/conversation/storage.ts:815-910`

### Description
La méthode `messagesToTurns` assume un pairing simple `user[i]` → `assistant[i+1]` :

```typescript
// Code actuel (bugué)
for (let i = 0; i < messages.length; i++) {
  const userMsg = messages[i];
  if (userMsg.role !== 'user') continue;

  // Find corresponding assistant message
  const assistantMsg = messages[i + 1];  // ← Problème : ne regarde que i+1
  if (!assistantMsg || assistantMsg.role !== 'assistant') continue;

  // Tool calls extraits uniquement de ce message assistant
  const toolResults = (assistantMsg.tool_calls || []).map(tc => ...);
}
```

### Impact
Quand l'agent fait plusieurs itérations avec des tool calls :
```
user[0]           → "Peux-tu lire ce fichier ?"
assistant[1]      → (tool_call: read_file)
assistant[2]      → (tool_call: grep_files)  ← IGNORÉ
assistant[3]      → "Voici le contenu..."    ← Seul ce message est pris
```

Les tool calls des messages `assistant[1]` et `assistant[2]` sont **perdus**.

### Solution proposée

```typescript
// Code corrigé
private messagesToTurns(messages: Message[]): ConversationTurn[] {
  const turns: ConversationTurn[] = [];

  let i = 0;
  while (i < messages.length) {
    const userMsg = messages[i];
    if (userMsg.role !== 'user') {
      i++;
      continue;
    }

    // Collecter TOUS les messages assistant jusqu'au prochain user
    const allToolResults: ToolResult[] = [];
    let finalAssistantContent = '';
    let lastTimestamp = userMsg.timestamp;

    let j = i + 1;
    while (j < messages.length && messages[j].role !== 'user') {
      const msg = messages[j];
      if (msg.role === 'assistant') {
        // Accumuler les tool calls de chaque message assistant
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          for (const tc of msg.tool_calls) {
            allToolResults.push({
              toolName: tc.tool_name || 'unknown',
              toolArgs: parseToolArgs(tc.arguments),
              toolResult: parseToolResult(tc.result),
              success: tc.result?.success ?? tc.success ?? true,
              timestamp: normalizeTimestamp(tc.timestamp || msg.timestamp)
            });
          }
        }
        // Le dernier message assistant avec du contenu est la réponse finale
        if (msg.content && msg.content.trim()) {
          finalAssistantContent = msg.content;
        }
        lastTimestamp = msg.timestamp;
      }
      j++;
    }

    // Créer le turn seulement si on a une réponse assistant
    if (finalAssistantContent) {
      turns.push({
        userMessage: userMsg.content,
        assistantMessage: finalAssistantContent,
        toolResults: allToolResults,  // Tous les tool calls accumulés
        timestamp: normalizeTimestamp(lastTimestamp)
      });
    }

    i = j; // Avancer au prochain user message
  }

  return turns;
}
```

### Fichiers à modifier
- `packages/core/src/runtime/conversation/storage.ts`

### Tests à ajouter
```typescript
describe('messagesToTurns', () => {
  it('should collect tool calls from multiple intermediate assistant messages', () => {
    const messages = [
      { role: 'user', content: 'Read the file', timestamp: '2025-01-01T10:00:00' },
      { role: 'assistant', content: '', tool_calls: [{ tool_name: 'read_file', ... }], timestamp: '2025-01-01T10:00:01' },
      { role: 'assistant', content: '', tool_calls: [{ tool_name: 'grep_files', ... }], timestamp: '2025-01-01T10:00:02' },
      { role: 'assistant', content: 'Here is the content...', tool_calls: [], timestamp: '2025-01-01T10:00:03' },
    ];

    const turns = storage.messagesToTurns(messages);

    expect(turns).toHaveLength(1);
    expect(turns[0].toolResults).toHaveLength(2);  // read_file + grep_files
    expect(turns[0].toolResults[0].toolName).toBe('read_file');
    expect(turns[0].toolResults[1].toolName).toBe('grep_files');
    expect(turns[0].assistantMessage).toBe('Here is the content...');
  });
});
```

---

## Clarification : Recherche fuzzy n'est PAS un fallback

### Localisation
`packages/core/src/runtime/conversation/storage.ts:2291-2329`

### Statut
**CORRECT** - La recherche fuzzy est bien lancée en parallèle avec la recherche sémantique.

```typescript
// Code actuel (correct)
const [semanticResults, fuzzyResults] = await Promise.all([
  // Semantic search: conditional
  (async () => { ... })(),
  // Fuzzy search: always runs
  (async () => {
    console.log('[ConversationStorage] buildEnrichedContext: Running fuzzy search');
    return await this.searchCodeFuzzyWithLLM(userMessage, { ... });
  })()
]);
```

### Documentation à corriger
La documentation dans `ARCHITECTURE.md` décrit la fuzzy search comme un "fallback", ce qui est incorrect. À mettre à jour pour refléter qu'elle s'exécute **toujours en parallèle**.

---

## Prochaines étapes

1. [ ] Implémenter la correction de `messagesToTurns`
2. [ ] Ajouter les tests unitaires
3. [ ] Mettre à jour `ARCHITECTURE.md` pour clarifier le comportement parallel
4. [ ] Vérifier que `formatContextForAgent` affiche bien tous les tool calls
