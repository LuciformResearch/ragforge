#!/usr/bin/env node
/**
 * RagForge CLI entry point.
 *
 * Brain-based knowledge management: index files, search, and query
 * via daemon or MCP server.
 */

import process from 'process';
import {
  parseMcpServerOptions,
  runMcpServer,
  printMcpServerHelp
} from './commands/mcp-server.js';
import {
  parseTestToolOptions,
  runTestTool,
  printTestToolHelp
} from './commands/test-tool.js';
import {
  startDaemon,
  stopDaemon,
  getDaemonStatus,
  streamDaemonLogs,
} from './commands/daemon.js';
import {
  parseCleanOptions,
  runClean,
  printCleanHelp
} from './commands/clean.js';
import {
  parseSetupOptions,
  runSetup,
  printSetupHelp
} from './commands/setup.js';
import {
  parseAgentOptions,
  runAgent,
  printAgentHelp
} from './commands/agent.js';

import { VERSION } from './version.js';

function printRootHelp(): void {
  console.log(`RagForge CLI v${VERSION}

Give Claude (or Cursor, Codex, etc.) a persistent memory.
Ingest code, docs, and web into a searchable knowledge graph.

Quick start:
  ragforge setup                   # Install Docker + Neo4j
  ragforge mcp-server              # Start MCP server (for Claude Code)

Usage:
  ragforge setup [options]         Setup Docker + Neo4j environment
  ragforge mcp-server [options]    Start as MCP server
  ragforge daemon <cmd>            Brain daemon (start|stop|status|logs)
  ragforge agent [options]         Quick agent commands (ask, search, ingest)
  ragforge test-tool <name>        Test a tool directly (debugging)
  ragforge clean <path>            Remove data for a project
  ragforge help <command>          Show help for a command

Global options:
  -h, --help       Show this message
  -v, --version    Show CLI version

Examples:
  # First time setup
  ragforge setup

  # Use with Claude Code (add to MCP config)
  ragforge mcp-server

  # Quick agent commands
  ragforge agent --ask "How does auth work?"
  ragforge agent --search "API endpoints"
  ragforge agent --ingest ./src

  # Check daemon status
  ragforge daemon status
`);
}

function printVersion(): void {
  console.log(VERSION);
}

function printDaemonHelp(): void {
  console.log(`
ragforge daemon - Brain Daemon Management

The Brain Daemon keeps BrainManager alive between tool calls for faster execution
and persistent file watchers. It auto-starts when using test-tool and shuts down
after 5 minutes of inactivity.

Usage:
  ragforge daemon start [-v]    Start the daemon (foreground)
  ragforge daemon stop          Stop the running daemon
  ragforge daemon status        Show daemon status and statistics
  ragforge daemon logs          Stream logs in real-time (Ctrl+C to stop)

Options:
  -v, --verbose    Show verbose output during daemon startup
  --tail=N         (logs) Show last N lines before streaming (default: 50)
  --no-follow      (logs) Show recent logs and exit (don't stream)

Endpoints (port 6969):
  GET  /health       Health check
  GET  /status       Detailed daemon status
  GET  /tools        List available tools
  GET  /projects     List loaded projects
  GET  /watchers     List active file watchers
  POST /tool/:name   Execute a tool
  POST /shutdown     Graceful shutdown

Examples:
  ragforge daemon status
  ragforge daemon start -v
  ragforge daemon logs
  ragforge daemon stop
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    // Default: show help
    printRootHelp();
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
          case 'setup':
            printSetupHelp();
            break;
          case 'mcp-server':
            printMcpServerHelp();
            break;
          case 'agent':
            printAgentHelp();
            break;
          case 'test-tool':
            printTestToolHelp();
            break;
          case 'daemon':
            printDaemonHelp();
            break;
          case 'clean':
            printCleanHelp();
            break;
          default:
            printRootHelp();
        }
        return;

      case 'setup': {
        const options = parseSetupOptions(rest);
        await runSetup(options);
        return;
      }

      case 'agent': {
        const options = parseAgentOptions(rest);
        await runAgent(options);
        return;
      }

      case 'mcp-server': {
        const options = parseMcpServerOptions(rest);
        await runMcpServer(options);
        return;
      }

      case 'test-tool': {
        const options = parseTestToolOptions(rest);
        await runTestTool(options);
        return;
      }

      case 'daemon': {
        const subcommand = rest[0];
        switch (subcommand) {
          case 'start':
            await startDaemon({ verbose: rest.includes('-v') || rest.includes('--verbose') });
            break;
          case 'stop':
            await stopDaemon();
            break;
          case 'status':
            await getDaemonStatus();
            break;
          case 'logs': {
            const tailArg = rest.find(a => a.startsWith('--tail='));
            const tail = tailArg ? parseInt(tailArg.split('=')[1], 10) : 50;
            const follow = !rest.includes('--no-follow');
            await streamDaemonLogs({ tail, follow });
            break;
          }
          default:
            printDaemonHelp();
        }
        return;
      }

      case 'clean': {
        const options = parseCleanOptions(rest);
        await runClean(options);
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
