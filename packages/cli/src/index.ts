#!/usr/bin/env node
/**
 * RagForge CLI entry point.
 *
 * Provides commands to introspect Neo4j schemas, generate RagForge
 * configs, and emit TypeScript client artifacts.
 */

import process from 'process';
import {
  parseInitOptions,
  runInit,
  printInitHelp
} from './commands/init.js';
import {
  parseGenerateOptions,
  runGenerate,
  printGenerateHelp
} from './commands/generate.js';
import {
  parseIntrospectOptions,
  runIntrospect,
  printIntrospectHelp
} from './commands/introspect.js';
import {
  parseEmbeddingsOptions,
  runEmbeddingsIndex,
  runEmbeddingsGenerate,
  printEmbeddingsHelp
} from './commands/embeddings.js';

import { VERSION } from './version.js';

function printRootHelp(): void {
  console.log(`RagForge CLI v${VERSION}

Usage:
  ragforge <command> [options]

Available commands:
  init                 Introspect Neo4j and generate config + client
  generate             Regenerate client artifacts from an existing config
  introspect           Produce config + schema snapshot without client code
  embeddings:index     Create vector indexes defined in embeddings config
  embeddings:generate  Generate embeddings via Gemini

Global options:
  -h, --help       Show this message
  -v, --version    Show CLI version
`);
}

function printVersion(): void {
  console.log(VERSION);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printRootHelp();
    process.exitCode = 1;
    return;
  }

  const [command, ...rest] = args;

  try {
    switch (command) {
      case '-h':
      case '--help':
        printRootHelp();
        return;

      case '-v':
      case '--version':
        printVersion();
        return;

      case 'help':
        switch (rest[0]) {
          case 'init':
            printInitHelp();
            break;
          case 'generate':
            printGenerateHelp();
            break;
          case 'introspect':
            printIntrospectHelp();
            break;
          case 'embeddings':
            printEmbeddingsHelp();
            break;
          default:
            printRootHelp();
        }
        return;

      case 'init': {
        const options = await parseInitOptions(rest);
        await runInit(options);
        return;
      }

      case 'generate': {
        const options = parseGenerateOptions(rest);
        await runGenerate(options);
        return;
      }

      case 'introspect': {
        const options = parseIntrospectOptions(rest);
        await runIntrospect(options);
        return;
      }

      case 'embeddings:index': {
        const options = await parseEmbeddingsOptions(rest);
        await runEmbeddingsIndex(options);
        return;
      }

      case 'embeddings:generate': {
        const options = await parseEmbeddingsOptions(rest);
        await runEmbeddingsGenerate(options);
        return;
      }

      default:
        console.error(`Unknown command "${command}".`);
        printRootHelp();
        process.exitCode = 1;
        return;
    }
  } catch (error: any) {
    console.error('❌  Error:', error.message || error);
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error('Unexpected error:', error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
