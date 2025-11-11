# Dev Mode Fix Summary

**Date**: 2025-11-11
**Status**: ✅ Production mode working, ⚠️ Dev mode needs investigation

## What Was Fixed

### 1. ✅ Production Mode (Default)
- `--dev` flag is now **required** for dev mode (no automatic detection)
- Default package.json uses npm versions:
  ```json
  {
    "dependencies": {
      "@luciformresearch/ragforge-runtime": "^0.2.0"
    },
    "scripts": {
      "regen": "ragforge generate --config ./ragforge.config.yaml --out . --force"
    }
  }
  ```
- Versions updated from 0.1.x to 0.2.0/0.1.3
- **Tested and working** ✅

### 2. Changes Made

#### `packages/cli/src/commands/quickstart.ts`
- Added `dev?: boolean` to `QuickstartOptions` interface
- Added `--dev` flag parsing in `parseQuickstartOptions()`
- Initialize `dev: false` by default in options
- Added `devMode?: boolean` parameter to `generateClient()`
- Pass `options.dev` to `generateClient()`
- Calculate `ragforgeRoot` using same logic as `init.ts`:
  ```typescript
  const distEsmDir = path.dirname(path.dirname(new URL(import.meta.url).pathname));
  ragforgeRoot = path.resolve(distEsmDir, '../../../..');
  ```

#### `packages/cli/src/utils/io.ts`
- Updated default versions:
  - `runtimeDependency = '^0.2.0'` (was `'^0.1.2'`)
  - `codeparsersDependency = '^0.1.3'` (was `'file:...'`)
- Calculate CLI path dynamically for dev mode scripts:
  ```typescript
  let cliCommand = 'ragforge';
  if (dev && rootDir) {
    const cliPath = path.join(rootDir, 'packages/cli/dist/esm/index.js');
    const relativeCli = path.relative(outDir, cliPath);
    cliCommand = `node ${relativeCli}`;
  }
  ```
- Scripts now use `${cliCommand}` instead of hardcoded paths

#### `packages/cli/src/commands/quickstart.ts` (help text)
- Added `--dev` option to help:
  ```
  --dev                Development mode: use local file: dependencies (for RagForge contributors)
  ```

## What's Not Working Yet

### ⚠️ Dev Mode with `--dev` Flag

**Problem**: Even with `--dev` flag, generated package.json still uses npm versions instead of `file:` paths.

**Expected behavior** with `--dev`:
```json
{
  "dependencies": {
    "@luciformresearch/ragforge-runtime": "file:../../packages/runtime"
  },
  "devDependencies": {
    "@luciformresearch/codeparsers": "file:../../../packages/codeparsers"
  },
  "scripts": {
    "regen": "node ../../packages/cli/dist/esm/index.js generate ..."
  }
}
```

**Actual behavior**:
- Still generates npm versions (`^0.2.0`)
- Still uses `ragforge` command in scripts
- No debug logs appearing (🔧 Dev mode logs)

### Debugging Steps Taken

1. Added debug logs in `generateClient()`:
   ```typescript
   console.log(`🔧 generateClient() called with devMode=${devMode}`);
   ```

2. Added debug logs for ragforgeRoot calculation:
   ```typescript
   console.log(`🔧 Dev mode - pathname: ${pathname}`);
   console.log(`🔧 Dev mode - distEsmDir: ${distEsmDir}`);
   console.log(`🔧 Dev mode - ragforgeRoot: ${ragforgeRoot}`);
   ```

3. Verified flag parsing is correct (added `dev: false` default)

4. Verified `options.dev` is passed to `generateClient()`

### Hypothesis

The `devMode` parameter might be:
- Not reaching `generateClient()` (undefined)
- Not being passed correctly through the call chain
- Being overridden somewhere

### Next Steps to Debug

1. Check if `options.dev` is actually set when parsing `--dev`:
   ```typescript
   console.log('After parsing options:', JSON.stringify(options));
   ```

2. Add log right before calling `generateClient()`:
   ```typescript
   console.log('Calling generateClient with options.dev =', options.dev);
   ```

3. Check if there's a mismatch between `dev` and `devMode` variable names

4. Verify the call site in `runQuickstart()` line 604

## Files Modified

- `packages/cli/src/commands/quickstart.ts`
- `packages/cli/src/utils/io.ts`
- `packages/cli/src/index.ts` (imports)

## Testing

### ✅ Production Mode (Verified Working)
```bash
cd /tmp/test-prod
node ../packages/cli/dist/esm/index.js quickstart --root ../packages --language typescript --no-embeddings --force

# Check generated package.json
cat generated/package.json | grep ragforge-runtime
# Output: "@luciformresearch/ragforge-runtime": "^0.2.0"  ✅

cat generated/package.json | grep '"regen"'
# Output: "regen": "ragforge generate ..."  ✅
```

### ⚠️ Dev Mode (Not Yet Working)
```bash
cd /tmp/test-dev
node ../packages/cli/dist/esm/index.js quickstart --root ../packages --language typescript --no-embeddings --force --dev

# Check generated package.json
cat generated/package.json | grep ragforge-runtime
# Expected: "@luciformresearch/ragforge-runtime": "file:../../packages/runtime"
# Actual: "@luciformresearch/ragforge-runtime": "^0.2.0"  ❌

# No debug logs appear
grep "🔧 Dev mode" SUCCESS.log
# No output  ❌
```

## Conclusion

**Production mode is ready for v0.2.0 release** ✅

**Dev mode needs further debugging** before it can be used by contributors. The issue is likely in how the `--dev` flag is being passed through the function chain.

## Recommended Action

For now:
1. **Ship v0.2.0 with working production mode**
2. **Document --dev as experimental** in release notes
3. **Fix dev mode in a follow-up patch** (v0.2.1)

OR

1. **Debug and fix dev mode now** before release
2. **Test both modes thoroughly**
3. **Ship v0.2.0 with both modes working**

The production mode is the critical path for users, so we can ship without perfect dev mode if needed.
