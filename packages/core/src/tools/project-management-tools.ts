/**
 * Project Management Tools
 *
 * Tools for managing multiple projects:
 * - list_projects: Show all loaded projects
 * - switch_project: Change active project
 * - unload_project: Remove project from memory
 */

import type { ProjectRegistry, LoadedProject } from '../runtime/projects/index.js';
import type { GeneratedToolDefinition } from './types/index.js';

/**
 * Context for project management tools
 */
export interface ProjectManagementContext {
  registry: ProjectRegistry;
}

/**
 * Project summary returned by list_projects
 */
interface ProjectSummary {
  id: string;
  path: string;
  type: string;
  status: string;
  isActive: boolean;
  lastAccessed: string;
}

/**
 * Generate list_projects tool definition
 */
export function generateListProjectsTool(): GeneratedToolDefinition {
  return {
    name: 'list_projects',
    description: `List all currently loaded projects.

Shows:
- Project ID and path
- Project type (ragforge-project, quick-ingest, external)
- Status (active, background, unloading)
- Which project is currently active
- Last access time

Use this to see what projects are available before switching.`,
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  };
}

/**
 * Generate handler for list_projects
 */
export function generateListProjectsHandler(ctx: ProjectManagementContext) {
  return async (): Promise<{ projects: ProjectSummary[]; activeId: string | null; count: number }> => {
    const projects = ctx.registry.getAll().map((p): ProjectSummary => ({
      id: p.id,
      path: p.path,
      type: p.type,
      status: p.status,
      isActive: p.id === ctx.registry.activeId,
      lastAccessed: p.lastAccessed.toISOString(),
    }));

    return {
      projects,
      activeId: ctx.registry.activeId,
      count: projects.length,
    };
  };
}

/**
 * Generate switch_project tool definition
 */
export function generateSwitchProjectTool(registry: ProjectRegistry): GeneratedToolDefinition {
  const projectIds = registry.getAll().map(p => p.id);

  return {
    name: 'switch_project',
    description: `Switch the active project context.

All subsequent RAG queries and file operations will use the new active project.
The previous active project becomes a background project (still loaded, but not default).

Current projects: ${projectIds.length > 0 ? projectIds.join(', ') : '(none loaded)'}`,
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'ID of the project to switch to',
          enum: projectIds.length > 0 ? projectIds : undefined,
        },
      },
      required: ['project_id'],
    },
  };
}

/**
 * Generate handler for switch_project
 */
export function generateSwitchProjectHandler(ctx: ProjectManagementContext) {
  return async (params: { project_id: string }): Promise<{ success: boolean; message: string; activeProject?: ProjectSummary }> => {
    const { project_id } = params;

    const project = ctx.registry.get(project_id);
    if (!project) {
      const available = ctx.registry.getAll().map(p => p.id);
      return {
        success: false,
        message: `Project '${project_id}' not found. Available: ${available.join(', ') || '(none)'}`,
      };
    }

    const switched = ctx.registry.switch(project_id);
    if (!switched) {
      return {
        success: false,
        message: `Failed to switch to project '${project_id}'`,
      };
    }

    return {
      success: true,
      message: `Switched to project '${project_id}'`,
      activeProject: {
        id: project.id,
        path: project.path,
        type: project.type,
        status: 'active',
        isActive: true,
        lastAccessed: new Date().toISOString(),
      },
    };
  };
}

/**
 * Generate unload_project tool definition
 */
export function generateUnloadProjectTool(registry: ProjectRegistry): GeneratedToolDefinition {
  const projectIds = registry.getAll()
    .filter(p => p.id !== registry.activeId) // Can't unload active
    .map(p => p.id);

  return {
    name: 'unload_project',
    description: `Unload a project from memory.

This will:
- Stop the file watcher
- Close the Neo4j connection
- Free memory

Cannot unload the active project - switch to another first.

Unloadable projects: ${projectIds.length > 0 ? projectIds.join(', ') : '(none - only active project loaded)'}`,
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'ID of the project to unload',
          enum: projectIds.length > 0 ? projectIds : undefined,
        },
      },
      required: ['project_id'],
    },
  };
}

/**
 * Generate handler for unload_project
 */
export function generateUnloadProjectHandler(ctx: ProjectManagementContext) {
  return async (params: { project_id: string }): Promise<{ success: boolean; message: string; remainingProjects: number }> => {
    const { project_id } = params;

    // Can't unload active project
    if (project_id === ctx.registry.activeId) {
      return {
        success: false,
        message: `Cannot unload active project '${project_id}'. Switch to another project first.`,
        remainingProjects: ctx.registry.count,
      };
    }

    const project = ctx.registry.get(project_id);
    if (!project) {
      return {
        success: false,
        message: `Project '${project_id}' not found`,
        remainingProjects: ctx.registry.count,
      };
    }

    await ctx.registry.unload(project_id);

    return {
      success: true,
      message: `Unloaded project '${project_id}'`,
      remainingProjects: ctx.registry.count,
    };
  };
}

/**
 * Generate all project management tools
 */
export function generateProjectManagementTools(ctx: ProjectManagementContext): {
  tools: GeneratedToolDefinition[];
  handlers: Record<string, (params: any) => Promise<any>>;
} {
  const tools: GeneratedToolDefinition[] = [
    generateListProjectsTool(),
    generateSwitchProjectTool(ctx.registry),
    generateUnloadProjectTool(ctx.registry),
  ];

  const handlers: Record<string, (params: any) => Promise<any>> = {
    list_projects: generateListProjectsHandler(ctx),
    switch_project: generateSwitchProjectHandler(ctx),
    unload_project: generateUnloadProjectHandler(ctx),
  };

  return { tools, handlers };
}
