/**
 * Configuration Merger
 *
 * Merges user configuration with adapter-specific defaults.
 * RagForge is a generic meta-framework, so defaults are minimal at the base level
 * and comprehensive at the adapter level (e.g., code-typescript.yaml).
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import YAML from 'yaml';
import type { RagForgeConfig } from '../types/config.js';

export interface MergerOptions {
  preserveComments?: boolean;
  addComments?: boolean;
}

/**
 * Deep merge two objects, with user config taking precedence over defaults
 */
function deepMerge<T>(defaults: T, userConfig: Partial<T>): T {
  // Handle primitives and null
  if (userConfig === null || typeof userConfig !== 'object') {
    return userConfig as T;
  }
  if (defaults === null || typeof defaults !== 'object') {
    return userConfig as T;
  }

  // Handle arrays - user config replaces defaults entirely
  if (Array.isArray(defaults) && Array.isArray(userConfig)) {
    return userConfig as T;
  }
  if (Array.isArray(defaults) || Array.isArray(userConfig)) {
    return userConfig as T;
  }

  // Merge objects recursively
  const result: any = { ...defaults };

  for (const key in userConfig) {
    if (Object.prototype.hasOwnProperty.call(userConfig, key)) {
      const userValue = (userConfig as any)[key];
      const defaultValue = (defaults as any)[key];

      if (userValue === undefined) {
        continue; // Skip undefined values from user config
      }

      if (defaultValue !== undefined && typeof defaultValue === 'object' && typeof userValue === 'object' && !Array.isArray(userValue)) {
        // Recursively merge nested objects
        result[key] = deepMerge(defaultValue, userValue);
      } else {
        // User value takes precedence
        result[key] = userValue;
      }
    }
  }

  return result;
}

/**
 * Load YAML defaults file from the defaults directory
 */
async function loadYamlDefaults(filename: string): Promise<Partial<RagForgeConfig>> {
  try {
    // Get the current file's directory
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    // When built, we're in dist/esm/config/, and defaults are in dist/defaults/
    // Go up to dist/ then into defaults/
    const defaultsDir = path.resolve(currentDir, '../../defaults');
    const filePath = path.join(defaultsDir, filename);

    const content = await fs.readFile(filePath, 'utf-8');
    const parsed = YAML.parse(content);

    return parsed || {};
  } catch (error) {
    // If defaults file doesn't exist, return empty object
    if ((error as any).code === 'ENOENT') {
      console.warn(`⚠️  Defaults file not found: ${filename}, using empty defaults`);
      return {};
    }
    throw error;
  }
}

/**
 * Load defaults based on user configuration
 * 1. Load base.yaml (generic defaults)
 * 2. Load adapter-specific defaults (e.g., code-typescript.yaml)
 */
async function loadDefaultsForConfig(
  userConfig: Partial<RagForgeConfig>
): Promise<Partial<RagForgeConfig>> {
  let defaults: Partial<RagForgeConfig> = {};

  // 1. Load base defaults (intentionally minimal for meta-framework)
  const baseDefaults = await loadYamlDefaults('base.yaml');
  defaults = deepMerge(defaults, baseDefaults);

  // 2. Load adapter-specific defaults
  if (userConfig.source?.type === 'code') {
    const adapter = userConfig.source.adapter;
    const adapterDefaults = await loadYamlDefaults(`code-${adapter}.yaml`);
    defaults = deepMerge(defaults, adapterDefaults);
  }

  return defaults;
}

/**
 * Merge user configuration with defaults
 * User config takes precedence, defaults fill in missing values
 */
export async function mergeWithDefaults(
  userConfig: Partial<RagForgeConfig>,
  options: MergerOptions = { addComments: false }
): Promise<RagForgeConfig> {
  const defaults = await loadDefaultsForConfig(userConfig);
  const merged = deepMerge(defaults, userConfig);

  // Add neo4j config with env vars if missing (for quickstart)
  if (!merged.neo4j) {
    merged.neo4j = {
      uri: '${NEO4J_URI}',
      database: 'neo4j',
      username: '${NEO4J_USERNAME}',
      password: '${NEO4J_PASSWORD}'
    };
  }

  // Validation: ensure required fields exist after merge
  if (!merged.name) {
    throw new Error('Configuration must have a "name" field');
  }
  if (!merged.version) {
    throw new Error('Configuration must have a "version" field');
  }
  if (!merged.entities || merged.entities.length === 0) {
    throw new Error('Configuration must have at least one entity');
  }

  return merged as RagForgeConfig;
}
