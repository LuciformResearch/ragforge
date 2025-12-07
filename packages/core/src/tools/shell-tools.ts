/**
 * Shell Tools
 *
 * Agent tools for executing shell commands safely.
 * Uses shell-helpers.ts for validation and execution.
 *
 * @since 2025-12-07
 */

import type { GeneratedToolDefinition } from './types/index.js';
import * as shellHelpers from './shell-helpers.js';

// ============================================
// Types
// ============================================

export interface ShellToolsContext {
  /**
   * Project root directory (for cwd default)
   * Can be a string or a getter function for dynamic resolution
   */
  projectRoot: string | (() => string | null);

  /**
   * Callback for commands requiring confirmation
   * If not provided, confirmation-required commands will be blocked
   */
  onConfirmationRequired?: (command: string, reason: string) => Promise<boolean>;

  /**
   * Force skip validation (DANGEROUS - for testing only)
   */
  skipValidation?: boolean;
}

/**
 * Helper to resolve projectRoot from context
 */
function getProjectRoot(ctx: ShellToolsContext): string | null {
  if (typeof ctx.projectRoot === 'function') {
    return ctx.projectRoot();
  }
  return ctx.projectRoot;
}

// ============================================
// Tool Definitions
// ============================================

export function generateRunCommandTool(): GeneratedToolDefinition {
  return {
    name: 'run_command',
    description: `Execute a shell command in the project directory.

SECURITY: Only whitelisted commands are allowed:
- Package managers: npm, yarn, pnpm, bun (install, run, test, build, etc.)
- Git: status, diff, log, add, commit, fetch, pull, stash (NOT push --force, reset --hard)
- File inspection: ls, cat, head, tail, grep, find, tree
- Build tools: tsc, node, npx, python, cargo, go, make
- Linters: eslint, prettier, biome, rustfmt, black, pylint
- Test runners: jest, vitest, pytest, playwright

Some commands (git push, rm, mv) require confirmation if a confirmation handler is configured.
Dangerous commands (rm -rf, sudo, git push --force) are always blocked.

Parameters:
- command: Shell command to execute
- cwd: Working directory (default: project root)
- timeout: Max execution time in ms (default: 60000)

Example: run_command({ command: "npm run build" })
Example: run_command({ command: "git status" })
Example: run_command({ command: "ls -la src" })`,
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Shell command to execute',
        },
        cwd: {
          type: 'string',
          description: 'Working directory (default: project root)',
          optional: true,
        },
        timeout: {
          type: 'number',
          description: 'Max execution time in ms (default: 60000)',
          optional: true,
        },
      },
      required: ['command'],
    },
  };
}

export function generateRunNpmScriptTool(): GeneratedToolDefinition {
  return {
    name: 'run_npm_script',
    description: `Run an npm script from package.json.

Shortcut for "npm run <script>". Safer and simpler than run_command for npm scripts.

Parameters:
- script: Script name from package.json
- args: Additional arguments to pass to the script

Example: run_npm_script({ script: "build" })
Example: run_npm_script({ script: "test", args: "--coverage" })`,
    inputSchema: {
      type: 'object',
      properties: {
        script: {
          type: 'string',
          description: 'npm script name (from package.json scripts)',
        },
        args: {
          type: 'string',
          description: 'Additional arguments to pass to the script',
          optional: true,
        },
      },
      required: ['script'],
    },
  };
}

export function generateGitStatusTool(): GeneratedToolDefinition {
  return {
    name: 'git_status',
    description: `Get the current git status.

Returns: branch name, changed files, staged files, untracked files.

Example: git_status()`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  };
}

export function generateGitDiffTool(): GeneratedToolDefinition {
  return {
    name: 'git_diff',
    description: `Show git diff for changes.

Parameters:
- staged: Show staged changes only (default: false shows unstaged)
- file: Specific file to diff (optional)

Example: git_diff()
Example: git_diff({ staged: true })
Example: git_diff({ file: "src/index.ts" })`,
    inputSchema: {
      type: 'object',
      properties: {
        staged: {
          type: 'boolean',
          description: 'Show staged changes (default: false)',
          optional: true,
        },
        file: {
          type: 'string',
          description: 'Specific file to diff',
          optional: true,
        },
      },
    },
  };
}

