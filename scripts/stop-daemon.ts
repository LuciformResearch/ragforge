#!/usr/bin/env tsx
/**
 * Stop the RagForge daemon before build
 * This ensures the daemon restarts with the latest code after build
 *
 * Tries two methods:
 * 1. PID file at ~/.ragforge/daemon.pid
 * 2. HTTP shutdown endpoint at http://127.0.0.1:6969/shutdown
 */

import { existsSync, readFileSync, unlinkSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const DEFAULT_PORT = 6969;
const pidPath = join(homedir(), '.ragforge', 'daemon.pid');

async function stopDaemon(): Promise<void> {
  let stopped = false;

  // Method 1: Try PID file
  if (existsSync(pidPath)) {
    try {
      const pid = parseInt(readFileSync(pidPath, 'utf-8').trim(), 10);
      console.log(`Stopping daemon via PID file (PID: ${pid})...`);
      process.kill(pid, 'SIGTERM');
      unlinkSync(pidPath);
      console.log('🛑 Daemon stopped via PID');
      stopped = true;
    } catch (err: any) {
      console.log(`Could not stop via PID: ${err.message}`);
      // Clean up stale PID file
      try {
        unlinkSync(pidPath);
      } catch {}
    }
  }

  // Method 2: Try HTTP shutdown endpoint (for MCP server daemon)
  if (!stopped) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000); // 2 second timeout

      const response = await fetch(`http://127.0.0.1:${DEFAULT_PORT}/shutdown`, {
        method: 'POST',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        console.log('🛑 Daemon shutdown initiated via HTTP');
        // Wait a bit for graceful shutdown
        await new Promise(resolve => setTimeout(resolve, 500));
        stopped = true;
      } else {
        console.log('ℹ️  Daemon HTTP endpoint not responding');
      }
    } catch (error: any) {
      // Daemon is not running or not responding - that's fine
      if (error.name === 'AbortError') {
        console.log('ℹ️  Daemon shutdown timeout (may not be running)');
      } else if (error.code === 'ECONNREFUSED' || error.message?.includes('fetch')) {
        console.log('ℹ️  Daemon is not running');
      } else {
        console.log(`ℹ️  Could not stop daemon via HTTP: ${error.message}`);
      }
    }
  }

  if (!stopped) {
    console.log('ℹ️  No daemon was running');
  }
}

stopDaemon().catch(console.error);
