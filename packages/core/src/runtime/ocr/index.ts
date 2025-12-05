/**
 * OCR Module
 *
 * Optical Character Recognition for extracting text from images
 * Supports multiple providers: Gemini Vision, DeepSeek-OCR (Replicate)
 *
 * @since 2025-12-05
 */

export * from './types.js';
export { GeminiOCRProvider } from './GeminiOCRProvider.js';
export { ReplicateOCRProvider } from './ReplicateOCRProvider.js';
export { OCRService, getOCRService, type OCRServiceOptions } from './OCRService.js';
