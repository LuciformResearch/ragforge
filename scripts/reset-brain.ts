#!/usr/bin/env npx tsx
/**
 * Reset Brain Script
 *
 * Completely resets the Neo4j database and optionally re-ingests a project.
 *
 * Usage:
 *   npx tsx scripts/reset-brain.ts                    # Just reset DB
 *   npx tsx scripts/reset-brain.ts --ingest packages  # Reset + ingest packages/
 */

import { execSync, spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const RAGFORGE_DIR = path.join(process.env.HOME || '', '.ragforge');
const DOCKER_COMPOSE = path.join(RAGFORGE_DIR, 'docker-compose.yml');

async function main() {
  const args = process.argv.slice(2);
  const ingestPath = args.includes('--ingest') ? args[args.indexOf('--ingest') + 1] : null;

  console.log('🧹 Reset Brain Script\n');

  // 1. Stop daemon if running
  console.log('1️⃣  Stopping daemon...');
  try {
    execSync('pkill -f "daemon.js start" || true', { stdio: 'inherit' });
    await sleep(1000);
  } catch (e) {
    // Ignore
  }
  console.log('   ✅ Daemon stopped\n');

  // 2. Stop and remove Neo4j container
  console.log('2️⃣  Stopping Neo4j container...');
  try {
    execSync('docker stop ragforge-brain-neo4j 2>/dev/null || true', { stdio: 'pipe' });
    execSync('docker rm ragforge-brain-neo4j 2>/dev/null || true', { stdio: 'pipe' });
  } catch (e) {
    // Ignore
  }
  console.log('   ✅ Container removed\n');

  // 3. Remove volumes
  console.log('3️⃣  Removing data volumes...');
  try {
    // Find volumes matching ragforge brain pattern
    const volumes = execSync('docker volume ls -q | grep ragforge.*brain || true', { encoding: 'utf-8' }).trim();
    if (volumes) {
      for (const vol of volumes.split('\n').filter(Boolean)) {
        execSync(`docker volume rm ${vol} 2>/dev/null || true`, { stdio: 'pipe' });
        console.log(`   Removed: ${vol}`);
      }
    }
  } catch (e) {
    // Ignore
  }
  console.log('   ✅ Volumes removed\n');

  // 4. Clear projects.yaml
  console.log('4️⃣  Clearing projects registry...');
  const projectsFile = path.join(RAGFORGE_DIR, 'projects.yaml');
  if (fs.existsSync(projectsFile)) {
    fs.writeFileSync(projectsFile, 'projects: []\n');
    console.log('   ✅ projects.yaml cleared\n');
  } else {
    console.log('   ⏭️  No projects.yaml found\n');
  }

  // 5. Start fresh Neo4j
  console.log('5️⃣  Starting fresh Neo4j...');
  if (fs.existsSync(DOCKER_COMPOSE)) {
    execSync(`cd ${RAGFORGE_DIR} && docker compose up -d`, { stdio: 'inherit' });
    console.log('   Waiting for Neo4j to be ready...');
    await waitForNeo4j();
    console.log('   ✅ Neo4j ready\n');
  } else {
    console.log('   ❌ docker-compose.yml not found at', DOCKER_COMPOSE);
    process.exit(1);
  }

  // 6. Optionally ingest
  if (ingestPath) {
    const absolutePath = path.resolve(ingestPath);
    console.log(`6️⃣  Ingesting ${absolutePath}...`);

    // Start daemon in background
    const daemon = spawn('npx', ['tsx', 'packages/cli/src/commands/daemon.ts', 'start'], {
      cwd: path.join(__dirname, '..'),
      detached: true,
      stdio: 'ignore'
    });
    daemon.unref();

    console.log('   Waiting for daemon to start...');
    await sleep(5000);

    // Trigger ingestion via MCP would require the daemon to be ready
    // For now, just inform the user
    console.log(`   ℹ️  Daemon started. Run ingestion manually or use MCP tools.`);
    console.log(`   Example: Use ingest_directory tool with path="${absolutePath}"\n`);
  }

  console.log('✅ Brain reset complete!\n');
}

async function waitForNeo4j(maxAttempts = 30): Promise<void> {
  // Read password from docker-compose.yml
  const composeContent = fs.readFileSync(DOCKER_COMPOSE, 'utf-8');
  const authMatch = composeContent.match(/NEO4J_AUTH:\s*neo4j\/(\S+)/);
  const password = authMatch ? authMatch[1] : 'ragforge123';

  for (let i = 0; i < maxAttempts; i++) {
    try {
      execSync(`docker exec ragforge-brain-neo4j cypher-shell -u neo4j -p "${password}" "RETURN 1" 2>/dev/null`, { stdio: 'pipe' });
      return;
    } catch (e) {
      await sleep(1000);
    }
  }
  throw new Error('Neo4j failed to start');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
