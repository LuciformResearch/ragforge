#!/usr/bin/env tsx
/**
 * Release script for RagForge packages
 *
 * Usage:
 *   npx tsx scripts/release.ts <version>
 *   npx tsx scripts/release.ts 0.3.2
 *
 * This will:
 * 1. Update all package versions
 * 2. Update cross-dependencies
 * 3. Build all packages
 * 4. Publish in order: core -> cli -> studio (prompting for OTP each time)
 * 5. Git commit and tag
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

const PACKAGES = [
  { name: 'core', dir: 'packages/core', npm: '@luciformresearch/ragforge' },
  { name: 'cli', dir: 'packages/cli', npm: '@luciformresearch/ragforge-cli' },
  { name: 'studio', dir: 'packages/studio', npm: '@luciformresearch/ragforge-studio' },
];

function run(cmd: string, cwd?: string) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: cwd || ROOT });
}

function runSilent(cmd: string, cwd?: string): string {
  return execSync(cmd, { cwd: cwd || ROOT, encoding: 'utf-8' });
}

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function updatePackageJson(pkgPath: string, version: string, depsVersion: string) {
  const fullPath = join(ROOT, pkgPath, 'package.json');
  const content = readFileSync(fullPath, 'utf-8');
  const pkg = JSON.parse(content);

  const oldVersion = pkg.version;
  pkg.version = version;

  // Update dependencies to other ragforge packages
  if (pkg.dependencies) {
    if (pkg.dependencies['@luciformresearch/ragforge']) {
      pkg.dependencies['@luciformresearch/ragforge'] = `^${depsVersion}`;
    }
    if (pkg.dependencies['@luciformresearch/ragforge-cli']) {
      pkg.dependencies['@luciformresearch/ragforge-cli'] = `^${depsVersion}`;
    }
  }

  writeFileSync(fullPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`  ${pkgPath}: ${oldVersion} -> ${version}`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.log('Usage: npx tsx scripts/release.ts <version>');
    console.log('Example: npx tsx scripts/release.ts 0.3.2');
    process.exit(1);
  }

  const version = args[0];

  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    console.error(`Invalid version: ${version}. Expected format: X.Y.Z`);
    process.exit(1);
  }

  console.log(`\n🚀 RagForge Release v${version}`);
  console.log('='.repeat(40));

  // Step 1: Update versions
  console.log('\n📝 Updating package versions...');
  for (const pkg of PACKAGES) {
    updatePackageJson(pkg.dir, version, version);
  }

  // Step 2: Build
  console.log('\n🔨 Building all packages...');
  run('npm run build');

  // Step 3: Publish in order
  console.log('\n📦 Publishing packages...');
  console.log('(You will be prompted for an OTP for each package)\n');

  for (const pkg of PACKAGES) {
    const otp = await prompt(`Enter OTP for ${pkg.npm}: `);

    if (!/^\d{6}$/.test(otp)) {
      console.error(`Invalid OTP: ${otp}. Expected 6 digits.`);
      console.error('Aborting. Run manually:');
      const remaining = PACKAGES.slice(PACKAGES.indexOf(pkg));
      for (const r of remaining) {
        console.error(`  cd ${r.dir} && npm publish --access public --otp=<OTP>`);
      }
      process.exit(1);
    }

    console.log(`  Publishing ${pkg.npm}@${version}...`);
    try {
      run(`npm publish --access public --otp=${otp}`, join(ROOT, pkg.dir));
      console.log(`  ✅ ${pkg.npm}@${version} published!\n`);
    } catch (err) {
      console.error(`  ❌ Failed to publish ${pkg.npm}`);
      console.error('  OTP may have expired. Run manually:');
      const remaining = PACKAGES.slice(PACKAGES.indexOf(pkg));
      for (const r of remaining) {
        console.error(`    cd ${r.dir} && npm publish --access public --otp=<OTP>`);
      }
      process.exit(1);
    }
  }

  // Step 4: Git commit and tag
  console.log('\n📌 Creating git commit and tag...');
  run('git add -A');
  run(`git commit -m "release: v${version}"`);
  run(`git tag v${version}`);

  console.log('\n✅ Release complete!');
  console.log(`\nTo push: git push origin main --tags`);
}

main().catch((err) => {
  console.error('Release failed:', err);
  process.exit(1);
});
