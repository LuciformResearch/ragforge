/**
 * Preload script - Exposes IPC to renderer
 */

import { contextBridge, ipcRenderer } from 'electron';

export interface StudioAPI {
  // Docker
  docker: {
    check: () => Promise<{ installed: boolean; running: boolean; version?: string; error?: string }>;
    openDownload: () => Promise<void>;
  };

  // Neo4j Container
  neo4j: {
    status: () => Promise<{ exists: boolean; running: boolean; imageExists: boolean; ports?: { bolt: number; http: number }; error?: string }>;
    pull: () => Promise<boolean>;
    start: () => Promise<boolean>;
    stop: () => Promise<boolean>;
    logs: () => Promise<string>;
    onPullProgress: (callback: (progress: { status: string; progress?: string; percent?: number }) => void) => void;
  };

  // Neo4j Database
  db: {
    connect: () => Promise<boolean>;
    query: (cypher: string, params?: Record<string, unknown>) => Promise<any[]>;
    getProjects: () => Promise<any[]>;
    getStats: () => Promise<any>;
    getGraph: (cypher: string, limit?: number) => Promise<{ nodes: any[]; edges: any[] }>;
    exploreNode: (uuid: string, depth?: number) => Promise<{ nodes: any[]; edges: any[] }>;
    searchNodes: (query: string, limit?: number) => Promise<{ nodes: any[]; edges: any[] }>;
    getNodeRelations: (uuid: string, depth?: number) => Promise<{ nodes: any[]; edges: any[] }>;
    resolveChunkParents: (parentUuids: string[]) => Promise<{ parents: Record<string, any>; error?: string }>;
  };

  // Shell
  shell: {
    openExternal: (url: string) => Promise<void>;
  };

  // Config / API Keys
  config: {
    getApiKey: (keyName: 'gemini' | 'replicate') => Promise<string | null>;
    setApiKey: (keyName: 'gemini' | 'replicate', value: string) => Promise<boolean>;
  };

  // Daemon API (RagForge MCP Server - auto-starts if needed)
  daemon: {
    status: () => Promise<{ running: boolean; ready: boolean; status?: string; details?: any }>;
    ensureRunning: () => Promise<boolean>;
    start: () => Promise<boolean>;
    stop: () => Promise<boolean>;
    listTools: () => Promise<string[]>;
    callTool: (toolName: string, params: Record<string, unknown>) => Promise<{ success: boolean; result?: any; error?: string; duration_ms?: number }>;
    brainSearch: (query: string, options?: {
      semantic?: boolean;
      limit?: number;
      explore_depth?: number;
      boost_keywords?: string[];
      glob?: string;
      min_score?: number;
      fuzzy_distance?: 0 | 1 | 2;
    }) => Promise<{ success: boolean; result?: any; error?: string; duration_ms?: number }>;
    onProgress: (callback: (msg: string) => void) => void;
  };
}

const api: StudioAPI = {
  docker: {
    check: () => ipcRenderer.invoke('docker:check'),
    openDownload: () => ipcRenderer.invoke('docker:open-download'),
  },

  neo4j: {
    status: () => ipcRenderer.invoke('neo4j:status'),
    pull: () => ipcRenderer.invoke('neo4j:pull'),
    start: () => ipcRenderer.invoke('neo4j:start'),
    stop: () => ipcRenderer.invoke('neo4j:stop'),
    logs: () => ipcRenderer.invoke('neo4j:logs'),
    onPullProgress: (callback) => {
      ipcRenderer.on('neo4j:pull-progress', (_event, progress) => callback(progress));
    },
  },

  db: {
    connect: () => ipcRenderer.invoke('neo4j:connect'),
    query: (cypher, params) => ipcRenderer.invoke('neo4j:query', cypher, params),
    getProjects: () => ipcRenderer.invoke('neo4j:get-projects'),
    getStats: () => ipcRenderer.invoke('neo4j:get-stats'),
    getGraph: (cypher, limit) => ipcRenderer.invoke('neo4j:get-graph', cypher, limit),
    exploreNode: (uuid, depth) => ipcRenderer.invoke('neo4j:explore-node', uuid, depth),
    searchNodes: (query, limit) => ipcRenderer.invoke('neo4j:search-nodes', query, limit),
    getNodeRelations: (uuid, depth) => ipcRenderer.invoke('neo4j:get-node-relations', uuid, depth),
    resolveChunkParents: (parentUuids) => ipcRenderer.invoke('neo4j:resolve-chunk-parents', parentUuids),
  },

  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  },

  config: {
    getApiKey: (keyName) => ipcRenderer.invoke('config:get-api-key', keyName),
    setApiKey: (keyName, value) => ipcRenderer.invoke('config:set-api-key', keyName, value),
  },

  daemon: {
    status: () => ipcRenderer.invoke('daemon:status'),
    ensureRunning: () => ipcRenderer.invoke('daemon:ensure-running'),
    start: () => ipcRenderer.invoke('daemon:start'),
    stop: () => ipcRenderer.invoke('daemon:stop'),
    listTools: () => ipcRenderer.invoke('daemon:list-tools'),
    callTool: (toolName, params) => ipcRenderer.invoke('daemon:call-tool', toolName, params),
    brainSearch: (query, options) => ipcRenderer.invoke('daemon:brain-search', query, options),
    onProgress: (callback) => {
      ipcRenderer.on('daemon:progress', (_event, msg) => callback(msg));
    },
  },
};

contextBridge.exposeInMainWorld('studio', api);

declare global {
  interface Window {
    studio: StudioAPI;
  }
}
