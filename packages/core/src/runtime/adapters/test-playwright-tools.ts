/**
 * Test Playwright Tools
 *
 * Tests for:
 * 1. HTML rendering and content extraction from web pages
 * 2. PDF creation from HTML
 *
 * Run with: npx playwright install chromium && npx tsx test-playwright-tools.ts
 */

import * as fs from 'fs';
import * as path from 'path';

const TEST_OUTPUT_DIR = '/tmp/playwright-tests';

// =============================================================================
// 1. Fetch and Render Web Page
// =============================================================================

interface WebPageContent {
  url: string;
  title: string;
  textContent: string;
  html: string;
  screenshots?: Buffer[];
  metadata: {
    fetchedAt: string;
    renderTime: number;
    contentLength: number;
  };
}

async function fetchWebPage(url: string, options: {
  waitFor?: 'load' | 'domcontentloaded' | 'networkidle';
  timeout?: number;
  screenshot?: boolean;
} = {}): Promise<WebPageContent> {
  const { chromium } = await import('playwright');

  const { waitFor = 'networkidle', timeout = 30000, screenshot = false } = options;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  });
  const page = await context.newPage();

  const startTime = Date.now();

  try {
    await page.goto(url, { waitUntil: waitFor, timeout });

    const title = await page.title();
    const html = await page.content();
    const textContent = await page.evaluate(() => document.body.innerText);

    let screenshots: Buffer[] | undefined;
    if (screenshot) {
      screenshots = [await page.screenshot({ fullPage: true })];
    }

    const renderTime = Date.now() - startTime;

    return {
      url,
      title,
      textContent,
      html,
      screenshots,
      metadata: {
        fetchedAt: new Date().toISOString(),
        renderTime,
        contentLength: html.length
      }
    };
  } finally {
    await browser.close();
  }
}

// =============================================================================
// 2. Create PDF from HTML
// =============================================================================

interface PDFCreationResult {
  pdfBuffer: Buffer;
  pageCount: number;
  metadata: {
    createdAt: string;
    renderTime: number;
    pdfSize: number;
  };
}

async function createPdfFromHtml(htmlContent: string, options: {
  format?: 'A4' | 'Letter' | 'Legal';
  landscape?: boolean;
  printBackground?: boolean;
  margin?: { top?: string; right?: string; bottom?: string; left?: string };
} = {}): Promise<PDFCreationResult> {
  const { chromium } = await import('playwright');

  const {
    format = 'A4',
    landscape = false,
    printBackground = true,
    margin = { top: '1cm', right: '1cm', bottom: '1cm', left: '1cm' }
  } = options;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const startTime = Date.now();

  try {
    // Load HTML content
    await page.setContent(htmlContent, { waitUntil: 'networkidle' });

    // Generate PDF
    const pdfBuffer = await page.pdf({
      format,
      landscape,
      printBackground,
      margin
    });

    // Estimate page count (rough calculation)
    // Real page count would require parsing the PDF
    const estimatedPageCount = Math.ceil(pdfBuffer.length / 50000) || 1;

    const renderTime = Date.now() - startTime;

    return {
      pdfBuffer,
      pageCount: estimatedPageCount,
      metadata: {
        createdAt: new Date().toISOString(),
        renderTime,
        pdfSize: pdfBuffer.length
      }
    };
  } finally {
    await browser.close();
  }
}

// =============================================================================
// 3. Extract Structured Data from Page
// =============================================================================

interface ExtractedData {
  links: { text: string; href: string }[];
  images: { src: string; alt: string }[];
  headings: { level: number; text: string }[];
  metaTags: Record<string, string>;
}

async function extractStructuredData(url: string): Promise<ExtractedData> {
  const { chromium } = await import('playwright');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    const data = await page.evaluate(() => {
      // Extract links
      const links = Array.from(document.querySelectorAll('a[href]')).map(a => ({
        text: a.textContent?.trim() || '',
        href: (a as HTMLAnchorElement).href
      })).filter(l => l.text && l.href);

      // Extract images
      const images = Array.from(document.querySelectorAll('img')).map(img => ({
        src: img.src,
        alt: img.alt || ''
      })).filter(i => i.src);

      // Extract headings
      const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).map(h => ({
        level: parseInt(h.tagName[1]),
        text: h.textContent?.trim() || ''
      })).filter(h => h.text);

      // Extract meta tags
      const metaTags: Record<string, string> = {};
      document.querySelectorAll('meta[name], meta[property]').forEach(meta => {
        const name = meta.getAttribute('name') || meta.getAttribute('property');
        const content = meta.getAttribute('content');
        if (name && content) metaTags[name] = content;
      });

      return { links, images, headings, metaTags };
    });

    return data;
  } finally {
    await browser.close();
  }
}

