/**
 * Test Gemini Web Search (Grounding with Google Search)
 *
 * Gemini can search the web and return structured responses.
 * This is built-in to the API via "grounding" feature.
 *
 * Run with: GEMINI_API_KEY=xxx npx tsx test-gemini-web-search.ts "your query"
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error('❌ GEMINI_API_KEY environment variable is required');
  process.exit(1);
}

// =============================================================================
// Types
// =============================================================================

interface WebSearchResult {
  query: string;
  answer: string;
  sources: {
    title: string;
    url: string;
    snippet?: string;
  }[];
  searchedAt: string;
}

interface StructuredWebResponse<T> {
  query: string;
  data: T;
  sources: { title: string; url: string }[];
  searchedAt: string;
}

// =============================================================================
// Gemini Web Search with Grounding
// =============================================================================

async function searchWebWithGemini(query: string): Promise<WebSearchResult> {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY!);

  // Use gemini-2.0-flash with Google Search grounding
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash-exp',
    // Enable grounding with Google Search
    tools: [{
      googleSearch: {}
    }] as any
  });

  const result = await model.generateContent(query);
  const response = result.response;
  const text = response.text();

  // Extract grounding metadata if available
  const groundingMetadata = (response as any).candidates?.[0]?.groundingMetadata;
  const sources: WebSearchResult['sources'] = [];

  if (groundingMetadata?.groundingChunks) {
    for (const chunk of groundingMetadata.groundingChunks) {
      if (chunk.web) {
        sources.push({
          title: chunk.web.title || 'Unknown',
          url: chunk.web.uri || '',
          snippet: undefined
        });
      }
    }
  }

  return {
    query,
    answer: text,
    sources,
    searchedAt: new Date().toISOString()
  };
}

// =============================================================================
// Structured Web Search (returns JSON)
// =============================================================================

async function searchWebStructured<T>(
  query: string,
  schema: object,
  instructions: string
): Promise<StructuredWebResponse<T>> {
  const { GoogleGenerativeAI, SchemaType } = await import('@google/generative-ai');

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY!);

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash-exp',
    tools: [{
      googleSearch: {}
    }] as any,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: schema as any
    }
  });

  const prompt = `${instructions}\n\nQuery: ${query}`;
  const result = await model.generateContent(prompt);
  const response = result.response;
  const text = response.text();

  // Parse JSON response
  let data: T;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Failed to parse structured response: ${text}`);
  }

  // Extract sources
  const groundingMetadata = (response as any).candidates?.[0]?.groundingMetadata;
  const sources: { title: string; url: string }[] = [];

  if (groundingMetadata?.groundingChunks) {
    for (const chunk of groundingMetadata.groundingChunks) {
      if (chunk.web) {
        sources.push({
          title: chunk.web.title || 'Unknown',
          url: chunk.web.uri || ''
        });
      }
    }
  }

  return {
    query,
    data,
    sources,
    searchedAt: new Date().toISOString()
  };
}

// =============================================================================
// Main Test
// =============================================================================

async function main() {
  console.log('=== Gemini Web Search Test ===\n');

  const query = process.argv[2] || 'What are the latest features in TypeScript 5.7?';

  // Test 1: Basic web search
  console.log('🔍 Test 1: Basic Web Search');
  console.log('-'.repeat(60));
  console.log(`Query: "${query}"`);
  console.log('');

  try {
    const startTime = Date.now();
    const result = await searchWebWithGemini(query);
    const elapsed = Date.now() - startTime;

    console.log(`✅ Answer (${elapsed}ms):\n`);
    console.log(result.answer);
    console.log('');

    if (result.sources.length > 0) {
      console.log(`📚 Sources (${result.sources.length}):`);
      for (const source of result.sources.slice(0, 5)) {
        console.log(`   - ${source.title}`);
        console.log(`     ${source.url}`);
      }
    } else {
      console.log('   (No grounding sources returned)');
    }
  } catch (err) {
    console.log(`❌ Error: ${err}`);
  }

  console.log('');

  // Test 2: Structured search
  console.log('📊 Test 2: Structured Web Search');
  console.log('-'.repeat(60));

  const structuredQuery = 'What are the top 3 JavaScript frameworks in 2025?';
  console.log(`Query: "${structuredQuery}"`);
  console.log('');

  try {
    interface FrameworkInfo {
      frameworks: {
        name: string;
        description: string;
        githubStars: string;
        website: string;
      }[];
    }

    const schema = {
      type: 'object',
      properties: {
        frameworks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              description: { type: 'string' },
              githubStars: { type: 'string' },
              website: { type: 'string' }
            },
            required: ['name', 'description']
          }
        }
      },
      required: ['frameworks']
    };

    const instructions = `Search the web and find the top 3 most popular JavaScript frameworks in 2025.
Return a structured JSON response with information about each framework.`;

    const startTime = Date.now();
    const result = await searchWebStructured<FrameworkInfo>(
      structuredQuery,
      schema,
      instructions
    );
    const elapsed = Date.now() - startTime;

    console.log(`✅ Structured Response (${elapsed}ms):\n`);
    console.log(JSON.stringify(result.data, null, 2));
    console.log('');

    if (result.sources.length > 0) {
      console.log(`📚 Sources (${result.sources.length}):`);
      for (const source of result.sources.slice(0, 3)) {
        console.log(`   - ${source.title}: ${source.url}`);
      }
    }
  } catch (err) {
    console.log(`❌ Error: ${err}`);
  }

  console.log('\n=== Test Complete ===');
}

main().catch(console.error);
