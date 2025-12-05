/**
 * OCR Types
 *
 * Types for Optical Character Recognition providers
 * Used to extract text from images in HTML documents
 *
 * @since 2025-12-05
 */

/**
 * Supported OCR providers
 */
export type OCRProviderType = 'gemini' | 'replicate-deepseek' | 'tesseract';

/**
 * Result of OCR extraction
 */
export interface OCRResult {
  /** Original image path or URL */
  imagePath: string;

  /** Extracted text content */
  text: string;

  /** Provider used for extraction */
  provider: OCRProviderType;

  /** Confidence score (0-1) if available */
  confidence?: number;

  /** Processing time in milliseconds */
  processingTimeMs?: number;

  /** Error message if extraction failed */
  error?: string;
}

/**
 * Options for OCR extraction
 */
export interface OCROptions {
  /** Language hint for better recognition */
  language?: string;

  /** Custom prompt for vision models */
  prompt?: string;

  /** Timeout in milliseconds */
  timeout?: number;
}

/**
 * Base interface for OCR providers
 */
export interface OCRProvider {
  /** Provider type identifier */
  readonly type: OCRProviderType;

  /** Human-readable name */
  readonly name: string;

  /**
   * Check if the provider is available (API key configured, etc.)
   */
  isAvailable(): boolean;

  /**
   * Extract text from an image file
   * @param imagePath - Path to the image file
   * @param options - Optional extraction options
   */
  extractText(imagePath: string, options?: OCROptions): Promise<OCRResult>;

  /**
   * Extract text from image data (base64 or buffer)
   * @param imageData - Base64 string or Buffer
   * @param mimeType - Image MIME type (e.g., 'image/png')
   * @param options - Optional extraction options
   */
  extractTextFromData(
    imageData: string | Buffer,
    mimeType: string,
    options?: OCROptions
  ): Promise<OCRResult>;
}

/**
 * OCR extraction for multiple images
 */
export interface BatchOCRResult {
  results: OCRResult[];
  totalProcessingTimeMs: number;
  successCount: number;
  errorCount: number;
}
