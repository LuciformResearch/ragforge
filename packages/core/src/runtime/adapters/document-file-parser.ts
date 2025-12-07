/**
 * Document File Parser
 *
 * Parses document files (PDF, DOCX, XLSX, CSV) with smart text extraction:
 * - PDF with text → pdf2json
 * - PDF image-only → extract images → OCR (tesseract or Gemini Vision fallback)
 * - DOCX → mammoth (text + HTML)
 * - XLSX/XLS/CSV → xlsx
 * - Images with text → tesseract (confidence > threshold) else Gemini Vision
 *
 * @since 2025-12-07
 */

import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// =============================================================================
// Types
// =============================================================================

export type DocumentFormat = 'pdf' | 'docx' | 'xlsx' | 'xls' | 'csv';

export interface DocumentFileInfo {
  uuid: string;
  file: string;
  format: DocumentFormat;
  hash: string;
  sizeBytes: number;

  /** Number of pages (PDF, DOCX) or sheets (XLSX) */
  pageCount?: number;

  /** Sheet names for spreadsheets */
  sheetNames?: string[];

  /** Extracted text content (may be empty if lazy loading) */
  textContent?: string;

  /** Text extraction method used */
  extractionMethod?: 'text' | 'ocr-tesseract' | 'ocr-gemini' | 'none' | 'pending';

  /** OCR confidence (0-100) if OCR was used */
  ocrConfidence?: number;

  /** Whether full text was extracted or just metadata */
  hasFullText: boolean;

  /** Whether Gemini Vision is needed for better OCR (lazy loading - costs money) */
  needsGeminiVision: boolean;

  /** Document metadata */
  metadata?: {
    title?: string;
    author?: string;
    subject?: string;
    creator?: string;
    creationDate?: string;
  };
}

export interface SpreadsheetInfo extends DocumentFileInfo {
  format: 'xlsx' | 'xls' | 'csv';

  /** Parsed sheet data */
  sheets?: Record<string, {
    rows: number;
    columns: number;
    headers?: string[];
    data?: unknown[][];
  }>;
}

export interface PDFInfo extends DocumentFileInfo {
  format: 'pdf';

  /** Whether PDF contains selectable text */
  hasSelectableText: boolean;
}

export interface DOCXInfo extends DocumentFileInfo {
  format: 'docx';

  /** HTML representation of the document */
  htmlContent?: string;
}

// OCR confidence threshold - below this, use Gemini Vision
const OCR_CONFIDENCE_THRESHOLD = 60;

// =============================================================================
// Format Detection
// =============================================================================

const DOCUMENT_EXTENSIONS: Record<string, DocumentFormat> = {
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.xlsx': 'xlsx',
  '.xls': 'xls',
  '.csv': 'csv',
};

export function isDocumentFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext in DOCUMENT_EXTENSIONS;
}

export function getDocumentFormat(filePath: string): DocumentFormat | null {
  const ext = path.extname(filePath).toLowerCase();
  return DOCUMENT_EXTENSIONS[ext] || null;
}

// =============================================================================
// PDF Parsing
// =============================================================================

async function parsePdfWithText(filePath: string): Promise<{ text: string; pages: number; metadata: any } | null> {
  try {
    const PDFParser = (await import('pdf2json')).default;

    return new Promise((resolve, reject) => {
      const pdfParser = new PDFParser();

      pdfParser.on('pdfParser_dataError', (errData: any) => {
        reject(new Error(errData.parserError));
      });

      pdfParser.on('pdfParser_dataReady', (pdfData: any) => {
        let fullText = '';
        const pages = pdfData.Pages?.length || 0;

        if (pdfData.Pages) {
          for (const page of pdfData.Pages) {
            for (const text of page.Texts || []) {
              for (const run of text.R || []) {
                fullText += decodeURIComponent(run.T) + ' ';
              }
            }
            fullText += '\n';
          }
        }

        resolve({
          text: fullText.trim(),
          pages,
          metadata: pdfData.Meta || {}
        });
      });

      pdfParser.loadPDF(filePath);
    });
  } catch (err) {
    console.warn('pdf2json failed:', err);
    return null;
  }
}

