import { exec, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { platform, homedir } from 'os';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';

const execAsync = promisify(exec);

export interface DockerStatus {
  installed: boolean;
  running: boolean;
  version?: string;
  error?: string;
}

export interface Neo4jStatus {
  containerExists: boolean;
  running: boolean;
  port?: number;
  boltUrl?: string;
}

const NEO4J_CONTAINER_NAME = 'ragforge-brain-neo4j';
const NEO4J_IMAGE = 'neo4j:5.23-community';
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

export class DockerManager {
  async checkDocker(): Promise<DockerStatus> {
    try {
      const { stdout } = await execAsync('docker --version');
      const version = stdout.trim();

      // Check if Docker daemon is running
      try {
        await execAsync('docker info');
        return { installed: true, running: true, version };
      } catch {
        return { installed: true, running: false, version, error: 'Docker daemon is not running' };
      }
    } catch {
      return {
        installed: false,
        running: false,
        error: 'Docker is not installed'
      };
    }
  }

  getDockerInstallInstructions(): string {
    const os = platform();
    switch (os) {
      case 'darwin':
        return `
Install Docker on macOS:

  Option 1 - Docker Desktop (recommended):
    1. Download from: https://www.docker.com/products/docker-desktop
    2. Open the downloaded .dmg file
    3. Drag Docker to Applications
    4. Open Docker from Applications

  Option 2 - Homebrew:
    brew install --cask docker
`;
      case 'win32':
        return `
Install Docker on Windows:

  1. Download Docker Desktop from: https://www.docker.com/products/docker-desktop
  2. Run the installer
  3. Follow the setup wizard (WSL 2 will be configured automatically)
  4. Restart your computer if prompted
  5. Open Docker Desktop
`;
      case 'linux':
        return `
Install Docker on Linux:

  Quick install (Ubuntu/Debian/Fedora/Arch):
    curl -fsSL https://get.docker.com | sh
    sudo usermod -aG docker $USER
    # Log out and back in for group changes to take effect

  Then start Docker:
    sudo systemctl start docker
    sudo systemctl enable docker
`;
      default:
        return 'Please visit https://docs.docker.com/get-docker/ for installation instructions.';
    }
  }

  async checkNeo4j(): Promise<Neo4jStatus> {
    try {
      const { stdout } = await execAsync(`docker ps -a --filter "name=${NEO4J_CONTAINER_NAME}" --format "{{.Status}}"`);
      const status = stdout.trim();

      if (!status) {
        return { containerExists: false, running: false };
      }

      const running = status.toLowerCase().startsWith('up');
      return {
        containerExists: true,
        running,
        port: NEO4J_BOLT_PORT,
        boltUrl: `bolt://localhost:${NEO4J_BOLT_PORT}`,
      };
    } catch {
      return { containerExists: false, running: false };
    }
  }

  async pullNeo4jImage(onProgress?: (msg: string) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const pull = spawn('docker', ['pull', NEO4J_IMAGE]);

      pull.stdout.on('data', (data) => {
        onProgress?.(data.toString().trim());
      });

      pull.stderr.on('data', (data) => {
        onProgress?.(data.toString().trim());
      });

      pull.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Failed to pull Neo4j image (exit code ${code})`));
        }
      });
    });
  }

  async createNeo4jContainer(password?: string): Promise<void> {
    const neo4jPassword = password || getOrCreatePassword();
    const args = [
      'run', '-d',
      '--name', NEO4J_CONTAINER_NAME,
      '-p', `${NEO4J_BOLT_PORT}:7687`,
      '-p', `${NEO4J_HTTP_PORT}:7474`,
      '-e', `NEO4J_AUTH=neo4j/${neo4jPassword}`,
      '-e', 'NEO4J_PLUGINS=["apoc", "graph-data-science"]',
      '-e', 'NEO4J_dbms_security_procedures_unrestricted=apoc.*,gds.*',
      '--restart', 'unless-stopped',
      NEO4J_IMAGE,
    ];

    try {
      await execAsync(`docker ${args.join(' ')}`);
    } catch (err: any) {
      throw new Error(`Failed to create Neo4j container: ${err.message}`);
    }
  }

  async startNeo4j(): Promise<void> {
    try {
      await execAsync(`docker start ${NEO4J_CONTAINER_NAME}`);
    } catch (err: any) {
      throw new Error(`Failed to start Neo4j: ${err.message}`);
    }
  }

  async stopNeo4j(): Promise<void> {
    try {
      await execAsync(`docker stop ${NEO4J_CONTAINER_NAME}`);
    } catch (err: any) {
      throw new Error(`Failed to stop Neo4j: ${err.message}`);
    }
  }

  async removeNeo4jContainer(): Promise<void> {
    try {
      await execAsync(`docker rm -f ${NEO4J_CONTAINER_NAME}`);
    } catch (err: any) {
      throw new Error(`Failed to remove Neo4j container: ${err.message}`);
    }
  }

  async waitForNeo4jReady(maxAttempts: number = 30, intervalMs: number = 2000): Promise<boolean> {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        // Check if Neo4j HTTP endpoint responds
        const { stdout } = await execAsync(
          `docker exec ${NEO4J_CONTAINER_NAME} curl -s -o /dev/null -w "%{http_code}" http://localhost:7474 2>/dev/null || echo "000"`
        );
        if (stdout.trim() === '200') {
          return true;
        }
      } catch {
        // Neo4j not ready yet
      }
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    return false;
  }

  async ensureNeo4jRunning(onProgress?: (msg: string) => void): Promise<{ boltUrl: string; password: string }> {
    const password = getOrCreatePassword();

    // Check Docker first
    const dockerStatus = await this.checkDocker();
    if (!dockerStatus.installed) {
      throw new Error('DOCKER_NOT_INSTALLED');
    }
    if (!dockerStatus.running) {
      throw new Error('DOCKER_NOT_RUNNING');
    }

    // Check Neo4j container
    const neo4jStatus = await this.checkNeo4j();

    if (!neo4jStatus.containerExists) {
      onProgress?.('Pulling Neo4j image...');
      await this.pullNeo4jImage(onProgress);

      onProgress?.('Creating Neo4j container...');
      await this.createNeo4jContainer(password);
    } else if (!neo4jStatus.running) {
      onProgress?.('Starting Neo4j...');
      await this.startNeo4j();
    } else {
      onProgress?.('Neo4j is already running');
    }

    onProgress?.('Waiting for Neo4j to be ready...');
    const ready = await this.waitForNeo4jReady();
    if (!ready) {
      throw new Error('Neo4j failed to start within timeout');
    }

    return {
      boltUrl: `bolt://localhost:${NEO4J_BOLT_PORT}`,
      password,
    };
  }

  getNeo4jConnectionInfo(): { boltUrl: string; username: string; password: string } {
    return {
      boltUrl: `bolt://localhost:${NEO4J_BOLT_PORT}`,
      username: 'neo4j',
      password: getOrCreatePassword(),
    };
  }
}

export const dockerManager = new DockerManager();
