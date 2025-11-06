# RagForge - Publication Roadmap

## 📋 Current State Analysis

### Monorepo Structure
```
ragforge/
├── packages/
│   ├── core/          ✅ Has package.json, TypeScript config
│   ├── runtime/       ✅ Has package.json, TypeScript config
│   ├── cli/           ✅ Has package.json, TypeScript config
│   ├── mcp/           ⚠️  Placeholder (no package.json)
│   └── reranking/     ⚠️  Placeholder (no package.json)
├── LICENSE            ✅ LRSL v1.1
├── README.md          ✅ Present
└── 73 TypeScript files
```

### Active Packages Status

#### @ragforge/core
- ✅ TypeScript configured
- ❌ No ESLint/Prettier
- ❌ No tests configured
- ❌ Uses `file:../../../packages/codeparsers` instead of npm
- ❌ No README
- ❌ No LICENSE file in package
- ❌ Basic build only (no dual ESM+types)

#### @ragforge/runtime
- ✅ TypeScript configured
- ❌ No ESLint/Prettier
- ❌ No tests configured
- ❌ No README
- ❌ No LICENSE file in package
- ❌ Basic build only

#### @ragforge/cli
- ✅ TypeScript configured
- ✅ Has bin entry for CLI
- ❌ No ESLint/Prettier
- ❌ No tests configured
- ❌ Uses `file:../core` and `file:../runtime` instead of npm
- ❌ No README
- ❌ No LICENSE file in package

### Missing Infrastructure
- ❌ No .gitignore
- ❌ No git repository initialized
- ❌ No ESLint configuration
- ❌ No Prettier configuration
- ❌ No Vitest configuration
- ❌ No turbo.json (despite turbo in devDeps)
- ❌ No CI/CD
- ❌ No proper package exports configuration

---

## 🎯 Publication Checklist

### Phase 1: Git Repository Setup ✅

- [ ] Create comprehensive .gitignore
- [ ] Initialize git repository
- [ ] Create GitHub repository: `https://github.com/LuciformResearch/RagForge`
- [ ] Initial commit and push

### Phase 2: Package Infrastructure 🔧

#### For Each Package (@ragforge/core, @ragforge/runtime, @ragforge/cli)

**Configuration Files:**
- [ ] Add ESLint configuration (use @typescript-eslint)
- [ ] Add Prettier configuration
- [ ] Add Vitest configuration
- [ ] Update tsconfig.json for proper dual build (ESM + types)
- [ ] Add LICENSE file (copy from root)
- [ ] Create package-specific README.md

**package.json Updates:**
- [ ] Fix license field: `"license": "LRSL-1.1 (See LICENSE file for more information)"`
- [ ] Add proper exports configuration
- [ ] Add repository, bugs, homepage URLs
- [ ] Add proper keywords
- [ ] Configure build scripts (ESM + types like codeparsers)
- [ ] Add lint, format, test scripts
- [ ] Update dependencies from `file:` to proper versions
- [ ] Add `files` field to control what gets published
- [ ] Set proper `publishConfig` with access: public

**Scripts to Add:**
```json
{
  "scripts": {
    "clean": "rm -rf dist",
    "build:esm": "tsc -p tsconfig.esm.json",
    "build:types": "tsc -p tsconfig.types.json",
    "build": "npm run clean && npm run build:esm && npm run build:types",
    "prepublishOnly": "npm run build",
    "test": "vitest run",
    "test:watch": "vitest watch",
    "test:ci": "vitest run --coverage",
    "lint": "eslint . --ext .ts,.tsx --max-warnings=0",
    "format": "prettier -w ."
  }
}
```

### Phase 3: Monorepo Configuration 📦

**Root-level:**
- [ ] Create turbo.json for turbo build orchestration
- [ ] Update root package.json scripts for monorepo operations
- [ ] Add root-level ESLint/Prettier configs (inherited by packages)
- [ ] Update @luciformresearch/codeparsers dependency to npm version

**turbo.json structure:**
```json
{
  "$schema": "https://turbo.build/schema.json",
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["build"]
    },
    "lint": {},
    "format": {}
  }
}
```

### Phase 4: Documentation 📚

**Root README updates:**
- [ ] Add installation instructions
- [ ] Add quick start guide
- [ ] Add link to individual package READMEs
- [ ] Update repository links
- [ ] Add badges (npm version, license, etc.)

**Per-package READMEs:**

#### @ragforge/core
- [ ] Overview of code generation features
- [ ] Config schema documentation
- [ ] Usage examples
- [ ] API reference

#### @ragforge/runtime
- [ ] Overview of runtime features
- [ ] Query builder usage
- [ ] Vector search examples
- [ ] API reference

#### @ragforge/cli
- [ ] CLI commands documentation
- [ ] Configuration guide
- [ ] Workflow examples

### Phase 5: Testing & Quality 🧪

