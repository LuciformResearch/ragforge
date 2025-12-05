import type { GraphSchema } from '@luciformresearch/ragforge';

export function validateGeminiSchema(schema: GraphSchema): void {
  const unknown = schema.vectorIndexes.filter(ix => ix.dimension === undefined || ix.dimension === null);
  if (unknown.length > 0) {
    console.warn('⚠️  Unable to determine vector dimensions for some indexes. Ensure they match the pipeline configuration.');
  }
}

export function ensureGeminiKey(key?: string): string {
  if (!key) {
    throw new Error('Missing GEMINI_API_KEY. Provide it via your environment or .env file to use Gemini embeddings.');
  }
  return key;
}

export const GEMINI_EMBEDDING_DIMENSION = 768;
