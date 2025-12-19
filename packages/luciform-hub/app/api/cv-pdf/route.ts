import { NextResponse } from 'next/server';
import { chromium } from 'playwright';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const baseUrl = searchParams.get('baseUrl') || 'http://localhost:3000';

  let browser = null;

  try {
    // Launch browser
    browser = await chromium.launch({
      headless: true,
    });

    // A4 dimensions in pixels at 96 DPI (standard CSS DPI)
    const A4_WIDTH = 794;  // 210mm
    const A4_HEIGHT = 1123; // 297mm
    const MARGIN = 38; // ~1cm in pixels
    const USABLE_HEIGHT = A4_HEIGHT - (MARGIN * 2); // ~1085px per page

    const context = await browser.newContext({
      viewport: { width: A4_WIDTH, height: 2000 }, // Tall viewport to see full content
      deviceScaleFactor: 2, // High DPI for crisp text
    });

    const page = await context.newPage();

    // Navigate to CV page with print mode
    await page.goto(`${baseUrl}/cv?print=true`, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    // Wait for any animations to settle
    await page.waitForTimeout(500);

    // Find the page break element and measure content
    const measurements = await page.evaluate(() => {
      const breakElement = document.querySelector('.cv-page-break');
      const contentContainer = document.querySelector('.print-content');

      if (!breakElement || !contentContainer) {
        return { breakTop: 0, totalHeight: 0, page2ContentHeight: 0 };
      }

      const breakRect = breakElement.getBoundingClientRect();
      const containerRect = contentContainer.getBoundingClientRect();

      // Find all content after the break point
      const allSections = contentContainer.querySelectorAll('section');
      let page2Height = 0;
      let foundBreak = false;

      allSections.forEach((section) => {
        if (section.classList.contains('cv-page-break')) {
          foundBreak = true;
        }
        if (foundBreak) {
          const rect = section.getBoundingClientRect();
          page2Height += rect.height;
        }
      });

      return {
        breakTop: breakRect.top - containerRect.top,
        totalHeight: containerRect.height,
        page2ContentHeight: page2Height,
      };
    });

    // Add styles for PDF generation with proper page breaks
    await page.addStyleTag({
      content: `
        /* Hide navigation and export button */
        nav, button[data-export-pdf] { display: none !important; }

        /* Ensure dark background prints */
        html, body {
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
          background: #0a0a0f !important;
        }

        /* Hide code blocks for cleaner PDF */
        .print\\:hidden { display: none !important; }

        /* Ensure links are styled visibly */
        a[href] {
          text-decoration: underline !important;
          text-decoration-color: currentColor !important;
        }

        /* Force page break before Professional Experience */
        .cv-page-break {
          break-before: page !important;
          page-break-before: always !important;
          padding-top: 20px !important;
        }

        /* Reduce margins and spacing for better fit */
        .print-content {
          padding: 30px 40px !important;
        }

        /* Tighter spacing for page 2 content */
        .cv-page-break ~ section,
        .cv-page-break {
          margin-bottom: 16px !important;
        }

        .cv-page-break ~ section .space-y-4 > * {
          margin-bottom: 8px !important;
        }

        /* Reduce font size slightly for professional experience section */
        .cv-page-break,
        .cv-page-break ~ section {
          font-size: 0.95em;
        }

        /* Reduce padding in experience cards */
        .cv-page-break .py-2 {
          padding-top: 4px !important;
          padding-bottom: 4px !important;
        }

        /* Compact project cards */
        .cv-page-break ~ section .p-4 {
          padding: 12px !important;
        }
      `
    });

    // Generate PDF with links preserved
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '1cm',
        bottom: '1cm',
        left: '1.2cm',
        right: '1.2cm',
      },
      displayHeaderFooter: false,
    });

    await browser.close();

    // Return PDF as download - convert Buffer to Uint8Array for NextResponse
    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="Lucie_Defraiteur_CV.pdf"',
      },
    });

  } catch (error) {
    console.error('PDF generation error:', error);
    if (browser) await browser.close();

    return NextResponse.json(
      { error: 'Failed to generate PDF', details: String(error) },
      { status: 500 }
    );
  }
}