// =============================================================================
// Main Test
// =============================================================================

async function main() {
  console.log('=== Playwright Tools Test ===\n');

  // Create output directory
  if (!fs.existsSync(TEST_OUTPUT_DIR)) {
    fs.mkdirSync(TEST_OUTPUT_DIR, { recursive: true });
  }

  // Test 1: Fetch Web Page
  console.log('📄 Test 1: Fetch Web Page');
  console.log('-'.repeat(60));
  try {
    const testUrl = process.argv[2] || 'https://example.com';
    console.log(`   URL: ${testUrl}`);

    const startTime = Date.now();
    const result = await fetchWebPage(testUrl, { screenshot: true });
    console.log(`   ✅ Title: ${result.title}`);
    console.log(`   ✅ Content length: ${result.metadata.contentLength} chars`);
    console.log(`   ✅ Text preview: ${result.textContent.substring(0, 100).replace(/\n/g, ' ')}...`);
    console.log(`   ✅ Render time: ${result.metadata.renderTime}ms`);

    if (result.screenshots) {
      const screenshotPath = path.join(TEST_OUTPUT_DIR, 'screenshot.png');
      fs.writeFileSync(screenshotPath, result.screenshots[0]);
      console.log(`   ✅ Screenshot saved: ${screenshotPath}`);
    }
  } catch (err) {
    console.log(`   ❌ Error: ${err}`);
  }

  console.log('');

  // Test 2: Create PDF from HTML
  console.log('📑 Test 2: Create PDF from HTML');
  console.log('-'.repeat(60));
  try {
    const testHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Test PDF</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 2cm; }
            h1 { color: #333; }
            p { line-height: 1.6; }
            .highlight { background: #ffffcc; padding: 1em; border-radius: 8px; }
          </style>
        </head>
        <body>
          <h1>Test PDF Document</h1>
          <p>This PDF was generated by Playwright from HTML content.</p>
          <div class="highlight">
            <strong>Features:</strong>
            <ul>
              <li>Full HTML/CSS support</li>
              <li>JavaScript rendering</li>
              <li>Custom fonts and styles</li>
              <li>Images and graphics</li>
            </ul>
          </div>
          <p>Generated at: ${new Date().toISOString()}</p>
        </body>
      </html>
    `;

    const startTime = Date.now();
    const result = await createPdfFromHtml(testHtml);
    console.log(`   ✅ PDF size: ${(result.pdfSize / 1024).toFixed(1)} KB`);
    console.log(`   ✅ Render time: ${result.metadata.renderTime}ms`);

    const pdfPath = path.join(TEST_OUTPUT_DIR, 'test-output.pdf');
    fs.writeFileSync(pdfPath, result.pdfBuffer);
    console.log(`   ✅ PDF saved: ${pdfPath}`);
  } catch (err) {
    console.log(`   ❌ Error: ${err}`);
  }

  console.log('');

  // Test 3: Extract Structured Data
  console.log('🔍 Test 3: Extract Structured Data');
  console.log('-'.repeat(60));
  try {
    const testUrl = 'https://example.com';
    console.log(`   URL: ${testUrl}`);

    const startTime = Date.now();
    const data = await extractStructuredData(testUrl);
    console.log(`   ✅ Links found: ${data.links.length}`);
    console.log(`   ✅ Images found: ${data.images.length}`);
    console.log(`   ✅ Headings found: ${data.headings.length}`);
    if (data.headings.length > 0) {
      console.log(`      First heading: "${data.headings[0].text}"`);
    }
    console.log(`   ✅ Meta tags: ${Object.keys(data.metaTags).length}`);
    console.log(`   ✅ Time: ${Date.now() - startTime}ms`);
  } catch (err) {
    console.log(`   ❌ Error: ${err}`);
  }

  console.log('\n=== Test Complete ===');
  console.log(`Output directory: ${TEST_OUTPUT_DIR}`);
}

main().catch(console.error);
