#!/usr/bin/env node
/**
 * Switch ragforge packages to use npm codeparsers (production mode)
 * Removes symlink and reinstalls from registry
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🔧 Switching to npm codeparsers (production mode)...\n');

// Path to codeparsers in node_modules
const nodeModulesTarget = path.resolve(__dirname, '../node_modules/@luciformresearch/codeparsers');

// Step 1: Remove symlink if exists
if (fs.existsSync(nodeModulesTarget)) {
  const stats = fs.lstatSync(nodeModulesTarget);
  if (stats.isSymbolicLink()) {
    console.log('🗑️  Removing symlink...');
    fs.unlinkSync(nodeModulesTarget);
    console.log('✓ Symlink removed\n');
  } else {
    console.log('📦 Already using npm version (no symlink found)\n');
  }
} else {
  console.log('⚠️  codeparsers not found in node_modules\n');
}

// Step 2: Reinstall from npm
console.log('📦 Installing from npm registry...');
try {
  execSync('npm install @luciformresearch/codeparsers', {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit'
  });
  console.log('✓ Installed from npm\n');
} catch (err) {
  console.error('❌ Failed to install from npm');
  process.exit(1);
}

console.log('✅ Now using npm codeparsers (production mode)');
