import { GoogleGenAI } from '@google/genai';

export interface GeminiProviderOptions {
  apiKey: string;
  model?: string;
  dimension?: number;
  batching?: {
    size?: number;
  };
}

export class GeminiEmbeddingProvider {
  private client: GoogleGenAI;
  private model: string;
  private dimension?: number;
  private batchSize: number;

  constructor(options: GeminiProviderOptions) {
    this.client = new GoogleGenAI({ apiKey: options.apiKey });
    this.model = options.model || 'gemini-embedding-001';
    this.dimension = options.dimension;
    this.batchSize = options.batching?.size ?? 16;
  }

  async embed(texts: string[], overrides?: { model?: string; dimension?: number }): Promise<number[][]> {
    const model = overrides?.model || this.model;
    const dimension = overrides?.dimension ?? this.dimension;

    const batches: number[][][] = [];

    for (let i = 0; i < texts.length; i += this.batchSize) {
      const chunk = texts.slice(i, i + this.batchSize);

      const request: any = {
        model,
        contents: chunk.map(content => ({
          role: 'user',
          parts: [{ text: content }]
        }))
      };

      if (dimension) {
        request.config = {
          ...(request.config ?? {}),
          outputDimensionality: dimension
        };
      }

      const response = await this.client.models.embedContent(request);
      const embeddings = response?.embeddings;

      if (!Array.isArray(embeddings) || embeddings.length !== chunk.length) {
        throw new Error('Invalid embedding response from Gemini');
      }

      const values = embeddings.map(entry => {
        if (!Array.isArray(entry?.values)) {
          throw new Error('Invalid embedding vector received from Gemini');
        }
        return entry.values as number[];
      });

      batches.push(values);
    }

    return batches.flat();
  }
}
