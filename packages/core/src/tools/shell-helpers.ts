/**
 * Shell Command Helpers
 *
 * Safe command execution with whitelist validation.
 * Used by shell-tools.ts for agent command execution.
 *
 * @since 2025-12-07
 */

import { spawn, execSync } from 'child_process';
import path from 'path';

// ============================================
// Types
// ============================================

export interface CommandResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  killed?: boolean;
  timedOut?: boolean;
}

export interface CommandValidation {
  allowed: boolean;
  reason?: string;
  dangerous?: boolean;
  requiresConfirmation?: boolean;
}

// ============================================
// Whitelist Configuration
// ============================================

/**
 * Commands that are always safe to run
 */
export const SAFE_COMMANDS: Record<string, true | string[]> = {
  // Package managers - safe subcommands
  npm: ['install', 'ci', 'run', 'test', 'build', 'lint', 'start', 'init', 'ls', 'list', 'outdated', 'audit', 'version', 'view', 'info', 'search', 'pack'],
  yarn: ['install', 'run', 'test', 'build', 'lint', 'start', 'init', 'list', 'outdated', 'info', 'why', 'pack'],
  pnpm: ['install', 'run', 'test', 'build', 'lint', 'start', 'init', 'list', 'outdated', 'why'],
  bun: ['install', 'run', 'test', 'build', 'init'],

  // Git - read-only and safe write commands
  git: ['status', 'diff', 'log', 'show', 'branch', 'remote', 'fetch', 'pull', 'add', 'commit', 'stash', 'tag', 'describe', 'rev-parse', 'ls-files', 'ls-tree', 'blame', 'shortlog'],

  // File inspection (read-only)
  ls: true,
  cat: true,
  head: true,
  tail: true,
  wc: true,
  file: true,
  stat: true,
  du: true,
  df: true,

  // Search
  find: true,
  grep: true,
  rg: true, // ripgrep
  ag: true, // silver searcher
  fd: true, // fd-find

  // Environment info
  pwd: true,
  which: true,
  whereis: true,
  echo: true,
  env: true,
  printenv: true,
  whoami: true,
  hostname: true,
  uname: true,
  date: true,

  // Build tools
  tsc: true,
  node: true,
  npx: true,
  tsx: true,
  ts_node: true,
  python: true,
  python3: true,
  pip: ['list', 'show', 'freeze', 'check'],
  pip3: ['list', 'show', 'freeze', 'check'],
  cargo: ['build', 'run', 'test', 'check', 'clippy', 'fmt', 'doc'],
  go: ['build', 'run', 'test', 'fmt', 'vet', 'mod'],
  make: true,
  cmake: true,

  // Linters / formatters
  eslint: true,
  prettier: true,
  biome: true,
  rustfmt: true,
  black: true,
  isort: true,
  flake8: true,
  mypy: true,
  pylint: true,

  // Test runners
  jest: true,
  vitest: true,
  mocha: true,
  pytest: true,
  playwright: true,
  cypress: true,

  // Docker (read-only)
  docker: ['ps', 'images', 'logs', 'inspect', 'stats', 'top', 'port', 'version', 'info'],

  // Misc utilities
  jq: true,
  yq: true,
  curl: true, // Careful - can be used for exfiltration, but needed for APIs
  wget: true,
  tree: true,
  realpath: true,
  basename: true,
  dirname: true,
};

/**
 * Patterns that indicate dangerous commands
 */
