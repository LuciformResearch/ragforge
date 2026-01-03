import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const PROMPT_PATH = '/home/luciedefraiteur/.ragforge/logs/llm-calls/ResearchAgent.iterate/2025-12-17T18-29-37-416+01-00/prompt.txt';

async function main() {
  // Read the prompt file
  console.log('Reading prompt file...');
  const promptContent = fs.readFileSync(PROMPT_PATH, 'utf-8');
  console.log(`Prompt loaded: ${promptContent.length} characters`);

  // Launch browser
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: false }); // headless: false to see what happens
  const page = await browser.newPage();

  // Create HTML content with Puter.js
  const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Puter.js Test</title>
  <style>
    body { font-family: monospace; padding: 20px; background: #1e1e1e; color: #d4d4d4; }
    #status { color: #4ec9b0; margin-bottom: 20px; }
    #response { white-space: pre-wrap; background: #2d2d2d; padding: 20px; border-radius: 8px; max-height: 80vh; overflow-y: auto; }
    .error { color: #f44747; }
  </style>
</head>
<body>
  <div id="status">Loading Puter.js...</div>
  <div id="response"></div>

  <script src="https://js.puter.com/v2/"></script>
  <script>
    window.runTest = async function(promptText) {
      const statusEl = document.getElementById('status');
      const responseEl = document.getElementById('response');

      try {
        statusEl.textContent = 'Sending to GPT-5 nano... (prompt: ' + promptText.length + ' chars)';

        const response = await puter.ai.chat(promptText, {
          model: 'gpt-5-nano',
        });

        statusEl.textContent = 'Response received!';
        responseEl.textContent = typeof response === 'string' ? response : JSON.stringify(response, null, 2);

        return response;
      } catch (error) {
        statusEl.textContent = 'Error!';
        statusEl.className = 'error';
        responseEl.textContent = error.message || String(error);
        responseEl.className = 'error';
        throw error;
      }
    };
  </script>
</body>
</html>
`;

  // Set the HTML content
  await page.setContent(html);

  // Wait for Puter.js to load
  console.log('Waiting for Puter.js to load...');
  await page.waitForFunction(() => typeof (window as any).puter !== 'undefined', { timeout: 30000 });
  console.log('Puter.js loaded!');

  // Run the test with the prompt
  console.log('Sending prompt to GPT-5 nano...');
  console.log('This may take a while for such a large prompt...');

  try {
    const response = await page.evaluate(async (prompt) => {
      return await (window as any).runTest(prompt);
    }, promptContent);

    console.log('\n=== RESPONSE ===\n');
    console.log(typeof response === 'string' ? response : JSON.stringify(response, null, 2));
  } catch (error) {
    console.error('Error:', error);
  }

  // Keep browser open to see the result
  console.log('\nBrowser will stay open. Press Ctrl+C to close.');
  await new Promise(() => {}); // Keep alive
}

main().catch(console.error);
