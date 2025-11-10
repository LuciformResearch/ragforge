/**
 * Code Source Adapter
 *
 * Parses codebases (TypeScript, Python, etc.) into Neo4j graph structure
 * using @luciformresearch/codeparsers
 */

import { globby } from 'globby';
import { createHash } from 'crypto';
import * as path from 'path';
import {
  ParserRegistry,
  TypeScriptLanguageParser,
  PythonLanguageParser,
  type ScopeFileAnalysis,
  type ScopeInfo
} from '@luciformresearch/codeparsers';
import {
  SourceAdapter,
  type SourceConfig,
  type ParseOptions,
  type ParseResult,
  type ParsedNode,
  type ParsedRelationship,
  type ParsedGraph,
  type ValidationResult,
  type ParseProgress
} from './types.js';
import { UniqueIDHelper } from '../utils/UniqueIDHelper.js';
import { ImportResolver } from '../utils/ImportResolver.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Code-specific source configuration
 */
export interface CodeSourceConfig extends SourceConfig {
  type: 'code';
  adapter: 'typescript' | 'python';
  options?: {
    /** Export XML for debugging */
    exportXml?: boolean;
    /** XML export directory */
    xmlDir?: string;
    /** Parse comments/docstrings */
    parseComments?: boolean;
    /** Resolve imports */
    resolveImports?: boolean;
    /** Extract type definitions */
    extractTypes?: boolean;
  };
}

/**
 * Adapter for parsing code sources (TypeScript, Python, etc.)
 */
export class CodeSourceAdapter extends SourceAdapter {
  readonly type = 'code';
  readonly adapterName: string;
  private registry: ParserRegistry;
  private uuidCache: Map<string, Map<string, string>>; // filePath -> (key -> uuid)

  constructor(adapterName: 'typescript' | 'python') {
    super();
    this.adapterName = adapterName;
    this.registry = this.initializeRegistry();
    this.uuidCache = new Map();
  }

  /**
   * Initialize parser registry with available language parsers
   */
  private initializeRegistry(): ParserRegistry {
    const registry = new ParserRegistry();
    registry.register(new TypeScriptLanguageParser());
    registry.register(new PythonLanguageParser());
    return registry;
  }

  /**
   * Validate source configuration
   */
  async validate(config: SourceConfig): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (config.type !== 'code') {
      errors.push(`Invalid source type: ${config.type}. Expected 'code'`);
    }

    if (!config.root) {
      warnings.push('No root directory specified. Will use current working directory');
    }

