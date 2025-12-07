/**
 * Project Management Module
 *
 * Provides multi-project support for the agent:
 * - ProjectRegistry for loading/unloading projects
 * - Project tools (list, switch, unload)
 */

export {
  ProjectRegistry,
  type LoadedProject,
  type ProjectStatus,
  type ProjectType,
  type ProjectMemoryPolicy,
  type ProjectRegistryConfig,
} from './project-registry.js';
