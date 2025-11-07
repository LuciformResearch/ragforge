import { promises as fs } from 'fs';
import { spawn } from 'child_process';
import path from 'path';
import type { GeneratedCode } from '@luciformresearch/ragforge-core';

export async function prepareOutputDirectory(dir: string, force: boolean): Promise<void> {
  try {
    const stats = await fs.stat(dir);

    if (!stats.isDirectory()) {
      throw new Error(`Output path "${dir}" exists and is not a directory.`);
    }

    if (!force) {
      const files = await fs.readdir(dir);
      if (files.length > 0) {
        throw new Error(`Output directory "${dir}" is not empty. Use --force to overwrite.`);
      }
    }
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      await fs.mkdir(dir, { recursive: true });
      return;
    }
    throw error;
  }
}

export async function writeFileIfChanged(filePath: string, content: string): Promise<void> {
  try {
    const existing = await fs.readFile(filePath, 'utf-8');
    if (existing === content) {
      return;
    }
  } catch (error: any) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf-8');
}

export async function persistGeneratedArtifacts(
  outDir: string,
  generated: GeneratedCode,
  typesContent: string,
  rootDir: string,
  projectName: string
): Promise<void> {
  const queriesDir = path.join(outDir, 'queries');
  await fs.mkdir(queriesDir, { recursive: true });

  const mutationsDir = path.join(outDir, 'mutations');
  await fs.mkdir(mutationsDir, { recursive: true });

  await writeFileIfChanged(path.join(outDir, 'client.ts'), generated.client);
  await writeFileIfChanged(path.join(outDir, 'index.ts'), generated.index);
  await writeFileIfChanged(path.join(outDir, 'types.ts'), typesContent);
  await writeFileIfChanged(path.join(outDir, 'agent.ts'), generated.agent);
  await writeFileIfChanged(path.join(outDir, 'documentation.ts'), generated.agentDocumentation.module);

  const docsDir = path.join(outDir, 'docs');
  await fs.mkdir(docsDir, { recursive: true });
  await writeFileIfChanged(path.join(docsDir, 'agent-reference.md'), generated.agentDocumentation.markdown);
  await writeFileIfChanged(path.join(docsDir, 'client-reference.md'), generated.developerDocumentation.markdown);

  for (const [entity, code] of generated.queries.entries()) {
    await writeFileIfChanged(path.join(queriesDir, `${entity}.ts`), code);
  }

  for (const [entity, code] of generated.mutations.entries()) {
    await writeFileIfChanged(path.join(mutationsDir, `${entity}.ts`), code);
  }

  // Create scripts directory (always needed for rebuild-agent script)
  const scriptsDir = path.join(outDir, 'scripts');
  await fs.mkdir(scriptsDir, { recursive: true });

  if (generated.embeddings) {
    const embeddingsDir = path.join(outDir, 'embeddings');
    await fs.mkdir(embeddingsDir, { recursive: true });

    const loaderPath = path.join(embeddingsDir, 'load-config.ts');
    await writeFileIfChanged(loaderPath, generated.embeddings.loader);

    // Clean up legacy files
    const legacyFiles = [
      path.join(embeddingsDir, 'config.js'),
      path.join(embeddingsDir, 'load-config.js'),
      path.join(embeddingsDir, 'load-config.d.ts')
    ];
    for (const legacyPath of legacyFiles) {
      try {
        await fs.unlink(legacyPath);
      } catch (error: any) {
        if (error?.code !== 'ENOENT') {
          throw error;
        }
      }
    }
    await writeFileIfChanged(path.join(scriptsDir, 'create-vector-indexes.ts'), generated.embeddings.createIndexesScript);
    await writeFileIfChanged(path.join(scriptsDir, 'generate-embeddings.ts'), generated.embeddings.generateEmbeddingsScript);

    const legacyScriptFiles = [
      path.join(scriptsDir, 'create-vector-indexes.js'),
      path.join(scriptsDir, 'generate-embeddings.js')
    ];

    for (const legacyPath of legacyScriptFiles) {
      try {
        await fs.unlink(legacyPath);
      } catch (error: any) {
        if (error?.code !== 'ENOENT') {
          throw error;
        }
      }
    }
  }

  // Write rebuild-agent script
  await writeFileIfChanged(path.join(scriptsDir, 'rebuild-agent.ts'), generated.rebuildAgentScript);

  const isDevelopmentMode = await checkIfDevelopmentMode(rootDir);
  if (isDevelopmentMode) {
    await copyRuntimePackage(rootDir, outDir);
  }
  await writeGeneratedPackageJson(outDir, projectName, isDevelopmentMode, generated);
  await writeGeneratedTsconfig(outDir);
  await writeExampleScripts(outDir, generated, projectName);
  await writeGitIgnore(outDir);
  await writeLicense(outDir);
  await ensureLogsDirectory(outDir);
}