    if (!config.include || config.include.length === 0) {
      warnings.push('No include patterns specified. Will parse all files in root directory');
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
      warnings: warnings.length > 0 ? warnings : undefined
    };
  }

  /**
   * Parse source into Neo4j graph structure
   */
  async parse(options: ParseOptions): Promise<ParseResult> {
    const startTime = Date.now();
    const config = options.source as CodeSourceConfig;

    // Detect project information
    const projectRoot = config.root || process.cwd();
    const projectInfo = await this.detectProjectInfo(projectRoot);
    console.log(`  ✓ Project: ${projectInfo.name}${projectInfo.gitRemote ? ' (' + projectInfo.gitRemote + ')' : ''}`);

    // Initialize ImportResolver for TypeScript projects
    const resolver = new ImportResolver(projectRoot);
    if (config.adapter === 'typescript') {
      try {
        await resolver.loadTsConfig();
        console.log('  ✓ Import resolver initialized with tsconfig.json');
      } catch (error) {
        console.warn('  ⚠️  No tsconfig.json found, continuing without import resolution');
      }
    }

    // Report progress: discovering files
    options.onProgress?.({
      phase: 'discovering',
      filesProcessed: 0,
      totalFiles: 0,
      percentComplete: 0
    });

    // Discover files to parse
    const files = await this.discoverFiles(config);

    if (files.length === 0) {
      return {
        graph: {
          nodes: [],
          relationships: [],
          metadata: {
            filesProcessed: 0,
            nodesGenerated: 0,
            relationshipsGenerated: 0,
            parseTimeMs: Date.now() - startTime,
            warnings: ['No files found matching include/exclude patterns']
          }
        },
        isIncremental: false
      };
    }

    // Report progress: parsing
    options.onProgress?.({
      phase: 'parsing',
      filesProcessed: 0,
      totalFiles: files.length,
      percentComplete: 0
    });

    // Parse all files
    const parsedFiles = await this.parseFiles(files, config, (current) => {
      options.onProgress?.({
        phase: 'parsing',
        currentFile: current,
        filesProcessed: files.indexOf(current) + 1,
        totalFiles: files.length,
        percentComplete: ((files.indexOf(current) + 1) / files.length) * 100
      });
    });

    // Report progress: building graph
    options.onProgress?.({
      phase: 'building_graph',
      filesProcessed: files.length,
      totalFiles: files.length,
      percentComplete: 100
    });

    // Build graph structure
    const graph = await this.buildGraph(parsedFiles, config, resolver, projectInfo);

    // Export XML if requested
    if (config.options?.exportXml) {
      await this.exportXml(parsedFiles, config);
    }

    // Report progress: complete
    options.onProgress?.({
      phase: 'complete',
      filesProcessed: files.length,
      totalFiles: files.length,
      percentComplete: 100
    });

    return {
      graph,
      isIncremental: false // TODO: Implement incremental updates
    };
  }

  /**
   * Discover files to parse based on include/exclude patterns
   */
  private async discoverFiles(config: CodeSourceConfig): Promise<string[]> {
    const patterns = config.include || ['**/*.ts', '**/*.tsx', '**/*.py'];
    const ignore = config.exclude || [
      '**/node_modules/**',
      '**/dist/**',
      '**/.git/**',
      '**/*.test.ts',
      '**/*.spec.ts'
    ];

    return await globby(patterns, {
      cwd: config.root || process.cwd(),
      ignore,
      absolute: true
    });
  }

  /**
   * Parse all files
   */
  private async parseFiles(
    files: string[],
    config: CodeSourceConfig,
    onProgress: (file: string) => void
  ): Promise<Map<string, ScopeFileAnalysis>> {
    const results = new Map<string, ScopeFileAnalysis>();

    for (const file of files) {
      onProgress(file);

      try {
        const parser = this.registry.getParserForFile(file);
        if (!parser) {
          console.warn(`No parser found for file: ${file}`);
          continue;
        }

        // Initialize parser if not already initialized
        if (!this.registry.isInitialized(parser.language)) {
          await this.registry.initializeParser(parser.language);
        }

        const content = await import('fs').then(fs => fs.promises.readFile(file, 'utf-8'));
        const universalAnalysis = await parser.parseFile(file, content);

        // Convert universal analysis to ScopeFileAnalysis format
        const analysis: ScopeFileAnalysis = {
          filePath: file,
          totalScopes: universalAnalysis.scopes.length,
          imports: universalAnalysis.imports.map(imp => imp.source),
          dependencies: [],
          scopes: universalAnalysis.scopes.map(uScope => ({
            name: uScope.name,
            type: uScope.type as any,
            filePath: uScope.filePath,
            startLine: uScope.startLine,
            endLine: uScope.endLine,
            content: uScope.source || '',
            contentDedented: uScope.source || '',
            signature: uScope.signature || '',
            returnType: uScope.returnType,
            parameters: uScope.parameters || [],
            parent: uScope.parentName,
            depth: uScope.depth || 0,
            linesOfCode: uScope.endLine - uScope.startLine + 1,
            identifierReferences: uScope.references || [],
            importReferences: uScope.imports || [],
            modifiers: [],
            complexity: 0,
            children: [],
            imports: [],
            exports: [],
            dependencies: [],
            astValid: true,
            astIssues: [],
            astNotes: [],
            decorators: (uScope as any).decorators,
            docstring: (uScope as any).docstring,
            value: uScope.value,
            // Phase 3: Include languageSpecific metadata (heritage, generics, decorators, enums)
            languageSpecific: uScope.languageSpecific
          } as ScopeInfo)),
          exports: universalAnalysis.exports.map(e => e.exported),
          importReferences: universalAnalysis.imports.map(imp => ({
            source: imp.source,
            imported: imp.imported,
            alias: imp.alias,
            kind: imp.kind as any,
            isLocal: imp.source.startsWith('.') || imp.source.startsWith('/')
          })),
          totalLines: universalAnalysis.linesOfCode,
          astValid: true,
          astIssues: universalAnalysis.errors?.map(e => e.message) || []
        };

        results.set(file, analysis);
      } catch (error) {
        console.error(`Error parsing file ${file}:`, error);
      }
    }

    return results;
  }

  /**
   * Detect project information (git remote, name, etc.)
   */
  private async detectProjectInfo(projectPath: string): Promise<{
    name: string;
    gitRemote: string | null;
    rootPath: string;
  }> {
    const rootPath = projectPath;
    let gitRemote: string | null = null;

    // Try to get git remote
    try {
      const { stdout } = await execAsync('git remote get-url origin', { cwd: rootPath });
      gitRemote = stdout.trim();
    } catch {
      // Not a git repo or no origin
    }

    // Extract project name from git remote or use directory name
    let name: string;
    if (gitRemote) {
      // Extract from git remote: git@github.com:user/repo.git -> repo
      const match = gitRemote.match(/[\/:]([^\/]+?)(?:\.git)?$/);
      name = match ? match[1] : gitRemote.split('/').pop() || 'unknown';
    } else {
      // Use directory name
      name = rootPath.split('/').pop() || 'unknown';
    }

    return { name, gitRemote, rootPath };
  }

  /**
   * Build Neo4j graph structure from parsed files
   */
  private async buildGraph(
    parsedFiles: Map<string, ScopeFileAnalysis>,
    config: CodeSourceConfig,
    resolver: ImportResolver,
    projectInfo: { name: string; gitRemote: string | null; rootPath: string }
  ): Promise<ParsedGraph> {
    const nodes: ParsedNode[] = [];
    const relationships: ParsedRelationship[] = [];
    const scopeMap = new Map<string, ScopeInfo>(); // uuid -> ScopeInfo

    // Create Project node
    const projectId = `project:${projectInfo.name}`;
    nodes.push({
      labels: ['Project'],
      id: projectId,
      properties: {
        name: projectInfo.name,
        gitRemote: projectInfo.gitRemote || null,
        rootPath: projectInfo.rootPath,
        indexedAt: new Date().toISOString()
      }
    });

    // Build global UUID mapping first (needed for parentUUID)
    const globalUUIDMapping = this.buildGlobalUUIDMapping(parsedFiles);

    // Get project root for relative path calculation
    const projectRoot = config.root || process.cwd();

    // First pass: Create all scope nodes
    for (const [filePath, analysis] of parsedFiles) {
      // Calculate relative path from project root
      const relPath = path.relative(projectRoot, filePath);

      for (const scope of analysis.scopes) {
        const uuid = this.generateUUID(scope, filePath);
        scopeMap.set(uuid, scope);

        // Find parent UUID if this scope has a parent
        const parentUuid = scope.parent
          ? this.findParentUUID(scope, filePath, globalUUIDMapping)
          : undefined;

        // Extract TypeScript-specific metadata (Phase 3)
        const tsMetadata = (scope as any).languageSpecific?.typescript;

        nodes.push({
          labels: ['Scope'],
          id: uuid,
          properties: {
            uuid,
            name: scope.name,
            type: scope.type,
            file: relPath, // Use relative path
            language: config.adapter, // NEW: language (typescript/python)
            startLine: scope.startLine,
            endLine: scope.endLine,
            linesOfCode: scope.linesOfCode || (scope.endLine - scope.startLine + 1),
            source: scope.content || '',
            signature: this.extractSignature(scope),
            hash: this.hashScope(scope),
            // Additional properties from ScopeInfo
            ...(scope.returnType && { returnType: scope.returnType }),
            ...(scope.parameters && scope.parameters.length > 0 && {
              parameters: JSON.stringify(scope.parameters)
            }),
            ...(scope.parent && { parent: scope.parent }),
            ...(parentUuid && { parentUUID: parentUuid }), // parentUUID
            ...(scope.depth !== undefined && { depth: scope.depth }),
            ...(scope.modifiers && scope.modifiers.length > 0 && {
              modifiers: scope.modifiers.join(',')
            }),
            ...(scope.complexity !== undefined && { complexity: scope.complexity }),

            // Phase 3: Heritage clauses (extends/implements)
            ...(tsMetadata?.heritageClauses && tsMetadata.heritageClauses.length > 0 && {
              heritageClauses: JSON.stringify(tsMetadata.heritageClauses),
              extends: tsMetadata.heritageClauses
                .filter((c: any) => c.clause === 'extends')
                .flatMap((c: any) => c.types)
                .join(','),
              implements: tsMetadata.heritageClauses
                .filter((c: any) => c.clause === 'implements')
                .flatMap((c: any) => c.types)
                .join(',')
            }),

            // Phase 3: Generic parameters
            ...(tsMetadata?.genericParameters && tsMetadata.genericParameters.length > 0 && {
              genericParameters: JSON.stringify(tsMetadata.genericParameters),
              generics: tsMetadata.genericParameters.map((g: any) => g.name).join(',')
            }),

            // Phase 3: Decorators (TypeScript)
            ...(tsMetadata?.decoratorDetails && tsMetadata.decoratorDetails.length > 0 && {
              decoratorDetails: JSON.stringify(tsMetadata.decoratorDetails),
              decorators: tsMetadata.decoratorDetails.map((d: any) => d.name).join(',')
            }),

            // Phase 3: Enum members
            ...(tsMetadata?.enumMembers && tsMetadata.enumMembers.length > 0 && {
              enumMembers: JSON.stringify(tsMetadata.enumMembers)
            }),

            // Python-specific
            ...((scope as any).decorators && (scope as any).decorators.length > 0 && {
              decorators: (scope as any).decorators.join(',')
            }),
            ...((scope as any).docstring && { docstring: (scope as any).docstring }),
            // For constants/variables
            ...(scope.value && { value: scope.value })
          }
        });

        // Create HAS_PARENT relationship if parent exists
        if (parentUuid) {
          relationships.push({
            type: 'HAS_PARENT',
            from: uuid,
            to: parentUuid
          });
        }

        // Create BELONGS_TO relationship (Scope -> Project)
        relationships.push({
          type: 'BELONGS_TO',
          from: uuid,
          to: projectId
        });
      }

      // Create File node with full metadata (using relative paths)
      const fileName = relPath.split('/').pop() || relPath;
      const directory = relPath.includes('/') ? relPath.substring(0, relPath.lastIndexOf('/')) : '.';
      const extension = fileName.includes('.') ? fileName.substring(fileName.lastIndexOf('.')) : '';

      // Calculate content hash (SHA-256)
      const contentHash = createHash('sha256').update(analysis.scopes.map(s => s.content || '').join('')).digest('hex');

      nodes.push({
        labels: ['File'],
        id: `file:${relPath}`, // Use relative path for ID consistency
        properties: {
          path: relPath, // Use relative path in properties
          name: fileName,
          directory,
          extension,
          contentHash
        }
      });

      // Create BELONGS_TO relationship (File -> Project)
      relationships.push({
        type: 'BELONGS_TO',
        from: `file:${relPath}`,
        to: projectId
      });

      // Create DEFINED_IN relationships
      for (const scope of analysis.scopes) {
        const uuid = this.generateUUID(scope, filePath);
        relationships.push({
          type: 'DEFINED_IN',
          from: uuid,
          to: `file:${relPath}`
        });
      }
    }

    // Create Directory nodes and relationships (using relative paths)
    const directories = new Set<string>();

    // Extract all unique directories from file paths (using relative paths)
    for (const [filePath] of parsedFiles) {
      const relPath = path.relative(projectRoot, filePath);
      let currentPath = relPath;

      while (true) {
        const dir = currentPath.includes('/') ? currentPath.substring(0, currentPath.lastIndexOf('/')) : '';
        if (!dir || dir === '.' || dir === '') break;

        directories.add(dir);

        // Create IN_DIRECTORY relationship (File -> Directory)
        if (currentPath === relPath) {
          relationships.push({
            type: 'IN_DIRECTORY',
            from: `file:${relPath}`,
            to: `dir:${dir}`
          });
        }

        currentPath = dir;
      }
    }

    // Create Directory nodes
    for (const dir of directories) {
      const depth = dir.split('/').filter(p => p.length > 0).length;
      nodes.push({
        labels: ['Directory'],
        id: `dir:${dir}`,
        properties: {
          path: dir, // Already relative
          depth
        }
      });
    }

    // Create PARENT_OF relationships (Directory -> Directory)
    for (const dir of directories) {
      const parentDir = dir.includes('/') ? dir.substring(0, dir.lastIndexOf('/')) : '';
      if (parentDir && parentDir !== '.' && parentDir !== '' && directories.has(parentDir)) {
        relationships.push({
          type: 'PARENT_OF',
          from: `dir:${parentDir}`,
          to: `dir:${dir}`
        });
      }
    }

    // Second pass: Create scope relationships (CONSUMES, etc.)
    for (const [filePath, analysis] of parsedFiles) {
      for (const scope of analysis.scopes) {
        const sourceUuid = this.generateUUID(scope, filePath);

        // Build scope references (local_scope kind only)
        const scopeRefs = this.buildScopeReferences(scope, filePath, globalUUIDMapping);
        for (const targetUuid of scopeRefs) {
          const targetScope = scopeMap.get(targetUuid);

          // Detect inheritance: both source and target are classes
          const isInheritance =
            scope.type === 'class' &&
            targetScope?.type === 'class' &&
            this.isInheritanceReference(scope, targetScope);

          relationships.push({
            type: isInheritance ? 'INHERITS_FROM' : 'CONSUMES',
            from: sourceUuid,
            to: targetUuid
          });
        }

        // Build import references (using ImportResolver)
        const importRefs = await this.buildImportReferences(
          scope,
          filePath,
          resolver,
          globalUUIDMapping
        );
        for (const targetUuid of importRefs) {
          const targetScope = scopeMap.get(targetUuid);

          // Detect inheritance from imports (e.g., class extends BaseClass from './base')
          const isInheritance =
            scope.type === 'class' &&
            targetScope?.type === 'class' &&
            this.isInheritanceReference(scope, targetScope);

          relationships.push({
            type: isInheritance ? 'INHERITS_FROM' : 'CONSUMES',
            from: sourceUuid,
            to: targetUuid
          });
        }

        // Build class member references if this is a class
        if (scope.type === 'class') {
          const memberRefs = this.buildClassMemberReferences(
            scope,
            filePath,
            analysis.scopes,
            globalUUIDMapping
          );
          for (const memberUuid of memberRefs) {
            relationships.push({
              type: 'CONSUMES',
              from: sourceUuid,
              to: memberUuid
            });
          }
        }
      }
    }

    // Phase 3: Create INHERITS_FROM and IMPLEMENTS relationships from heritage clauses
    // This is more reliable than the heuristic-based detection above
    for (const [filePath, analysis] of parsedFiles) {
      for (const scope of analysis.scopes) {
        const tsMetadata = (scope as any).languageSpecific?.typescript;

        if (tsMetadata?.heritageClauses && tsMetadata.heritageClauses.length > 0) {
          const sourceUuid = this.generateUUID(scope, filePath);

          for (const clause of tsMetadata.heritageClauses) {
            for (const typeName of clause.types) {
              // Try to find the target scope by name
              // First check in same file
              let targetUuid: string | undefined;

              // Search in same file
              const sameFileScope = analysis.scopes.find(s => s.name === typeName);
              if (sameFileScope) {
                targetUuid = this.generateUUID(sameFileScope, filePath);
              } else {
                // Search in all parsed files
                for (const [mappedFilePath, mappedAnalysis] of parsedFiles) {
                  const foundScope = mappedAnalysis.scopes.find(s => s.name === typeName);
                  if (foundScope) {
                    targetUuid = this.generateUUID(foundScope, mappedFilePath);
                    break;
                  }
                }
              }

              if (targetUuid) {
                const relType = clause.clause === 'extends' ? 'INHERITS_FROM' : 'IMPLEMENTS';

                // Avoid duplicates - check if relationship already exists
                const isDuplicate = relationships.some(
                  r => r.type === relType && r.from === sourceUuid && r.to === targetUuid
                );

                if (!isDuplicate) {
                  relationships.push({
                    type: relType,
                    from: sourceUuid,
                    to: targetUuid,
                    properties: {
                      explicit: true, // Mark as explicitly declared (not heuristic)
                      clause: clause.clause
                    }
                  });
                }
              }
            }
          }
        }
      }
    }

    // Create ExternalLibrary nodes and USES_LIBRARY relationships
    const externalLibs = new Map<string, Set<string>>(); // library name -> symbols

    for (const [filePath, analysis] of parsedFiles) {
      for (const scope of analysis.scopes) {
        const sourceUuid = this.generateUUID(scope, filePath);

        // Extract external imports (isLocal === false)
        if (scope.importReferences && Array.isArray(scope.importReferences)) {
          for (const imp of scope.importReferences.filter(i => !i.isLocal)) {
            // Track library and its symbols
            if (!externalLibs.has(imp.source)) {
              externalLibs.set(imp.source, new Set());
            }
            externalLibs.get(imp.source)!.add(imp.imported);

            // Create USES_LIBRARY relationship
            relationships.push({
              type: 'USES_LIBRARY',
              from: sourceUuid,
              to: `lib:${imp.source}`,
              properties: {
                symbol: imp.imported
              }
            });
          }
        }
      }
    }

    // Create ExternalLibrary nodes
    for (const [libName] of externalLibs) {
      nodes.push({
        labels: ['ExternalLibrary'],
        id: `lib:${libName}`,
        properties: {
          name: libName
        }
      });
    }

    return {
      nodes,
      relationships,
      metadata: {
        filesProcessed: parsedFiles.size,
        nodesGenerated: nodes.length,
        relationshipsGenerated: relationships.length,
        parseTimeMs: 0 // Will be set by caller
      }
    };
  }

  /**
   * Calculate signature hash for a scope (ported from buildXmlScopes.ts)
   * Hash is stable across builds if the scope signature doesn't change
   * Includes parent context to differentiate methods in different classes
   */
  private getSignatureHash(scope: ScopeInfo): string {
    // Include parent name for methods to avoid collisions
    // e.g., "MyClass.myMethod" vs "OtherClass.myMethod"
    const parentPrefix = scope.parent ? `${scope.parent}.` : '';

    // Use signature if available, otherwise build from name:type:content
    const baseInput = scope.signature ||
      `${scope.name}:${scope.type}:${scope.contentDedented || scope.content}`;

    let hashInput = `${parentPrefix}${baseInput}`;

    // For variables/constants: include line number to differentiate same-name vars
    // (e.g., let v = '' at line 45 and let v = ... at line 358)
    if (scope.type === 'variable' || scope.type === 'constant') {
      hashInput += `:line${scope.startLine}`;
    }

    return createHash('sha256')
      .update(hashInput)
      .digest('hex')
      .substring(0, 8); // 8-char hash like original
  }

  /**
   * Get or generate UUID for a scope
   * Uses signature hash to create stable UUIDs that survive refactoring
   * Cache key format: "name:type:signatureHash"
   */
  private generateUUID(scope: ScopeInfo, filePath: string): string {
    // Get or create cache for this file
    if (!this.uuidCache.has(filePath)) {
      this.uuidCache.set(filePath, new Map());
    }
    const fileCache = this.uuidCache.get(filePath)!;

    // Calculate signature hash
    const signatureHash = this.getSignatureHash(scope);
    const cacheKey = `${scope.name}:${scope.type}:${signatureHash}`;

    // Try to reuse existing UUID from cache
    if (fileCache.has(cacheKey)) {
      return fileCache.get(cacheKey)!;
    }

    // Generate new UUID
    const uuid = UniqueIDHelper.GenerateUUID();
    fileCache.set(cacheKey, uuid);
    return uuid;
  }

  /**
   * Hash scope content for incremental updates
   */
  private hashScope(scope: ScopeInfo): string {
    // Use same hash as signature for consistency
    return this.getSignatureHash(scope);
  }

  /**
   * Extract signature from scope
   * Returns the actual signature string, not just "type name"
   */
  private extractSignature(scope: ScopeInfo): string {
    // If scope already has a signature, use it
    if (scope.signature) {
      return scope.signature;
    }

    // Build signature based on scope type
    const parts: string[] = [];

    // Modifiers
    if (scope.modifiers && scope.modifiers.length > 0) {
      parts.push(scope.modifiers.join(' '));
    }

    // Type keyword
    parts.push(scope.type);

    // Name
    parts.push(scope.name);

    // Parameters (for functions/methods)
    if (scope.parameters && scope.parameters.length > 0) {
      const params = scope.parameters.map(p => {
        let param = p.name;
        if (p.type) param += `: ${p.type}`;
        if (p.optional) param += '?';
        return param;
      }).join(', ');
      parts.push(`(${params})`);
    } else if (scope.type === 'function' || scope.type === 'method') {
      parts.push('()');
    }

    // Return type
    if (scope.returnType) {
      parts.push(`: ${scope.returnType}`);
    }

    return parts.join(' ');
  }

  /**
   * Check if a reference is an inheritance relationship
   * Looks for "extends" keyword in context or signature
   */
  private isInheritanceReference(scope: ScopeInfo, target: ScopeInfo): boolean {
    // TypeScript/JavaScript: Check if any identifier reference to target contains "extends"
    if (scope.identifierReferences && Array.isArray(scope.identifierReferences)) {
      for (const ref of scope.identifierReferences) {
        if (ref.identifier === target.name) {
          // Check context for "extends" keyword
          if (ref.context && ref.context.includes('extends')) {
            return true;
          }
        }
      }
    }

    // TypeScript/JavaScript: Check class signature for "extends" keyword
    if (scope.signature && scope.signature.includes('extends') && scope.signature.includes(target.name)) {
      return true;
    }

    // Cross-file inheritance: Check if target is imported and signature has "extends"
    // This handles cases like: class CodeSourceAdapter extends SourceAdapter (where SourceAdapter is imported)
    if (scope.importReferences && Array.isArray(scope.importReferences)) {
      const hasImportedTarget = scope.importReferences.some(
        imp => imp.imported === target.name || imp.source === target.name
      );
      if (hasImportedTarget && scope.signature && scope.signature.includes('extends')) {
        // Check if the signature explicitly mentions the target class after "extends"
        const extendsPattern = new RegExp(`extends\\s+${target.name}\\b`);
        if (extendsPattern.test(scope.signature)) {
          return true;
        }
      }
    }

    // Python: check for parent class in class definition
    // e.g., "class MyClass(BaseClass):"
    if (scope.content) {
      const firstLine = scope.content.split('\n')[0];
      if (firstLine.includes('class') && firstLine.includes('(') && firstLine.includes(target.name)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Find parent UUID for a scope
   */
  private findParentUUID(
    scope: ScopeInfo,
    filePath: string,
    globalUUIDMapping: Map<string, Array<{ uuid: string; file: string; type: string }>>
  ): string | undefined {
    if (!scope.parent) return undefined;

    const candidates = globalUUIDMapping.get(scope.parent) || [];
    // Match by file to avoid collisions
    const match = candidates.find(c => c.file === filePath);
    return match?.uuid;
  }

  /**
   * Build global UUID mapping (name -> [{uuid, file, type}])
   * Supports multiple scopes with same name (distinguished by file and type)
   * Ported from buildXmlScopes.ts:908-927
   */
  private buildGlobalUUIDMapping(
    parsedFiles: Map<string, ScopeFileAnalysis>
  ): Map<string, Array<{ uuid: string; file: string; type: string }>> {
    const mapping = new Map<string, Array<{ uuid: string; file: string; type: string }>>();

    for (const [filePath, analysis] of parsedFiles) {
      for (const scope of analysis.scopes) {
        const uuid = this.generateUUID(scope, filePath);

        if (!mapping.has(scope.name)) {
          mapping.set(scope.name, []);
        }
        mapping.get(scope.name)!.push({
          uuid,
          file: filePath,
          type: scope.type
        });
      }
    }

    return mapping;
  }

  /**
   * Build scope references from identifierReferences
   * Only processes local_scope kind (references in same file)
   * Ported from buildXmlScopes.ts:307-349
   */
  private buildScopeReferences(
    scope: ScopeInfo,
    filePath: string,
    globalUUIDMapping: Map<string, Array<{ uuid: string; file: string; type: string }>>
  ): string[] {
    const references: string[] = [];

    // Handle scopes without detailed identifier references
    if (!scope.identifierReferences || !Array.isArray(scope.identifierReferences)) {
      return references;
    }

    for (const ref of scope.identifierReferences) {
      // TypeScript: explicit local_scope references
      if (ref.kind === 'local_scope' && ref.targetScope) {
        const candidates = globalUUIDMapping.get(ref.identifier) || [];
        // Match by file to avoid collisions
        const match = candidates.find(c => c.file === filePath);

        if (match && !references.includes(match.uuid)) {
          references.push(match.uuid);
        }
      }
    }

    return references;
  }

  /**
   * Build import references with resolved file paths and UUIDs
   * Ported from buildXmlScopes.ts:355-437
   */
  private async buildImportReferences(
    scope: ScopeInfo,
    currentFile: string,
    resolver: ImportResolver,
    globalUUIDMapping: Map<string, Array<{ uuid: string; file: string; type: string }>>
  ): Promise<string[]> {
    const imports: string[] = [];

    // Handle scopes without detailed references
    if (!scope.importReferences || !Array.isArray(scope.importReferences)) {
      return imports;
    }
    if (!scope.identifierReferences || !Array.isArray(scope.identifierReferences)) {
      return imports;
    }

    // Process only local imports
    for (const imp of scope.importReferences.filter(i => i.isLocal)) {
      for (const ref of scope.identifierReferences) {
        if (ref.kind === 'import' && ref.source === imp.source && ref.identifier === imp.imported) {
          // Resolve the import to actual source file
          let resolvedPath = await resolver.resolveImport(imp.source, currentFile);

          // Follow re-exports to find the actual source file where the symbol is defined
          if (resolvedPath) {
            resolvedPath = await resolver.followReExports(resolvedPath, imp.imported);
          }

          const resolvedFile = resolvedPath ? resolver.getRelativePath(resolvedPath) : undefined;

          // Try to find UUID for the imported symbol
          let symbolUUID: string | undefined;
          const candidates = globalUUIDMapping.get(imp.imported) || [];

          if (resolvedFile && candidates.length > 0) {
            // Filter candidates by file
            const fileCandidates = candidates.filter(c => c.file === resolvedFile);

            if (fileCandidates.length === 1) {
              // Only one match, use it
              symbolUUID = fileCandidates[0].uuid;
            } else if (fileCandidates.length > 1) {
              // Multiple scopes with same name in same file (e.g., interface Foo + function Foo)
              // Prioritize value types (function, const, class) over type-only (interface, type)
              const valueTypes = ['function', 'const', 'class', 'method'];
              const valueCandidate = fileCandidates.find(c => valueTypes.includes(c.type));
              symbolUUID = (valueCandidate || fileCandidates[0]).uuid;
            }
          } else if (candidates.length === 1) {
            // Only one scope with this name, use it
            symbolUUID = candidates[0].uuid;
          }
          // If multiple candidates and no resolved file, we can't determine which one

          if (symbolUUID && !imports.includes(symbolUUID)) {
            imports.push(symbolUUID);
          }
        }
      }
    }

    return imports;
  }

  /**
   * Build class member references
   * Finds all scopes that have this class as parent
   * Ported from buildXmlScopes.ts:496-524
   */
  private buildClassMemberReferences(
    classScope: ScopeInfo,
    filePath: string,
    allFileScopes: ScopeInfo[],
    globalUUIDMapping: Map<string, Array<{ uuid: string; file: string; type: string }>>
  ): string[] {
    const members: string[] = [];

    // Find all scopes that have this class as parent
    for (const otherScope of allFileScopes) {
      if (otherScope.parent === classScope.name && otherScope.filePath === filePath) {
        // This is a member of the class (method, attribute, nested class, etc.)
        const candidates = globalUUIDMapping.get(otherScope.name) || [];
        const match = candidates.find(c => c.file === filePath);

        if (match && !members.includes(match.uuid)) {
          members.push(match.uuid);
        }
      }
    }

    return members;
  }

  /**
   * Export parsed data to XML (for debugging)
   */
  private async exportXml(
    parsedFiles: Map<string, ScopeFileAnalysis>,
    config: CodeSourceConfig
  ): Promise<void> {
    // TODO: Implement XML export using fast-xml-parser
    console.log('XML export requested but not yet implemented');
  }
}
