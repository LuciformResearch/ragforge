/**
 * RagForge Studio - Main Process
 */

import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { DockerManager } from './docker';
import { Neo4jManager } from './neo4j';
import * as daemonClient from './daemon-client';

const RAGFORGE_DIR = path.join(homedir(), '.ragforge');
const RAGFORGE_ENV_FILE = path.join(RAGFORGE_DIR, '.env');

let mainWindow: BrowserWindow | null = null;
const dockerManager = new DockerManager();
const neo4jManager = new Neo4jManager();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 15 },
  });

  // Load renderer
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    // mainWindow.webContents.openDevTools(); // Uncomment to auto-open devtools
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// App lifecycle
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// ========== IPC Handlers ==========

// Docker
ipcMain.handle('docker:check', async () => {
  return dockerManager.checkDocker();
});

ipcMain.handle('docker:open-download', async () => {
  const url = process.platform === 'darwin'
    ? 'https://www.docker.com/products/docker-desktop/'
    : process.platform === 'win32'
    ? 'https://www.docker.com/products/docker-desktop/'
    : 'https://docs.docker.com/engine/install/';
  shell.openExternal(url);
});

// Neo4j Container
ipcMain.handle('neo4j:status', async () => {
  return dockerManager.getNeo4jStatus();
});

ipcMain.handle('neo4j:pull', async () => {
  return dockerManager.pullNeo4jImage((progress) => {
    mainWindow?.webContents.send('neo4j:pull-progress', progress);
  });
});

ipcMain.handle('neo4j:start', async () => {
  return dockerManager.startNeo4j();
});

ipcMain.handle('neo4j:stop', async () => {
  return dockerManager.stopNeo4j();
});

ipcMain.handle('neo4j:logs', async () => {
  return dockerManager.getNeo4jLogs();
});

// Neo4j Database
ipcMain.handle('neo4j:connect', async () => {
  return neo4jManager.connect();
});

ipcMain.handle('neo4j:query', async (_event, cypher: string, params?: Record<string, unknown>) => {
  return neo4jManager.query(cypher, params);
});

ipcMain.handle('neo4j:get-projects', async () => {
  return neo4jManager.getProjects();
});

ipcMain.handle('neo4j:get-stats', async () => {
  return neo4jManager.getStats();
});

ipcMain.handle('neo4j:get-graph', async (_event, cypher: string, limit: number = 100) => {
  return neo4jManager.getGraphData(cypher, limit);
});

