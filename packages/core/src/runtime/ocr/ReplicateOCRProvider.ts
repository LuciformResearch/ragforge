/**
 * Replicate OCR Provider (DeepSeek-OCR)
 *
 * Uses Replicate API to run DeepSeek-OCR model
 * Alternative provider - 97% accuracy, layout understanding
 *
 * @since 2025-12-05
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { OCRProvider, OCRResult, OCROptions, OCRProviderType } from './types.js';

/**
 * Replicate OCR Provider using DeepSeek-OCR
 */
export class ReplicateOCRProvider implements OCRProvider {
  readonly type: OCRProviderType = 'replicate-deepseek';
  readonly name = 'DeepSeek-OCR (Replicate)';

  private modelVersion: string;

  constructor(modelVersion: string = 'deepseek-ai/deepseek-vl2:latest') {
    this.modelVersion = modelVersion;
  }

  /**
   * Check if Replicate API token is configured
   */
  isAvailable(): boolean {
    return !!process.env.REPLICATE_API_TOKEN;
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
   * Extract text from image data using Replicate API
   */
  async extractTextFromData(
    imageData: string | Buffer,
    mimeType: string,
    options?: OCROptions & { _originalPath?: string }
  ): Promise<OCRResult> {
    const startTime = Date.now();
    const imagePath = options?._originalPath || 'inline-image';

    try {
      const apiToken = process.env.REPLICATE_API_TOKEN;
      if (!apiToken) {
        throw new Error('REPLICATE_API_TOKEN environment variable is not set');
      }

      // Convert Buffer to base64 if needed
      const base64Data = Buffer.isBuffer(imageData)
        ? imageData.toString('base64')
        : imageData;

      // Create data URI
      const dataUri = `data:${mimeType};base64,${base64Data}`;

      const prompt = options?.prompt || 'Extract all text from this image. Return only the text content.';

      // Call Replicate API
      const response = await fetch('https://api.replicate.com/v1/predictions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
          'Prefer': 'wait', // Wait for result (up to 60s)
        },
        body: JSON.stringify({
          version: this.modelVersion,
          input: {
            image: dataUri,
            prompt: prompt,
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Replicate API error: ${response.status} ${errorText}`);
      }

      const prediction = await response.json() as {
        status: string;
        output?: string | string[];
        error?: string;
        id?: string;
      };

      // If prediction is still processing, poll for result
      if (prediction.status === 'starting' || prediction.status === 'processing') {
        const result = await this.pollForResult(prediction.id!, apiToken, options?.timeout || 60000);
        return {
          imagePath,
          text: this.extractOutputText(result.output),
          provider: this.type,
          processingTimeMs: Date.now() - startTime,
        };
      }

      if (prediction.status === 'failed') {
        throw new Error(prediction.error || 'Prediction failed');
      }

      const text = this.extractOutputText(prediction.output);

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

  /**
   * Extract text from Replicate output (can be string or array)
   */
  private extractOutputText(output: string | string[] | undefined): string {
    if (!output) return '';
    if (Array.isArray(output)) return output.join('');
    return output;
  }

  /**
   * Poll for prediction result
   */
  private async pollForResult(
    predictionId: string,
    apiToken: string,
    timeout: number
  ): Promise<{ output?: string | string[] }> {
    const startTime = Date.now();
    const pollInterval = 1000; // 1 second

    while (Date.now() - startTime < timeout) {
      const response = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
        headers: {
          'Authorization': `Bearer ${apiToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Replicate API error: ${response.status}`);
      }

      const prediction = await response.json() as {
        status: string;
        output?: string | string[];
        error?: string;
      };

      if (prediction.status === 'succeeded') {
        return { output: prediction.output };
      }

      if (prediction.status === 'failed') {
        throw new Error(prediction.error || 'Prediction failed');
      }

      // Wait before polling again
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Prediction timeout after ${timeout}ms`);
  }
}
