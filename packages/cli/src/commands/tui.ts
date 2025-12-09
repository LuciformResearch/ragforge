/**
 * RagForge TUI Command
 *
 * Launches the terminal user interface for interactive agent sessions.
 * Uses Ink (React for CLI) for a rich terminal experience.
 *
 * Features:
 * - Rich terminal UI with header, footer, and scrollable message area
 * - Tool confirmation dialogs for action validation
 * - Real-time streaming responses
 * - Vim-style keyboard navigation
 *
 * Usage:
 *   ragforge tui [options]
 *
 * @since 2025-12-09
 */

import path from 'path';
import process from 'process';
import { startTui } from '../tui/index.js';

export interface TuiOptions {
  /** Project path (default: current directory) */
  project?: string;

  /** Model to use */
  model?: string;

  /** Verbose output */
  verbose?: boolean;
}

export function printTuiHelp(): void {
  console.log(`Usage:
  ragforge tui [options]

Description:
  Launch the RagForge terminal user interface.

  Features:
  - Rich terminal UI with Ink (React for CLI)
  - Tool confirmation dialogs for safe agent operations
  - Real-time streaming responses
  - Keyboard navigation

Options:
  --project <path>   Project directory (default: current directory)
  --model <model>    LLM model to use (default: gemini-2.0-flash)
  --verbose          Enable verbose output
  -h, --help         Show this help

Environment:
  GEMINI_API_KEY     Required for LLM operations

Examples:
  # Launch TUI in current project
  ragforge tui

  # Launch TUI for specific project
  ragforge tui --project /path/to/project
`);
}

export function parseTuiOptions(args: string[]): TuiOptions {
  const options: TuiOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--project':
        options.project = args[++i];
        break;
      case '--model':
        options.model = args[++i];
        break;
      case '--verbose':
        options.verbose = true;
        break;
      case '-h':
      case '--help':
        printTuiHelp();
        process.exit(0);
        break;
      default:
        if (arg.startsWith('-')) {
          throw new Error(`Unknown option: ${arg}`);
        }
    }
  }

  return options;
}

export async function runTui(options: TuiOptions): Promise<void> {
  const projectPath = options.project || process.cwd();

  // Derive project name from path
  const projectName = path.basename(projectPath);

  console.log('Starting RagForge TUI...');

  await startTui({
    projectName,
    projectPath,
    model: options.model,
    verbose: options.verbose,
  });
}