async function extractPdfPagesAsImages(filePath: string): Promise<Buffer[]> {
  try {
    const { pdf } = await import('pdf-to-img');
    const images: Buffer[] = [];

    const document = await pdf(filePath, { scale: 2 }); // scale 2 for better OCR

    for await (const image of document) {
      images.push(image);
    }

    return images;
  } catch (err) {
    console.warn('pdf-to-img failed:', err);
    return [];
  }
}

// =============================================================================
// OCR with Tesseract
// =============================================================================

async function ocrWithTesseract(imageBuffer: Buffer): Promise<{ text: string; confidence: number }> {
  try {
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker('eng');

    const { data } = await worker.recognize(imageBuffer);
    await worker.terminate();

    return {
      text: data.text,
      confidence: data.confidence
    };
  } catch (err) {
    console.warn('Tesseract OCR failed:', err);
    return { text: '', confidence: 0 };
  }
}

// =============================================================================
// DOCX Parsing
// =============================================================================

async function parseDocx(filePath: string): Promise<{ text: string; html: string; warnings: number }> {
  try {
    const mammoth = await import('mammoth');

    const textResult = await mammoth.extractRawText({ path: filePath });
    const htmlResult = await mammoth.convertToHtml({ path: filePath });

    return {
      text: textResult.value,
      html: htmlResult.value,
      warnings: htmlResult.messages.length
    };
  } catch (err) {
    console.warn('mammoth failed:', err);
    return { text: '', html: '', warnings: 0 };
  }
}

// =============================================================================
// Spreadsheet Parsing
// =============================================================================

async function parseSpreadsheet(filePath: string): Promise<{
  sheetNames: string[];
  sheets: Record<string, { rows: number; columns: number; headers?: string[]; data?: unknown[][] }>;
}> {
  try {
    const XLSX = await import('xlsx');
    const buffer = fs.readFileSync(filePath);
    const workbook = XLSX.read(buffer, { type: 'buffer' });

    const sheets: Record<string, { rows: number; columns: number; headers?: string[]; data?: unknown[][] }> = {};

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];

      const rows = data.length;
      const columns = data.length > 0 ? Math.max(...data.map(row => (row as unknown[]).length)) : 0;
      const headers = rows > 0 ? (data[0] as string[]).map(h => String(h || '')) : undefined;

      sheets[sheetName] = { rows, columns, headers, data };
    }

    return {
      sheetNames: workbook.SheetNames,
      sheets
    };
  } catch (err) {
    console.warn('xlsx failed:', err);
    return { sheetNames: [], sheets: {} };
  }
}

// =============================================================================
// Main Parser
// =============================================================================

export interface ParseDocumentOptions {
  /** Extract full text content (may be slow for large documents) */
  extractText?: boolean;
  /** Use OCR for image-based PDFs */
  useOcr?: boolean;
  /** Gemini Vision fallback function for low-confidence OCR */
  geminiVisionFallback?: (imageBuffer: Buffer, prompt: string) => Promise<string>;
  /** Maximum pages to OCR (for performance) */
  maxOcrPages?: number;
}