// Explore node relationships with depth
ipcMain.handle('neo4j:explore-node', async (_event, uuid: string, depth: number = 1) => {
  // Get all relationships from/to this node up to specified depth
  // Use string interpolation for uuid since getGraphData doesn't support params
  const escapedUuid = uuid.replace(/'/g, "\\'");
  const cypher = `
    MATCH path = (start {uuid: '${escapedUuid}'})-[*1..${depth}]-(connected)
    UNWIND relationships(path) as r
    WITH DISTINCT startNode(r) as n, r, endNode(r) as m
    RETURN n, r, m
  `;
  return neo4jManager.getGraphData(cypher, 500);
});

// Search nodes by text (simple text search on name/content properties)
ipcMain.handle('neo4j:search-nodes', async (_event, searchQuery: string, limit: number = 50) => {
  const escapedQuery = searchQuery.replace(/'/g, "\\'");
  const cypher = `
    MATCH (n)
    WHERE n.name CONTAINS '${escapedQuery}'
       OR n.title CONTAINS '${escapedQuery}'
       OR n.signature CONTAINS '${escapedQuery}'
       OR n.relativePath CONTAINS '${escapedQuery}'
    RETURN n
    LIMIT ${limit}
  `;
  return neo4jManager.getGraphData(cypher, limit);
});

// Get node with all its direct relationships
ipcMain.handle('neo4j:get-node-relations', async (_event, uuid: string, depth: number = 1) => {
  const escapedUuid = uuid.replace(/'/g, "\\'");
  // Build query based on depth
  const cypher = depth === 1
    ? `
      MATCH (n {uuid: '${escapedUuid}'})
      OPTIONAL MATCH (n)-[r]-(m)
      RETURN n, r, m
    `
    : `
      MATCH path = (n {uuid: '${escapedUuid}'})-[*1..${depth}]-(m)
      UNWIND relationships(path) as r
      WITH n, collect(DISTINCT r) as rels, collect(DISTINCT m) as nodes
      UNWIND rels as r
      WITH DISTINCT startNode(r) as sn, r, endNode(r) as en
      RETURN sn as n, r, en as m
    `;
  return neo4jManager.getGraphData(cypher, 500);
});

// Resolve EmbeddingChunk parents - get parent Scopes for a list of parentUuids
ipcMain.handle('neo4j:resolve-chunk-parents', async (_event, parentUuids: string[]) => {
  if (!parentUuids || parentUuids.length === 0) {
    return { parents: {} };
  }

  // Use parameterized query for safety
  const cypher = `
    MATCH (s:Scope)
    WHERE s.uuid IN $uuids
    RETURN s.uuid as uuid, s.name as name, s.type as type, s.signature as signature,
           s.file as file, s.startLine as startLine, s.endLine as endLine,
           s.docstring as docstring, s.source as source
  `;

  try {
    const results = await neo4jManager.query(cypher, { uuids: parentUuids });
    // Build a map of uuid -> parent data
    const parents: Record<string, any> = {};
    for (const record of results) {
      parents[record.uuid] = {
        uuid: record.uuid,
        name: record.name,
        type: record.type,
        signature: record.signature,
        file: record.file,
        startLine: record.startLine,
        endLine: record.endLine,
        docstring: record.docstring,
        source: record.source,
      };
    }
    return { parents };
  } catch (err) {
    console.error('Failed to resolve chunk parents:', err);
    return { parents: {}, error: String(err) };
  }
});

// Shell
ipcMain.handle('shell:open-external', async (_event, url: string) => {
  shell.openExternal(url);
});

// Config / API Keys
ipcMain.handle('config:get-api-key', async (_event, keyName: 'gemini' | 'replicate'): Promise<string | null> => {
  const envVarName = keyName === 'gemini' ? 'GEMINI_API_KEY' : 'REPLICATE_API_TOKEN';

  if (!existsSync(RAGFORGE_ENV_FILE)) {
    return null;
  }

  try {
    const content = readFileSync(RAGFORGE_ENV_FILE, 'utf-8');
    const match = content.match(new RegExp(`${envVarName}=(.+)`));
    if (match && match[1]) {
      const value = match[1].trim();
      // Don't return commented out keys or placeholder values
      if (value && !value.startsWith('#') && !value.includes('your_')) {
        return value;
      }
    }
  } catch {
    // File read error
  }
  return null;
});

ipcMain.handle('config:set-api-key', async (_event, keyName: 'gemini' | 'replicate', value: string): Promise<boolean> => {
  const envVarName = keyName === 'gemini' ? 'GEMINI_API_KEY' : 'REPLICATE_API_TOKEN';

  try {
    // Ensure directory exists
    if (!existsSync(RAGFORGE_DIR)) {
      mkdirSync(RAGFORGE_DIR, { recursive: true });
    }

    let content = '';
    if (existsSync(RAGFORGE_ENV_FILE)) {
      content = readFileSync(RAGFORGE_ENV_FILE, 'utf-8');
    }

    // Check if key already exists
    const regex = new RegExp(`^#?\\s*${envVarName}=.*$`, 'm');
    if (regex.test(content)) {
      // Replace existing key
      content = content.replace(regex, `${envVarName}=${value}`);
    } else {
      // Append new key
      if (content && !content.endsWith('\n')) {
        content += '\n';
      }
      content += `${envVarName}=${value}\n`;
    }

    writeFileSync(RAGFORGE_ENV_FILE, content, 'utf-8');
    return true;
  } catch (err) {
    console.error(`Failed to save API key ${keyName}:`, err);
    return false;
  }
});

// ========== Daemon API ==========
// Uses daemon-client which auto-starts daemon if needed

// Check daemon status (and start if not running)
ipcMain.handle('daemon:status', async () => {
  return daemonClient.getDaemonStatus();
});

// Ensure daemon is running (start if needed)
ipcMain.handle('daemon:ensure-running', async () => {
  return daemonClient.ensureDaemonRunning((msg) => {
    mainWindow?.webContents.send('daemon:progress', msg);
  });
});

// Start daemon explicitly
ipcMain.handle('daemon:start', async () => {
  return daemonClient.startDaemon((msg) => {
    mainWindow?.webContents.send('daemon:progress', msg);
  });
});

// Stop daemon
ipcMain.handle('daemon:stop', async () => {
  return daemonClient.stopDaemon();
});

// List available tools from daemon
ipcMain.handle('daemon:list-tools', async () => {
  return daemonClient.listDaemonTools();
});

// Call any daemon tool (auto-starts daemon if needed)
ipcMain.handle('daemon:call-tool', async (_event, toolName: string, params: Record<string, unknown>) => {
  return daemonClient.callDaemonTool(toolName, params);
});

// Brain search - convenience wrapper (auto-starts daemon if needed)
ipcMain.handle('daemon:brain-search', async (_event, query: string, options?: {
  semantic?: boolean;
  limit?: number;
  explore_depth?: number;
  boost_keywords?: string[];
  glob?: string;
  min_score?: number;
  fuzzy_distance?: 0 | 1 | 2;
}) => {
  const params = {
    query,
    semantic: options?.semantic ?? false, // Default to BM25 mode for Studio
    limit: options?.limit ?? 50,
    explore_depth: options?.explore_depth ?? 0,
    ...(options?.boost_keywords && { boost_keywords: options.boost_keywords }),
    ...(options?.glob && { glob: options.glob }),
    ...(options?.min_score && { min_score: options.min_score }),
    ...(options?.fuzzy_distance !== undefined && { fuzzy_distance: options.fuzzy_distance }),
  };

  return daemonClient.callDaemonTool('brain_search', params, { timeout: 30000 });
});