export async function installDependencies(projectDir: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const installer = spawn('npm', ['install', '--no-audit', '--no-fund'], {
      cwd: projectDir,
      stdio: 'inherit',
      env: {
        ...process.env,
        npm_config_cache: path.join(projectDir, '.npm-cache')
      }
    });

    installer.on('error', error => {
      reject(new Error(`Failed to launch npm install: ${error instanceof Error ? error.message : String(error)}`));
    });

    installer.on('exit', code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`npm install exited with code ${code}`));
      }
    });
  });
}

export interface ConnectionEnv {
  uri: string;
  username: string;
  password: string;
  database?: string;
}

export async function writeGeneratedEnv(outDir: string, connection: ConnectionEnv, geminiKey?: string): Promise<void> {
  const envLines = [
    `NEO4J_URI=${connection.uri}`,
    `NEO4J_USERNAME=${connection.username}`,
    `NEO4J_PASSWORD=${connection.password}`
  ];

  if (connection.database) {
    envLines.push(`NEO4J_DATABASE=${connection.database}`);
  }

  if (geminiKey) {
    envLines.push(`GEMINI_API_KEY=${geminiKey}`);
  }

  const envPath = path.join(outDir, '.env');
  await writeFileIfChanged(envPath, envLines.join('\n') + '\n');
}

async function checkIfDevelopmentMode(rootDir: string): Promise<boolean> {
  // Check if we're in a development environment (monorepo with packages/runtime)
  const candidates = [
    path.join(rootDir, 'packages/runtime'),
    path.join(rootDir, 'ragforge/packages/runtime')
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return true;
    } catch {
      continue;
    }
  }

  return false;
}

async function copyRuntimePackage(rootDir: string, targetDir: string): Promise<void> {
  const candidates = [
    path.join(rootDir, 'packages/runtime'),
    path.join(rootDir, 'ragforge/packages/runtime')
  ];

  const runtimeSource = await (async () => {
    for (const candidate of candidates) {
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        continue;
      }
    }
    throw new Error('Unable to locate @luciformresearch/ragforge-runtime package in the current workspace.');
  })();
  const runtimeDest = path.join(targetDir, 'packages/runtime');

  try {
    await fs.access(path.join(runtimeSource, 'dist', 'index.js'));
  } catch {
    throw new Error('Runtime package not built. Run `npm run build --workspace=@luciformresearch/ragforge-runtime` first.');
  }

  await fs.mkdir(path.join(targetDir, 'packages'), { recursive: true });
  await fs.rm(runtimeDest, { recursive: true, force: true });
  await fs.mkdir(runtimeDest, { recursive: true });

  await fs.cp(path.join(runtimeSource, 'dist'), path.join(runtimeDest, 'dist'), { recursive: true });

  const filesToCopy = ['package.json', 'README.md', 'LICENSE', 'LICENSE.md'];
  for (const file of filesToCopy) {
    const src = path.join(runtimeSource, file);
    try {
      await fs.copyFile(src, path.join(runtimeDest, file));
    } catch {
      // optional file not present
    }
  }

  await relaxRuntimePackageMetadata(runtimeDest);
}

