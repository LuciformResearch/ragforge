/**
 * Stop the daemon before build to prevent file conflicts
 */
import { existsSync, readFileSync, unlinkSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const pidPath = join(homedir(), '.ragforge', 'daemon.pid');

if (existsSync(pidPath)) {
  try {
    const pid = parseInt(readFileSync(pidPath, 'utf-8').trim(), 10);
    console.log(`Stopping daemon (PID: ${pid})...`);
    process.kill(pid, 'SIGTERM');
    unlinkSync(pidPath);
    console.log('Daemon stopped');
  } catch (err: any) {
    console.log(`Could not stop daemon: ${err.message}`);
    // Clean up stale PID file
    try {
      unlinkSync(pidPath);
    } catch {}
  }
} else {
  console.log('No daemon running');
}
