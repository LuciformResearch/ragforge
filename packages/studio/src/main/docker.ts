/**
 * Docker Manager - Manages Docker and Neo4j container
 */

import Docker from 'dockerode';
import { homedir } from 'os';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';

const NEO4J_IMAGE = 'neo4j:5.23-community';
const NEO4J_CONTAINER_NAME = 'ragforge-brain-neo4j';
const NEO4J_DATA_VOLUME = 'ragforge_brain_data';
const NEO4J_BOLT_PORT = 7687;
const NEO4J_HTTP_PORT = 7474;
const RAGFORGE_DIR = join(homedir(), '.ragforge');
const RAGFORGE_ENV_FILE = join(RAGFORGE_DIR, '.env');

/**
 * Generate a random 16-character password
 */
function generatePassword(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let password = '';
  const bytes = randomBytes(16);
  for (let i = 0; i < 16; i++) {
    password += chars.charAt(bytes[i] % chars.length);
  }
  return password;
}

/**
 * Get Neo4j password from ~/.ragforge/.env or generate a new one
 */
function getOrCreatePassword(): string {
  // Try to read existing password from .env
  if (existsSync(RAGFORGE_ENV_FILE)) {
    try {
      const envContent = readFileSync(RAGFORGE_ENV_FILE, 'utf-8');
      const match = envContent.match(/NEO4J_PASSWORD=(.+)/);
      if (match && match[1]) {
        return match[1].trim();
      }
    } catch {
      // Fall through to generate new password
    }
  }

  // Generate new password and save to .env
  const password = generatePassword();

  // Ensure ~/.ragforge directory exists
  if (!existsSync(RAGFORGE_DIR)) {
    mkdirSync(RAGFORGE_DIR, { recursive: true });
  }

  // Create or update .env file
  const envContent = `# RagForge Neo4j Configuration
NEO4J_URI=bolt://localhost:${NEO4J_BOLT_PORT}
NEO4J_DATABASE=neo4j
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=${password}

# API Keys (add your keys here)
# GEMINI_API_KEY=your_key_here
# REPLICATE_API_TOKEN=your_token_here
`;

  writeFileSync(RAGFORGE_ENV_FILE, envContent, 'utf-8');
  return password;
}

// ============ DEBUG MODE ============
// Set to true to simulate different states for testing the Setup Wizard
const DEBUG_MODE = false;
const DEBUG_STATE = {
  dockerInstalled: false,    // false = Docker pas installé
  dockerRunning: false,      // false = Docker installé mais pas lancé
  neo4jImageExists: false,   // false = Image pas téléchargée
  neo4jContainerExists: false,
  neo4jContainerRunning: false,
};
// ====================================

export interface DockerStatus {
  installed: boolean;
  running: boolean;
  version?: string;
  error?: string;
}

export interface Neo4jContainerStatus {
  exists: boolean;
  running: boolean;
  imageExists: boolean;
  ports?: { bolt: number; http: number };
  error?: string;
}

export interface PullProgress {
  status: string;
  progress?: string;
  percent?: number;
}

export class DockerManager {
  private docker: Docker | null = null;

  constructor() {
    try {
      this.docker = new Docker();
    } catch (err) {
      console.error('Failed to initialize Docker client:', err);
    }
  }

  /**
   * Check if Docker is installed and running
   */
  async checkDocker(): Promise<DockerStatus> {
    // DEBUG MODE
    if (DEBUG_MODE) {
      console.log('[DEBUG] checkDocker - simulating:', DEBUG_STATE);
      if (!DEBUG_STATE.dockerInstalled) {
        return { installed: false, running: false, error: 'Docker is not installed.' };
      }
      if (!DEBUG_STATE.dockerRunning) {
        return { installed: true, running: false, error: 'Docker is not running. Please start Docker Desktop.' };
      }
      return { installed: true, running: true, version: '27.0.0 (debug)' };
    }

    if (!this.docker) {
      return { installed: false, running: false, error: 'Docker client not initialized' };
    }

    try {
      const info = await this.docker.version();
      return {
        installed: true,
        running: true,
        version: info.Version,
      };
    } catch (err: any) {
      // Check if Docker is installed but not running
      if (err.code === 'ECONNREFUSED' || err.code === 'ENOENT') {
        return {
          installed: err.code !== 'ENOENT',
          running: false,
          error: 'Docker is not running. Please start Docker Desktop.',
        };
      }
      return {
        installed: false,
        running: false,
        error: err.message,
      };
    }
  }

  /**
   * Get Neo4j container status
   */
  async getNeo4jStatus(): Promise<Neo4jContainerStatus> {
    // DEBUG MODE
    if (DEBUG_MODE) {
      console.log('[DEBUG] getNeo4jStatus - simulating:', DEBUG_STATE);
      return {
        exists: DEBUG_STATE.neo4jContainerExists,
        running: DEBUG_STATE.neo4jContainerRunning,
        imageExists: DEBUG_STATE.neo4jImageExists,
        ports: DEBUG_STATE.neo4jContainerRunning ? { bolt: 7687, http: 7474 } : undefined,
      };
    }

    if (!this.docker) {
      return { exists: false, running: false, imageExists: false, error: 'Docker not available' };
    }

    try {
      // Check if image exists
      let imageExists = false;
      try {
        await this.docker.getImage(NEO4J_IMAGE).inspect();
        imageExists = true;
      } catch {
        imageExists = false;
      }

      // Check container
      const containers = await this.docker.listContainers({ all: true });
      const neo4jContainer = containers.find(c =>
        c.Names.some(n => n === `/${NEO4J_CONTAINER_NAME}`)
      );

      if (!neo4jContainer) {
        return { exists: false, running: false, imageExists };
      }

      const isRunning = neo4jContainer.State === 'running';

      // Get port mappings
      let ports: { bolt: number; http: number } | undefined;
      if (neo4jContainer.Ports) {
        const boltPort = neo4jContainer.Ports.find(p => p.PrivatePort === 7687);
        const httpPort = neo4jContainer.Ports.find(p => p.PrivatePort === 7474);
        if (boltPort?.PublicPort && httpPort?.PublicPort) {
          ports = { bolt: boltPort.PublicPort, http: httpPort.PublicPort };
        }
      }

      return {
        exists: true,
        running: isRunning,
        imageExists,
        ports,
      };
    } catch (err: any) {
      return {
        exists: false,
        running: false,
        imageExists: false,
        error: err.message,
      };
    }
  }

