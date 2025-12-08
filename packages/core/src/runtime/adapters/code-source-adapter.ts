/**
 * Code Source Adapter
 *
 * Parses codebases (TypeScript, Python, etc.) into Neo4j graph structure
 * using @luciformresearch/codeparsers
 *
 * NOTE: Historically, this adapter required specifying a language type (typescript,
 * python, html, auto) to determine which parser to use. This is becoming increasingly
 * irrelevant as we evolve toward a generalist code agent that automatically handles
 * all file types. The adapter now auto-detects file types and uses the appropriate
 * parser regardless of the configured adapter type. Eventually, the adapter field
 * may be deprecated entirely.
 */

import { globby } from 'globby';
import { createHash } from 'crypto';
import * as path from 'path';
import * as fs from 'fs/promises';
import pLimit from 'p-limit';
import { formatLocalDate } from '../utils/timestamp.js';
import {
  ParserRegistry,
  TypeScriptLanguageParser,
  PythonLanguageParser,
  HTMLDocumentParser,
  CSSParser,
  SCSSParser,
  VueParser,
  SvelteParser,
  MarkdownParser,
  GenericCodeParser,
  // TODO: Migrate to UniversalScope/FileAnalysis from './base'
  // These internal types (ScopeInfo, ScopeFileAnalysis) are used throughout this file
  // and require a larger refactoring effort to replace with the universal types.
  // See convertUniversalToScopeFileAnalysis() for the conversion layer.
  type ScopeFileAnalysis,
  type ScopeInfo,
  type HTMLParseResult,
  type DocumentInfo,
  type CSSParseResult,
  type StylesheetInfo,
  type SCSSParseResult,
  type VueSFCParseResult,
  type SvelteParseResult,
  type MarkdownParseResult,
  type GenericFileAnalysis,
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
import { getLocalTimestamp } from '../utils/timestamp.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
  parseDataFile,
  isDataFile,
  type DataFileInfo,
} from './data-file-parser.js';
import {
  parseMediaFile,
  isMediaFile,
  type MediaFileInfo,
  type ImageFileInfo,
  type ThreeDFileInfo,
  type PDFFileInfo,
} from './media-file-parser.js';
import {
  parseDocumentFile,
  isDocumentFile,
  type DocumentFileInfo,
  type SpreadsheetInfo,
  type PDFInfo,
  type DOCXInfo,
} from './document-file-parser.js';

const execAsync = promisify(exec);

/**
 * Code-specific source configuration
 *
 * @deprecated The 'adapter' field is becoming irrelevant. The code adapter now
 * auto-detects file types and uses appropriate parsers. Use 'auto' for new projects.
 */
export interface CodeSourceConfig extends SourceConfig {
  type: 'code';
  /**
   * @deprecated Use 'auto' - file types are now auto-detected regardless of this setting.
   * Kept for backward compatibility with existing configurations.
   */
  adapter: 'typescript' | 'python' | 'html' | 'auto';
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
 * Parsed package.json information
 */
export interface PackageJsonInfo {
  file: string;
  name: string;
  version: string;
  description?: string;
  dependencies: string[];
  devDependencies: string[];
  peerDependencies: string[];
  scripts: string[];
  main?: string;
  type?: 'module' | 'commonjs';
  raw: Record<string, any>;
}

/**
 * Adapter for parsing code sources (TypeScript, Python, HTML/Vue, etc.)
 */
export class CodeSourceAdapter extends SourceAdapter {
  readonly type = 'code';
  readonly adapterName: string;
  private registry: ParserRegistry;
  private htmlParser: HTMLDocumentParser | null = null;
  private cssParser: CSSParser | null = null;
  private scssParser: SCSSParser | null = null;
  private vueParser: VueParser | null = null;
  private svelteParser: SvelteParser | null = null;
  private markdownParser: MarkdownParser | null = null;
  private genericParser: GenericCodeParser | null = null;
  private uuidCache: Map<string, Map<string, string>>; // filePath -> (key -> uuid)

  constructor(adapterName: 'typescript' | 'python' | 'html' | 'auto') {
    super();
    this.adapterName = adapterName;
    this.registry = this.initializeRegistry();
    this.uuidCache = new Map();
  }

  /**
   * Compute file metadata for incremental ingestion
   * Returns rawContentHash (for pre-parsing skip) and mtime
   */
  private async computeFileMetadata(filePath: string): Promise<{
    rawContentHash?: string;
    mtime?: string;
  }> {
    try {
      const [fileContent, stat] = await Promise.all([
        fs.readFile(filePath),
        fs.stat(filePath)
      ]);
      return {
        rawContentHash: createHash('sha256').update(fileContent).digest('hex'),
        mtime: formatLocalDate(stat.mtime)
      };
    } catch {
      return {};
    }
  }

  /**
   * Get or initialize HTML parser
   */
  private async getHtmlParser(): Promise<HTMLDocumentParser> {
    if (!this.htmlParser) {
      this.htmlParser = new HTMLDocumentParser();
      await this.htmlParser.initialize();
    }
    return this.htmlParser;
  }

  /**
   * Get or initialize CSS parser
   */
  private async getCssParser(): Promise<CSSParser> {
    if (!this.cssParser) {
      this.cssParser = new CSSParser();
      await this.cssParser.initialize();
    }
    return this.cssParser;
  }

  /**
   * Get or initialize SCSS parser
   */
  private async getScssParser(): Promise<SCSSParser> {
    if (!this.scssParser) {
      this.scssParser = new SCSSParser();
      await this.scssParser.initialize();
    }
    return this.scssParser;
  }

  /**
   * Get or initialize Vue parser
   */
  private async getVueParser(): Promise<VueParser> {
    if (!this.vueParser) {
      this.vueParser = new VueParser();
      await this.vueParser.initialize();
    }
    return this.vueParser;
  }

  /**
   * Get or initialize Svelte parser
   */
  private async getSvelteParser(): Promise<SvelteParser> {
    if (!this.svelteParser) {
      this.svelteParser = new SvelteParser();
      await this.svelteParser.initialize();
    }
    return this.svelteParser;
  }

  /**
   * Get or initialize Markdown parser
   */
  private async getMarkdownParser(): Promise<MarkdownParser> {
    if (!this.markdownParser) {
      this.markdownParser = new MarkdownParser();
      await this.markdownParser.initialize();
    }
    return this.markdownParser;
  }

  /**
   * Get or initialize Generic code parser (fallback for unknown languages)
   */
  private async getGenericParser(): Promise<GenericCodeParser> {
    if (!this.genericParser) {
      this.genericParser = new GenericCodeParser();
      await this.genericParser.initialize();
    }
    return this.genericParser;
  }

  /**
   * Check if a file is a plain HTML file (not Vue/Svelte)
   */
  private isHtmlFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return ['.html', '.htm', '.astro'].includes(ext);
  }

  /**
   * Check if a file is a Vue SFC
   */
  private isVueFile(filePath: string): boolean {
    return path.extname(filePath).toLowerCase() === '.vue';
  }

  /**
   * Check if a file is a Svelte component
   */
  private isSvelteFile(filePath: string): boolean {
    return path.extname(filePath).toLowerCase() === '.svelte';
  }

  /**
   * Check if a file is a plain CSS file
   */
  private isCssFile(filePath: string): boolean {
    return path.extname(filePath).toLowerCase() === '.css';
  }

