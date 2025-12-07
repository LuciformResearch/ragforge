/**
 * Media File Parser
 *
 * Parses media files (images, 3D models, PDFs) with lazy loading:
 * - Stores only metadata at ingestion time
 * - Visual/3D analysis is performed on-demand when agent requests it
 *
 * @since 2025-12-06
 */

import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// =============================================================================
// Types
// =============================================================================

/**
 * Supported media file formats
 */
export type MediaFormat =
  | 'png' | 'jpg' | 'jpeg' | 'gif' | 'webp' | 'svg' | 'ico' | 'bmp' | 'tiff'  // Images
  | 'gltf' | 'glb'                                                             // 3D
  | 'pdf';                                                                      // Documents

/**
 * Media category
 */
export type MediaCategory = 'image' | '3d' | 'document';

/**
 * Base information for all media files
 */
export interface MediaFileInfo {
  uuid: string;
  file: string;
  format: MediaFormat;
  category: MediaCategory;
  hash: string;
  sizeBytes: number;

  /** When the file was last modified */
  modifiedAt: Date;

  /** Whether content has been analyzed (lazy loading) */
  analyzed: boolean;

  /** Analysis result (populated on-demand) */
  analysis?: MediaAnalysis;
}

/**
 * Image-specific metadata
 */
export interface ImageFileInfo extends MediaFileInfo {
  category: 'image';

  /** Image dimensions (if available without full decode) */
  dimensions?: {
    width: number;
    height: number;
  };
}

/**
 * 3D model-specific metadata
 */
export interface ThreeDFileInfo extends MediaFileInfo {
  category: '3d';

  /** GLTF metadata (parsed from JSON for .gltf, or minimal for .glb) */
  gltfInfo?: {
    version?: string;
    generator?: string;
    meshCount?: number;
    materialCount?: number;
    textureCount?: number;
    animationCount?: number;
  };
}

/**
 * PDF-specific metadata
 */
export interface PDFFileInfo extends MediaFileInfo {
  category: 'document';

  /** PDF metadata if available */
  pdfInfo?: {
    pageCount?: number;
    title?: string;
    author?: string;
    subject?: string;
  };
}

/**
 * Union type for all media file info
 */
export type AnyMediaFileInfo = ImageFileInfo | ThreeDFileInfo | PDFFileInfo;

/**
 * Analysis result (populated on-demand)
 */
export interface MediaAnalysis {
  /** When analysis was performed */
  analyzedAt: Date;

  /** Provider used for analysis */
  provider: string;

  /** For images: visual description */
  description?: string;

  /** For images with text: OCR result */
  ocrText?: string;

  /** For PDFs: extracted text */
  extractedText?: string;

  /** For 3D: rendered view paths */
  renderedViews?: string[];

  /** Any detected labels/tags */
  labels?: string[];
}

/**
 * Parse options
 */
export interface MediaFileParseOptions {
  /** Try to extract image dimensions (requires reading file header) */
  extractDimensions?: boolean;

  /** Parse GLTF JSON for metadata */
  parseGltfMetadata?: boolean;

  /** Base path for resolving relative paths */
  basePath?: string;
}

// =============================================================================
// Format Detection
// =============================================================================

/** Image extensions */
const IMAGE_EXTENSIONS: MediaFormat[] = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'tiff'];

/** 3D model extensions */
const THREED_EXTENSIONS: MediaFormat[] = ['gltf', 'glb'];

/** Document extensions */
const DOCUMENT_EXTENSIONS: MediaFormat[] = ['pdf'];

/**
 * Detect format from file extension
 */
export function detectMediaFormat(filePath: string): MediaFormat | null {
  const ext = filePath.toLowerCase().split('.').pop() as MediaFormat;

  if (IMAGE_EXTENSIONS.includes(ext)) return ext;
  if (THREED_EXTENSIONS.includes(ext)) return ext;
  if (DOCUMENT_EXTENSIONS.includes(ext)) return ext;

  return null;
}

/**
 * Get media category from format
 */
export function getMediaCategory(format: MediaFormat): MediaCategory {
  if (IMAGE_EXTENSIONS.includes(format)) return 'image';
  if (THREED_EXTENSIONS.includes(format)) return '3d';
  if (DOCUMENT_EXTENSIONS.includes(format)) return 'document';
  return 'image'; // fallback
}

