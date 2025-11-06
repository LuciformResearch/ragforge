# Google AI Libraries: Vertex AI vs Gemini API

## Pourquoi RagForge utilise Vertex AI (`@google-cloud/vertexai`)

### Bibliothèques Google AI

Il existe **deux** façons d'utiliser les modèles Google :

#### 1. **Gemini API** - `@google/genai`
- 🔑 **Auth:** API Key (simple)
- 🌐 **Endpoint:** generativelanguage.googleapis.com
- 💰 **Pricing:** Pay-per-use, free tier disponible
- 🎯 **Use case:** Prototypage, petits projets, développement rapide

#### 2. **Vertex AI** - `@google-cloud/vertexai`
- 🔐 **Auth:** Service Account (GCP)
- 🌐 **Endpoint:** {region}-aiplatform.googleapis.com
- 💰 **Pricing:** GCP billing, pas de free tier
- 🎯 **Use case:** Production, enterprise, scaling

### Pourquoi RagForge utilise Vertex AI ?

**Raisons actuelles:**

1. **Embeddings de production**
   - `text-embedding-004` est disponible sur Vertex AI
   - Meilleure intégration avec Neo4j (même infra GCP)
   - Quotas plus élevés (1000 req/min vs 15 req/min)

2. **Déjà configuré**
   - Service account setup pour LR_CodeRag
   - GOOGLE_APPLICATION_CREDENTIALS déjà en place
   - Pas besoin d'ajouter une deuxième auth

3. **Production-ready**
   - SLAs garantis
   - Support entreprise
   - Monitoring avec Cloud Console

4. **Consistency**
   - Même SDK pour embeddings ET génération
   - Une seule configuration

### Comparaison détaillée

| Feature | Gemini API | Vertex AI |
|---------|-----------|-----------|
| **Setup** | ✅ Simple (API key) | ⚠️  Complex (service account) |
| **Auth** | API key string | JSON credentials file |
| **Free tier** | ✅ Oui (60 req/min) | ❌ Non |
| **Rate limits** | 15 req/min (paid) | 1000+ req/min |
| **Pricing** | Même prix | Même prix |
| **Models** | Tous Gemini + Gemma | Tous Gemini + Gemma |
| **Embeddings** | ❌ Pas text-embedding-004 | ✅ text-embedding-004 |
| **Région** | Global | Configurable (us-central1, etc) |
| **Monitoring** | ❌ Basique | ✅ Cloud Console complet |
| **SLA** | ❌ Best effort | ✅ Garanti |

### Pour le Reranking LLM

**Option 1: Rester sur Vertex AI** ⭐ **Recommandé**

```typescript
import { VertexAI } from '@google-cloud/vertexai';

const vertexAI = new VertexAI({
  project: process.env.VERTEX_PROJECT_ID,
  location: 'us-central1'
});

const model = vertexAI.getGenerativeModel({
  model: 'gemma-3n-e2b-it'
});

const result = await model.generateContent(prompt);
```

**Avantages:**
- ✅ Cohérent avec le reste de RagForge
- ✅ Mêmes credentials
- ✅ Meilleurs quotas (important pour parallélisation)
- ✅ Monitoring unifié

**Option 2: Ajouter Gemini API**

```typescript
import { GoogleGenAI } from '@google/genai';

const genAI = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

const model = genAI.getGenerativeModel({
  model: 'gemma-3n-e2b-it'
});

const result = await model.generateContent(prompt);
```

**Avantages:**
- ✅ Plus simple (juste API key)
- ✅ Gratuit pour dev (60 req/min)

**Inconvénients:**
- ❌ Quotas limités (15 req/min paid)
- ❌ Deuxième auth à configurer
- ❌ Incohérent avec embeddings

### Recommendation

**Pour RagForge:** **Rester sur Vertex AI** 🎯

Raisons:
1. Déjà configuré et fonctionnel
2. Meilleurs quotas (essentiel pour parallélisation)
3. Cohérence avec embeddings
4. Production-ready

### Code unifié

Créer une abstraction LLMProvider qui fonctionne avec les deux:

```typescript
interface LLMProvider {
  generateContent(prompt: string): Promise<string>;
}

class VertexAIProvider implements LLMProvider {
  private model: any;

  constructor(config: { project: string; location: string; model: string }) {
    const vertexAI = new VertexAI({
      project: config.project,
      location: config.location
    });
    this.model = vertexAI.getGenerativeModel({ model: config.model });
  }

  async generateContent(prompt: string): Promise<string> {
    const result = await this.model.generateContent(prompt);
    return result.response.candidates[0].content.parts[0].text;
  }
}

class GeminiAPIProvider implements LLMProvider {
  private model: any;

  constructor(config: { apiKey: string; model: string }) {
    const genAI = new GoogleGenAI({ apiKey: config.apiKey });
    this.model = genAI.getGenerativeModel({ model: config.model });
  }

  async generateContent(prompt: string): Promise<string> {
    const result = await this.model.generateContent(prompt);
    return result.response.candidates[0].content.parts[0].text;
  }
}
```

Ainsi on peut facilement switch selon l'environnement:

```typescript
const provider = process.env.USE_VERTEX_AI === 'true'
  ? new VertexAIProvider({
      project: process.env.VERTEX_PROJECT_ID,
      location: 'us-central1',
      model: 'gemma-3n-e2b-it'
    })
  : new GeminiAPIProvider({
      apiKey: process.env.GEMINI_API_KEY,
      model: 'gemma-3n-e2b-it'
    });
```

### Pricing: Identique!

Les deux utilisent les **mêmes prix** pour les mêmes modèles:

- Gemma 3n E2B: $0.005 / 1M tokens (input)
- Gemini 2.5 Flash: $0.075 / 1M tokens (input)

Pas de différence de coût entre Gemini API et Vertex AI.

### Conclusion

**RagForge continuera d'utiliser Vertex AI** pour:
- Embeddings (text-embedding-004)
- LLM Reranking (gemma-3n-e2b-it)
- Future génération de code

**Pourquoi?**
- Déjà setup ✅
- Meilleurs quotas ✅
- Production-ready ✅
- Cohérence ✅

Le seul moment où Gemini API aurait du sens:
- Prototypage très rapide sans GCP
- Free tier pour tests

Mais pour RagForge (outil de production), **Vertex AI est le bon choix**. 🎯