export async function parseDocumentFile(
  filePath: string,
  options: ParseDocumentOptions = {}
): Promise<DocumentFileInfo | null> {
  const {
    extractText = true,
    useOcr = true,
    geminiVisionFallback,
    maxOcrPages = 10
  } = options;

  const format = getDocumentFormat(filePath);
  if (!format) return null;

  const stats = fs.statSync(filePath);
  const content = fs.readFileSync(filePath);
  const hash = createHash('sha256').update(content).digest('hex').substring(0, 16);

  const baseInfo: Partial<DocumentFileInfo> = {
    uuid: uuidv4(),
    file: filePath,
    format,
    hash,
    sizeBytes: stats.size,
    hasFullText: false,
    needsGeminiVision: false,
  };

  // ==========================================================================
  // PDF
  // ==========================================================================
  if (format === 'pdf') {
    const pdfResult = await parsePdfWithText(filePath);
    const hasSelectableText = !!(pdfResult?.text && pdfResult.text.trim().length > 50);

    const pdfInfo: PDFInfo = {
      ...baseInfo as PDFInfo,
      pageCount: pdfResult?.pages || 0,
      hasSelectableText,
      needsGeminiVision: false,
      metadata: pdfResult?.metadata ? {
        title: pdfResult.metadata.Title,
        author: pdfResult.metadata.Author,
        subject: pdfResult.metadata.Subject,
        creator: pdfResult.metadata.Creator,
        creationDate: pdfResult.metadata.CreationDate,
      } : undefined,
    };

    if (hasSelectableText && extractText) {
      // PDF has text - use it directly (free)
      pdfInfo.textContent = pdfResult!.text;
      pdfInfo.extractionMethod = 'text';
      pdfInfo.hasFullText = true;
    } else if (!hasSelectableText && useOcr) {
      // PDF is image-only - try Tesseract OCR (free)
      console.log(`PDF is image-only, running Tesseract OCR...`);
      const images = await extractPdfPagesAsImages(filePath);

      if (images.length > 0) {
        const pagesToOcr = images.slice(0, maxOcrPages);
        let fullText = '';
        let totalConfidence = 0;

        for (let i = 0; i < pagesToOcr.length; i++) {
          const { text, confidence } = await ocrWithTesseract(pagesToOcr[i]);
          fullText += `--- Page ${i + 1} ---\n${text}\n\n`;
          totalConfidence += confidence;
        }

        const avgConfidence = totalConfidence / pagesToOcr.length;
        pdfInfo.ocrConfidence = avgConfidence;
        pdfInfo.textContent = fullText;
        pdfInfo.extractionMethod = 'ocr-tesseract';

        if (avgConfidence >= OCR_CONFIDENCE_THRESHOLD) {
          // Good OCR confidence
          pdfInfo.hasFullText = true;
          pdfInfo.needsGeminiVision = false;
        } else {
          // Low confidence - mark for Gemini Vision lazy loading
          pdfInfo.hasFullText = false; // Partial/unreliable text
          pdfInfo.needsGeminiVision = true;
          console.log(`OCR confidence low (${avgConfidence.toFixed(1)}%), marked for Gemini Vision`);
        }
      }
    }

    return pdfInfo;
  }

  // ==========================================================================
  // DOCX
  // ==========================================================================
  if (format === 'docx') {
    const docxResult = await parseDocx(filePath);

    const docxInfo: DOCXInfo = {
      ...baseInfo as DOCXInfo,
      hasFullText: docxResult.text.length > 0,
      needsGeminiVision: false,
      textContent: extractText ? docxResult.text : undefined,
      htmlContent: extractText ? docxResult.html : undefined,
      extractionMethod: 'text',
    };

    // Estimate page count (rough: ~3000 chars per page)
    docxInfo.pageCount = Math.ceil(docxResult.text.length / 3000) || 1;

    return docxInfo;
  }

  // ==========================================================================
  // Spreadsheets (XLSX, XLS, CSV)
  // ==========================================================================
  if (format === 'xlsx' || format === 'xls' || format === 'csv') {
    const spreadsheetResult = await parseSpreadsheet(filePath);

    const spreadsheetInfo: SpreadsheetInfo = {
      ...baseInfo as SpreadsheetInfo,
      format,
      sheetNames: spreadsheetResult.sheetNames,
      pageCount: spreadsheetResult.sheetNames.length,
      sheets: spreadsheetResult.sheets,
      hasFullText: true,
      needsGeminiVision: false,
      extractionMethod: 'text',
    };

    // Create text representation of spreadsheet
    if (extractText) {
      let textContent = '';
      for (const [sheetName, sheet] of Object.entries(spreadsheetResult.sheets)) {
        textContent += `=== Sheet: ${sheetName} ===\n`;
        if (sheet.headers) {
          textContent += `Headers: ${sheet.headers.join(' | ')}\n`;
        }
        textContent += `Rows: ${sheet.rows}, Columns: ${sheet.columns}\n\n`;
      }
      spreadsheetInfo.textContent = textContent;
    }

    return spreadsheetInfo;
  }

  return null;
}

// =============================================================================
// Batch Parser
// =============================================================================

export async function parseDocumentFiles(
  filePaths: string[],
  options: ParseDocumentOptions = {}
): Promise<Map<string, DocumentFileInfo>> {
  const results = new Map<string, DocumentFileInfo>();

  for (const filePath of filePaths) {
    if (isDocumentFile(filePath)) {
      const info = await parseDocumentFile(filePath, options);
      if (info) {
        results.set(filePath, info);
      }
    }
  }

  return results;
}
