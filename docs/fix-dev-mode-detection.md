# Fix Dev Mode Detection and Package.json Generation

**Date**: 2025-11-11
**Priority**: HIGH (Blocking release)
**Issue**: Quickstart generates dev dependencies by default instead of using published npm packages

## Problem

Currently, `ragforge quickstart` automatically detects "dev mode" when running from `/dist/esm/` and generates package.json with `file:` dependencies:

```json
{
  "dependencies": {
    "@luciformresearch/ragforge-runtime": "file:../../packages/runtime"
  },
  "devDependencies": {
    "@luciformresearch/codeparsers": "file:../../../packages/codeparsers"
  },
  "scripts": {
    "regen": "node ../../ragforge/packages/cli/dist/index.js generate ..."
  }
}
```

**This breaks when users install from npm!**

## Expected Behavior

**By default** (no --dev flag):
```json
{
  "dependencies": {
    "@luciformresearch/ragforge-runtime": "^0.2.0",
    "@google/genai": "^1.28.0",
    "dotenv": "^16.3.1",
    "tsx": "^4.20.0",
    "js-yaml": "^4.1.0"
  },
  "scripts": {
    "regen": "ragforge generate --config ./ragforge.config.yaml --out . --force"
  }
}
```

**With --dev flag**:
```json
{
  "dependencies": {
    "@luciformresearch/ragforge-runtime": "file:../../packages/runtime"
  },
  "devDependencies": {
    "@luciformresearch/codeparsers": "file:../../../packages/codeparsers"
  },
  "scripts": {
    "regen": "node ../../ragforge/packages/cli/dist/index.js generate ..."
  }
}
```

## Files to Fix

### 1. `packages/cli/src/commands/quickstart.ts`

#### Current Code (lines 1277-1289):
```typescript
// Calculate ragforge root for dev mode
let ragforgeRoot: string | undefined;
let devMode = false;

// Check if we're running from dist/esm (development mode)
const currentFileUrl = import.meta.url;
const currentFilePath = new URL(currentFileUrl).pathname;
if (currentFilePath.includes('/dist/esm/')) {
  const distEsmDir = path.dirname(currentFilePath);
  ragforgeRoot = path.resolve(distEsmDir, '../../../..');
  devMode = true;
  console.log('✓ Development mode detected, using local dependencies');
}
```

#### Fix:
```typescript
// Dev mode: use local dependencies instead of npm packages
let ragforgeRoot: string | undefined;
let devMode = options.dev || false;

// If --dev flag is set, calculate path to ragforge monorepo
if (devMode) {
  const currentFileUrl = import.meta.url;
  const currentFilePath = new URL(currentFileUrl).pathname;
  if (currentFilePath.includes('/dist/esm/')) {
    const distEsmDir = path.dirname(currentFilePath);
    ragforgeRoot = path.resolve(distEsmDir, '../../../..');
    console.log('✓ Development mode: using local dependencies');
  } else {
    console.warn('⚠ --dev flag set but not running from dist/esm, cannot determine ragforge root');
    devMode = false;
  }
}
```

#### Add --dev option to command interface:
```typescript
interface QuickstartOptions {
  root?: string;
  language?: 'typescript' | 'python';
  noEmbeddings?: boolean;
  noDocker?: boolean;
  dev?: boolean;  // ADD THIS
}
```

#### Update command parsing:
```typescript
export async function quickstart(options: QuickstartOptions = {}): Promise<void> {
  const sourcePath = options.root ? path.resolve(options.root) : workspacePath;
  const forceLanguage = options.language;
  const skipEmbeddings = options.noEmbeddings || false;
  const skipDocker = options.noDocker || false;
  const devMode = options.dev || false;  // ADD THIS
  // ...
}
```

#### Update help text (printRootHelp function):
```typescript
Quick start:
  ragforge quickstart                # New to RagForge? Start here!
  ragforge quickstart --dev          # Development mode with local packages
```

### 2. `packages/cli/src/utils/io.ts`

#### Current Code (lines 372-404):
```typescript
// Calculate relative path to runtime package when in dev mode
let runtimeDependency = '^0.1.2';  // ❌ OLD VERSION
let codeparsersDependency = 'file:../../packages/codeparsers';  // ❌ WRONG DEFAULT

if (dev && rootDir) {
  // ... calculate file: paths ...
  runtimeDependency = `file:${relativePath}`;
  codeparsersDependency = `file:${codeparsersRelativePath}`;
}
```

#### Fix:
```typescript
// Default: use published npm packages
let runtimeDependency = '^0.2.0';  // ✅ NEW VERSION
let codeparsersDependency = '^0.1.3';  // ✅ Use npm by default

// In dev mode, use local file: dependencies
if (dev && rootDir) {
  // Find the monorepo root by looking for packages/runtime
  let monorepoRoot = rootDir;
  const candidates = [
    path.join(rootDir, 'packages/runtime'),           // Already at monorepo root
    path.join(rootDir, '../packages/runtime'),        // One level up
    path.join(rootDir, '../../packages/runtime'),     // Two levels up
    path.join(rootDir, '../ragforge/packages/runtime') // Sibling ragforge folder
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      monorepoRoot = path.dirname(path.dirname(candidate));
      break;
    } catch {
      continue;
    }
  }

  const runtimePath = path.join(monorepoRoot, 'packages/runtime');
  const relativePath = path.relative(outDir, runtimePath);
  runtimeDependency = `file:${relativePath}`;

  // Also calculate codeparsers path
  const codeparsersPath = path.join(monorepoRoot, '../packages/codeparsers');
  const codeparsersRelativePath = path.relative(outDir, codeparsersPath);
  codeparsersDependency = `file:${codeparsersRelativePath}`;
}
```

