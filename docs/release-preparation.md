# Release Preparation Checklist

**Date**: 2025-11-11
**Branch**: rag-doll
**Target Release**: v0.2.0 (Major feature release)

## Summary of Changes

This release includes the **Quickstart Command** - a complete onboarding experience that auto-detects projects, generates configs with defaults, sets up Docker, and creates working TypeScript clients with examples.

### Major Features Added

#### 1. Quickstart Command (`ragforge quickstart`)
- Auto-detects TypeScript/Python projects
- Generates minimal config merged with adapter defaults
- Sets up Neo4j via Docker Compose
- Performs full ingestion + embeddings
- Generates complete TypeScript client with 14 examples
- **Files**: `packages/cli/src/commands/quickstart.ts` (1365 lines)

#### 2. Config Defaults System
- Base defaults + adapter-specific defaults (TypeScript)
- Smart merging with user configs
- Educational comments distinguishing auto-added fields
- **Files**:
  - `packages/core/src/defaults/base.yaml`
  - `packages/core/src/defaults/code-typescript.yaml`
  - `packages/core/src/config/merger.ts`
  - `packages/core/src/config/writer.ts`

#### 3. Workspace/Source Separation
- Generate RagForge projects in empty directories
- Point to source code elsewhere via `--root`
- Proper path resolution across directory boundaries
- Monorepo detection and pattern generation

#### 4. Code Source Adapter
- Incremental ingestion with change detection
- File watching with auto-regeneration
- TypeScript import resolution
- **Files**:
  - `packages/runtime/src/adapters/code-source-adapter.ts`
  - `packages/runtime/src/adapters/change-tracker.ts`
  - `packages/runtime/src/adapters/file-watcher.ts`
  - `packages/runtime/src/adapters/incremental-ingestion.ts`
  - `packages/runtime/src/adapters/ingestion-queue.ts`

#### 5. Field Summarization
- LLM-based code summarization with context queries
- Configurable output fields (purpose, operation, etc.)
- Reranking integration with summaries
- **Files**:
  - `packages/runtime/src/summarization/generic-summarizer.ts`
  - `packages/runtime/src/summarization/summary-storage.ts`
  - `packages/runtime/src/summarization/default-strategies.ts`
  - `packages/core/src/summarization/strategy-loader.ts`

## Package Versions

### Current Versions
- `@luciformresearch/ragforge-cli`: **0.1.16**
- `@luciformresearch/ragforge-core`: **0.1.7**
- `@luciformresearch/ragforge-runtime`: **0.1.3**
- `@luciformresearch/codeparsers`: **0.1.2**

### Proposed New Versions
Given the scope of changes (major new feature: quickstart), recommend:
- `@luciformresearch/ragforge-cli`: **0.2.0** (major feature: quickstart command)
- `@luciformresearch/ragforge-core`: **0.2.0** (major features: defaults system, writer)
- `@luciformresearch/ragforge-runtime`: **0.2.0** (major features: code adapter, summarization)
- `@luciformresearch/codeparsers`: **0.1.3** (minor updates if any, check separately)

## Pre-Release Checklist

### 1. Documentation Updates

#### CLI Help Text
- [ ] Update `ragforge -h` main help (add quickstart prominently)
- [ ] Add `ragforge help quickstart` detailed help
- [ ] Update `ragforge init -h` (mention quickstart as alternative)
- [ ] Ensure all examples in help text are accurate
- [ ] Files to update:
  - `packages/cli/src/index.ts` (printRootHelp function)
  - `packages/cli/src/commands/quickstart.ts` (inline help)

#### README Files
- [ ] **Main README** (`ragforge/README.md`)
  - Add quickstart to "Getting Started" section
  - Update feature list
  - Update installation instructions
  - Add quickstart example

- [ ] **CLI README** (`packages/cli/README.md`)
  - Add quickstart command documentation
  - Update command reference
  - Add quickstart examples
  - Update usage section

- [ ] **Core README** (`packages/core/README.md`)
  - Document defaults system
  - Document config merging
  - Document writer with educational comments
  - Add examples of minimal configs

- [ ] **Runtime README** (`packages/runtime/README.md`)
  - Document code source adapter
  - Document incremental ingestion
  - Document summarization features
  - Add adapter usage examples

- [ ] **CodeParsers README** (`packages/codeparsers/README.md`)
  - Check if any updates needed
  - Verify examples still work

