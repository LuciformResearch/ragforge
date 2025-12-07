/**
 * Test script for document-file-parser
 * Run with: npx tsx test-document-parsers.ts [files...]
 */

import * as fs from 'fs';
import { parseDocumentFile, isDocumentFile } from './document-file-parser.js';

async function main() {
  const args = process.argv.slice(2);

  console.log('=== Document File Parser Test ===\n');

  if (args.length === 0) {
    console.log('Usage: npx tsx test-document-parsers.ts <file1> [file2] ...');
    console.log('Supported: .pdf, .docx, .xlsx, .xls, .csv\n');

    // Default test files
    const testDir = '/home/luciedefraiteur/LR_CodeRag/ragforge/docs/test-documents';
    const defaultFiles = [
      `${testDir}/NDA_Aurialink.pdf`,           // PDF with text
      `${testDir}/NDA_image_only.pdf`,          // PDF image-only (needs OCR)
      `${testDir}/NDA_synth.xlsx`,              // Spreadsheet
      `${testDir}/realdocs-Atlas/Atlas_Comprehensive_Introduction.docx`, // DOCX
    ];

    console.log('Running with default test files:\n');
    for (const file of defaultFiles) {
      if (fs.existsSync(file)) {
        args.push(file);
      }
    }
  }

  for (const filePath of args) {
    if (!fs.existsSync(filePath)) {
      console.log(`❌ File not found: ${filePath}\n`);
      continue;
    }

    if (!isDocumentFile(filePath)) {
      console.log(`⏭️  Skipping non-document: ${filePath}\n`);
      continue;
    }

    console.log(`📄 Parsing: ${filePath}`);
    console.log('-'.repeat(60));

    try {
      const startTime = Date.now();
      const result = await parseDocumentFile(filePath, {
        extractText: true,
        useOcr: true,
        maxOcrPages: 3, // Limit for testing
      });
      const elapsed = Date.now() - startTime;

      if (result) {
        console.log(`✅ Format: ${result.format}`);
        console.log(`   Size: ${(result.sizeBytes / 1024).toFixed(1)} KB`);
        console.log(`   Hash: ${result.hash}`);
        console.log(`   Pages/Sheets: ${result.pageCount || 'N/A'}`);
        console.log(`   Extraction: ${result.extractionMethod || 'none'}`);

        if (result.ocrConfidence !== undefined) {
          console.log(`   OCR Confidence: ${result.ocrConfidence.toFixed(1)}%`);
        }

        if (result.metadata) {
          console.log(`   Metadata: ${JSON.stringify(result.metadata)}`);
        }

        if ('sheetNames' in result && result.sheetNames) {
          console.log(`   Sheets: ${result.sheetNames.join(', ')}`);
        }

        if ('hasSelectableText' in result) {
          console.log(`   Has Selectable Text: ${result.hasSelectableText}`);
        }

        if (result.textContent) {
          const preview = result.textContent.substring(0, 300).replace(/\n/g, ' ');
          console.log(`   Text Preview: ${preview}...`);
        }

        console.log(`   Time: ${elapsed}ms`);
      } else {
        console.log(`❌ Failed to parse`);
      }
    } catch (err) {
      console.log(`❌ Error: ${err}`);
    }

    console.log('');
  }

  console.log('=== Test Complete ===');
}

main().catch(console.error);
