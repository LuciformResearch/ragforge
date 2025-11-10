#!/usr/bin/env node
/**
 * Switch ragforge packages to use local codeparsers (dev mode)
 * Creates direct symlink in node_modules (no sudo needed)
 */

const fs = require('fs');
const path = require('path');

console.log('🔧 Switching to local codeparsers (dev mode)...\n');

// Paths
const codeparsersSource = path.resolve(__dirname, '../../packages/codeparsers');
const nodeModulesTarget = path.resolve(__dirname, '../node_modules/@luciformresearch/codeparsers');

console.log(`📦 Source: ${codeparsersSource}`);
console.log(`🎯 Target: ${nodeModulesTarget}\n`);

// Verify source exists
if (!fs.existsSync(codeparsersSource)) {
  console.error(`❌ Source not found: ${codeparsersSource}`);
  process.exit(1);
}

// Remove existing if present
if (fs.existsSync(nodeModulesTarget)) {
  console.log('🗑️  Removing existing codeparsers...');
  fs.rmSync(nodeModulesTarget, { recursive: true, force: true });
  console.log('✓ Removed\n');
}

// Create @luciformresearch dir if needed
const orgDir = path.dirname(nodeModulesTarget);
if (!fs.existsSync(orgDir)) {
  fs.mkdirSync(orgDir, { recursive: true });
}

// Create symlink
console.log('🔗 Creating symlink...');
try {
  fs.symlinkSync(codeparsersSource, nodeModulesTarget, 'dir');
  console.log('✓ Symlink created\n');
} catch (err) {
  console.error('❌ Failed to create symlink:');
  console.error(err.message);
  process.exit(1);
}

// Verify it works
if (fs.lstatSync(nodeModulesTarget).isSymbolicLink()) {
  console.log('✅ Successfully linked to local codeparsers (dev mode)');
  console.log('💡 Changes to codeparsers will be reflected immediately after rebuild');
} else {
  console.error('❌ Symlink verification failed');
  process.exit(1);
}
