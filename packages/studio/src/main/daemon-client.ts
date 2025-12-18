/**
 * Daemon Client for RagForge Studio
 *
 * Handles communication with the RagForge daemon (MCP server).
 * Auto-starts the daemon if not running.
 */

import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { createServer } from 'net';

const DAEMON_PORT = 6969;
const DAEMON_URL = `http://127.0.0.1:${DAEMON_PORT}`;
const STARTUP_TIMEOUT_MS = 90000; // 90 seconds
const STARTUP_CHECK_INTERVAL_MS = 500;
const RAGFORGE_DIR = path.join(os.homedir(), '.ragforge');
const DAEMON_STARTUP_LOCK_FILE = path.join(RAGFORGE_DIR, 'daemon-startup.lock');

/**
 * Check if the daemon is running AND ready
 */
export async function isDaemonRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${DAEMON_URL}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    return response.ok; // 200 = ready
  } catch {
    return false;
  }
}

/**
 * Check if daemon is started (responding, even if not fully ready)
 */
export async function isDaemonStarted(): Promise<boolean> {
  try {
    const response = await fetch(`${DAEMON_URL}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    return true; // Any response = started
  } catch {
    return false;
  }
}

/**
 * Check if port is in use
 */
async function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve(true);
      } else {
        resolve(false);
      }
    });
    server.once('listening', () => {
      server.close();
      resolve(false);
    });
    server.listen(port);
  });
}

/**
 * Acquire startup lock to prevent parallel daemon starts
 */
async function acquireStartupLock(): Promise<boolean> {
  try {
    try {
      const stats = await fs.stat(DAEMON_STARTUP_LOCK_FILE);
      const age = Date.now() - stats.mtimeMs;
      if (age < 30000) {
        return false; // Lock is recent
      }
      await fs.unlink(DAEMON_STARTUP_LOCK_FILE);
    } catch {
      // Lock doesn't exist
    }
    await fs.writeFile(DAEMON_STARTUP_LOCK_FILE, `${process.pid}\n`, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Release startup lock
 */
async function releaseStartupLock(): Promise<void> {
  try {
    await fs.unlink(DAEMON_STARTUP_LOCK_FILE);
  } catch {
    // Ignore
  }
}

/**
 * Find the ragforge CLI executable
 */
async function findRagforgeCli(): Promise<string | null> {
  // Try multiple locations
  const possiblePaths = [
    // Global npm install
    'ragforge',
    // Local node_modules (monorepo)
    path.join(__dirname, '..', '..', '..', '..', 'cli', 'dist', 'esm', 'cli.js'),
    path.join(__dirname, '..', '..', '..', '..', 'cli', 'src', 'cli.ts'),
    // npx
    'npx ragforge',
  ];

  // Check if ragforge is in PATH
  try {
    const { execSync } = await import('child_process');
    execSync('which ragforge', { stdio: 'ignore' });
    return 'ragforge';
  } catch {
    // Not in PATH
  }

  // Check local paths
  for (const p of possiblePaths) {
    if (p.startsWith('/') || p.includes('..')) {
      try {
        await fs.access(p);
        return p;
      } catch {
        // Continue
      }
    }
  }

  return null;
}

/**
 * Start the daemon
 */
export async function startDaemon(onProgress?: (msg: string) => void): Promise<boolean> {
  // Check if already running
  if (await isDaemonRunning()) {
    onProgress?.('Daemon already running');
    return true;
  }

  // Check if starting
  if (await isDaemonStarted()) {
    onProgress?.('Daemon is starting, waiting...');
    const startTime = Date.now();
    while (Date.now() - startTime < STARTUP_TIMEOUT_MS) {
      await new Promise(r => setTimeout(r, STARTUP_CHECK_INTERVAL_MS));
      if (await isDaemonRunning()) {
        onProgress?.('Daemon ready');
        return true;
      }
    }
    return false;
  }

  // Check if port is in use
  if (await isPortInUse(DAEMON_PORT)) {
    onProgress?.('Port in use, waiting for daemon...');
    const startTime = Date.now();
    while (Date.now() - startTime < STARTUP_TIMEOUT_MS) {
      await new Promise(r => setTimeout(r, STARTUP_CHECK_INTERVAL_MS));
      if (await isDaemonRunning()) {
        return true;
      }
    }
    return false;
  }

  // Acquire lock
  const lockAcquired = await acquireStartupLock();
  if (!lockAcquired) {
    onProgress?.('Another process is starting the daemon, waiting...');
    const startTime = Date.now();
    while (Date.now() - startTime < STARTUP_TIMEOUT_MS) {
      await new Promise(r => setTimeout(r, STARTUP_CHECK_INTERVAL_MS));
      if (await isDaemonRunning()) {
        return true;
      }
    }
    return false;
  }

  try {
    onProgress?.('Starting daemon...');

    // Find ragforge CLI
    const cliPath = await findRagforgeCli();

    let command: string;
    let args: string[];

    if (cliPath === 'ragforge') {
      command = 'ragforge';
      args = ['daemon', 'start'];
    } else if (cliPath?.endsWith('.ts')) {
      command = 'npx';
      args = ['tsx', cliPath, 'daemon', 'start'];
    } else if (cliPath?.endsWith('.js')) {
      command = process.execPath;
      args = [cliPath, 'daemon', 'start'];
    } else {
      // Try npx as fallback
      command = 'npx';
      args = ['ragforge', 'daemon', 'start'];
    }

    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      shell: command === 'npx' || command === 'ragforge',
      env: { ...process.env },
    });
    child.unref();

    onProgress?.('Waiting for daemon to be ready...');

    // Wait for daemon to be ready
    const startTime = Date.now();
    while (Date.now() - startTime < STARTUP_TIMEOUT_MS) {
      await new Promise(r => setTimeout(r, STARTUP_CHECK_INTERVAL_MS));
      if (await isDaemonRunning()) {
        onProgress?.('Daemon ready');
        return true;
      }
    }

    onProgress?.('Timeout waiting for daemon');
    return false;
  } finally {
    await releaseStartupLock();
  }
}

/**
 * Ensure daemon is running, start if needed
 */
export async function ensureDaemonRunning(onProgress?: (msg: string) => void): Promise<boolean> {
  if (await isDaemonRunning()) {
    return true;
  }
  return startDaemon(onProgress);
}

/**
 * Call a tool via the daemon
 */
export async function callDaemonTool(
  toolName: string,
  params: Record<string, unknown>,
  options?: { timeout?: number }
): Promise<{ success: boolean; result?: any; error?: string; duration_ms?: number }> {
  const timeout = options?.timeout ?? 60000;

  // Ensure daemon is running
  const ready = await ensureDaemonRunning();
  if (!ready) {
    return { success: false, error: 'Failed to start daemon' };
  }

  try {
    const response = await fetch(`${DAEMON_URL}/tool/${toolName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(timeout),
    });

    if (response.ok) {
      return await response.json();
    }

    const errorText = await response.text();
    return { success: false, error: `HTTP ${response.status}: ${errorText}` };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

/**
 * Get daemon status
 */
export async function getDaemonStatus(): Promise<{
  running: boolean;
  ready: boolean;
  status?: string;
  details?: any;
}> {
  try {
    const healthResponse = await fetch(`${DAEMON_URL}/health`, {
      signal: AbortSignal.timeout(2000),
    });

    if (healthResponse.ok) {
      // Get detailed status
      try {
        const statusResponse = await fetch(`${DAEMON_URL}/status`, {
          signal: AbortSignal.timeout(5000),
        });
        if (statusResponse.ok) {
          const details = await statusResponse.json();
          return { running: true, ready: true, status: 'ready', details };
        }
      } catch {
        // Ignore
      }
      return { running: true, ready: true, status: 'ready' };
    } else if (healthResponse.status === 503) {
      return { running: true, ready: false, status: 'starting' };
    }
    return { running: false, ready: false };
  } catch {
    return { running: false, ready: false };
  }
}

/**
 * Stop the daemon
 */
export async function stopDaemon(): Promise<boolean> {
  try {
    const response = await fetch(`${DAEMON_URL}/shutdown`, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * List available tools from daemon
 */
export async function listDaemonTools(): Promise<string[]> {
  try {
    const ready = await ensureDaemonRunning();
    if (!ready) return [];

    const response = await fetch(`${DAEMON_URL}/tools`, {
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      const data = await response.json() as { tools?: string[] };
      return data.tools || [];
    }
    return [];
  } catch {
    return [];
  }
}

export { DAEMON_PORT, DAEMON_URL };
