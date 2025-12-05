/**
 * Gemini Vision OCR Provider
 *
 * Uses Google's Gemini Vision API for OCR extraction
 * Primary provider - semantic understanding, context-aware
 *
 * @since 2025-12-05
 */

import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { OCRProvider, OCRResult, OCROptions, OCRProviderType } from './types.js';

const DEFAULT_PROMPT = `Extract all text from this image.
Return only the extracted text, no explanations or formatting.
If the image contains no text, return an empty string.
Preserve the original text layout and structure as much as possible.`;

/**
 * Gemini Vision OCR Provider
 */
export class GeminiOCRProvider implements OCRProvider {
  readonly type: OCRProviderType = 'gemini';
  readonly name = 'Gemini Vision';

  private client: GoogleGenAI | null = null;
  private modelName: string;

  constructor(modelName: string = 'gemini-2.0-flash') {
    this.modelName = modelName;
  }

  /**
   * Check if Gemini API key is configured
   */
  isAvailable(): boolean {
    return !!process.env.GEMINI_API_KEY;
  }

  /**
   * Get or create Gemini client
   */
  private getClient(): GoogleGenAI {
    if (!this.client) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error('GEMINI_API_KEY environment variable is not set');
      }
      this.client = new GoogleGenAI({ apiKey });
    }
    return this.client;
  }

  /**
   * Get MIME type from file extension
   */
  private getMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
    };
    return mimeTypes[ext] || 'image/png';
  }

  /**
   * Extract text from an image file
   */
  async extractText(imagePath: string, options?: OCROptions): Promise<OCRResult> {
    const startTime = Date.now();

    try {
      // Read image file
      const imageBuffer = await fs.readFile(imagePath);
      const base64Data = imageBuffer.toString('base64');
      const mimeType = this.getMimeType(imagePath);

      return await this.extractTextFromData(base64Data, mimeType, {
        ...options,
        // Pass the original path for the result
        _originalPath: imagePath,
      } as OCROptions & { _originalPath: string });
    } catch (error) {
      return {
        imagePath,
        text: '',
        provider: this.type,
        processingTimeMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Extract text from image data
   */
  async extractTextFromData(
    imageData: string | Buffer,
    mimeType: string,
    options?: OCROptions & { _originalPath?: string }
  ): Promise<OCRResult> {
    const startTime = Date.now();
    const imagePath = options?._originalPath || 'inline-image';

    try {
      const client = this.getClient();

      // Convert Buffer to base64 if needed
      const base64Data = Buffer.isBuffer(imageData)
        ? imageData.toString('base64')
        : imageData;

      const prompt = options?.prompt || DEFAULT_PROMPT;

      const response = await client.models.generateContent({
        model: this.modelName,
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType,
                  data: base64Data,
                },
              },
            ],
          },
        ],
      });

      const text = response.text?.trim() || '';

      return {
        imagePath,
        text,
        provider: this.type,
        processingTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        imagePath,
        text: '',
        provider: this.type,
        processingTimeMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
