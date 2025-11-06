import dotenv from 'dotenv';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

let envLoaded = false;
let cachedRoot: string | undefined;

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
export function ensureEnvLoaded(callerUrl: string): string {
  if (!envLoaded) {
    const cwdEnv = resolve(process.cwd(), '.env');
    const cwdEnvLocal = resolve(process.cwd(), '.env.local');

    if (existsSync(cwdEnv)) {
      dotenv.config({ path: cwdEnv });
    }
    if (existsSync(cwdEnvLocal)) {
      dotenv.config({ path: cwdEnvLocal });
    }

    const root = locateProjectRoot(callerUrl);

    dotenv.config({ path: resolve(root, '.env') });
    dotenv.config({ path: resolve(root, '.env.local') });

    if (process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.GOOGLE_APPLICATION_CREDENTIALS.startsWith('/')) {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = resolve(root, process.env.GOOGLE_APPLICATION_CREDENTIALS);
    }

    cachedRoot = root;
    envLoaded = true;
  }

  return cachedRoot!;
}

/**
 * Utility to read an environment variable using multiple fallbacks.
 */
export function getEnv(keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key];
    if (value) {
      return value;
    }
  }
  return undefined;
}