export function generateListSafeCommandsTool(): GeneratedToolDefinition {
  return {
    name: 'list_safe_commands',
    description: `List all commands that are whitelisted for execution.

Returns the list of command names that can be used with run_command.

Example: list_safe_commands()`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  };
}

// ============================================
// Handler Generators
// ============================================

export function generateRunCommandHandler(ctx: ShellToolsContext) {
  return async (params: {
    command: string;
    cwd?: string;
    timeout?: number;
  }) => {
    const projectRoot = getProjectRoot(ctx);

    // Validate command
    if (!ctx.skipValidation) {
      const validation = shellHelpers.validateCommand(params.command);

      if (!validation.allowed) {
        return {
          error: 'Command not allowed',
          reason: validation.reason,
          dangerous: validation.dangerous,
          suggestion: validation.dangerous
            ? 'This command is blocked for safety. Use a safer alternative.'
            : 'Use a whitelisted command. Call list_safe_commands() to see available commands.',
        };
      }

      if (validation.requiresConfirmation) {
        if (ctx.onConfirmationRequired) {
          const confirmed = await ctx.onConfirmationRequired(params.command, validation.reason || 'Command requires confirmation');
          if (!confirmed) {
            return {
              error: 'Command cancelled',
              reason: 'User did not confirm execution',
              command: params.command,
            };
          }
        } else {
          return {
            error: 'Command requires confirmation',
            reason: validation.reason,
            command: params.command,
            suggestion: 'This command needs user confirmation but no confirmation handler is configured.',
          };
        }
      }
    }

    // Resolve cwd
    const cwd = params.cwd
      ? (require('path').isAbsolute(params.cwd) ? params.cwd : require('path').join(projectRoot || process.cwd(), params.cwd))
      : (projectRoot || process.cwd());

    // Execute command
    const result = await shellHelpers.executeCommand(params.command, {
      cwd,
      timeout: params.timeout || 60000,
    });

    return {
      command: result.command,
      exit_code: result.exitCode,
      success: result.exitCode === 0,
      stdout: result.stdout,
      stderr: result.stderr,
      duration_ms: result.durationMs,
      timed_out: result.timedOut,
    };
  };
}

export function generateRunNpmScriptHandler(ctx: ShellToolsContext) {
  return async (params: {
    script: string;
    args?: string;
  }) => {
    const projectRoot = getProjectRoot(ctx);
    if (!projectRoot) {
      return {
        error: 'No project loaded. Use create_project, setup_project, or load_project first.',
        suggestion: 'load_project',
      };
    }

    // Build command
    const command = params.args
      ? `npm run ${params.script} -- ${params.args}`
      : `npm run ${params.script}`;

    // Execute (npm run is always safe)
    const result = await shellHelpers.executeCommand(command, {
      cwd: projectRoot,
      timeout: 120000, // 2 min for npm scripts
    });

    return {
      script: params.script,
      command: result.command,
      exit_code: result.exitCode,
      success: result.exitCode === 0,
      stdout: result.stdout,
      stderr: result.stderr,
      duration_ms: result.durationMs,
      timed_out: result.timedOut,
    };
  };
}

