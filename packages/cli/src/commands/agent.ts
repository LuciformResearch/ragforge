/**
 * Agent CLI - Simple wrapper around daemon tools
 *
 * Usage:
 *   ragforge agent --ask "question"      # Call ResearchAgent
 *   ragforge agent --search "query"      # Call brain_search
 *   ragforge agent --ingest "./path"     # Ingest a directory
 */

import { ensureDaemonRunning, callToolViaDaemon } from './daemon-client.js';

export interface AgentOptions {
  ask?: string;
  search?: string;
  ingest?: string;
  analyzeImages?: boolean;
  analyze3d?: boolean;
  ocr?: boolean;
  verbose?: boolean;
}

export function printAgentHelp(): void {
  console.log(`
Usage: ragforge agent [options]

Options:
  --ask <question>     Ask the ResearchAgent a question
  --search <query>     Search the brain (semantic search)
  --ingest <path>      Ingest a directory into the brain
  --verbose            Show detailed output
  -h, --help           Show this help

Ingest options:
  --analyze-images     Analyze images with Gemini Vision (generates descriptions)
  --analyze-3d         Analyze 3D models (.glb, .gltf) by rendering them
  --ocr                Run OCR on scanned PDF documents

Examples:
  ragforge agent --ask "How does authentication work?"
  ragforge agent --search "ResearchAgent class"
  ragforge agent --ingest ./src
  ragforge agent --ingest ./docs --ocr --analyze-images
`);
}

export function parseAgentOptions(args: string[]): AgentOptions {
  const options: AgentOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--ask':
        options.ask = args[++i];
        break;
      case '--search':
        options.search = args[++i];
        break;
      case '--ingest':
        options.ingest = args[++i];
        break;
      case '--analyze-images':
      case '--images':
        options.analyzeImages = true;
        break;
      case '--analyze-3d':
      case '--3d':
        options.analyze3d = true;
        break;
      case '--ocr':
        options.ocr = true;
        break;
      case '--verbose':
        options.verbose = true;
        break;
      case '-h':
      case '--help':
        printAgentHelp();
        process.exit(0);
    }
  }

  return options;
}

export async function runAgent(options: AgentOptions): Promise<void> {
  // Ensure daemon is running
  console.log('🔄 Ensuring daemon is running...');
  await ensureDaemonRunning();

  if (options.ask) {
    console.log(`\n🔍 Asking ResearchAgent: "${options.ask}"\n`);

    const response = await callToolViaDaemon('call_research_agent', {
      question: options.ask,
      max_iterations: 15,
    });

    if (response.error) {
      console.error('❌ Error:', response.error);
      process.exit(1);
    }

    const data = response.result as any;

    // Print report
    console.log(data?.report || JSON.stringify(data, null, 2));

    if (options.verbose && data?.sourcesUsed) {
      console.log('\n📚 Sources:', data.sourcesUsed.join(', '));
      console.log(`🔄 Iterations: ${data.iterations}`);
    }

  } else if (options.search) {
    console.log(`\n🔍 Searching brain: "${options.search}"\n`);

    const response = await callToolViaDaemon('brain_search', {
      query: options.search,
      semantic: true,
      limit: 10,
    });

    if (response.error) {
      console.error('❌ Error:', response.error);
      process.exit(1);
    }

    const data = response.result as any;

    // Print results
    const results = data?.results || [];
    console.log(`Found ${results.length} results:\n`);

    for (const r of results) {
      const node = r.node || {};
      const score = r.score?.toFixed(3) || '?';
      const file = node.file || node.absolutePath || '?';
      const name = node.name || node.signature || '?';
      const type = node.type || '?';
      const lines = node.startLine ? `:${node.startLine}` : '';

      console.log(`  [${score}] ${type} ${name}`);
      console.log(`         ${file}${lines}\n`);
    }

  } else if (options.ingest) {
    const path = await import('path');
    const absolutePath = path.default.resolve(options.ingest);

    const flags: string[] = [];
    if (options.analyzeImages) flags.push('analyze-images');
    if (options.analyze3d) flags.push('analyze-3d');
    if (options.ocr) flags.push('ocr');

    console.log(`\n📥 Ingesting: ${absolutePath}${flags.length ? ` [${flags.join(', ')}]` : ''}\n`);

    const response = await callToolViaDaemon('ingest_directory', {
      path: absolutePath,
      generate_embeddings: true,
      analyze_images: options.analyzeImages,
      analyze_3d: options.analyze3d,
      ocr_documents: options.ocr,
    });

    if (response.error) {
      console.error('❌ Error:', response.error);
      process.exit(1);
    }

    const data = response.result as any;

    console.log(`✅ Ingested successfully!`);
    if (data?.projectId) {
      console.log(`   Project ID: ${data.projectId}`);
    }
    if (data?.stats) {
      console.log(`   Files: ${data.stats.filesProcessed || 0}`);
      console.log(`   Scopes: ${data.stats.scopesCreated || 0}`);
    }

  } else {
    printAgentHelp();
  }
}