#### Fix package.json devDependencies (lines 420-425):
```typescript
// Only include codeparsers in development mode
// In production, it's bundled with ragforge-runtime
if (dev) {
  pkg.devDependencies = {
    '@luciformresearch/codeparsers': codeparsersDependency
  };
}
```

### 3. Fix Scripts in package.json (lines 434-442)

#### Current Code:
```typescript
const baseScripts: Record<string, string> = {
  build: 'echo "Nothing to build"',
  start: 'tsx ./client.ts',
  regen: 'node ../../ragforge/packages/cli/dist/index.js generate --config ./ragforge.config.yaml --out . --force',  // ❌ DEV PATH
  'regen:auto': 'node ../../ragforge/packages/cli/dist/index.js generate --config ./ragforge.config.yaml --out . --force --auto-detect-fields',  // ❌ DEV PATH
  'rebuild:agent': 'tsx ./scripts/rebuild-agent.ts',
  'embeddings:index': 'tsx ./scripts/create-vector-indexes.ts',
  'embeddings:generate': 'tsx ./scripts/generate-embeddings.ts'
};
```

#### Fix:
```typescript
const baseScripts: Record<string, string> = {
  build: 'echo "Nothing to build"',
  start: 'tsx ./client.ts',
  regen: dev
    ? 'node ../../ragforge/packages/cli/dist/index.js generate --config ./ragforge.config.yaml --out . --force'
    : 'ragforge generate --config ./ragforge.config.yaml --out . --force',
  'regen:auto': dev
    ? 'node ../../ragforge/packages/cli/dist/index.js generate --config ./ragforge.config.yaml --out . --force --auto-detect-fields'
    : 'ragforge generate --config ./ragforge.config.yaml --out . --force --auto-detect-fields',
  'rebuild:agent': 'tsx ./scripts/rebuild-agent.ts',
  'embeddings:index': 'tsx ./scripts/create-vector-indexes.ts',
  'embeddings:generate': 'tsx ./scripts/generate-embeddings.ts'
};
```

### 4. Same fix needed in `packages/cli/src/commands/generate.ts` and `init.ts`

These also call `persistGeneratedArtifacts()` and may need the same devMode logic.

Check their usage:
```bash
grep -n "persistGeneratedArtifacts" packages/cli/src/commands/*.ts
```

Ensure they also:
- Have --dev option
- Pass devMode = false by default
- Only set devMode = true if --dev flag is explicitly set

## Testing Plan

### Test 1: Default behavior (production mode)
```bash
# Clean install from npm
npm install -g @luciformresearch/ragforge-cli@0.2.0

# Run quickstart
cd /tmp/test-prod
ragforge quickstart --root ~/my-project

# Check generated package.json
cat generated/package.json | grep ragforge-runtime
# Should show: "@luciformresearch/ragforge-runtime": "^0.2.0"

# Check scripts work
cd generated
npm install
npm run regen  # Should use 'ragforge' command, not node path
```

### Test 2: Dev mode
```bash
# From ragforge monorepo
cd /path/to/ragforge

# Run with --dev
cd /tmp/test-dev
node ../ragforge/packages/cli/dist/esm/index.js quickstart --root ~/my-project --dev

# Check generated package.json
cat generated/package.json | grep ragforge-runtime
# Should show: "@luciformresearch/ragforge-runtime": "file:../../packages/runtime"

# Check scripts
cat generated/package.json | grep regen
# Should use: "node ../../ragforge/packages/cli/dist/index.js"
```

### Test 3: Version correctness
```bash
# Verify versions in generated package.json match published versions
cat generated/package.json | grep -E "ragforge|codeparsers"
# Should be: ^0.2.0 and ^0.1.3 respectively
```

## Implementation Order

1. ✅ Document the issue (this file)
2. Add --dev flag to QuickstartOptions interface
3. Fix devMode detection in quickstart.ts (don't auto-detect)
4. Update version numbers in io.ts (0.2.0, 0.1.3)
5. Fix default dependencies to use npm versions
6. Fix scripts to use 'ragforge' command by default
7. Test production mode (no --dev)
8. Test dev mode (with --dev)
9. Verify generated projects work end-to-end

## Timeline

- **Critical**: Must be fixed before v0.2.0 release
- **Estimate**: 1-2 hours
- **Risk**: HIGH - Breaks user experience if not fixed

## Success Criteria

✅ Users installing from npm get working projects with npm dependencies
✅ --dev flag works for RagForge contributors
✅ No hardcoded paths in generated projects (except with --dev)
✅ 'npm run regen' works without local RagForge installation
✅ All 14 generated examples work in production mode