#### CHANGELOG
- [ ] Create/update `CHANGELOG.md` in each package
- [ ] Document breaking changes (if any)
- [ ] List new features
- [ ] List bug fixes
- [ ] Migration guide if needed

### 2. Code Quality Checks

#### TypeScript Compilation
```bash
cd /home/luciedefraiteur/LR_CodeRag/ragforge
npm run build
```
- [ ] CLI builds without errors
- [ ] Core builds without errors
- [ ] Runtime builds without errors
- [ ] Type declarations generated correctly

#### Linting
```bash
npm run lint
```
- [ ] No linting errors in CLI
- [ ] No linting errors in Core
- [ ] No linting errors in Runtime

#### Testing
```bash
npm run test
```
- [ ] All existing tests pass
- [ ] Consider adding tests for:
  - Config merging logic
  - Monorepo detection
  - Path resolution
  - Quickstart flow (integration test)

### 3. Files to Include in Published Packages

#### CLI Package
- [ ] Verify `dist/` contains all built files
- [ ] Verify `dist/esm/index.js` is executable (chmod +x)
- [ ] Verify LICENSE is included
- [ ] Verify README.md is included

#### Core Package
- [ ] Verify `dist/defaults/` is copied (base.yaml, code-typescript.yaml)
- [ ] Verify `dist/templates/` is copied (template files)
- [ ] Verify all TypeScript declarations
- [ ] Verify LICENSE is included

#### Runtime Package
- [ ] Verify all adapter files are included
- [ ] Verify summarization files are included
- [ ] Verify type declarations
- [ ] Verify LICENSE is included

### 4. Dependency Updates

#### Update Internal Dependencies
Edit package.json files to match new versions:

**CLI** (`packages/cli/package.json`):
```json
{
  "dependencies": {
    "@luciformresearch/ragforge-core": "^0.2.0",
    "@luciformresearch/ragforge-runtime": "^0.2.0",
    "@luciformresearch/xmlparser": "^0.2.4"
  }
}
```

**Core** (`packages/core/package.json`):
```json
{
  "dependencies": {
    "@luciformresearch/codeparsers": "^0.1.3"
  }
}
```

**Runtime** (`packages/runtime/package.json`):
```json
{
  "dependencies": {
    "@luciformresearch/codeparsers": "^0.1.3"
  }
}
```

- [ ] Update CLI dependencies to Core 0.2.0 and Runtime 0.2.0
- [ ] Update Core dependencies to CodeParsers 0.1.3 (if updated)
- [ ] Update Runtime dependencies to CodeParsers 0.1.3 (if updated)
- [ ] Run `npm install` in workspace root to update lock file

### 5. CodeParsers Release (if changes made)

Check if codeparsers has changes:
```bash
cd /home/luciedefraiteur/LR_CodeRag/packages/codeparsers
git status
git diff main
```

If changes exist:
- [ ] Update version to 0.1.3
- [ ] Update CHANGELOG
- [ ] Build: `npm run build`
- [ ] Test: `npm run test`
- [ ] Publish: `npm publish`
- [ ] Verify on npmjs.com

### 6. Manual Testing

#### Test Quickstart Flow
```bash
# Clean test
cd /tmp
mkdir ragforge-test && cd ragforge-test
npm install -g @luciformresearch/ragforge-cli@latest # after publish
ragforge quickstart --root ~/my-typescript-project
```

Test checklist:
- [ ] Detects project type correctly
- [ ] Generates ragforge.config.yaml with comments
- [ ] Creates docker-compose.yml
- [ ] Adds Neo4j credentials to .env
- [ ] Docker container starts successfully
- [ ] Ingestion completes without errors
- [ ] Embeddings generate successfully
- [ ] TypeScript client generated in `generated/`
- [ ] Examples run without errors
- [ ] Semantic search returns results

#### Test with Monorepo
- [ ] Test with a monorepo structure
- [ ] Verify patterns include `**/src/**/*.ts`
- [ ] Verify all packages are discovered

#### Test Init Command (Ensure Still Works)
```bash
ragforge init
```
- [ ] Still works with existing .env
- [ ] Introspection works
- [ ] Client generation works

### 7. Git & Publishing

#### Prepare Repository
```bash
cd /home/luciedefraiteur/LR_CodeRag/ragforge
git status
git add .
git commit -m "Release v0.2.0: Quickstart command and defaults system"
git push origin rag-doll
```