async function writeGeneratedPackageJson(
  outDir: string,
  projectName: string,
  isDevelopmentMode: boolean,
  generated: GeneratedCode
): Promise<void> {
  const safeName = projectName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/--+/g, '-')
    .replace(/^-|-$/g, '') || 'ragforge-client';

  const pkg: any = {
    name: safeName,
    private: true,
    type: 'module',
    version: '0.0.1',
    dependencies: {
      '@luciformresearch/ragforge-runtime': isDevelopmentMode ? 'file:./packages/runtime' : '^0.1.2',
      '@google/genai': '^1.28.0',
      'dotenv': '^16.3.1',
      'tsx': '^4.20.0',
      'js-yaml': '^4.1.0'
    }
  };

  // Only add devDependencies in development mode
  if (isDevelopmentMode) {
    pkg.devDependencies = {
      '@luciformresearch/codeparsers': 'file:../../packages/codeparsers'
    };
  }

  const exampleScripts = Object.fromEntries(
    Array.from(generated.examples.keys()).map(exampleFile => [
      `examples:${exampleFile}`,
      `tsx ./examples/${exampleFile}.ts`
    ])
  );

  pkg.scripts = {
      build: 'echo "Nothing to build"',
      start: 'tsx ./client.ts',
      regen: 'node ../../ragforge/packages/cli/dist/index.js generate --config ./ragforge.config.yaml --out . --force',
      'regen:auto': 'node ../../ragforge/packages/cli/dist/index.js generate --config ./ragforge.config.yaml --out . --force --auto-detect-fields',
      'rebuild:agent': 'tsx ./scripts/rebuild-agent.ts',
      'embeddings:index': 'tsx ./scripts/create-vector-indexes.ts',
      'embeddings:generate': 'tsx ./scripts/generate-embeddings.ts',
      ...exampleScripts
    };

  await writeFileIfChanged(path.join(outDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

  // Auto-install dependencies in production mode
  if (!isDevelopmentMode) {
    console.log('📦  Installing dependencies...');
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execPromise = promisify(exec);

    try {
      await execPromise('npm install', { cwd: outDir });
      console.log('✅  Dependencies installed successfully');
    } catch (error) {
      console.warn('⚠️  Failed to auto-install dependencies. Run `npm install` manually in the output directory.');
    }
  }
}

async function relaxRuntimePackageMetadata(runtimeDir: string): Promise<void> {
  const packagePath = path.join(runtimeDir, 'package.json');

  let raw: string;
  try {
    raw = await fs.readFile(packagePath, 'utf-8');
  } catch (error) {
    throw new Error(`Failed to read runtime package metadata: ${error instanceof Error ? error.message : String(error)}`);
  }

  const pkg = JSON.parse(raw);
  delete pkg.peerDependencies;
  delete pkg.devDependencies;
  pkg.private = true;
  pkg.scripts = {
    build: 'echo "Runtime already built"'
  };

  await fs.writeFile(packagePath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
}

async function writeGeneratedTsconfig(outDir: string): Promise<void> {
  const tsconfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      moduleDetection: 'force',
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      resolveJsonModule: true,
      isolatedModules: true,
      forceConsistentCasingInFileNames: true,
      skipLibCheck: true,
      strict: false,
      outDir: 'dist'
    },
    include: ['**/*.ts'],
    exclude: ['node_modules', 'packages/runtime/dist', 'packages/runtime/src']
  };

  await writeFileIfChanged(
    path.join(outDir, 'tsconfig.json'),
    JSON.stringify(tsconfig, null, 2) + '\n'
  );
}

async function writeExampleScripts(outDir: string, generated: GeneratedCode, projectName: string): Promise<void> {
  const examplesDir = path.join(outDir, 'examples');
  await fs.mkdir(examplesDir, { recursive: true });

  // Write generated examples from YAML
  for (const [filename, code] of generated.examples.entries()) {
    await writeFileIfChanged(path.join(examplesDir, `${filename}.ts`), code);
  }
}

async function writeGitIgnore(outDir: string): Promise<void> {
  const gitignore = `node_modules
.npm-cache
.env
.env.local
packages/runtime/node_modules
dist
logs
`;

  await writeFileIfChanged(path.join(outDir, '.gitignore'), gitignore);
}