export function generateGitStatusHandler(ctx: ShellToolsContext) {
  return async () => {
    const projectRoot = getProjectRoot(ctx);
    if (!projectRoot) {
      return {
        error: 'No project loaded. Use create_project, setup_project, or load_project first.',
        suggestion: 'load_project',
      };
    }

    // Get branch name
    const branchResult = shellHelpers.executeCommandSync('git branch --show-current', { cwd: projectRoot });

    // Get status
    const statusResult = shellHelpers.executeCommandSync('git status --porcelain', { cwd: projectRoot });

    if (branchResult.exitCode !== 0 && statusResult.exitCode !== 0) {
      return {
        error: 'Not a git repository or git not available',
        stderr: branchResult.stderr || statusResult.stderr,
      };
    }

    // Parse status
    const lines = statusResult.stdout.split('\n').filter(Boolean);
    const staged: string[] = [];
    const modified: string[] = [];
    const untracked: string[] = [];

    for (const line of lines) {
      const index = line[0];
      const worktree = line[1];
      const file = line.slice(3);

      if (index === '?' && worktree === '?') {
        untracked.push(file);
      } else if (index !== ' ' && index !== '?') {
        staged.push(file);
      }
      if (worktree !== ' ' && worktree !== '?') {
        modified.push(file);
      }
    }

    return {
      branch: branchResult.stdout || 'unknown',
      clean: lines.length === 0,
      staged,
      modified,
      untracked,
      total_changes: lines.length,
    };
  };
}

export function generateGitDiffHandler(ctx: ShellToolsContext) {
  return async (params: {
    staged?: boolean;
    file?: string;
  }) => {
    const projectRoot = getProjectRoot(ctx);
    if (!projectRoot) {
      return {
        error: 'No project loaded. Use create_project, setup_project, or load_project first.',
        suggestion: 'load_project',
      };
    }

    // Build command
    let command = 'git diff';
    if (params.staged) {
      command += ' --staged';
    }
    if (params.file) {
      command += ` -- ${params.file}`;
    }

    const result = shellHelpers.executeCommandSync(command, { cwd: projectRoot });

    if (result.exitCode !== 0) {
      return {
        error: 'Git diff failed',
        stderr: result.stderr,
      };
    }

    return {
      diff: result.stdout || '(no changes)',
      staged: params.staged || false,
      file: params.file,
    };
  };
}

export function generateListSafeCommandsHandler() {
  return async () => {
    const commands = shellHelpers.getSafeCommandsList();

    // Group by category
    const categories: Record<string, string[]> = {
      'Package Managers': ['npm', 'yarn', 'pnpm', 'bun'],
      'Version Control': ['git'],
      'File Inspection': ['ls', 'cat', 'head', 'tail', 'wc', 'file', 'stat', 'du', 'df', 'tree'],
      'Search': ['find', 'grep', 'rg', 'ag', 'fd'],
      'Environment': ['pwd', 'which', 'whereis', 'echo', 'env', 'printenv', 'whoami', 'hostname', 'uname', 'date'],
      'Build Tools': ['tsc', 'node', 'npx', 'tsx', 'ts_node', 'python', 'python3', 'pip', 'pip3', 'cargo', 'go', 'make', 'cmake'],
      'Linters/Formatters': ['eslint', 'prettier', 'biome', 'rustfmt', 'black', 'isort', 'flake8', 'mypy', 'pylint'],
      'Test Runners': ['jest', 'vitest', 'mocha', 'pytest', 'playwright', 'cypress'],
      'Containers': ['docker'],
      'Utilities': ['jq', 'yq', 'curl', 'wget', 'realpath', 'basename', 'dirname'],
    };

    return {
      total: commands.length,
      commands,
      categories,
    };
  };
}

// ============================================
// Export All Shell Tools
// ============================================

export interface ShellToolsResult {
  tools: GeneratedToolDefinition[];
  handlers: Record<string, (args: any) => Promise<any>>;
}

/**
 * Generate all shell tools with handlers
 */
export function generateShellTools(ctx: ShellToolsContext): ShellToolsResult {
  return {
    tools: [
      generateRunCommandTool(),
      generateRunNpmScriptTool(),
      generateGitStatusTool(),
      generateGitDiffTool(),
      generateListSafeCommandsTool(),
    ],
    handlers: {
      run_command: generateRunCommandHandler(ctx),
      run_npm_script: generateRunNpmScriptHandler(ctx),
      git_status: generateGitStatusHandler(ctx),
      git_diff: generateGitDiffHandler(ctx),
      list_safe_commands: generateListSafeCommandsHandler(),
    },
  };
}