/**
 * Check if file is a media file
 */
export function isMediaFile(filePath: string): boolean {
  return detectMediaFormat(filePath) !== null;
}

/**
 * Check if file is an image
 */
export function isImageFile(filePath: string): boolean {
  const format = detectMediaFormat(filePath);
  return format !== null && IMAGE_EXTENSIONS.includes(format);
}

/**
 * Check if file is a 3D model
 */
export function isThreeDFile(filePath: string): boolean {
  const format = detectMediaFormat(filePath);
  return format !== null && THREED_EXTENSIONS.includes(format);
}

/**
 * Check if file is a PDF
 */
export function isPDFFile(filePath: string): boolean {
  return detectMediaFormat(filePath) === 'pdf';
}

// =============================================================================
// Dimension Extraction (Lazy - reads file header only)
// =============================================================================

/**
 * PNG signature and IHDR chunk
 */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

/**
 * JPEG SOI marker
 */
const JPEG_SOI = Buffer.from([0xFF, 0xD8]);

/**
 * Extract image dimensions from file header (without full decode)
 */
export async function extractImageDimensions(
  filePath: string
): Promise<{ width: number; height: number } | null> {
  try {
    const fd = await fs.promises.open(filePath, 'r');
    try {
      const header = Buffer.alloc(32);
      await fd.read(header, 0, 32, 0);

      // PNG: Check signature and read IHDR
      if (header.subarray(0, 8).equals(PNG_SIGNATURE)) {
        // IHDR chunk starts at offset 8, width at 16, height at 20
        const width = header.readUInt32BE(16);
        const height = header.readUInt32BE(20);
        return { width, height };
      }

      // JPEG: Need to scan for SOF marker
      if (header.subarray(0, 2).equals(JPEG_SOI)) {
        return await extractJpegDimensions(fd);
      }

      // GIF: LSD at offset 6
      if (header.toString('ascii', 0, 6) === 'GIF89a' || header.toString('ascii', 0, 6) === 'GIF87a') {
        const width = header.readUInt16LE(6);
        const height = header.readUInt16LE(8);
        return { width, height };
      }

      // WebP: Check RIFF header
      if (header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP') {
        return await extractWebpDimensions(fd);
      }

      // BMP: BITMAPINFOHEADER at offset 18
      if (header.toString('ascii', 0, 2) === 'BM') {
        const width = header.readUInt32LE(18);
        const height = Math.abs(header.readInt32LE(22));
        return { width, height };
      }

      return null;
    } finally {
      await fd.close();
    }
  } catch {
    return null;
  }
}

/**
 * Extract JPEG dimensions by scanning for SOF marker
 */
async function extractJpegDimensions(
  fd: fs.promises.FileHandle
): Promise<{ width: number; height: number } | null> {
  const buffer = Buffer.alloc(12);
  let offset = 2;

  while (offset < 1024 * 1024) { // Limit search to 1MB
    await fd.read(buffer, 0, 4, offset);

    if (buffer[0] !== 0xFF) break;

    const marker = buffer[1];

    // SOF markers (0xC0 - 0xCF, excluding 0xC4, 0xC8, 0xCC)
    if ((marker >= 0xC0 && marker <= 0xCF) && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
      await fd.read(buffer, 0, 9, offset);
      const height = buffer.readUInt16BE(5);
      const width = buffer.readUInt16BE(7);
      return { width, height };
    }

    // Skip to next marker
    await fd.read(buffer, 0, 2, offset + 2);
    const length = buffer.readUInt16BE(0);
    offset += 2 + length;
  }

  return null;
}

/**
 * Extract WebP dimensions
 */
async function extractWebpDimensions(
  fd: fs.promises.FileHandle
): Promise<{ width: number; height: number } | null> {
  const buffer = Buffer.alloc(30);
  await fd.read(buffer, 0, 30, 0);

  const chunkType = buffer.toString('ascii', 12, 16);

  if (chunkType === 'VP8 ') {
    // Lossy WebP
    const width = buffer.readUInt16LE(26) & 0x3FFF;
    const height = buffer.readUInt16LE(28) & 0x3FFF;
    return { width, height };
  } else if (chunkType === 'VP8L') {
    // Lossless WebP
    const bits = buffer.readUInt32LE(21);
    const width = (bits & 0x3FFF) + 1;
    const height = ((bits >> 14) & 0x3FFF) + 1;
    return { width, height };
  } else if (chunkType === 'VP8X') {
    // Extended WebP
    const width = (buffer.readUInt32LE(24) & 0xFFFFFF) + 1;
    const height = (buffer.readUInt32LE(27) & 0xFFFFFF) + 1;
    return { width, height };
  }

  return null;
}

