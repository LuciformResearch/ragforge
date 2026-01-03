/**
 * Clean command - Remove embeddings and/or all ingested data for a project
 *
 * Usage:
 *   ragforge clean <project-path> [--embeddings-only] [--all]
 *
 * Options:
 *   --embeddings-only    Remove only embeddings (keep nodes)
 *   --all                Remove all nodes and embeddings (full cleanup)
 *   -h, --help          Show help
 */

import process from 'process';
import * as path from 'path';
import { ensureEnvLoaded } from '../utils/env.js';
import { ensureDaemonRunning, callToolViaDaemon } from './daemon-client.js';

export interface CleanOptions {
  projectPath: string;
  embeddingsOnly: boolean;
  all: boolean;
}

export function parseCleanOptions(args: string[]): CleanOptions {
  let projectPath: string | undefined;
  let embeddingsOnly = false;
  let all = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case '--embeddings-only':
        embeddingsOnly = true;
        break;
      case '--all':
        all = true;
        break;
      case '-h':
      case '--help':
        printCleanHelp();
        process.exit(0);
        break;
      default:
        if (!projectPath && !arg.startsWith('-')) {
          projectPath = path.resolve(arg);
        } else {
          throw new Error(`Unknown option: ${arg}`);
        }
    }
  }

  if (!projectPath) {
    throw new Error('Project path is required. Usage: ragforge clean <project-path> [--embeddings-only|--all]');
  }

  if (!embeddingsOnly && !all) {
    // Default: embeddings only (safer)
    embeddingsOnly = true;
  }

  if (embeddingsOnly && all) {
    throw new Error('Cannot use both --embeddings-only and --all. Choose one.');
  }

  return {
    projectPath,
    embeddingsOnly,
    all,
  };
}

export async function runClean(options: CleanOptions): Promise<void> {
  ensureEnvLoaded(import.meta.url);

  const resolvedPath = path.resolve(options.projectPath);
  console.log(`🧹 Cleaning project: ${resolvedPath}`);

  // Ensure daemon is running (handles Kuzu single-process constraint)
  console.log(`📡 Connecting to daemon...`);
  try {
    await ensureDaemonRunning();
  } catch (error: any) {
    console.error(`❌ Failed to connect to daemon: ${error.message}`);
    console.log(`\n💡 Try: ragforge daemon start`);
    process.exitCode = 1;
    return;
  }

  // Find project using daemon
  const projectsResult = await callToolViaDaemon('list_brain_projects', {});
  if (!projectsResult.success) {
    console.error(`❌ Failed to list projects: ${projectsResult.error}`);
    process.exitCode = 1;
    return;
  }

  const projects = projectsResult.result?.projects || [];

  // Find matching project by path or ID
  let project = projects.find((p: any) =>
    p.path === resolvedPath ||
    p.id === options.projectPath ||
    resolvedPath.startsWith(p.path) ||
    p.path?.startsWith(resolvedPath)
  );

  if (!project) {
    console.error(`❌ Project not found: ${resolvedPath}`);
    console.log(`\n💡 Available projects:`);
    if (projects.length === 0) {
      console.log(`   (no projects found)`);
    } else {
      projects.forEach((p: any) => {
        console.log(`   - ${p.path} (ID: ${p.id})`);
      });
    }
    process.exitCode = 1;
    return;
  }

  console.log(`📦 Project ID: ${project.id}`);
  console.log(`📁 Root path: ${project.path}`);

  try {
    if (options.embeddingsOnly) {
      console.log(`\n🗑️  Removing embeddings only (nodes will be kept)...`);

      // Use run_cypher via daemon to remove embeddings
      // This removes embedding properties while keeping nodes
      const cypherResult = await callToolViaDaemon('run_cypher', {
        query: `
          MATCH (n {projectId: $projectId})
          WHERE n.embedding IS NOT NULL
             OR n.embedding_name IS NOT NULL
             OR n.embedding_content IS NOT NULL
             OR n.embedding_description IS NOT NULL
          SET n.embedding = null,
              n.embedding_name = null,
              n.embedding_content = null,
              n.embedding_description = null,
              n.embedding_hash = null,
              n._embeddingHash = null
          RETURN count(n) as clearedCount
        `,
        params: { projectId: project.id }
      });

      // Also delete EmbeddingChunk nodes for this project
      await callToolViaDaemon('run_cypher', {
        query: `
          MATCH (c:EmbeddingChunk {projectId: $projectId})
          DETACH DELETE c
        `,
        params: { projectId: project.id }
      });

      if (cypherResult.success) {
        const clearedCount = cypherResult.result?.records?.[0]?.clearedCount || 0;
        console.log(`✅ Removed embeddings from ${clearedCount} nodes`);
      } else {
        console.log(`✅ Embeddings removal attempted (may have partially succeeded)`);
      }

      console.log(`\n💡 Nodes are still in the database. Re-run ingestion to regenerate embeddings.`);
    } else if (options.all) {
      console.log(`\n⚠️  Removing ALL nodes and embeddings (full cleanup)...`);
      const confirmed = await confirmDeletion();
      if (!confirmed) {
        console.log(`❌ Cancelled.`);
        return;
      }

      // Use forget_path via daemon
      const forgetResult = await callToolViaDaemon('forget_path', {
        path: resolvedPath
      });

      if (forgetResult.success) {
        console.log(`✅ Project completely removed from brain.`);
      } else {
        console.error(`❌ Cleanup failed: ${forgetResult.error}`);
        process.exitCode = 1;
        return;
      }

      console.log(`💡 Re-run ingestion to re-index the project.`);
    }
  } catch (error: any) {
    console.error(`❌ Error during cleanup: ${error.message}`);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exitCode = 1;
  }
}

async function confirmDeletion(): Promise<boolean> {
  return new Promise((resolve) => {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    console.log(`\n⚠️  This will permanently delete all data for this project.`);
    console.log(`   Type 'yes' to confirm, or press Ctrl+C to cancel: `);

    process.stdin.once('data', (key: string) => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      const input = key.toString().trim().toLowerCase();
      resolve(input === 'yes' || input === 'y');
    });
  });
}

export function printCleanHelp(): void {
  console.log(`
Clean - Remove embeddings and/or all ingested data for a project

Usage:
  ragforge clean <project-path> [options]

Options:
  --embeddings-only    Remove only embeddings (keep nodes)
                       Default behavior if no option specified
  --all                Remove all nodes and embeddings (full cleanup)
                       Requires confirmation
  -h, --help          Show this help message

Examples:
  # Remove embeddings only (safer, allows re-generation)
  ragforge clean /path/to/project --embeddings-only

  # Remove everything (full cleanup)
  ragforge clean /path/to/project --all

  # Default: embeddings only
  ragforge clean /path/to/project

Notes:
  - After removing embeddings, re-run ingestion to regenerate them
  - After --all cleanup, the project must be re-ingested completely
  - Use 'ragforge list-projects' to see all registered projects
`);
}