- [ ] Commit all changes
- [ ] Push to GitHub
- [ ] Create PR: rag-doll → main
- [ ] Get review/approval
- [ ] Merge to main
- [ ] Tag release: `git tag v0.2.0 && git push --tags`

#### Build All Packages
```bash
npm run build # Builds all workspaces
```

#### Publish Packages (in order)
**Important**: Publish in dependency order!

1. **CodeParsers** (if updated):
```bash
cd /home/luciedefraiteur/LR_CodeRag/packages/codeparsers
npm publish
```

2. **Core** (depends on codeparsers):
```bash
cd /home/luciedefraiteur/LR_CodeRag/ragforge/packages/core
npm publish
```

3. **Runtime** (depends on codeparsers):
```bash
cd /home/luciedefraiteur/LR_CodeRag/ragforge/packages/runtime
npm publish
```

4. **CLI** (depends on core + runtime):
```bash
cd /home/luciedefraiteur/LR_CodeRag/ragforge/packages/cli
npm publish
```

- [ ] CodeParsers published successfully
- [ ] Core published successfully
- [ ] Runtime published successfully
- [ ] CLI published successfully

#### Verify npm Packages
- [ ] Check https://www.npmjs.com/package/@luciformresearch/ragforge-cli
- [ ] Check https://www.npmjs.com/package/@luciformresearch/ragforge-core
- [ ] Check https://www.npmjs.com/package/@luciformresearch/ragforge-runtime
- [ ] Check https://www.npmjs.com/package/@luciformresearch/codeparsers
- [ ] Verify versions are correct
- [ ] Verify files are included (check "Files" tab)

### 8. Post-Release Testing

#### Install from npm
```bash
cd /tmp
mkdir fresh-test && cd fresh-test
npm install -g @luciformresearch/ragforge-cli@0.2.0
ragforge --version # Should show 0.2.0
ragforge quickstart --root ~/some-project
```

- [ ] Global install works
- [ ] Version command shows correct version
- [ ] Quickstart works from published packages
- [ ] Generated client uses published runtime package

#### Test in New Project
Create a completely fresh test project:
```bash
mkdir /tmp/clean-ragforge-test
cd /tmp/clean-ragforge-test
ragforge quickstart --root ~/my-code --language typescript
cd generated
npm run examples:01
npm run examples:02
```

- [ ] All generated examples work
- [ ] No dependency resolution errors
- [ ] Embeddings work with Gemini API
- [ ] Semantic search returns results

### 9. Announcement & Documentation

#### GitHub Release
- [ ] Create GitHub release for v0.2.0
- [ ] Add release notes from CHANGELOG
- [ ] Highlight quickstart command
- [ ] Add migration guide if needed
- [ ] Link to documentation

#### Update Documentation Site (if exists)
- [ ] Update getting started guide
- [ ] Add quickstart tutorial
- [ ] Update API reference
- [ ] Add migration guide

#### Announcement
- [ ] Twitter/X post about release
- [ ] Discord/community announcement
- [ ] Update any showcase/demo projects

## Known Issues to Document

1. **Reranking Quota Limits** (See `reranking-quota-issue.md`)
   - LLM reranking can hit Gemini API quota limits
   - Workaround: Use `prefer_summary` or reduce result count
   - Future: Switch to Gemini Flash for reranking

2. **Neo4j Auth Timing** (Fixed, but document)
   - Neo4j needs 10s after port opens for auth to stabilize
   - Quickstart handles this automatically

3. **Monorepo Pattern Detection**
   - Currently checks for common indicators
   - May need manual adjustment for unusual structures

## Rollback Plan

If issues discovered after release:

1. **Minor issues**: Patch release (0.2.1)
2. **Major issues**:
   - Deprecate 0.2.0 on npm: `npm deprecate @luciformresearch/ragforge-cli@0.2.0 "Has critical bugs, use 0.1.16"`
   - Revert to 0.1.x
   - Fix issues
   - Release 0.2.1

## Success Criteria

✅ Release is successful when:
- All packages build without errors
- All tests pass
- Quickstart works end-to-end from published packages
- Documentation is complete and accurate
- No critical bugs in first 48 hours
- Community feedback is positive

## Timeline

- **Day 1**: Update documentation, run tests, fix issues
- **Day 2**: Update versions, publish to npm, create GitHub release
- **Day 3**: Monitor for issues, respond to feedback
- **Week 1**: Gather feedback, plan 0.2.1 if needed
