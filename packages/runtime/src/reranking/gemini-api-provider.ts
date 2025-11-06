/**
 * Gemini API Provider for LLM Reranking
 *
 * Uses Google's Gemini API (via @google/genai) for text generation.
 * Simpler than Vertex AI - just requires an API key.
 *
 * Advantages over Vertex AI:
 * - Simpler setup (just API key)
 * - All models available globally (no regional restrictions)
 * - Free tier available (60 req/min)
 * - Works with Gemma 3n E2B everywhere
 */

import { GoogleGenAI } from '@google/genai';
import type { LLMProvider, LLMProviderConfig } from './llm-provider.js';

export interface GeminiAPIConfig extends LLMProviderConfig {
  apiKey: string;
}

export class GeminiAPIProvider implements LLMProvider {
  private client: GoogleGenAI;
  private modelName: string;
  private temperature: number;
  private maxOutputTokens: number;

  constructor(config: GeminiAPIConfig) {
    this.client = new GoogleGenAI({ apiKey: config.apiKey });
    this.modelName = config.model;
    this.temperature = config.temperature || 0.3;
    this.maxOutputTokens = config.maxOutputTokens || 512;
  }

  async generateContent(prompt: string): Promise<string> {
    try {
      const response = await this.client.models.generateContent({
        model: this.modelName,
        contents: prompt,
        config: {
          temperature: this.temperature,
          maxOutputTokens: this.maxOutputTokens,
        }
      });

      const text = response.text;

      if (!text) {
        throw new Error('No text in response');
      }

      return text;
    } catch (error: any) {
      throw new Error(`Gemini API generation failed: ${error.message}`);
    }
  }

  async generateBatch(prompts: string[]): Promise<string[]> {
    // Gemini API supports parallel requests
    return Promise.all(prompts.map(p => this.generateContent(p)));
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Simple ping test
      await this.generateContent('test');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create a default provider using environment variables
   */
  static fromEnv(model: string = 'gemma-3n-e2b-it'): GeminiAPIProvider {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable not set');
    }

    return new GeminiAPIProvider({
      apiKey,
      model,
      temperature: 0.3,
      maxOutputTokens: 512
    });
  }
}
