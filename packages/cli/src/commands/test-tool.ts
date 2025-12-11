/**
 * Test Tool Command
 *
 * CLI command to test MCP tools directly without needing Claude Code.
 * By default, uses the Brain Daemon for persistent state and faster execution.
 *
 * Usage:
 *   ragforge test-tool <tool-name> [--param1=value1] [--param2=value2]
 *
 * Options:
 *   --no-daemon    Run without daemon (direct BrainManager, slower but no persistent state)
 *   -v, --verbose  Show detailed output
 *
 * Examples:
 *   ragforge test-tool get_brain_status
 *   ragforge test-tool ingest_directory --path=./src --project_name=test
 *   ragforge test-tool brain_search --query="function" --limit=5
 *   ragforge test-tool cleanup_brain --mode=data_only --confirm=true
 */

import {
  BrainManager,
  generateBrainToolHandlers,
  generateSetupToolHandlers,
  generateImageTools,
  generate3DTools,
  type BrainToolsContext,
  type ImageToolsContext,
  type ThreeDToolsContext,
} from '@luciformresearch/ragforge';
import { callToolViaDaemon, isDaemonRunning, listTools } from './daemon-client.js';

export interface TestToolOptions {
  toolName: string;
  params: Record<string, any>;
  verbose: boolean;
  noDaemon: boolean;
}

export function parseTestToolOptions(args: string[]): TestToolOptions {
  const options: TestToolOptions = {
    toolName: '',
    params: {},
    verbose: false,
    noDaemon: false,
  };

  // Helper to parse values from CLI strings
  const parseValue = (raw: any): any => {
    if (raw === true || raw === false) return raw;
    if (typeof raw !== 'string') return raw;

    if (raw === 'true') return true;
    if (raw === 'false') return false;

    const asNumber = Number(raw);
    if (!Number.isNaN(asNumber) && raw !== '') return asNumber;

    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '-v' || arg === '--verbose') {
      options.verbose = true;
      continue;
    }

    if (arg === '--no-daemon') {
      options.noDaemon = true;
      continue;
    }

    if (arg.startsWith('--')) {
      let key: string;
      let rawValue: any = '';

      // Support both --key=value and --key value styles
      if (arg.includes('=')) {
        const [parsedKey, ...valueParts] = arg.slice(2).split('=');
        key = parsedKey;
        rawValue = valueParts.join('=');
      } else {
        key = arg.slice(2);

        const next = args[i + 1];
        if (next && !next.startsWith('-')) {
          rawValue = next;
          i++; // Skip the value we just consumed
        } else {
          rawValue = true;
        }
      }

      options.params[key] = parseValue(rawValue);
      continue;
    }

    if (!options.toolName) {
      options.toolName = arg;
    }
  }

  return options;
}

