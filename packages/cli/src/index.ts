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
import {
  parseQuickstartOptions,
  runQuickstart,
  printQuickstartHelp
} from './commands/quickstart.js';
import {
  parseCreateOptions,
  runCreate,
  printCreateHelp
} from './commands/create.js';
import {
  parseAgentOptions,
  runAgent,
  printAgentHelp
} from './commands/agent.js';

import { VERSION } from './version.js';

function printRootHelp(): void {
  console.log(`RagForge CLI v${VERSION}

Quick start:
  ragforge quickstart                # New to RagForge? Start here!
  ragforge create <name>             # Create a new TypeScript project
  ragforge init                      # Introspect Neo4j + generate client (uses .env)
  ragforge init --auto-detect-fields # + LLM field detection (needs GEMINI_API_KEY)

Connection defaults from .env in current directory:
  NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD, NEO4J_DATABASE, GEMINI_API_KEY

Usage:
  ragforge quickstart [options]      Quick setup for code RAG with defaults
  ragforge create <name> [options]   Create a new TypeScript project
  ragforge agent [options]           Launch RagForge agent (RAG + File + Project tools)
  ragforge init [options]            Complete setup (introspect + generate)
  ragforge help <command>            Show detailed help for a specific command

Advanced commands:
  generate             Regenerate client from existing config
  introspect           Just introspection, no client code
  embeddings:index     Create vector indexes
  embeddings:generate  Generate embeddings via Gemini

Global options:
  -h, --help       Show this message
  -v, --version    Show CLI version

Examples:
  # Quick start (auto-detects TypeScript/Python, creates config, sets up Docker)
  ragforge quickstart

  # Simple init - uses .env in current directory
  ragforge init

  # With LLM field auto-detection
  ragforge init --auto-detect-fields

  # Custom project name and output
  ragforge init --project myapp --out ./generated

  # Override connection (instead of .env)
  ragforge init --uri bolt://localhost:7687 --username neo4j --password secret
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
          case 'quickstart':
            printQuickstartHelp();
            break;
          case 'create':
            printCreateHelp();
            break;
          case 'agent':
            printAgentHelp();
            break;
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

      case 'quickstart': {
        const options = await parseQuickstartOptions(rest);
        await runQuickstart(options);
        return;
      }

      case 'create': {
        const options = parseCreateOptions(rest);
        await runCreate(options);
        return;
      }

      case 'agent': {
        const options = parseAgentOptions(rest);
        await runAgent(options);
        return;
      }

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