  /**
   * Pull Neo4j image with progress callback
   */
  async pullNeo4jImage(onProgress?: (progress: PullProgress) => void): Promise<boolean> {
    // DEBUG MODE - simulate pull with fake progress
    if (DEBUG_MODE) {
      console.log('[DEBUG] pullNeo4jImage - simulating download');
      const steps = [
        'Pulling from library/neo4j',
        'Downloading layer 1/5',
        'Downloading layer 2/5',
        'Downloading layer 3/5',
        'Downloading layer 4/5',
        'Downloading layer 5/5',
        'Extracting',
        'Pull complete',
      ];
      for (let i = 0; i < steps.length; i++) {
        await new Promise(r => setTimeout(r, 500));
        onProgress?.({ status: steps[i], percent: Math.round((i / steps.length) * 100) });
      }
      DEBUG_STATE.neo4jImageExists = true;
      return true;
    }

    if (!this.docker) return false;

    try {
      const stream = await this.docker.pull(NEO4J_IMAGE);

      return new Promise((resolve, reject) => {
        this.docker!.modem.followProgress(
          stream,
          (err, output) => {
            if (err) {
              reject(err);
            } else {
              resolve(true);
            }
          },
          (event) => {
            if (onProgress) {
              onProgress({
                status: event.status || '',
                progress: event.progress,
                percent: event.progressDetail?.current && event.progressDetail?.total
                  ? Math.round((event.progressDetail.current / event.progressDetail.total) * 100)
                  : undefined,
              });
            }
          }
        );
      });
    } catch (err) {
      console.error('Failed to pull Neo4j image:', err);
      return false;
    }
  }

  /**
   * Start Neo4j container (create if doesn't exist)
   */
  async startNeo4j(): Promise<boolean> {
    // DEBUG MODE - simulate container start
    if (DEBUG_MODE) {
      console.log('[DEBUG] startNeo4j - simulating container start');
      await new Promise(r => setTimeout(r, 2000)); // Simulate startup time
      DEBUG_STATE.neo4jContainerExists = true;
      DEBUG_STATE.neo4jContainerRunning = true;
      return true;
    }

    if (!this.docker) return false;

    try {
      const status = await this.getNeo4jStatus();

      if (status.running) {
        return true; // Already running
      }

      if (status.exists) {
        // Container exists, just start it
        const container = this.docker.getContainer(NEO4J_CONTAINER_NAME);
        await container.start();
        return true;
      }

      // Create volume if doesn't exist
      try {
        await this.docker.createVolume({ Name: NEO4J_DATA_VOLUME });
      } catch {
        // Volume might already exist
      }

      // Create and start container
      const container = await this.docker.createContainer({
        name: NEO4J_CONTAINER_NAME,
        Image: NEO4J_IMAGE,
        Env: [
          `NEO4J_AUTH=neo4j/${getOrCreatePassword()}`,
          'NEO4J_PLUGINS=["apoc", "graph-data-science"]',
          'NEO4J_apoc_export_file_enabled=true',
          'NEO4J_apoc_import_file_enabled=true',
          'NEO4J_dbms_security_procedures_unrestricted=apoc.*,gds.*',
        ],
        HostConfig: {
          PortBindings: {
            '7474/tcp': [{ HostPort: '7474' }],
            '7687/tcp': [{ HostPort: '7687' }],
          },
          Binds: [
            `${NEO4J_DATA_VOLUME}:/data`,
          ],
          RestartPolicy: {
            Name: 'unless-stopped',
          },
        },
        ExposedPorts: {
          '7474/tcp': {},
          '7687/tcp': {},
        },
      });

      await container.start();
      return true;
    } catch (err) {
      console.error('Failed to start Neo4j:', err);
      return false;
    }
  }

  /**
   * Stop Neo4j container
   */
  async stopNeo4j(): Promise<boolean> {
    if (!this.docker) return false;

    try {
      const container = this.docker.getContainer(NEO4J_CONTAINER_NAME);
      await container.stop();
      return true;
    } catch (err) {
      console.error('Failed to stop Neo4j:', err);
      return false;
    }
  }

  /**
   * Get Neo4j container logs
   */
  async getNeo4jLogs(tail: number = 100): Promise<string> {
    if (!this.docker) return '';

    try {
      const container = this.docker.getContainer(NEO4J_CONTAINER_NAME);
      const logs = await container.logs({
        stdout: true,
        stderr: true,
        tail,
        timestamps: true,
      });
      return logs.toString();
    } catch (err) {
      console.error('Failed to get Neo4j logs:', err);
      return '';
    }
  }
}
