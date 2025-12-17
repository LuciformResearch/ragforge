import dotenv from 'dotenv';
import { dirname, resolve, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync } from 'fs';

let envLoaded = false;
let cachedRoot: string | undefined;
let localEnvVars: Record<string, string> = {};

/**
 * Locate the LR_CodeRag project root by traversing upwards
 * from the given module URL until a .env file is found.
 */
function locateProjectRoot(startUrl: string): string {
  let currentDir = dirname(fileURLToPath(startUrl));

  while (!existsSync(resolve(currentDir, '.env'))) {
    const parent = resolve(currentDir, '..');
    if (parent === currentDir) {
      throw new Error('Unable to locate project root (missing .env file)');
    }
    currentDir = parent;
  }

  return currentDir;
}

/**
 * Load environment variables once per process.
 * Returns the detected project root for convenience.
 */
function parseEnvFile(filePath: string): Record<string, string> {
  const vars: Record<string, string> = {};
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = trimmed.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        let value = match[2].trim();
        // Remove quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        vars[key] = value;
      }
    }
  } catch {
    // File doesn't exist or can't be read
  }
  return vars;
}

export function ensureEnvLoaded(callerUrl: string): string {
  if (!envLoaded) {
    const cwd = process.cwd();
    const cwdEnv = resolve(cwd, '.env');
    const cwdEnvLocal = resolve(cwd, '.env.local');

    let root: string = cwd;

    // Parse local .env files to track which vars come from local files
    localEnvVars = { ...parseEnvFile(cwdEnv), ...parseEnvFile(cwdEnvLocal) };

    // Load from current working directory
    if (existsSync(cwdEnv)) {
      dotenv.config({ path: cwdEnv, override: true });
    }

    // Always try to load .env.local if it exists (with higher priority)
    if (existsSync(cwdEnvLocal)) {
      dotenv.config({ path: cwdEnvLocal, override: true });
    }

    if (process.env.GOOGLE_APPLICATION_CREDENTIALS && !isAbsolute(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = resolve(root, process.env.GOOGLE_APPLICATION_CREDENTIALS);
    }

    cachedRoot = root;
    envLoaded = true;
  }

  return cachedRoot!;
}

/**
 * Utility to read an environment variable using multiple fallbacks.
 * For sensitive keys like GEMINI_API_KEY, only reads from local .env files.
 */
export function getEnv(keys: string[], localOnly: boolean = false): string | undefined {
  for (const key of keys) {
    if (localOnly) {
      // Only return if it's defined in local .env files
      const value = localEnvVars[key];
      if (value) {
        return value;
      }
    } else {
      const value = process.env[key];
      if (value) {
        return value;
      }
    }
  }
  return undefined;
}