export async function runTestTool(options: TestToolOptions): Promise<void> {
  const globalStart = Date.now();
  const log = (msg: string) => {
    if (options.verbose) {
      console.log(`[${Date.now() - globalStart}ms] ${msg}`);
    }
  };

  if (!options.toolName) {
    console.error('Error: No tool name provided');
    printTestToolHelp();
    process.exitCode = 1;
    return;
  }

  console.log(`\n🔧 Testing tool: ${options.toolName}`);
  if (Object.keys(options.params).length > 0) {
    console.log(`   Parameters: ${JSON.stringify(options.params, null, 2)}`);
  }
  console.log('');

  // Use daemon by default for faster execution and persistent state
  if (!options.noDaemon) {
    await runTestToolViaDaemon(options);
    return;
  }

  // Direct mode (--no-daemon): Initialize BrainManager directly
  console.log('📦 Running in direct mode (no daemon)...');
  let brain: BrainManager | null = null;

  try {
    // Initialize BrainManager
    log('⏳ Getting BrainManager instance...');
    brain = await BrainManager.getInstance();
    log('⏳ Initializing BrainManager...');
    await brain.initialize();
    log('✓ BrainManager initialized');

    // Create context
    log('⏳ Creating tool context...');
    const brainCtx: BrainToolsContext = { brain };
    const imageCtx: ImageToolsContext = {
      projectRoot: process.cwd(),
      onContentExtracted: async (params) => {
        return await brain!.updateMediaContent(params);
      },
    };
    const threeDCtx: ThreeDToolsContext = {
      projectRoot: process.cwd(),
      onContentExtracted: async (params) => {
        return await brain!.updateMediaContent(params);
      },
    };

    // Get all tool handlers
    log('⏳ Generating tool handlers...');
    const brainHandlers = generateBrainToolHandlers(brainCtx);
    const setupHandlers = generateSetupToolHandlers(brainCtx);
    const imageTools = generateImageTools(imageCtx);
    const threeDTools = generate3DTools(threeDCtx);
    const allHandlers: Record<string, (params: any) => Promise<any>> = {
      ...brainHandlers,
      ...setupHandlers,
      ...imageTools.handlers,
      ...threeDTools.handlers,
    };
    log(`✓ ${Object.keys(allHandlers).length} tools ready`);

    // Check if tool exists
    if (!allHandlers[options.toolName]) {
      console.error(`❌ Unknown tool: ${options.toolName}`);
      console.log('\nAvailable tools:');
      for (const name of Object.keys(allHandlers).sort()) {
        console.log(`  - ${name}`);
      }
      process.exitCode = 1;
      return;
    }

    // Execute the tool
    log(`⏳ Executing ${options.toolName}...`);
    const result = await allHandlers[options.toolName](options.params);
    log(`✓ Tool execution completed`);

    console.log('\n📋 Result:');
    console.log(JSON.stringify(result, null, 2));

    // Cleanup: shutdown brain to close Neo4j connections
    log('🔌 Shutting down BrainManager...');
    await brain.shutdown();
    log('✓ Shutdown complete');

  } catch (error: any) {
    console.error(`\n❌ Error: ${error.message}`);
    if (options.verbose && error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exitCode = 1;
  } finally {
    log('🏁 Script ending');
  }
}

/**
 * Run a tool via the Brain Daemon (default mode)
 * This is faster because the daemon keeps BrainManager alive between calls.
 */
async function runTestToolViaDaemon(options: TestToolOptions): Promise<void> {
  const globalStart = Date.now();
  const log = (msg: string) => {
    if (options.verbose) {
      console.log(`[${Date.now() - globalStart}ms] ${msg}`);
    }
  };

  try {
    log('⏳ Calling tool via daemon...');
    const response = await callToolViaDaemon(options.toolName, options.params, {
      verbose: options.verbose,
    });

    if (!response.success) {
      console.error(`❌ Error: ${response.error}`);

      // If tool not found, show available tools
      if (response.error?.includes('Unknown tool')) {
        const tools = await listTools();
        if (tools.length > 0) {
          console.log('\nAvailable tools:');
          for (const name of tools) {
            console.log(`  - ${name}`);
          }
        }
      }
      process.exitCode = 1;
      return;
    }

    log(`✓ Tool execution completed in ${response.duration_ms}ms`);

    console.log('\n📋 Result:');
    console.log(JSON.stringify(response.result, null, 2));

    if (options.verbose && response.duration_ms) {
      console.log(`\n⏱️  Execution time: ${response.duration_ms}ms`);
    }

  } catch (error: any) {
    console.error(`\n❌ Error: ${error.message}`);
    if (options.verbose && error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exitCode = 1;
  }
}

export function printTestToolHelp(): void {
  console.log(`
ragforge test-tool - Test MCP tools directly from CLI

By default, uses the Brain Daemon (port 6969) for faster execution.
The daemon auto-starts if needed and shuts down after 10 min of inactivity.

Usage:
  ragforge test-tool <tool-name> [--param1=value1] [--param2=value2] [-v]

Options:
  -v, --verbose    Show detailed output and timing info
  --no-daemon      Run without daemon (slower, no persistent state)

Available Brain Tools:
  ingest_directory     Ingest a directory into the brain
    --path=<string>           Directory path to ingest
    --project_name=<string>   Optional project name
    --watch=<bool>            Watch for changes (default: false)
    --generate_embeddings=<bool>  Generate embeddings (default: false)

  ingest_web_page      Ingest a web page into the brain
    --url=<string>            URL to ingest
    --depth=<number>          Crawl depth (default: 0)
    --max_pages=<number>      Max pages to crawl (default: 10)

  brain_search         Search across all knowledge
    --query=<string>          Search query
    --limit=<number>          Max results (default: 20)
    --types=<json>            Node types to search (e.g., '["Function","Class"]')
    --projects=<json>         Project IDs to search

  forget_path          Remove knowledge about a path
    --path=<string>           Path to forget

  list_brain_projects  List all projects in the brain

Setup Tools:
  get_brain_status     Get brain configuration status

  set_api_key          Set an API key
    --key_name=<string>       Key name: gemini or replicate
    --key_value=<string>      The API key value

  cleanup_brain        Clean up brain data
    --mode=<string>           Mode: data_only or full
    --confirm=<bool>          Must be true to proceed

Examples:
  # Check brain status
  ragforge test-tool get_brain_status

  # Ingest a directory
  ragforge test-tool ingest_directory --path=./src --project_name=my-project

  # Search the brain
  ragforge test-tool brain_search --query="authentication" --limit=10

  # Full cleanup with confirmation
  ragforge test-tool cleanup_brain --mode=full --confirm=true

  # List all projects
  ragforge test-tool list_brain_projects
`);
}
