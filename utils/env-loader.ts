/**
 * Environment Loader Utility
 *
 * Loads environment variables from LR_CodeRag root and fixes relative paths
 * for Google Cloud credentials when running from RagForge subdirectories
 */

import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

/**
 * Get the root directory of LR_CodeRag project
 */
export function getLRCodeRagRoot(currentFilePath: string): string {
  const currentDir = dirname(fileURLToPath(currentFilePath));

  // From ragforge/* -> go up one level
  // From ragforge/packages/* -> go up two levels
  // From ragforge/packages/*/src -> go up three levels

  let root = currentDir;

  // Keep going up until we find the root (contains .env)
  while (!existsSync(resolve(root, '.env'))) {
    const parent = resolve(root, '..');
    if (parent === root) {
      throw new Error('Could not find LR_CodeRag root directory (.env file not found)');
    }
    root = parent;
  }

  return root;
}

/**
 * Load environment variables from LR_CodeRag root and fix paths
 */
export function loadEnv(currentFilePath: string): void {
  const root = getLRCodeRagRoot(currentFilePath);

  console.log(`📁 LR_CodeRag root: ${root}`);

  // Load .env and .env.local
  dotenv.config({ path: resolve(root, '.env') });
  dotenv.config({ path: resolve(root, '.env.local') });

  // Fix GOOGLE_APPLICATION_CREDENTIALS path if it's relative
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const originalPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

    if (!originalPath.startsWith('/')) {
      const absolutePath = resolve(root, originalPath);
      process.env.GOOGLE_APPLICATION_CREDENTIALS = absolutePath;

      console.log(`🔧 Fixed GOOGLE_APPLICATION_CREDENTIALS:`);
      console.log(`   ${originalPath} → ${absolutePath}`);
    }
  }

  console.log();
}

/**
 * Verify required environment variables are set
 */
export function verifyEnv(requiredVars: string[]): void {
  const missing: string[] = [];

  for (const varName of requiredVars) {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  }

  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:');
    missing.forEach(v => console.error(`   - ${v}`));
    throw new Error('Environment setup incomplete');
  }

  console.log('✅ All required environment variables are set\n');
}