export const DANGEROUS_PATTERNS: RegExp[] = [
  // Destructive file operations
  /\brm\s+(-[rf]+\s+)*[\/~]/,           // rm with absolute/home paths
  /\brm\s+(-[rf]+\s+)*\.\./,            // rm with parent paths
  /\brm\s+-[rf]*\s*\*/,                 // rm with wildcards
  /\brmdir\b/,

  // Git destructive operations
  /\bgit\s+push\s+.*--force/,
  /\bgit\s+push\s+-f\b/,
  /\bgit\s+reset\s+--hard/,
  /\bgit\s+clean\s+-[fd]/,
  /\bgit\s+checkout\s+--\s+\./,

  // System operations
  /\bsudo\b/,
  /\bsu\b/,
  /\bchmod\s+777/,
  /\bchown\b/,
  /\bchgrp\b,/,
  /\bmkfs\b/,
  /\bdd\b/,
  /\bfdisk\b/,
  /\bparted\b/,

  // Network exfiltration patterns
  /curl.*\|.*sh/,
  /wget.*\|.*sh/,
  /curl.*\|.*bash/,
  /wget.*\|.*bash/,
  /\bcurl\b.*(-d|--data).*\$\(/,        // curl with command substitution in data

  // Process/system manipulation
  /\bkill\s+-9/,
  /\bkillall\b/,
  /\bpkill\b/,
  /\breboot\b/,
  /\bshutdown\b/,
  /\bhalt\b/,
  /\bpoweroff\b/,

  // Environment manipulation
  /\bexport\s+PATH=/,
  /\bunset\s+PATH/,
  /\bsource\s+\/etc/,
  /\b\.\s+\/etc/,

  // Dangerous redirects
  />\s*\/dev\//,
  />\s*\/etc\//,
  />\s*\/usr\//,
  />\s*\/bin\//,

  // Forkbomb patterns
  /:\(\)\s*\{\s*:\|:&\s*\};:/,
];

/**
 * Commands that need user confirmation
 */
export const CONFIRMATION_REQUIRED: RegExp[] = [
  /\bgit\s+push\b/,           // Any git push
  /\bgit\s+merge\b/,          // Git merge
  /\bgit\s+rebase\b/,         // Git rebase
  /\bnpm\s+publish\b/,        // npm publish
  /\byarn\s+publish\b/,       // yarn publish
  /\bdocker\s+build\b/,       // Docker build
  /\bdocker\s+push\b/,        // Docker push
  /\bdocker\s+run\b/,         // Docker run
  /\bdocker\s+exec\b/,        // Docker exec
  /\brm\s/,                   // Any rm command
  /\bmv\s/,                   // Any mv command
];

// ============================================
// Validation Functions
// ============================================

/**
 * Parse a command string to extract the base command and args
 */
export function parseCommand(command: string): { base: string; args: string[] } {
  // Remove leading/trailing whitespace
  const trimmed = command.trim();

  // Handle quoted strings and split by spaces
  const parts: string[] = [];
  let current = '';
  let inQuote: string | null = null;

  for (const char of trimmed) {
    if (inQuote) {
      if (char === inQuote) {
        inQuote = null;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      inQuote = char;
    } else if (char === ' ') {
      if (current) {
        parts.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }
  if (current) {
    parts.push(current);
  }

  const base = parts[0] || '';
  const args = parts.slice(1);

  return { base, args };
}

/**
 * Validate if a command is safe to run
 */
export function validateCommand(command: string): CommandValidation {
  // Check for dangerous patterns first
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return {
        allowed: false,
        dangerous: true,
        reason: `Command matches dangerous pattern: ${pattern.source}`,
      };
    }
  }

  // Check if confirmation is required
  for (const pattern of CONFIRMATION_REQUIRED) {
    if (pattern.test(command)) {
      return {
        allowed: true,
        requiresConfirmation: true,
        reason: `Command requires user confirmation: ${pattern.source}`,
      };
    }
  }

  // Parse and check whitelist
  const { base, args } = parseCommand(command);

  // Handle piped commands - validate each part
  if (command.includes('|')) {
    const parts = command.split('|').map(p => p.trim());
    for (const part of parts) {
      const validation = validateCommand(part);
      if (!validation.allowed) {
        return validation;
      }
      if (validation.requiresConfirmation) {
        return validation;
      }
    }
    return { allowed: true };
  }

  // Handle && and ; chained commands
  if (command.includes('&&') || command.includes(';')) {
    const parts = command.split(/&&|;/).map(p => p.trim()).filter(Boolean);
    for (const part of parts) {
      const validation = validateCommand(part);
      if (!validation.allowed) {
        return validation;
      }
      if (validation.requiresConfirmation) {
        return validation;
      }
    }
    return { allowed: true };
  }

  // Check if command is in whitelist
  const whitelistEntry = SAFE_COMMANDS[base];

  if (whitelistEntry === true) {
    // Command is fully whitelisted
    return { allowed: true };
  }

  if (Array.isArray(whitelistEntry)) {
    // Command has specific allowed subcommands
    const subcommand = args[0];
    if (subcommand && whitelistEntry.includes(subcommand)) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: `Subcommand '${subcommand || '(none)'}' not in whitelist for '${base}'. Allowed: ${whitelistEntry.join(', ')}`,
    };
  }

  // Command not in whitelist
  return {
    allowed: false,
    reason: `Command '${base}' is not in the whitelist. Use a whitelisted command or ask user for confirmation.`,
  };
}

// ============================================
// Execution Functions
// ============================================

/**
 * Execute a command and return the result
 */
export async function executeCommand(
  command: string,
  options: {
    cwd?: string;
    timeout?: number;
    env?: Record<string, string>;
  } = {}
): Promise<CommandResult> {
  const { cwd = process.cwd(), timeout = 60000, env } = options;

  const startTime = Date.now();

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let killed = false;
    let timedOut = false;

    // Use shell to execute (allows pipes, etc.)
    const child = spawn(command, [], {
      cwd,
      shell: true,
      env: { ...process.env, ...env },
    });

    // Set timeout
    const timer = setTimeout(() => {
      timedOut = true;
      killed = true;
      child.kill('SIGTERM');
    }, timeout);

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        command,
        exitCode: 1,
        stdout,
        stderr: stderr + '\n' + err.message,
        durationMs: Date.now() - startTime,
        killed,
        timedOut,
      });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        command,
        exitCode: code ?? 1,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        durationMs: Date.now() - startTime,
        killed,
        timedOut,
      });
    });
  });
}

/**
 * Execute a command synchronously (for quick commands)
 */
export function executeCommandSync(
  command: string,
  options: {
    cwd?: string;
    timeout?: number;
    env?: Record<string, string>;
  } = {}
): CommandResult {
  const { cwd = process.cwd(), timeout = 30000, env } = options;

  const startTime = Date.now();

  try {
    const result = execSync(command, {
      cwd,
      timeout,
      env: { ...process.env, ...env },
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return {
      command,
      exitCode: 0,
      stdout: result.trim(),
      stderr: '',
      durationMs: Date.now() - startTime,
    };
  } catch (err: any) {
    return {
      command,
      exitCode: err.status ?? 1,
      stdout: err.stdout?.toString().trim() ?? '',
      stderr: err.stderr?.toString().trim() ?? err.message,
      durationMs: Date.now() - startTime,
      timedOut: err.killed,
    };
  }
}

/**
 * Get list of available safe commands (for agent info)
 */
export function getSafeCommandsList(): string[] {
  return Object.keys(SAFE_COMMANDS).sort();
}