// =============================================================================
// GLTF Metadata Extraction
// =============================================================================

/**
 * Extract metadata from GLTF/GLB file
 */
export async function extractGltfMetadata(
  filePath: string
): Promise<ThreeDFileInfo['gltfInfo'] | null> {
  try {
    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.gltf') {
      // GLTF is JSON, read and parse
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const gltf = JSON.parse(content);
      return parseGltfJson(gltf);
    } else if (ext === '.glb') {
      // GLB is binary, read header and JSON chunk
      const fd = await fs.promises.open(filePath, 'r');
      try {
        const header = Buffer.alloc(20);
        await fd.read(header, 0, 20, 0);

        // Check magic "glTF"
        if (header.toString('ascii', 0, 4) !== 'glTF') {
          return null;
        }

        // Get JSON chunk length (after 12-byte header + 4-byte chunk length + 4-byte chunk type)
        const jsonLength = header.readUInt32LE(12);
        const jsonBuffer = Buffer.alloc(jsonLength);
        await fd.read(jsonBuffer, 0, jsonLength, 20);

        const gltf = JSON.parse(jsonBuffer.toString('utf-8'));
        return parseGltfJson(gltf);
      } finally {
        await fd.close();
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Parse GLTF JSON for metadata
 */
function parseGltfJson(gltf: any): ThreeDFileInfo['gltfInfo'] {
  return {
    version: gltf.asset?.version,
    generator: gltf.asset?.generator,
    meshCount: gltf.meshes?.length ?? 0,
    materialCount: gltf.materials?.length ?? 0,
    textureCount: gltf.textures?.length ?? 0,
    animationCount: gltf.animations?.length ?? 0,
  };
}

// =============================================================================
// Main Parser
// =============================================================================

/**
 * Parse a media file (metadata only, lazy loading)
 */
export async function parseMediaFile(
  filePath: string,
  options: MediaFileParseOptions = {}
): Promise<AnyMediaFileInfo | null> {
  const format = detectMediaFormat(filePath);
  if (!format) {
    return null;
  }

  const category = getMediaCategory(format);
  const resolvedPath = options.basePath
    ? path.resolve(options.basePath, filePath)
    : filePath;

  // Get file stats
  let stats: fs.Stats;
  try {
    stats = await fs.promises.stat(resolvedPath);
  } catch {
    // File doesn't exist or not readable
    return null;
  }

  // Calculate hash from first 64KB (for performance)
  const hash = await calculateFileHash(resolvedPath);

  // Base info
  const baseInfo = {
    uuid: uuidv4(),
    file: filePath,
    format,
    category,
    hash,
    sizeBytes: stats.size,
    modifiedAt: stats.mtime,
    analyzed: false,
  };

  // Category-specific parsing
  if (category === 'image') {
    const info: ImageFileInfo = {
      ...baseInfo,
      category: 'image',
    };

    if (options.extractDimensions !== false) {
      info.dimensions = await extractImageDimensions(resolvedPath) || undefined;
    }

    return info;
  }

  if (category === '3d') {
    const info: ThreeDFileInfo = {
      ...baseInfo,
      category: '3d',
    };

    if (options.parseGltfMetadata !== false) {
      info.gltfInfo = await extractGltfMetadata(resolvedPath) || undefined;
    }

    return info;
  }

  if (category === 'document') {
    const info: PDFFileInfo = {
      ...baseInfo,
      category: 'document',
    };

    // PDF metadata extraction would require a PDF parser
    // We keep it minimal for lazy loading - analysis happens on-demand

    return info;
  }

  return null;
}

/**
 * Calculate file hash from first 64KB
 */
async function calculateFileHash(filePath: string): Promise<string> {
  try {
    const fd = await fs.promises.open(filePath, 'r');
    try {
      const buffer = Buffer.alloc(65536);
      const { bytesRead } = await fd.read(buffer, 0, 65536, 0);
      const hash = createHash('sha256').update(buffer.subarray(0, bytesRead)).digest('hex');
      return hash.substring(0, 16);
    } finally {
      await fd.close();
    }
  } catch {
    return uuidv4().replace(/-/g, '').substring(0, 16);
  }
}

/**
 * Parse multiple media files
 */
export async function parseMediaFiles(
  filePaths: string[],
  options: MediaFileParseOptions = {}
): Promise<Map<string, AnyMediaFileInfo>> {
  const results = new Map<string, AnyMediaFileInfo>();

  for (const filePath of filePaths) {
    try {
      const info = await parseMediaFile(filePath, options);
      if (info) {
        results.set(filePath, info);
      }
    } catch (err) {
      console.warn(`Failed to parse media file ${filePath}:`, err);
    }
  }

  return results;
}

// =============================================================================
// Lazy Analysis Functions (called on-demand by agent)
// =============================================================================

/**
 * Analyze image using Gemini Vision (called on-demand)
 *
 * This is a placeholder - actual implementation uses the image tools
 * from threed-tools.ts (describe_image, read_image)
 */
export interface ImageAnalysisRequest {
  filePath: string;

  /** 'describe' for visual description, 'ocr' for text extraction */
  mode: 'describe' | 'ocr';

  /** Custom prompt for description */
  prompt?: string;
}

/**
 * Render 3D model to images (called on-demand)
 *
 * This is a placeholder - actual implementation uses render_3d_asset
 * from threed-tools.ts
 */
export interface ThreeDRenderRequest {
  modelPath: string;
  outputDir: string;
  views?: string[];
  width?: number;
  height?: number;
}

/**
 * Extract text from PDF (called on-demand)
 *
 * Uses Tika for extraction
 */
export interface PDFExtractionRequest {
  filePath: string;

  /** Extract specific pages only */
  pages?: number[];
}

// =============================================================================
// Utility: Get all media files from directory
// =============================================================================

/**
 * Find all media files in a directory
 */
export async function findMediaFiles(
  directory: string,
  options: { recursive?: boolean; patterns?: string[] } = {}
): Promise<string[]> {
  const { recursive = true } = options;
  const mediaFiles: string[] = [];

  async function scanDir(dir: string): Promise<void> {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory() && recursive) {
        // Skip common non-media directories
        if (!['node_modules', '.git', 'dist', 'build', '.cache'].includes(entry.name)) {
          await scanDir(fullPath);
        }
      } else if (entry.isFile() && isMediaFile(entry.name)) {
        mediaFiles.push(fullPath);
      }
    }
  }

  await scanDir(directory);
  return mediaFiles;
}

// =============================================================================
// Export summary for graph ingestion
// =============================================================================

/**
 * Summary of media file for Neo4j node creation
 */
export interface MediaFileSummary {
  uuid: string;
  file: string;
  format: MediaFormat;
  category: MediaCategory;
  hash: string;
  sizeBytes: number;

  // Image-specific
  width?: number;
  height?: number;

  // 3D-specific
  meshCount?: number;
  materialCount?: number;
  textureCount?: number;
  animationCount?: number;

  // Status
  analyzed: boolean;
}

/**
 * Convert media file info to summary for graph
 */
export function toMediaFileSummary(info: AnyMediaFileInfo): MediaFileSummary {
  const summary: MediaFileSummary = {
    uuid: info.uuid,
    file: info.file,
    format: info.format,
    category: info.category,
    hash: info.hash,
    sizeBytes: info.sizeBytes,
    analyzed: info.analyzed,
  };

  if (info.category === 'image' && (info as ImageFileInfo).dimensions) {
    const dims = (info as ImageFileInfo).dimensions!;
    summary.width = dims.width;
    summary.height = dims.height;
  }

  if (info.category === '3d' && (info as ThreeDFileInfo).gltfInfo) {
    const gltf = (info as ThreeDFileInfo).gltfInfo!;
    summary.meshCount = gltf.meshCount;
    summary.materialCount = gltf.materialCount;
    summary.textureCount = gltf.textureCount;
    summary.animationCount = gltf.animationCount;
  }

  return summary;
}