  /**
   * Check if a file is an SCSS file
   */
  private isScssFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return ['.scss', '.sass'].includes(ext);
  }

  /**
   * Check if a file is a Markdown file
   */
  private isMarkdownFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return ['.md', '.mdx', '.markdown'].includes(ext);
  }

  /**
   * Check if a file is a text file that should be chunked
   */
  private isTextFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return ['.txt', '.log', '.env.example', '.gitignore', '.dockerignore'].includes(ext) ||
           filePath.endsWith('.env.example') ||
           path.basename(filePath).startsWith('.');
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
    let files = await this.discoverFiles(config);

    // Filter out files that should be skipped (incremental ingestion)
    const rootDir = config.root || process.cwd();
    if (options.skipFiles && options.skipFiles.size > 0) {
      const beforeCount = files.length;
      files = files.filter(f => {
        const relPath = path.relative(rootDir, f);
        return !options.skipFiles!.has(relPath);
      });
      const skipped = beforeCount - files.length;
      if (skipped > 0) {
        console.log(`[CodeSourceAdapter] Skipped ${skipped} unchanged files (incremental)`);
      }
    }

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
    const {
      codeFiles,
      htmlFiles,
      cssFiles,
      scssFiles,
      vueFiles,
      svelteFiles,
      markdownFiles,
      genericFiles,
      packageJsonFiles,
      dataFiles,
      mediaFiles,
      documentFiles
    } = await this.parseFiles(files, config, (current) => {
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
    const graph = await this.buildGraph({
      codeFiles,
      htmlFiles,
      cssFiles,
      scssFiles,
      vueFiles,
      svelteFiles,
      markdownFiles,
      genericFiles,
      packageJsonFiles,
      dataFiles,
      mediaFiles,
      documentFiles
    }, config, resolver, projectInfo);

    // Export XML if requested
    if (config.options?.exportXml) {
      await this.exportXml(codeFiles, config);
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
    const patterns = config.include || ['**/*.ts', '**/*.tsx', '**/*.py', 'package.json'];
    const ignore = config.exclude || [
      '**/node_modules/**',
      '**/dist/**',
      '**/.git/**',
      '**/.ragforge/**',
      '**/__pycache__/**',
      '**/target/**',
      '**/*.test.ts',
      '**/*.spec.ts'
    ];

    const cwd = config.root || process.cwd();

    const files = await globby(patterns, {
      cwd,
      ignore,
      absolute: true
    });

    // Always include package.json from project root if it exists
    const fs = await import('fs/promises');
    const packageJsonPath = path.join(cwd, 'package.json');
    try {
      await fs.access(packageJsonPath);
      if (!files.includes(packageJsonPath)) {
        files.push(packageJsonPath);
      }
    } catch {
      // No package.json in root, that's OK
    }

    return files;
  }

  /**
   * Check if a file is a package.json
   */
  private isPackageJson(filePath: string): boolean {
    return path.basename(filePath) === 'package.json';
  }

  /**
   * Parsed package.json info
   */
  private parsePackageJson(content: string, filePath: string): PackageJsonInfo | null {
    try {
      const pkg = JSON.parse(content);
      return {
        file: filePath,
        name: pkg.name || path.basename(path.dirname(filePath)),
        version: pkg.version || '0.0.0',
        description: pkg.description,
        dependencies: Object.keys(pkg.dependencies || {}),
        devDependencies: Object.keys(pkg.devDependencies || {}),
        peerDependencies: Object.keys(pkg.peerDependencies || {}),
        scripts: Object.keys(pkg.scripts || {}),
        main: pkg.main,
        type: pkg.type, // 'module' or 'commonjs'
        raw: pkg, // Keep full object for queries
      };
    } catch {
      console.warn(`Failed to parse package.json: ${filePath}`);
      return null;
    }
  }

  /**
   * Parse all files (code, HTML, CSS, Vue, Svelte, SCSS, Markdown, and package.json)
   * Uses p-limit for parallel processing (10 concurrent files)
   */
  private async parseFiles(
    files: string[],
    config: CodeSourceConfig,
    onProgress: (file: string) => void
  ): Promise<{
    codeFiles: Map<string, ScopeFileAnalysis>;
    htmlFiles: Map<string, HTMLParseResult>;
    cssFiles: Map<string, CSSParseResult>;
    scssFiles: Map<string, SCSSParseResult>;
    vueFiles: Map<string, VueSFCParseResult>;
    svelteFiles: Map<string, SvelteParseResult>;
    markdownFiles: Map<string, MarkdownParseResult>;
    genericFiles: Map<string, GenericFileAnalysis>;
    packageJsonFiles: Map<string, PackageJsonInfo>;
    dataFiles: Map<string, DataFileInfo>;
    mediaFiles: Map<string, MediaFileInfo>;
    documentFiles: Map<string, DocumentFileInfo>;
  }> {
    const codeFiles = new Map<string, ScopeFileAnalysis>();
    const htmlFiles = new Map<string, HTMLParseResult>();
    const cssFiles = new Map<string, CSSParseResult>();
    const scssFiles = new Map<string, SCSSParseResult>();
    const vueFiles = new Map<string, VueSFCParseResult>();
    const svelteFiles = new Map<string, SvelteParseResult>();
    const markdownFiles = new Map<string, MarkdownParseResult>();
    const genericFiles = new Map<string, GenericFileAnalysis>();
    const packageJsonFiles = new Map<string, PackageJsonInfo>();
    const dataFiles = new Map<string, DataFileInfo>();
    const mediaFiles = new Map<string, MediaFileInfo>();
    const documentFiles = new Map<string, DocumentFileInfo>();

    // Use p-limit for parallel processing (10 concurrent files)
    const limit = pLimit(10);
    let filesProcessed = 0;

    // Pre-initialize all parsers BEFORE parallel processing to avoid race conditions
    // Detect which parsers we'll need based on file extensions
    const needsTs = files.some(f => /\.(ts|tsx|js|jsx)$/i.test(f));
    const needsPy = files.some(f => /\.py$/i.test(f));
    const needsVue = files.some(f => /\.vue$/i.test(f));
    const needsSvelte = files.some(f => /\.svelte$/i.test(f));
    const needsHtml = files.some(f => /\.html?$/i.test(f));
    const needsCss = files.some(f => /\.css$/i.test(f));
    const needsScss = files.some(f => /\.scss$/i.test(f));
    const needsMd = files.some(f => /\.mdx?$/i.test(f));

    // Initialize parsers in parallel
    await Promise.all([
      needsTs && this.registry.initializeParser('typescript').catch(() => {}),
      needsPy && this.registry.initializeParser('python').catch(() => {}),
      needsVue && this.getVueParser().catch(() => {}),
      needsSvelte && this.getSvelteParser().catch(() => {}),
      needsHtml && this.getHtmlParser().catch(() => {}),
      needsCss && this.getCssParser().catch(() => {}),
      needsScss && this.getScssParser().catch(() => {}),
      needsMd && this.getMarkdownParser().catch(() => {}),
    ].filter(Boolean));

    // Parse single file and return typed result
    const parseFile = async (file: string): Promise<void> => {
      try {
        // Handle document files first (PDF, DOCX, XLSX - binary with full text extraction)
        if (isDocumentFile(file)) {
          try {
            const docInfo = await parseDocumentFile(file, { extractText: true });
            if (docInfo) {
              documentFiles.set(file, docInfo);
            }
          } catch (err) {
            console.warn(`Failed to parse document file ${file}:`, err);
          }
          return;
        }

        // Handle media files (images, 3D - binary, metadata only)
        if (isMediaFile(file)) {
          try {
            const mediaInfo = await parseMediaFile(file);
            if (mediaInfo) {
              mediaFiles.set(file, mediaInfo);
            }
          } catch (err) {
            console.warn(`Failed to parse media file ${file}:`, err);
          }
          return;
        }

        const content = await import('fs').then(fs => fs.promises.readFile(file, 'utf-8'));

        // Handle package.json files
        if (this.isPackageJson(file)) {
          const pkgInfo = this.parsePackageJson(content, file);
          if (pkgInfo) {
            packageJsonFiles.set(file, pkgInfo);
          }
          return;
        }

        // Handle Vue SFC files
        if (this.isVueFile(file)) {
          const vueParser = await this.getVueParser();
          const result = await vueParser.parseFile(file, content);
          vueFiles.set(file, result);
          return;
        }

        // Handle Svelte component files
        if (this.isSvelteFile(file)) {
          const svelteParser = await this.getSvelteParser();
          const result = await svelteParser.parseFile(file, content);
          svelteFiles.set(file, result);
          return;
        }

        // Handle HTML files (not Vue/Svelte)
        if (this.isHtmlFile(file)) {
          const htmlParser = await this.getHtmlParser();
          const result = await htmlParser.parseFile(file, content, { parseScripts: true });
          htmlFiles.set(file, result);
          return;
        }

        // Handle SCSS files
        if (this.isScssFile(file)) {
          const scssParser = await this.getScssParser();
          const result = await scssParser.parseFile(file, content);
          scssFiles.set(file, result);
          return;
        }

        // Handle CSS files
        if (this.isCssFile(file)) {
          const cssParser = await this.getCssParser();
          const result = await cssParser.parseFile(file, content);
          cssFiles.set(file, result);
          return;
        }

        // Handle Markdown files
        if (this.isMarkdownFile(file)) {
          const mdParser = await this.getMarkdownParser();
          const result = await mdParser.parseFile(file, content, { parseCodeBlocks: true });
          markdownFiles.set(file, result);
          return;
        }

        // Handle data files (JSON, YAML, XML, TOML, ENV) - but not package.json which is handled separately
        if (isDataFile(file) && !this.isPackageJson(file)) {
          try {
            const dataInfo = parseDataFile(file, content);
            dataFiles.set(file, dataInfo);
          } catch (err) {
            console.warn(`Failed to parse data file ${file}:`, err);
          }
          return;
        }

        // Handle TypeScript/Python files with ParserRegistry (parsers pre-initialized above)
        const parser = this.registry.getParserForFile(file);
        if (parser) {
          const universalAnalysis = await parser.parseFile(file, content);

          // LEGACY CONVERSION: Convert UniversalScope/FileAnalysis → ScopeInfo/ScopeFileAnalysis
          // This conversion exists because the rest of this file uses the internal types.
          // TODO: Refactor this file to use UniversalScope/FileAnalysis directly and remove this conversion.
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

          codeFiles.set(file, analysis);
          return;
        }

        // Fallback: Use GenericCodeParser for unknown code files
        // This handles any code file that doesn't have a dedicated parser
        const genericParser = await this.getGenericParser();
        const genericResult = await genericParser.parseFile(file, content);
        genericFiles.set(file, genericResult);

      } catch (error) {
        console.error(`Error parsing file ${file}:`, error);
      } finally {
        filesProcessed++;
        onProgress(file);
      }
    };

    // Process all files in parallel with concurrency limit
    await Promise.all(
      files.map(file => limit(() => parseFile(file)))
    );

    return { codeFiles, htmlFiles, cssFiles, scssFiles, vueFiles, svelteFiles, markdownFiles, genericFiles, packageJsonFiles, dataFiles, mediaFiles, documentFiles };
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
    parsedFiles: {
      codeFiles: Map<string, ScopeFileAnalysis>;
      htmlFiles: Map<string, HTMLParseResult>;
      cssFiles: Map<string, CSSParseResult>;
      scssFiles: Map<string, SCSSParseResult>;
      vueFiles: Map<string, VueSFCParseResult>;
      svelteFiles: Map<string, SvelteParseResult>;
      markdownFiles: Map<string, MarkdownParseResult>;
      genericFiles: Map<string, GenericFileAnalysis>;
      packageJsonFiles: Map<string, PackageJsonInfo>;
      dataFiles: Map<string, DataFileInfo>;
      mediaFiles: Map<string, MediaFileInfo>;
      documentFiles: Map<string, DocumentFileInfo>;
    },
    config: CodeSourceConfig,
    resolver: ImportResolver,
    projectInfo: { name: string; gitRemote: string | null; rootPath: string }
  ): Promise<ParsedGraph> {
    const {
      codeFiles,
      htmlFiles,
      cssFiles,
      scssFiles,
      vueFiles,
      svelteFiles,
      markdownFiles,
      genericFiles,
      packageJsonFiles,
      dataFiles,
      mediaFiles,
      documentFiles
    } = parsedFiles;
    const nodes: ParsedNode[] = [];
    const relationships: ParsedRelationship[] = [];
    const scopeMap = new Map<string, ScopeInfo>(); // uuid -> ScopeInfo

    // Create Project node
    const projectId = `project:${projectInfo.name}`;
    nodes.push({
      labels: ['Project'],
      id: projectId,
      properties: {
        uuid: projectId, // Required for relationship matching
        name: projectInfo.name,
        gitRemote: projectInfo.gitRemote || null,
        rootPath: projectInfo.rootPath,
        indexedAt: getLocalTimestamp()
      }
    });

    // Create PackageJson nodes
    const projectRoot = config.root || process.cwd();
    for (const [filePath, pkgInfo] of packageJsonFiles) {
      const relPath = path.relative(projectRoot, filePath);
      // Generate deterministic UUID for package.json
      const pkgUuidRaw = UniqueIDHelper.GenerateDeterministicUUID(`packagejson:${filePath}`);
      const pkgId = `pkg:${pkgUuidRaw}`; // Prefix for relationship matching

      nodes.push({
        labels: ['PackageJson'],
        id: pkgId,
        properties: {
          uuid: pkgId,
          file: relPath,
          name: pkgInfo.name,
          version: pkgInfo.version,
          description: pkgInfo.description || null,
          dependencies: pkgInfo.dependencies,
          devDependencies: pkgInfo.devDependencies,
          peerDependencies: pkgInfo.peerDependencies,
          scripts: pkgInfo.scripts,
          main: pkgInfo.main || null,
          moduleType: pkgInfo.type || null,
          hash: createHash('sha256').update(JSON.stringify(pkgInfo.raw)).digest('hex').slice(0, 16),
          indexedAt: getLocalTimestamp()
        }
      });

      // Link to Project
      relationships.push({
        type: 'PACKAGE_OF',
        from: pkgId,
        to: projectId,
        properties: {}
      });
    }

    // Build global UUID mapping first (needed for parentUUID)
    const globalUUIDMapping = this.buildGlobalUUIDMapping(codeFiles);

    // First pass: Create all scope nodes from code files
    for (const [filePath, analysis] of codeFiles) {
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

      // Calculate content hash (SHA-256 of parsed scopes - for detecting semantic changes)
      const contentHash = createHash('sha256').update(analysis.scopes.map(s => s.content || '').join('')).digest('hex');

      // Compute file metadata for incremental ingestion
      const { rawContentHash, mtime } = await this.computeFileMetadata(filePath);

      const fileUuid = `file:${relPath}`;
      nodes.push({
        labels: ['File'],
        id: fileUuid,
        properties: {
          uuid: fileUuid, // Required for relationship matching
          path: relPath,
          name: fileName,
          directory,
          extension,
          contentHash,
          ...(rawContentHash && { rawContentHash }),
          ...(mtime && { mtime }),
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
    for (const [filePath] of codeFiles) {
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
      const dirUuid = `dir:${dir}`;
      nodes.push({
        labels: ['Directory'],
        id: dirUuid,
        properties: {
          uuid: dirUuid, // Required for relationship matching
          path: dir,
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
    for (const [filePath, analysis] of codeFiles) {
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
    for (const [filePath, analysis] of codeFiles) {
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
                for (const [mappedFilePath, mappedAnalysis] of codeFiles) {
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

    for (const [filePath, analysis] of codeFiles) {
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

    // Create WebDocument nodes for HTML/Vue/Svelte files
    // (Document is reserved for Tika, MarkdownDocument for Markdown)
    for (const [filePath, htmlResult] of htmlFiles) {
      const relPath = path.relative(projectRoot, filePath);
      const doc = htmlResult.document;

      // Create WebDocument node
      const docId = `webdoc:${doc.uuid}`;
      nodes.push({
        labels: ['WebDocument'],
        id: docId,
        properties: {
          uuid: docId, // Use prefixed ID for relationship matching
          file: relPath,
          type: doc.type, // 'html' | 'vue-sfc' | 'svelte' | 'astro'
          hash: doc.hash,
          hasTemplate: doc.hasTemplate,
          hasScript: doc.hasScript,
          hasStyle: doc.hasStyle,
          ...(doc.componentName && { componentName: doc.componentName }),
          ...(doc.scriptLang && { scriptLang: doc.scriptLang }),
          ...(doc.isScriptSetup !== undefined && { isScriptSetup: doc.isScriptSetup }),
          ...(doc.imports.length > 0 && { imports: JSON.stringify(doc.imports) }),
          ...(doc.usedComponents.length > 0 && { usedComponents: JSON.stringify(doc.usedComponents) }),
          ...(doc.images.length > 0 && { imageCount: doc.images.length })
        }
      });

      // Create BELONGS_TO relationship (WebDocument -> Project)
      relationships.push({
        type: 'BELONGS_TO',
        from: docId,
        to: projectId
      });

      // Create File node for HTML file
      const fileName = relPath.split('/').pop() || relPath;
      const directory = relPath.includes('/') ? relPath.substring(0, relPath.lastIndexOf('/')) : '.';
      const extension = fileName.includes('.') ? fileName.substring(fileName.lastIndexOf('.')) : '';
      const { rawContentHash, mtime } = await this.computeFileMetadata(filePath);

      nodes.push({
        labels: ['File'],
        id: `file:${relPath}`,
        properties: {
          path: relPath,
          name: fileName,
          directory,
          extension,
          contentHash: doc.hash,
          ...(rawContentHash && { rawContentHash }),
          ...(mtime && { mtime }),
        }
      });

      // Create BELONGS_TO relationship (File -> Project)
      relationships.push({
        type: 'BELONGS_TO',
        from: `file:${relPath}`,
        to: projectId
      });

      // Create DEFINED_IN relationship (WebDocument -> File)
      relationships.push({
        type: 'DEFINED_IN',
        from: docId,
        to: `file:${relPath}`
      });

      // Create Image nodes and relationships
      for (const img of doc.images) {
        const imgId = `img:${doc.uuid}:${img.line}`;
        nodes.push({
          labels: ['Image'],
          id: imgId,
          properties: {
            src: img.src,
            alt: img.alt || null,
            line: img.line
          }
        });

        // Create HAS_IMAGE relationship (WebDocument -> Image)
        relationships.push({
          type: 'HAS_IMAGE',
          from: docId,
          to: imgId
        });
      }

      // Add directory to set for HTML files too
      let currentPath = relPath;
      while (true) {
        const dir = currentPath.includes('/') ? currentPath.substring(0, currentPath.lastIndexOf('/')) : '';
        if (!dir || dir === '.' || dir === '') break;

        if (!directories.has(dir)) {
          directories.add(dir);
          const depth = dir.split('/').filter(p => p.length > 0).length;
          nodes.push({
            labels: ['Directory'],
            id: `dir:${dir}`,
            properties: {
              path: dir,
              depth
            }
          });
        }

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

      // If HTML has embedded scripts that were parsed, create Scope nodes for them
      if (htmlResult.scopes && htmlResult.scopes.length > 0) {
        for (const scope of htmlResult.scopes) {
          const scopeUuid = this.generateUUID(scope, filePath);
          scopeMap.set(scopeUuid, scope);

          nodes.push({
            labels: ['Scope'],
            id: scopeUuid,
            properties: {
              uuid: scopeUuid,
              name: scope.name,
              type: scope.type,
              file: relPath,
              language: 'typescript', // Embedded scripts are typically TS/JS
              startLine: scope.startLine,
              endLine: scope.endLine,
              linesOfCode: scope.linesOfCode || (scope.endLine - scope.startLine + 1),
              source: scope.content || '',
              signature: this.extractSignature(scope),
              hash: this.hashScope(scope),
              ...(scope.returnType && { returnType: scope.returnType }),
              ...(scope.parameters && scope.parameters.length > 0 && {
                parameters: JSON.stringify(scope.parameters)
              }),
              ...(scope.parent && { parent: scope.parent })
            }
          });

          // Create BELONGS_TO relationship (Scope -> Project)
          relationships.push({
            type: 'BELONGS_TO',
            from: scopeUuid,
            to: projectId
          });

          // Create DEFINED_IN relationship (Scope -> File)
          relationships.push({
            type: 'DEFINED_IN',
            from: scopeUuid,
            to: `file:${relPath}`
          });

          // Create SCRIPT_OF relationship (Scope -> WebDocument)
          relationships.push({
            type: 'SCRIPT_OF',
            from: scopeUuid,
            to: docId
          });
        }
      }
    }

    // Create Stylesheet nodes for CSS files
    for (const [filePath, cssResult] of cssFiles) {
      const relPath = path.relative(projectRoot, filePath);
      const stylesheet = cssResult.stylesheet;

      // Create Stylesheet node
      const stylesheetId = `stylesheet:${stylesheet.uuid}`;
      nodes.push({
        labels: ['Stylesheet'],
        id: stylesheetId,
        properties: {
          uuid: stylesheetId,
          file: relPath,
          hash: stylesheet.hash,
          linesOfCode: stylesheet.linesOfCode,
          ruleCount: stylesheet.ruleCount,
          selectorCount: stylesheet.selectorCount,
          propertyCount: stylesheet.propertyCount,
          variableCount: stylesheet.variables.length,
          importCount: stylesheet.imports.length,
          fontFaceCount: stylesheet.fontFaceCount,
          keyframeNames: stylesheet.keyframeNames.length > 0 ? JSON.stringify(stylesheet.keyframeNames) : null,
          mediaQueries: stylesheet.mediaQueries.length > 0 ? JSON.stringify(stylesheet.mediaQueries) : null,
          indexedAt: getLocalTimestamp()
        }
      });

      // Create BELONGS_TO relationship (Stylesheet -> Project)
      relationships.push({
        type: 'BELONGS_TO',
        from: stylesheetId,
        to: projectId
      });

      // Create File node for CSS file
      const fileName = relPath.split('/').pop() || relPath;
      const directory = relPath.includes('/') ? relPath.substring(0, relPath.lastIndexOf('/')) : '.';
      const extension = fileName.includes('.') ? fileName.substring(fileName.lastIndexOf('.')) : '';
      const fileUuid = `file:${relPath}`;
      const { rawContentHash, mtime } = await this.computeFileMetadata(filePath);

      nodes.push({
        labels: ['File'],
        id: fileUuid,
        properties: {
          uuid: fileUuid,
          path: relPath,
          name: fileName,
          directory,
          extension,
          contentHash: stylesheet.hash,
          ...(rawContentHash && { rawContentHash }),
          ...(mtime && { mtime }),
        }
      });

      // Create BELONGS_TO relationship (File -> Project)
      relationships.push({
        type: 'BELONGS_TO',
        from: fileUuid,
        to: projectId
      });

      // Create DEFINED_IN relationship (Stylesheet -> File)
      relationships.push({
        type: 'DEFINED_IN',
        from: stylesheetId,
        to: fileUuid
      });

      // Create IMPORTS relationships for @import
      for (const importUrl of stylesheet.imports) {
        relationships.push({
          type: 'IMPORTS',
          from: stylesheetId,
          to: importUrl, // Will be resolved to file if it exists
          properties: {}
        });
      }

      // Create CSSVariable nodes
      for (const variable of stylesheet.variables) {
        const varId = `cssvar:${stylesheet.uuid}:${variable.name}`;
        nodes.push({
          labels: ['CSSVariable'],
          id: varId,
          properties: {
            uuid: varId,
            name: variable.name,
            value: variable.value,
            scope: variable.scope,
            line: variable.line
          }
        });

        // Create DEFINES_VARIABLE relationship (Stylesheet -> CSSVariable)
        relationships.push({
          type: 'DEFINES_VARIABLE',
          from: stylesheetId,
          to: varId
        });
      }

      // Add directory to set for CSS files
      let currentPath = relPath;
      while (true) {
        const dir = currentPath.includes('/') ? currentPath.substring(0, currentPath.lastIndexOf('/')) : '';
        if (!dir || dir === '.' || dir === '') break;

        if (!directories.has(dir)) {
          directories.add(dir);
          const dirUuid = `dir:${dir}`;
          const depth = dir.split('/').filter(p => p.length > 0).length;
          nodes.push({
            labels: ['Directory'],
            id: dirUuid,
            properties: {
              uuid: dirUuid,
              path: dir,
              depth
            }
          });
        }

        if (currentPath === relPath) {
          relationships.push({
            type: 'IN_DIRECTORY',
            from: fileUuid,
            to: `dir:${dir}`
          });
        }

        currentPath = dir;
      }
    }

    // Create Stylesheet nodes for SCSS files (similar to CSS)
    for (const [filePath, scssResult] of scssFiles) {
      const relPath = path.relative(projectRoot, filePath);
      const stylesheet = scssResult.stylesheet;

      // Create Stylesheet node (same label as CSS, but with scss type)
      const stylesheetId = `stylesheet:${stylesheet.uuid}`;
      nodes.push({
        labels: ['Stylesheet'],
        id: stylesheetId,
        properties: {
          uuid: stylesheetId,
          file: relPath,
          type: 'scss',
          hash: stylesheet.hash,
          linesOfCode: stylesheet.linesOfCode,
          ruleCount: stylesheet.ruleCount,
          selectorCount: stylesheet.selectorCount,
          propertyCount: stylesheet.propertyCount,
          variableCount: stylesheet.variables.length,
          importCount: stylesheet.imports.length,
          mixinCount: stylesheet.mixins?.length ?? 0,
          functionCount: stylesheet.functions?.length ?? 0,
          indexedAt: getLocalTimestamp()
        }
      });

      // Create BELONGS_TO relationship (Stylesheet -> Project)
      relationships.push({
        type: 'BELONGS_TO',
        from: stylesheetId,
        to: projectId
      });

      // Create File node
      const fileName = relPath.split('/').pop() || relPath;
      const directory = relPath.includes('/') ? relPath.substring(0, relPath.lastIndexOf('/')) : '.';
      const extension = fileName.includes('.') ? fileName.substring(fileName.lastIndexOf('.')) : '';
      const fileUuid = `file:${relPath}`;
      const { rawContentHash: scssRawHash, mtime: scssMtime } = await this.computeFileMetadata(filePath);

      nodes.push({
        labels: ['File'],
        id: fileUuid,
        properties: {
          uuid: fileUuid,
          path: relPath,
          name: fileName,
          directory,
          extension,
          contentHash: stylesheet.hash,
          ...(scssRawHash && { rawContentHash: scssRawHash }),
          ...(scssMtime && { mtime: scssMtime }),
        }
      });

      relationships.push({
        type: 'BELONGS_TO',
        from: fileUuid,
        to: projectId
      });

      relationships.push({
        type: 'DEFINED_IN',
        from: stylesheetId,
        to: fileUuid
      });

      // Add directory handling
      this.ensureDirectoryNodes(relPath, directories, nodes, relationships, fileUuid);
    }

    // Create VueSFC nodes for Vue files
    for (const [filePath, vueResult] of vueFiles) {
      const relPath = path.relative(projectRoot, filePath);
      const sfc = vueResult.sfc; // Access nested VueSFCInfo

      const vueId = `vue:${sfc.uuid}`;
      nodes.push({
        labels: ['VueSFC'],
        id: vueId,
        properties: {
          uuid: vueId,
          file: relPath,
          componentName: sfc.componentName || path.basename(relPath, '.vue'),
          hash: sfc.hash,
          hasTemplate: sfc.hasTemplate,
          hasScript: sfc.hasScript,
          hasStyle: sfc.hasStyle,
          scriptLang: sfc.scriptLang || null,
          styleLang: sfc.styleLang || null,
          hasScriptSetup: sfc.hasScriptSetup || false,
          styleScoped: sfc.styleScoped || false,
          ...(sfc.props && sfc.props.length > 0 && { props: JSON.stringify(sfc.props) }),
          ...(sfc.emits && sfc.emits.length > 0 && { emits: JSON.stringify(sfc.emits) }),
          ...(sfc.componentUsages && sfc.componentUsages.length > 0 && { componentUsages: JSON.stringify(sfc.componentUsages) }),
          indexedAt: getLocalTimestamp()
        }
      });

      relationships.push({
        type: 'BELONGS_TO',
        from: vueId,
        to: projectId
      });

      // Create File node
      const fileName = relPath.split('/').pop() || relPath;
      const directory = relPath.includes('/') ? relPath.substring(0, relPath.lastIndexOf('/')) : '.';
      const extension = '.vue';
      const fileUuid = `file:${relPath}`;
      const { rawContentHash: vueRawHash, mtime: vueMtime } = await this.computeFileMetadata(filePath);

      nodes.push({
        labels: ['File'],
        id: fileUuid,
        properties: {
          uuid: fileUuid,
          path: relPath,
          name: fileName,
          directory,
          extension,
          contentHash: sfc.hash,
          ...(vueRawHash && { rawContentHash: vueRawHash }),
          ...(vueMtime && { mtime: vueMtime }),
        }
      });

      relationships.push({
        type: 'BELONGS_TO',
        from: fileUuid,
        to: projectId
      });

      relationships.push({
        type: 'DEFINED_IN',
        from: vueId,
        to: fileUuid
      });

      // Add directory handling
      this.ensureDirectoryNodes(relPath, directories, nodes, relationships, fileUuid);

      // Note: Vue script scopes would require parsing the script block content
      // This could be added later by extracting script content from vueResult.blocks
    }

    // Create SvelteComponent nodes for Svelte files
    for (const [filePath, svelteResult] of svelteFiles) {
      const relPath = path.relative(projectRoot, filePath);
      const component = svelteResult.component; // Access nested SvelteComponentInfo

      const svelteId = `svelte:${component.uuid}`;
      nodes.push({
        labels: ['SvelteComponent'],
        id: svelteId,
        properties: {
          uuid: svelteId,
          file: relPath,
          componentName: component.componentName || path.basename(relPath, '.svelte'),
          hash: component.hash,
          hasScript: component.hasScript,
          hasStyle: component.hasStyle,
          scriptLang: component.scriptLang || null,
          styleLang: component.styleLang || null,
          ...(component.props && component.props.length > 0 && { props: JSON.stringify(component.props) }),
          ...(component.componentUsages && component.componentUsages.length > 0 && { componentUsages: JSON.stringify(component.componentUsages) }),
          indexedAt: getLocalTimestamp()
        }
      });

      relationships.push({
        type: 'BELONGS_TO',
        from: svelteId,
        to: projectId
      });

      // Create File node
      const fileName = relPath.split('/').pop() || relPath;
      const directory = relPath.includes('/') ? relPath.substring(0, relPath.lastIndexOf('/')) : '.';
      const extension = '.svelte';
      const fileUuid = `file:${relPath}`;
      const { rawContentHash: svelteRawHash, mtime: svelteMtime } = await this.computeFileMetadata(filePath);

      nodes.push({
        labels: ['File'],
        id: fileUuid,
        properties: {
          uuid: fileUuid,
          path: relPath,
          name: fileName,
          directory,
          extension,
          contentHash: component.hash,
          ...(svelteRawHash && { rawContentHash: svelteRawHash }),
          ...(svelteMtime && { mtime: svelteMtime }),
        }
      });

      relationships.push({
        type: 'BELONGS_TO',
        from: fileUuid,
        to: projectId
      });

      relationships.push({
        type: 'DEFINED_IN',
        from: svelteId,
        to: fileUuid
      });

      this.ensureDirectoryNodes(relPath, directories, nodes, relationships, fileUuid);

      // Note: Svelte script scopes would require parsing the script block content
      // This could be added later by extracting script content from svelteResult.blocks
    }

    // Create MarkdownDocument nodes for Markdown files
    for (const [filePath, mdResult] of markdownFiles) {
      const relPath = path.relative(projectRoot, filePath);
      const doc = mdResult.document;

      const mdId = `markdown:${doc.uuid}`;
      nodes.push({
        labels: ['MarkdownDocument'],
        id: mdId,
        properties: {
          uuid: mdId,
          file: relPath,
          type: 'markdown',
          hash: doc.hash,
          title: doc.title || null,
          sectionCount: doc.sections?.length ?? 0,
          codeBlockCount: doc.codeBlocks?.length ?? 0,
          linkCount: doc.links?.length ?? 0,
          imageCount: doc.images?.length ?? 0,
          wordCount: doc.wordCount ?? 0,
          ...(doc.frontMatter && { frontMatter: JSON.stringify(doc.frontMatter) }),
          ...(doc.sections && doc.sections.length > 0 && { sections: JSON.stringify(doc.sections.map(s => ({ title: s.title, level: s.level, slug: s.slug }))) }),
          indexedAt: getLocalTimestamp()
        }
      });

      relationships.push({
        type: 'BELONGS_TO',
        from: mdId,
        to: projectId
      });

      // Create File node
      const fileName = relPath.split('/').pop() || relPath;
      const directory = relPath.includes('/') ? relPath.substring(0, relPath.lastIndexOf('/')) : '.';
      const extension = fileName.includes('.') ? fileName.substring(fileName.lastIndexOf('.')) : '';
      const fileUuid = `file:${relPath}`;
      const { rawContentHash: mdRawHash, mtime: mdMtime } = await this.computeFileMetadata(filePath);

      nodes.push({
        labels: ['File'],
        id: fileUuid,
        properties: {
          uuid: fileUuid,
          path: relPath,
          name: fileName,
          directory,
          extension,
          contentHash: doc.hash,
          ...(mdRawHash && { rawContentHash: mdRawHash }),
          ...(mdMtime && { mtime: mdMtime }),
        }
      });

      relationships.push({
        type: 'BELONGS_TO',
        from: fileUuid,
        to: projectId
      });

      relationships.push({
        type: 'DEFINED_IN',
        from: mdId,
        to: fileUuid
      });

      this.ensureDirectoryNodes(relPath, directories, nodes, relationships, fileUuid);

      // Create CodeBlock nodes for embedded code
      if (doc.codeBlocks && doc.codeBlocks.length > 0) {
        for (let i = 0; i < doc.codeBlocks.length; i++) {
          const block = doc.codeBlocks[i];
          const blockId = `codeblock:${doc.uuid}:${i}`;
          // Compute hash from code for incremental ingestion
          const blockHash = createHash('sha256').update(block.code || '').digest('hex').slice(0, 16);

          nodes.push({
            labels: ['CodeBlock'],
            id: blockId,
            properties: {
              uuid: blockId,
              projectId,
              file: relPath,
              language: block.language || 'text',
              code: block.code,
              rawText: block.code, // For unified search
              hash: blockHash, // Required for incremental ingestion
              startLine: block.startLine,
              endLine: block.endLine,
              index: i
            }
          });

          relationships.push({
            type: 'CONTAINS_CODE',
            from: mdId,
            to: blockId
          });
        }
      }

      // Create MarkdownSection nodes for each section (searchable content)
      if (doc.sections && doc.sections.length > 0) {
        for (const section of doc.sections) {
          const sectionId = `section:${section.uuid}`;
          // Compute hash from content for incremental ingestion
          const sectionHash = createHash('sha256').update(section.content || '').digest('hex').slice(0, 16);

          nodes.push({
            labels: ['MarkdownSection'],
            id: sectionId,
            properties: {
              uuid: sectionId,
              projectId,
              file: relPath,
              title: section.title,
              level: section.level,
              slug: section.slug,
              // Store both full content and own content for different search needs
              content: section.content,
              ownContent: section.ownContent,
              // rawText for unified search compatibility
              rawText: section.content,
              hash: sectionHash, // Required for incremental ingestion
              startLine: section.startLine,
              endLine: section.endLine,
              ...(section.parentTitle && { parentTitle: section.parentTitle }),
              indexedAt: getLocalTimestamp()
            }
          });

          relationships.push({
            type: 'HAS_SECTION',
            from: mdId,
            to: sectionId
          });

          // Link to parent section if exists
          if (section.parentTitle) {
            const parentSection = doc.sections.find(s => s.title === section.parentTitle);
            if (parentSection) {
              relationships.push({
                type: 'CHILD_OF',
                from: sectionId,
                to: `section:${parentSection.uuid}`
              });
            }
          }
        }
      }
    }

    // Create GenericFile nodes for unknown code files
    for (const [filePath, genericResult] of genericFiles) {
      const relPath = path.relative(projectRoot, filePath);

      // Generate UUID from hash since GenericFileAnalysis doesn't have uuid
      const genericId = `generic:${genericResult.hash}`;
      nodes.push({
        labels: ['GenericFile'],
        id: genericId,
        properties: {
          uuid: genericId,
          file: relPath,
          hash: genericResult.hash,
          linesOfCode: genericResult.linesOfCode,
          language: genericResult.languageHint || 'unknown',
          braceStyle: genericResult.braceStyle || 'unknown',
          ...(genericResult.imports && genericResult.imports.length > 0 && { imports: JSON.stringify(genericResult.imports) }),
          indexedAt: getLocalTimestamp()
        }
      });

      relationships.push({
        type: 'BELONGS_TO',
        from: genericId,
        to: projectId
      });

      // Create File node
      const fileName = relPath.split('/').pop() || relPath;
      const directory = relPath.includes('/') ? relPath.substring(0, relPath.lastIndexOf('/')) : '.';
      const extension = fileName.includes('.') ? fileName.substring(fileName.lastIndexOf('.')) : '';
      const fileUuid = `file:${relPath}`;
      const { rawContentHash: genericRawHash, mtime: genericMtime } = await this.computeFileMetadata(filePath);

      nodes.push({
        labels: ['File'],
        id: fileUuid,
        properties: {
          uuid: fileUuid,
          path: relPath,
          name: fileName,
          directory,
          extension,
          contentHash: genericResult.hash,
          ...(genericRawHash && { rawContentHash: genericRawHash }),
          ...(genericMtime && { mtime: genericMtime }),
        }
      });

      relationships.push({
        type: 'BELONGS_TO',
        from: fileUuid,
        to: projectId
      });

      relationships.push({
        type: 'DEFINED_IN',
        from: genericId,
        to: fileUuid
      });

      this.ensureDirectoryNodes(relPath, directories, nodes, relationships, fileUuid);
    }

    // Create DataFile nodes for data files (JSON, YAML, XML, TOML, ENV)
    // Track all file paths for cross-file reference resolution
    const allFilePaths = new Set<string>();
    for (const [filePath] of codeFiles) allFilePaths.add(path.relative(projectRoot, filePath));
    for (const [filePath] of htmlFiles) allFilePaths.add(path.relative(projectRoot, filePath));
    for (const [filePath] of cssFiles) allFilePaths.add(path.relative(projectRoot, filePath));
    for (const [filePath] of scssFiles) allFilePaths.add(path.relative(projectRoot, filePath));
    for (const [filePath] of vueFiles) allFilePaths.add(path.relative(projectRoot, filePath));
    for (const [filePath] of svelteFiles) allFilePaths.add(path.relative(projectRoot, filePath));
    for (const [filePath] of markdownFiles) allFilePaths.add(path.relative(projectRoot, filePath));
    for (const [filePath] of genericFiles) allFilePaths.add(path.relative(projectRoot, filePath));
    for (const [filePath] of dataFiles) allFilePaths.add(path.relative(projectRoot, filePath));
    for (const [filePath] of mediaFiles) allFilePaths.add(path.relative(projectRoot, filePath));

    // Track ExternalURLs for deduplication
    const externalUrls = new Map<string, string>(); // url -> uuid

    for (const [filePath, dataInfo] of dataFiles) {
      const relPath = path.relative(projectRoot, filePath);

      // Create DataFile node
      const dataFileId = `datafile:${dataInfo.uuid}`;
      nodes.push({
        labels: ['DataFile'],
        id: dataFileId,
        properties: {
          uuid: dataFileId,
          file: relPath,
          format: dataInfo.format,
          hash: dataInfo.hash,
          linesOfCode: dataInfo.linesOfCode,
          sectionCount: dataInfo.sections.length,
          referenceCount: dataInfo.references.length,
          indexedAt: getLocalTimestamp()
        }
      });

      relationships.push({
        type: 'BELONGS_TO',
        from: dataFileId,
        to: projectId
      });

      // Create File node
      const fileName = relPath.split('/').pop() || relPath;
      const directory = relPath.includes('/') ? relPath.substring(0, relPath.lastIndexOf('/')) : '.';
      const extension = fileName.includes('.') ? fileName.substring(fileName.lastIndexOf('.')) : '';
      const fileUuid = `file:${relPath}`;
      const { rawContentHash: dataRawHash, mtime: dataMtime } = await this.computeFileMetadata(filePath);

      nodes.push({
        labels: ['File'],
        id: fileUuid,
        properties: {
          uuid: fileUuid,
          path: relPath,
          name: fileName,
          directory,
          extension,
          contentHash: dataInfo.hash,
          ...(dataRawHash && { rawContentHash: dataRawHash }),
          ...(dataMtime && { mtime: dataMtime }),
        }
      });

      relationships.push({
        type: 'BELONGS_TO',
        from: fileUuid,
        to: projectId
      });

      relationships.push({
        type: 'DEFINED_IN',
        from: dataFileId,
        to: fileUuid
      });

      this.ensureDirectoryNodes(relPath, directories, nodes, relationships, fileUuid);

      // Create DataSection nodes for top-level sections
      for (const section of dataInfo.sections) {
        this.createDataSectionNodes(section, dataFileId, nodes, relationships, dataInfo.uuid);
      }

      // Create REFERENCES relationships for detected references
      for (const ref of dataInfo.references) {
        if (ref.type === 'url') {
          // Create or reference ExternalURL node
          let urlUuid = externalUrls.get(ref.value);
          if (!urlUuid) {
            urlUuid = `url:${createHash('sha256').update(ref.value).digest('hex').substring(0, 12)}`;
            externalUrls.set(ref.value, urlUuid);

            // Extract domain from URL
            let domain = '';
            try {
              const urlObj = new URL(ref.value);
              domain = urlObj.hostname;
            } catch {
              domain = ref.value.split('/')[2] || '';
            }

            nodes.push({
              labels: ['ExternalURL'],
              id: urlUuid,
              properties: {
                uuid: urlUuid,
                url: ref.value,
                domain
              }
            });
          }

          relationships.push({
            type: 'LINKS_TO',
            from: dataFileId,
            to: urlUuid,
            properties: { path: ref.path, line: ref.line }
          });
        } else if (ref.type === 'code' || ref.type === 'config' || ref.type === 'file') {
          // Reference to a file - resolve relative path
          const refPath = this.resolveReferencePath(ref.value, relPath, projectRoot);
          if (refPath && allFilePaths.has(refPath)) {
            relationships.push({
              type: 'REFERENCES',
              from: dataFileId,
              to: `file:${refPath}`,
              properties: { path: ref.path, refType: ref.type }
            });
          }
        } else if (ref.type === 'image') {
          // Reference to image - will link to MediaFile when created
          const refPath = this.resolveReferencePath(ref.value, relPath, projectRoot);
          if (refPath) {
            relationships.push({
              type: 'REFERENCES_IMAGE',
              from: dataFileId,
              to: `file:${refPath}`,
              properties: { path: ref.path }
            });
          }
        } else if (ref.type === 'directory') {
          // Reference to directory
          const refPath = this.resolveReferencePath(ref.value, relPath, projectRoot);
          if (refPath && directories.has(refPath)) {
            relationships.push({
              type: 'REFERENCES',
              from: dataFileId,
              to: `dir:${refPath}`,
              properties: { path: ref.path, refType: 'directory' }
            });
          }
        } else if (ref.type === 'package') {
          // Reference to npm/pip package - create ExternalLibrary node
          const pkgUuid = `pkg:${ref.value}`;
          // Check if already created (avoid duplicates)
          if (!nodes.some(n => n.id === pkgUuid)) {
            nodes.push({
              labels: ['ExternalLibrary'],
              id: pkgUuid,
              properties: {
                uuid: pkgUuid,
                name: ref.value,
                source: 'npm' // TODO: detect pip/cargo/etc
              }
            });
          }

          relationships.push({
            type: 'USES_PACKAGE',
            from: dataFileId,
            to: pkgUuid,
            properties: { path: ref.path, line: ref.line }
          });
        }
      }
    }

    // Create MediaFile nodes for images, 3D models, PDFs (lazy loading - metadata only)
    for (const [filePath, mediaInfo] of mediaFiles) {
      const relPath = path.relative(projectRoot, filePath);

      // Determine specific labels based on category
      const labels = ['MediaFile'];
      if (mediaInfo.category === 'image') labels.push('ImageFile');
      if (mediaInfo.category === '3d') labels.push('ThreeDFile');
      if (mediaInfo.category === 'document') labels.push('DocumentFile');

      const mediaId = `media:${mediaInfo.uuid}`;
      const properties: Record<string, unknown> = {
        uuid: mediaId,
        file: relPath,
        format: mediaInfo.format,
        category: mediaInfo.category,
        hash: mediaInfo.hash,
        sizeBytes: mediaInfo.sizeBytes,
        analyzed: mediaInfo.analyzed,
        indexedAt: getLocalTimestamp()
      };

      // Add category-specific properties
      if (mediaInfo.category === 'image') {
        const imageInfo = mediaInfo as ImageFileInfo;
        if (imageInfo.dimensions) {
          properties.width = imageInfo.dimensions.width;
          properties.height = imageInfo.dimensions.height;
        }
      }

      if (mediaInfo.category === '3d') {
        const threeDInfo = mediaInfo as ThreeDFileInfo;
        if (threeDInfo.gltfInfo) {
          if (threeDInfo.gltfInfo.version) properties.gltfVersion = threeDInfo.gltfInfo.version;
          if (threeDInfo.gltfInfo.generator) properties.gltfGenerator = threeDInfo.gltfInfo.generator;
          if (threeDInfo.gltfInfo.meshCount !== undefined) properties.meshCount = threeDInfo.gltfInfo.meshCount;
          if (threeDInfo.gltfInfo.materialCount !== undefined) properties.materialCount = threeDInfo.gltfInfo.materialCount;
          if (threeDInfo.gltfInfo.textureCount !== undefined) properties.textureCount = threeDInfo.gltfInfo.textureCount;
          if (threeDInfo.gltfInfo.animationCount !== undefined) properties.animationCount = threeDInfo.gltfInfo.animationCount;
        }
      }

      if (mediaInfo.category === 'document') {
        const pdfInfo = mediaInfo as PDFFileInfo;
        if (pdfInfo.pdfInfo?.pageCount !== undefined) properties.pageCount = pdfInfo.pdfInfo.pageCount;
        if (pdfInfo.pdfInfo?.title) properties.pdfTitle = pdfInfo.pdfInfo.title;
        if (pdfInfo.pdfInfo?.author) properties.pdfAuthor = pdfInfo.pdfInfo.author;
      }

      nodes.push({
        labels,
        id: mediaId,
        properties
      });

      relationships.push({
        type: 'BELONGS_TO',
        from: mediaId,
        to: projectId
      });

      // Create File node for media file
      const fileName = relPath.split('/').pop() || relPath;
      const directory = relPath.includes('/') ? relPath.substring(0, relPath.lastIndexOf('/')) : '.';
      const extension = path.extname(relPath);
      const fileUuid = `file:${relPath}`;
      const { rawContentHash: mediaRawHash, mtime: mediaMtime } = await this.computeFileMetadata(filePath);

      nodes.push({
        labels: ['File'],
        id: fileUuid,
        properties: {
          uuid: fileUuid,
          path: relPath,
          name: fileName,
          directory,
          extension,
          contentHash: mediaInfo.hash,
          ...(mediaRawHash && { rawContentHash: mediaRawHash }),
          ...(mediaMtime && { mtime: mediaMtime }),
        }
      });

      relationships.push({
        type: 'BELONGS_TO',
        from: fileUuid,
        to: projectId
      });

      relationships.push({
        type: 'DEFINED_IN',
        from: mediaId,
        to: fileUuid
      });

      this.ensureDirectoryNodes(relPath, directories, nodes, relationships, fileUuid);
    }

    // Create DocumentFile nodes for PDFs, DOCX, XLSX (with full text extraction)
    for (const [filePath, docInfo] of documentFiles) {
      const relPath = path.relative(projectRoot, filePath);

      // Determine specific labels based on format
      const labels = ['DocumentFile'];
      if (docInfo.format === 'pdf') labels.push('PDFDocument');
      if (docInfo.format === 'docx') labels.push('WordDocument');
      if (docInfo.format === 'xlsx' || docInfo.format === 'xls') labels.push('SpreadsheetDocument');
      if (docInfo.format === 'csv') labels.push('SpreadsheetDocument');

      const docId = `doc:${docInfo.uuid}`;
      const properties: Record<string, unknown> = {
        uuid: docId,
        file: relPath,
        format: docInfo.format,
        hash: docInfo.hash,
        sizeBytes: docInfo.sizeBytes,
        pageCount: docInfo.pageCount,
        hasFullText: docInfo.hasFullText,
        needsGeminiVision: docInfo.needsGeminiVision,
        extractionMethod: docInfo.extractionMethod,
        indexedAt: getLocalTimestamp()
      };

      // Add text content if available (for search)
      if (docInfo.textContent) {
        properties.textContent = docInfo.textContent;
        properties.textLength = docInfo.textContent.length;
      }

      // Add OCR confidence if available
      if (docInfo.ocrConfidence !== undefined) {
        properties.ocrConfidence = docInfo.ocrConfidence;
      }

      // Add spreadsheet-specific properties
      if ('sheetNames' in docInfo) {
        const spreadsheet = docInfo as SpreadsheetInfo;
        if (spreadsheet.sheetNames) {
          properties.sheetNames = spreadsheet.sheetNames;
          properties.sheetCount = spreadsheet.sheetNames.length;
        }
      }

      nodes.push({
        labels,
        id: docId,
        properties
      });

      relationships.push({
        type: 'BELONGS_TO',
        from: docId,
        to: projectId
      });

      // Create File node for document file
      const fileName = relPath.split('/').pop() || relPath;
      const directory = relPath.includes('/') ? relPath.substring(0, relPath.lastIndexOf('/')) : '.';
      const extension = path.extname(relPath);
      const fileUuid = `file:${relPath}`;
      const { rawContentHash: docRawHash, mtime: docMtime } = await this.computeFileMetadata(filePath);

      nodes.push({
        labels: ['File'],
        id: fileUuid,
        properties: {
          uuid: fileUuid,
          path: relPath,
          name: fileName,
          directory,
          extension,
          contentHash: docInfo.hash,
          ...(docRawHash && { rawContentHash: docRawHash }),
          ...(docMtime && { mtime: docMtime }),
        }
      });

      relationships.push({
        type: 'BELONGS_TO',
        from: fileUuid,
        to: projectId
      });

      relationships.push({
        type: 'DEFINED_IN',
        from: docId,
        to: fileUuid
      });

      this.ensureDirectoryNodes(relPath, directories, nodes, relationships, fileUuid);
    }

    return {
      nodes,
      relationships,
      metadata: {
        filesProcessed: codeFiles.size + htmlFiles.size + cssFiles.size + scssFiles.size + vueFiles.size + svelteFiles.size + markdownFiles.size + genericFiles.size + dataFiles.size + mediaFiles.size + documentFiles.size,
        nodesGenerated: nodes.length,
        relationshipsGenerated: relationships.length,
        parseTimeMs: 0 // Will be set by caller
      }
    };
  }

  /**
   * Helper to ensure directory nodes exist and create relationships
   */
  private ensureDirectoryNodes(
    relPath: string,
    directories: Set<string>,
    nodes: ParsedNode[],
    relationships: ParsedRelationship[],
    fileUuid: string
  ): void {
    let currentPath = relPath;
    while (true) {
      const dir = currentPath.includes('/') ? currentPath.substring(0, currentPath.lastIndexOf('/')) : '';
      if (!dir || dir === '.' || dir === '') break;

      if (!directories.has(dir)) {
        directories.add(dir);
        const dirUuid = `dir:${dir}`;
        const depth = dir.split('/').filter(p => p.length > 0).length;
        nodes.push({
          labels: ['Directory'],
          id: dirUuid,
          properties: {
            uuid: dirUuid,
            path: dir,
            depth
          }
        });
      }

      if (currentPath === relPath) {
        relationships.push({
          type: 'IN_DIRECTORY',
          from: fileUuid,
          to: `dir:${dir}`
        });
      }

      currentPath = dir;
    }
  }

  /**
   * Recursively create DataSection nodes for nested data structures
   */
  private createDataSectionNodes(
    section: import('./data-file-parser.js').DataSection,
    parentId: string,
    nodes: ParsedNode[],
    relationships: ParsedRelationship[],
    fileUuid: string,
    isRoot: boolean = true
  ): void {
    const sectionId = `datasection:${fileUuid}:${section.path}`;

    nodes.push({
      labels: ['DataSection'],
      id: sectionId,
      properties: {
        uuid: sectionId,
        path: section.path,
        key: section.key,
        content: section.content.length > 10000
          ? section.content.substring(0, 10000) + '...[truncated]'
          : section.content,
        depth: section.depth,
        valueType: section.valueType,
        childCount: section.children?.length ?? 0
      }
    });

    // Link to parent (DataFile or parent DataSection)
    relationships.push({
      type: isRoot ? 'HAS_SECTION' : 'HAS_CHILD',
      from: parentId,
      to: sectionId
    });

    // Recursively create child sections (limit depth to avoid explosion)
    if (section.children && section.depth < 3) {
      for (const child of section.children) {
        this.createDataSectionNodes(child, sectionId, nodes, relationships, fileUuid, false);
      }
    }
  }

  /**
   * Resolve a reference path relative to the source file
   */
  private resolveReferencePath(
    refValue: string,
    sourceRelPath: string,
    projectRoot: string
  ): string | null {
    // Skip absolute URLs
    if (refValue.startsWith('http://') || refValue.startsWith('https://')) {
      return null;
    }

    // Handle relative paths
    if (refValue.startsWith('./') || refValue.startsWith('../')) {
      const sourceDir = sourceRelPath.includes('/')
        ? sourceRelPath.substring(0, sourceRelPath.lastIndexOf('/'))
        : '.';

      // Resolve relative to source file directory
      const parts = sourceDir.split('/').filter(p => p && p !== '.');
      const refParts = refValue.split('/');

      for (const part of refParts) {
        if (part === '..') {
          parts.pop();
        } else if (part !== '.') {
          parts.push(part);
        }
      }

      return parts.join('/');
    }

    // Absolute path from project root (starts with /)
    if (refValue.startsWith('/')) {
      return refValue.substring(1);
    }

    // Bare path - assume relative to source
    const sourceDir = sourceRelPath.includes('/')
      ? sourceRelPath.substring(0, sourceRelPath.lastIndexOf('/'))
      : '';

    return sourceDir ? `${sourceDir}/${refValue}` : refValue;
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

    // Generate deterministic UUID based on file path + scope signature
    // This ensures the same scope always gets the same UUID across ingestions
    const deterministicInput = `${filePath}:${scope.name}:${scope.type}:${scope.startLine}`;
    const uuid = UniqueIDHelper.GenerateDeterministicUUID(deterministicInput);

    fileCache.set(cacheKey, uuid);
    return uuid;
  }

  /**
   * Hash scope content for incremental updates
   * Uses full content + docstring to detect ANY changes in the scope
   */
  private hashScope(scope: ScopeInfo): string {
    // Hash the full content to detect changes in implementation
    // Not just the signature which would miss body changes
    const content = scope.contentDedented || scope.content || '';
    const docstring = (scope as any).docstring || '';
    const parentPrefix = scope.parent ? `${scope.parent}.` : '';
    const hashInput = `${parentPrefix}${scope.name}:${scope.type}:${docstring}:${content}`;

    return createHash('sha256')
      .update(hashInput)
      .digest('hex')
      .substring(0, 8);
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