- [ ] Add test files for core functionality
- [ ] Configure code coverage thresholds
- [ ] Add pre-commit hooks (optional)
- [ ] Run linter on all code and fix issues
- [ ] Run prettier on all code

### Phase 6: Publication Order 🚀

**Important**: Packages must be published in dependency order!

1. **@ragforge/runtime** (no internal dependencies)
   - [ ] Update version to 0.1.0
   - [ ] Build and test
   - [ ] Publish to npm with `--access public`

2. **@ragforge/core** (depends on nothing, peer-depends on runtime)
   - [ ] Update version to 0.1.0
   - [ ] Update dependencies to use published @ragforge/runtime
   - [ ] Build and test
   - [ ] Publish to npm with `--access public`

3. **@ragforge/cli** (depends on core and runtime)
   - [ ] Update version to 0.1.0
   - [ ] Update dependencies to use published @ragforge/core and @ragforge/runtime
   - [ ] Build and test
   - [ ] Publish to npm with `--access public`

### Phase 7: Post-Publication 🎉

- [ ] Test installation: `npm install -g @ragforge/cli`
- [ ] Test published packages in a fresh project
- [ ] Update main README with npm installation instructions
- [ ] Create GitHub release with changelog
- [ ] Update project board/issues

---

## 📊 Package Comparison with codeparsers

| Feature | codeparsers | ragforge packages | Action Needed |
|---------|-------------|-------------------|---------------|
| ESLint | ✅ | ❌ | Add config |
| Prettier | ✅ | ❌ | Add config |
| Vitest | ✅ | ❌ | Add config |
| Dual Build (ESM+Types) | ✅ | ⚠️ Basic | Improve |
| LICENSE in package | ✅ | ❌ | Copy from root |
| Package README | ✅ | ❌ | Create |
| Proper exports | ✅ | ❌ | Configure |
| GitHub links | ✅ | ❌ | Add |
| npm dependencies | ✅ | ⚠️ Uses file: | Update |
| files field | ✅ | ❌ | Add |

---

## 🚨 Critical Issues to Fix Before Publication

### 1. File Dependencies
All `file:` dependencies must be replaced with proper npm versions:
```json
// ❌ Current
"@ragforge/core": "file:../core"
"@luciformresearch/codeparsers": "file:../../../packages/codeparsers"

// ✅ Target
"@ragforge/core": "^0.1.0"
"@luciformresearch/codeparsers": "^0.1.2"
```

### 2. License Consistency
Each package must have its own LICENSE file and correct license field:
```json
"license": "LRSL-1.1 (See LICENSE file for more information)"
```

### 3. Repository Links
All packages need proper repository configuration:
```json
{
  "repository": {
    "type": "git",
    "url": "git+https://github.com/LuciformResearch/RagForge.git",
    "directory": "packages/core"
  },
  "bugs": {
    "url": "https://github.com/LuciformResearch/RagForge/issues"
  },
  "homepage": "https://github.com/LuciformResearch/RagForge#readme"
}
```

### 4. Build Artifacts
Add `files` field to control what gets published:
```json
{
  "files": [
    "dist",
    "LICENSE",
    "README.md"
  ]
}
```

---

## 💡 Recommendations

### Development Workflow
1. Use turbo for faster builds: `npx turbo run build`
2. Run tests in parallel: `npx turbo run test`
3. Use changesets for version management (optional)

### Publication Strategy
- Start with 0.1.0 for all packages (pre-1.0 signals API instability)
- Use semantic versioning strictly
- Maintain a CHANGELOG.md
- Tag releases in git

### Future Enhancements
- [ ] Add GitHub Actions for CI/CD
- [ ] Add automated testing on PR
- [ ] Add automated publishing workflow
- [ ] Add Dependabot for dependency updates
- [ ] Consider adding a examples/ package to monorepo
- [ ] Complete mcp and reranking packages

---

## 📝 Notes

- The monorepo is well-structured with clear separation of concerns
- TypeScript setup is solid, just needs dual build configuration
- CLI already has bin entry configured, which is good
- Main work is adding professional tooling (linting, testing, docs)
- Publication order is critical due to internal dependencies

---

## 🎯 Quick Start Guide (For Implementation)

**Step 1: Reference codeparsers setup**
Copy and adapt these files from packages/codeparsers:
- tsconfig.esm.json
- tsconfig.types.json
- ESLint config
- Prettier config
- Vitest config
- scripts/fix-esm-extensions.mjs

**Step 2: Apply to each package systematically**
- runtime (no deps) → core (peer deps) → cli (deps)

**Step 3: Test locally before publishing**
```bash
# Build all
npm run build

# Test all
npm run test

# Lint all
npm run lint
```

**Step 4: Publish in order**
```bash
cd packages/runtime && npm publish --access public
cd packages/core && npm publish --access public
cd packages/cli && npm publish --access public
```
