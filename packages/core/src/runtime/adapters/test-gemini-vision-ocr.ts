/**
 * Test Gemini Vision OCR on images
 */

import * as fs from 'fs';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error('❌ GEMINI_API_KEY environment variable is required');
  process.exit(1);
}

async function ocrWithGeminiVision(imagePath: string): Promise<string> {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

  const imageBuffer = fs.readFileSync(imagePath);
  const base64Image = imageBuffer.toString('base64');
  const mimeType = imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';

  const result = await model.generateContent([
    {
      inlineData: {
        mimeType,
        data: base64Image
      }
    },
    'Extract ALL text visible in this image. Include any labels, tags, titles, or text overlays. Return only the extracted text, preserving the structure as much as possible.'
  ]);

  return result.response.text();
}

async function main() {
  const imagePath = process.argv[2] || '/home/luciedefraiteur/LR_CodeRag/ragforge/docs/test-documents/image_with_text.jpg';

  if (!fs.existsSync(imagePath)) {
    console.error('File not found:', imagePath);
    process.exit(1);
  }

  console.log('=== Gemini Vision OCR Test ===\n');
  console.log(`Image: ${imagePath}`);
  console.log('-'.repeat(60));

  // First test with Tesseract for comparison
  console.log('\n📷 Testing Tesseract first...');
  try {
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker('eng');
    const { data } = await worker.recognize(imagePath);
    await worker.terminate();

    console.log(`   Confidence: ${data.confidence.toFixed(1)}%`);
    console.log(`   Text preview: ${data.text.substring(0, 150).replace(/\n/g, ' ')}...`);
  } catch (err) {
    console.log('   Tesseract failed:', err);
  }

  // Now test with Gemini Vision
  console.log('\n🔮 Testing Gemini Vision...');
  try {
    const startTime = Date.now();
    const text = await ocrWithGeminiVision(imagePath);
    const elapsed = Date.now() - startTime;

    console.log(`   Time: ${elapsed}ms`);
    console.log(`   Extracted text:\n`);
    console.log(text);
  } catch (err) {
    console.log('   Gemini Vision failed:', err);
  }

  console.log('\n=== Test Complete ===');
}

main().catch(console.error);