async function writeLicense(outDir: string): Promise<void> {
  const license = `Luciform Research Source License (LRSL) – Version 1.1

Copyright © 2025 Luciform Research
All rights reserved except as expressly granted below.

This is a source-available license.

1. Purpose

This license encourages research, personal development, and creative exploration,
while ensuring fair compensation when the software is used in substantial commercial contexts.

2. Definitions

2.1 "Use" means to execute, compile, modify, integrate, or deploy this software in any context,
including but not limited to:
- Internal tools and systems
- Products or services offered to third parties
- Software-as-a-Service (SaaS) offerings
- Embedded components in other software

2.2 "Revenue Threshold" means €100,000 in gross monthly revenue, calculated as:
- For companies/organizations: the total gross monthly revenue of the legal entity using this software
- For products/services: if used in a specific product line, the revenue of that product line
- Whichever amount is higher applies

2.3 "Commercial Use" means any Use by an entity or for a purpose that generates revenue
exceeding the Revenue Threshold.

3. Permitted Use

You may freely:

a) View, study, modify, and compile the source code for any purpose

b) Use the software for:
   - Research, experimentation, and education
   - Personal, academic, or artistic projects
   - Freelance work or business operations where your entity's gross monthly revenue
     does not exceed €100,000

c) Create and distribute derivative works, subject to the terms in Section 4

Such use is free of charge and requires no further permission from Luciform Research.

4. Redistribution and Derivative Works

4.1 You may redistribute modified or unmodified versions of this software provided that:

a) This license file is retained in full, unmodified
b) All modifications are clearly documented in a CHANGELOG file or prominent notice
   at the top of modified files
c) You do not claim endorsement by or affiliation with Luciform Research without
   written consent
d) Redistributions must be under this same license (LRSL v1.1 or later)
e) You clearly indicate that the redistributed version is not the official version

4.2 Derivative works (modified versions) must:

a) Clearly state they are derived from Luciform Research software
b) Include a notice of modifications made
c) Retain all copyright notices from the original software
d) Be distributed under this same license

5. Commercial Use Above Revenue Threshold

Any Commercial Use (as defined in Section 2.3) requires a separate commercial agreement
with Luciform Research.

5.1 To obtain a commercial license:
- Contact: legal@luciformresearch.com
- Provide: description of intended use and current revenue figures
- Commercial agreements may include specific licensing terms, support provisions,
  or partnership arrangements

5.2 If your revenue crosses the threshold:
- You have a 60-day grace period to either:
  (a) Obtain a commercial license, or
  (b) Cease using the software

6. Patent Grant

Subject to the terms of this license, Luciform Research grants you a worldwide,
royalty-free, non-exclusive license under any patent claims owned by Luciform Research
that are necessarily infringed by the software to make, use, and distribute the software.

This patent license terminates if you initiate patent litigation against Luciform Research
or any contributor regarding patents related to this software.

7. No Warranty

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
PURPOSE, AND NONINFRINGEMENT.

IN NO EVENT SHALL LUCIFORM RESEARCH OR CONTRIBUTORS BE LIABLE FOR ANY CLAIM, DAMAGES,
OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT, OR OTHERWISE, ARISING FROM,
OUT OF, OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

8. Limitation of Liability

TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL LUCIFORM RESEARCH
OR CONTRIBUTORS BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS
OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED
AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE,
EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

9. Governing Law and Jurisdiction

9.1 This license shall be governed by and construed in accordance with the laws of France,
without regard to its conflict of law provisions.

9.2 Any disputes arising from this license shall be subject to the exclusive jurisdiction
of the courts of Paris, France.

9.3 If any provision of this license is found to be unenforceable, the remaining provisions
shall remain in full effect.

10. Termination

10.1 This license terminates automatically if you fail to comply with any of its terms.

10.2 Upon termination, you must cease all Use of the software and destroy all copies
in your possession.

10.3 Sections 7 (No Warranty), 8 (Limitation of Liability), and 9 (Governing Law)
survive termination.

11. License Evolution

11.1 Luciform Research may publish new versions of this license to clarify or adjust its terms.

11.2 You may choose to use the software under the terms of the version under which you
originally received it, or any later version published by Luciform Research.

11.3 New versions will not retroactively change the terms of previously distributed software.

12. Future License Change

Luciform Research reserves the right to release future versions of this software under
different licenses, including but not limited to:
- More permissive licenses (e.g., MIT, Apache 2.0)
- Updated versions of LRSL with adjusted revenue thresholds or terms

Previously distributed versions remain under their original license terms.

13. Contact and Commercial Inquiries

For commercial licensing, partnerships, support, or legal questions:

Email: legal@luciformresearch.com
Website: https://luciformresearch.com (when available)

---

IMPORTANT NOTES FOR USERS:

1. This is a custom "source-available" license, NOT an OSI-approved open source license
2. It is NOT compatible with GPL or other copyleft licenses
3. Read Sections 2 and 5 carefully to understand revenue threshold requirements
4. When in doubt about commercial use, contact legal@luciformresearch.com

---

Version History:
- v1.1 (2025): Added definitions, patent grant, grace period, jurisdiction, and clarifications
- v1.0 (2025): Initial release
`;

  await writeFileIfChanged(path.join(outDir, 'LICENSE'), license);
}

async function ensureLogsDirectory(outDir: string): Promise<void> {
  const logsDir = path.join(outDir, 'logs');
  await fs.mkdir(logsDir, { recursive: true });
}
