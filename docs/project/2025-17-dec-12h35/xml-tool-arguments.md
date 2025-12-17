# Migration des arguments de tool calls: JSON vers XML

## Résumé

**Objectif**: Remplacer les arguments JSON dans les tool calls par du XML pur avec CDATA.

**Fichiers à modifier**:
1. `structured-llm-executor.ts` - parsing + instructions (CRITIQUE)
2. `debug-tools.ts` - exemples de documentation

**Estimation**: ~200 lignes de code modifiées

**Impact**: Aucun breaking change pour les consommateurs (arguments déjà parsés en objets JS)

---

## Contexte et Problème

### Situation actuelle
Les tool calls utilisent un format hybride XML/JSON:
```xml
<tool_call>
  <tool_name>append_to_report</tool_name>
  <arguments>{"content": "## Mon titre\nDu contenu..."}</arguments>
</tool_call>
```

### Problème identifié
Le JSON dans `<arguments>` pose des problèmes de parsing quand le contenu contient:
- Des newlines (`\n`) qui doivent être échappées
- Des backticks (``` pour les blocs de code markdown)
- Des template literals (`${}`)
- Des backslashes (`\\`)
- Des guillemets (`"`)

**Exemple de bug**: Session `2025-12-17T12-15-30` - l'agent a passé du contenu dans `append_to_report` mais le parsing JSON a échoué, résultant en `content: ""` (vide).

## Solution choisie: Option 3 - Full XML avec CDATA

### Nouveau format
```xml
<tool_call>
  <tool_name>append_to_report</tool_name>
  <arguments>
    <content><![CDATA[## Mon titre

Du contenu avec ```code``` et caractères spéciaux < > & "
    ]]></content>
    <path>/some/path</path>
  </arguments>
</tool_call>
```

### Avantages
1. **Pas d'échappement JSON** - les newlines sont littérales
2. **CDATA protège** les caractères spéciaux XML (`<`, `>`, `&`, `"`)
3. **Plus lisible** pour le LLM et pour le debug
4. **Parsing robuste** - pas de double-échappement

## Fichiers impactés

### Fichiers CRITIQUES (parsing et génération)

### 1. `packages/core/src/runtime/llm/structured-llm-executor.ts`

#### Schema des tool_calls (lignes ~1655-1663)
```typescript
// AVANT
arguments: { type: 'object', description: 'Arguments', required: true }

// APRES
arguments: {
  type: 'object',
  description: 'Arguments as XML elements',
  dynamicProperties: true,  // Nouveau flag
  required: true
}
```

#### Instructions au LLM - Format XML (lignes 1551-1558)
```typescript
// AVANT (ligne 1556)
instructions.push('      <arguments>{"param": "value"}</arguments>');

// APRES
instructions.push('      <arguments>');
instructions.push('        <param>value</param>');
instructions.push('        <!-- Pour du texte long avec caractères spéciaux, utiliser CDATA: -->');
instructions.push('        <!-- <content><![CDATA[texte...]]></content> -->');
instructions.push('      </arguments>');
```

#### Instructions au LLM - Format JSON (lignes 1596-1597)
```typescript
// AVANT
instructions.push('  "tool_calls": [{"tool_name": "...", "arguments": {...}}]');

// Note: Le format JSON reste inchangé car il n'est pas utilisé pour le research agent
// Le research agent utilise le format XML
```

#### Instructions au LLM - Format YAML (lignes 1576-1579)
```typescript
// AVANT
instructions.push('    arguments:');
instructions.push('      param: "value"');

// Note: Le format YAML reste inchangé car il n'est pas utilisé actuellement
```

#### CRITIQUE: `buildSystemPromptWithTools` (lignes 3972-4053)
Cette fonction génère les instructions d'utilisation des tools et est utilisée par:
- `agent-runtime.ts` ligne 395
- `structured-llm-executor.ts` lignes 1164, 3845, 4095

**Problème**: Elle contient des exemples JSON (lignes 4012-4053) même quand le format de sortie est XML!

```typescript
// AVANT (lignes 4012-4037) - toujours JSON
### Single Tool Call Example:
\`\`\`json
{
  "tool_calls": [
    {
      "tool_name": "${exampleTool1}",
      "arguments": { "param1": "value1" }
    }
  ]
}
\`\`\`

// APRES - détecter le format et générer l'exemple approprié
// Si format XML:
### Single Tool Call Example:
\`\`\`xml
<tool_calls>
  <tool_call>
    <tool_name>${exampleTool1}</tool_name>
    <arguments>
      <param1>value1</param1>
    </arguments>
  </tool_call>
</tool_calls>
\`\`\`
```

**Solution**: Ajouter un paramètre `format` à `buildSystemPromptWithTools` et générer les exemples dans le bon format.

#### `getTextContentFromElement` (lignes 3241-3254)
**CRITIQUE**: Actuellement ne capture pas CDATA!

```typescript
// AVANT (ligne 3247)
.filter((c: any) => c.type === 'text')

// APRES - inclure CDATA
.filter((c: any) => c.type === 'text' || c.type === 'cdata')
```

Le `LuciformXMLParser` crée des nodes séparés pour CDATA avec `type: 'cdata'`.

#### Parsing des arguments (lignes ~3312-3349)
Ajouter une méthode `parseDynamicObjectFromElement`:
- Extraire tous les enfants de `<arguments>`
- Utiliser `getTextContentFromElement` (qui maintenant capture CDATA)
- Inférer les types (boolean, number, string)
- Parser récursivement les objets/arrays imbriqués

#### `convertValue` (lignes ~3501-3585)
- Supprimer la logique de fallback JSON pour type 'object'
- Simplifier: si pas de `properties`, utiliser `parseDynamicObjectFromElement`

### 2. `packages/core/src/runtime/agents/research-agent.ts`

#### System prompt
Mettre à jour les instructions de format de réponse pour montrer le format XML des arguments.

### 3. `packages/core/src/runtime/agents/rag-agent.ts`

#### System prompt (si différent)
Même mise à jour que research-agent.

### Fichiers SECONDAIRES (utilisent le résultat du parsing)

### 4. `packages/core/src/tools/agent-tools.ts`
- Lignes ~546, ~583, ~720: Utilisent `tool_calls` après parsing
- **Pas de modification nécessaire** - utilise le résultat parsé

### 5. `packages/core/src/tools/debug-tools.ts`
- Ligne ~178-189: Documentation et exemples
- **Modifier les exemples** pour montrer le format XML

### 6. `packages/core/src/runtime/agents/agent-runtime.ts`
- Lignes ~728, ~807, ~822: Logging des tool calls
- **Pas de modification nécessaire** - utilise `tc.arguments` déjà parsé

### 7. `packages/core/src/runtime/conversation/conversation.ts`
- Ligne ~331: Affichage des tool calls dans les prompts
- **Pas de modification nécessaire** - utilise JSON.stringify pour l'affichage

### 8. `packages/core/src/runtime/conversation/storage.ts`
- Stockage des tool calls en base
- **Pas de modification nécessaire** - stocke les arguments déjà parsés

### 9. Tests: `packages/core/src/runtime/conversation/__tests__/storage.test.ts`
- Lignes ~192-367: Tests avec tool_calls
- **Pas de modification nécessaire** - les tests utilisent des objets JS

## Changements de parsing détaillés

### Nouvelle méthode: `parseDynamicObjectFromElement`

```typescript
private parseDynamicObjectFromElement(element: any): Record<string, any> {
  const obj: Record<string, any> = {};

  if (!element?.children) return obj;

  for (const child of element.children) {
    if (child.type !== 'element') continue;

    const propName = child.name;
    const textContent = this.getTextContentFromElement(child);

    // Vérifier si c'est un objet/array imbriqué
    const nestedElements = child.children?.filter(c => c.type === 'element') || [];

    if (nestedElements.length > 0 && !textContent) {
      // Objet ou array imbriqué
      const names = new Set(nestedElements.map(e => e.name));
      if (names.size === 1 && nestedElements.length > 1) {
        // Array (même nom répété)
        obj[propName] = nestedElements.map(e => this.parseDynamicObjectFromElement(e));
      } else {
        // Objet imbriqué
        obj[propName] = this.parseDynamicObjectFromElement(child);
      }
    } else {
      // Valeur primitive
      obj[propName] = this.inferPrimitiveType(textContent);
    }
  }

  return obj;
}

private inferPrimitiveType(value: string): any {
  if (value === '') return '';
  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;
  if (/^-?\d+$/.test(value)) return parseInt(value, 10);
  if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value);
  return value;  // String par défaut
}
```

### Modification de `parseObjectFromElement`

Quand `type: 'object'` sans `properties` défini:
```typescript
// AVANT: getTextContentFromElement + convertValue (JSON.parse)
// APRES: parseDynamicObjectFromElement
```

## Gestion des arrays

### Format pour arrays simples
```xml
<arguments>
  <paths>
    <item>/path/one</item>
    <item>/path/two</item>
  </paths>
</arguments>
```

### Format pour arrays d'objets
```xml
<arguments>
  <filters>
    <filter>
      <type>scope</type>
      <name>foo</name>
    </filter>
    <filter>
      <type>file</type>
      <name>bar</name>
    </filter>
  </filters>
</arguments>
```

## Risques et considérations

### 1. LLM doit apprendre le nouveau format
- Mettre à jour TOUS les system prompts
- Fournir des exemples clairs
- Le LLM pourrait faire des erreurs au début

### 2. CDATA - quand l'utiliser?
Instruire le LLM:
> "Pour les contenus textuels longs ou contenant des caractères spéciaux (`<`, `>`, `&`), utiliser CDATA: `<content><![CDATA[...]]></content>`"

### 3. Rétrocompatibilité
- Les anciens formats JSON ne fonctionneront plus
- Pas de problème car c'est le LLM qui génère les tool calls

### 4. Performance
- Parsing XML légèrement plus lent que JSON.parse
- Négligeable comparé au temps LLM

## Plan d'implémentation

### Phase 1: Parsing (structured-llm-executor.ts)
1. [ ] Ajouter `parseDynamicObjectFromElement(element)` - parse tous les enfants comme propriétés
2. [ ] Ajouter `inferPrimitiveType(value)` - convertit string en boolean/number/string
3. [ ] Modifier `parseObjectFromElement` - utiliser `parseDynamicObjectFromElement` quand pas de `properties`
4. [ ] Supprimer le fallback JSON.parse dans `convertValue` pour type 'object'

### Phase 2: Instructions XML (structured-llm-executor.ts)
5. [ ] Modifier lignes 1551-1558 - exemple XML avec arguments XML + CDATA
6. [ ] Modifier `buildSystemPromptWithTools` (lignes 3972-4053):
   - Ajouter paramètre `format: 'xml' | 'json' | 'yaml'`
   - Générer les exemples dans le bon format
7. [ ] Mettre à jour tous les appels à `buildSystemPromptWithTools` pour passer le format

### Phase 3: Agents
8. [ ] Vérifier `research-agent.ts` - utilise déjà format XML via executeSingle
9. [ ] Vérifier `rag-agent.ts` - même chose
10. [ ] Vérifier `agent-runtime.ts` - ligne 395, passe le format

### Phase 4: Documentation et exemples
11. [ ] Mettre à jour `debug-tools.ts` lignes 178-189 - exemples XML

### Phase 5: Tests
12. [ ] Tool call avec contenu simple
13. [ ] Tool call avec contenu multiligne
14. [ ] Tool call avec code markdown (backticks)
15. [ ] Tool call avec caractères XML (`<`, `>`, `&`)
16. [ ] Tool call avec arguments multiples
17. [ ] Tool call avec arguments imbriqués (objet dans objet)
18. [ ] Tool call avec arrays

## Tests à effectuer

1. Tool call avec contenu simple
2. Tool call avec contenu multiligne
3. Tool call avec code markdown (backticks)
4. Tool call avec caractères XML (`<`, `>`, `&`)
5. Tool call avec arguments multiples
6. Tool call avec arguments imbriqués (objet dans objet)
7. Tool call avec arrays
