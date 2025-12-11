#!/usr/bin/env tsx
/**
 * Stop the RagForge daemon before build
 * This ensures the daemon restarts with the latest code after build
 */

const DEFAULT_PORT = 6969;

async function stopDaemon(): Promise<void> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000); // 2 second timeout

    const response = await fetch(`http://127.0.0.1:${DEFAULT_PORT}/shutdown`, {
      method: 'POST',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      console.log('🛑 Daemon shutdown initiated');
      // Wait a bit for graceful shutdown
      await new Promise(resolve => setTimeout(resolve, 500));
    } else {
      console.log('ℹ️  Daemon not responding (may not be running)');
    }
  } catch (error: any) {
    // Daemon is not running or not responding - that's fine
    if (error.name === 'AbortError') {
      console.log('ℹ️  Daemon shutdown timeout (may not be running)');
    } else if (error.code === 'ECONNREFUSED' || error.message?.includes('fetch')) {
      console.log('ℹ️  Daemon is not running');
    } else {
      console.log(`ℹ️  Could not stop daemon: ${error.message}`);
    }
  }
}

stopDaemon().catch(console.error);
