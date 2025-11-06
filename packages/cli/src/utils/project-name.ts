import path from 'path';
import { spawnSync } from 'child_process';

export interface ProjectNaming {
  project: string;
  outputDir: string;
}

async function resolveGitRepoName(cwd: string): Promise<string | undefined> {
  try {
    const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf-8'
    });

    if (result.status !== 0) {
      return undefined;
    }

    const root = result.stdout.trim();
    if (!root) {
      return undefined;
    }

    return path.basename(root);
  } catch {
    return undefined;
  }
}

export async function deriveProjectNaming(explicitProject?: string, explicitOut?: string): Promise<ProjectNaming> {
  const cwd = process.cwd();

  const gitName = await resolveGitRepoName(cwd);
  const folderName = path.basename(cwd);

  const project = explicitProject || gitName || folderName;
  const defaultOut = explicitOut || path.resolve(cwd, 'generated');
  const outputDir = explicitOut ? path.resolve(explicitOut) : defaultOut;

  return { project, outputDir };
}
