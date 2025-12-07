/**
 * Data File Parser
 *
 * Parses configuration/data files (JSON, YAML, XML, TOML, ENV) and extracts:
 * - Recursive sections (for Neo4j nodes)
 * - References to other files (paths, URLs, packages)
 *
 * @since 2025-12-06
 */

import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import YAML from 'yaml';
import { LuciformXMLParser } from '@luciformresearch/xmlparser';

// =============================================================================
// Types
// =============================================================================

/**
 * Supported data file formats
 */
export type DataFormat = 'json' | 'yaml' | 'xml' | 'toml' | 'env';

/**
 * Reference type detected in data files
 */
export type ReferenceType = 'code' | 'image' | 'directory' | 'url' | 'package' | 'config' | 'file';

/**
 * Information about a data file
 */
export interface DataFileInfo {
  uuid: string;
  file: string;
  format: DataFormat;
  hash: string;
  linesOfCode: number;

  /** Raw content for full-text search */
  rawContent: string;

  /** Top-level sections (recursive) */
  sections: DataSection[];

  /** References to external resources */
  references: DataReference[];
}

/**
 * Section in a data file (recursive)
 */
export interface DataSection {
  uuid: string;

  /** Full path: "compilerOptions.paths" */
  path: string;

  /** Local key: "paths" */
  key: string;

  /** Serialized content of the block */
  content: string;

  startLine: number;
  endLine: number;

  /** Nesting depth (0 = root) */
  depth: number;

  /** Parent path: "compilerOptions" */
  parentPath?: string;

  /** Child sections (recursive) */
  children: DataSection[];

  /** Value type */
  valueType: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
}

/**
 * Reference to external resource
 */
export interface DataReference {
  /** Resource type */
  type: ReferenceType;

  /** Raw value: "./src/index.ts" */
  value: string;

  /** Path in the file: "services.web.volumes[0]" */
  path: string;

  line: number;

  /** Is it a relative path? */
  isRelative: boolean;
}

/**
 * Parse options
 */
export interface DataFileParseOptions {
  /** Minimum properties to create a sub-section (default: 2) */
  minPropertiesForSection?: number;

  /** Minimum array elements to create a sub-section (default: 3) */
  minArrayElementsForSection?: number;

  /** Maximum depth for recursive sections (default: 10) */
  maxDepth?: number;

  /** Extract references (default: true) */
  extractReferences?: boolean;
}

// =============================================================================
// Reference Detection
// =============================================================================

/** Code file extensions */
const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rs', '.c', '.cpp', '.h', '.hpp', '.cs', '.rb', '.php', '.swift', '.kt'];

/** Image file extensions */
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp', '.tiff'];

/** Config file extensions */
const CONFIG_EXTENSIONS = ['.json', '.yaml', '.yml', '.xml', '.toml', '.ini', '.conf', '.config'];

/**
 * Detect reference type from a string value
 */
function detectReferenceType(value: string, contextPath: string): ReferenceType | null {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  // URL
  if (/^https?:\/\//.test(trimmed) || /^ftp:\/\//.test(trimmed)) {
    return 'url';
  }

  // Package in dependencies context
  if (contextPath.includes('dependencies') || contextPath.includes('devDependencies') || contextPath.includes('peerDependencies')) {
    // Skip version specifiers
    if (!trimmed.startsWith('.') && !trimmed.startsWith('/') && !trimmed.includes('/')) {
      return 'package';
    }
  }

  // Relative or absolute path
  if (trimmed.startsWith('./') || trimmed.startsWith('../') || trimmed.startsWith('/')) {
    const lower = trimmed.toLowerCase();

    // Directory (ends with / or is a glob pattern)
    if (trimmed.endsWith('/') || trimmed.includes('**/') || trimmed.includes('/*')) {
      return 'directory';
    }

    // Check extension
    const ext = getExtension(trimmed);
    if (ext) {
      if (CODE_EXTENSIONS.includes(ext)) return 'code';
      if (IMAGE_EXTENSIONS.includes(ext)) return 'image';
      if (CONFIG_EXTENSIONS.includes(ext)) return 'config';
    }

    return 'file';
  }

  return null;
}

/**
 * Get file extension from path
 */
function getExtension(path: string): string | null {
  // Remove query string and hash
  const cleanPath = path.split('?')[0].split('#')[0];
  // Remove glob patterns
  const withoutGlob = cleanPath.replace(/\*+/g, '');
  const match = withoutGlob.match(/\.[a-z0-9]+$/i);
  return match ? match[0].toLowerCase() : null;
}

// =============================================================================
// Section Extraction
// =============================================================================

/**
 * Check if value should be a separate section
 */
function shouldCreateSection(value: any, options: DataFileParseOptions): boolean {
  const minProps = options.minPropertiesForSection ?? 2;
  const minArray = options.minArrayElementsForSection ?? 3;

  if (Array.isArray(value)) {
    return value.length >= minArray;
  }

  if (value !== null && typeof value === 'object') {
    return Object.keys(value).length >= minProps;
  }

  return false;
}

/**
 * Get value type
 */
function getValueType(value: any): DataSection['valueType'] {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'string';
}

/**
 * Extract sections recursively from parsed data
 */
function extractSections(
  data: any,
  options: DataFileParseOptions,
  references: DataReference[],
  parentPath: string = '',
  depth: number = 0,
  startLine: number = 1
): DataSection[] {
  const sections: DataSection[] = [];
  const maxDepth = options.maxDepth ?? 10;

  if (depth > maxDepth) return sections;
  if (data === null || typeof data !== 'object') return sections;

  const entries = Array.isArray(data)
    ? data.map((v, i) => [`[${i}]`, v] as [string, any])
    : Object.entries(data);

  let currentLine = startLine;

  for (const [key, value] of entries) {
    const path = parentPath ? `${parentPath}.${key}` : key;

    // Extract references
    if (options.extractReferences !== false && typeof value === 'string') {
      const refType = detectReferenceType(value, path);
      if (refType) {
        references.push({
          type: refType,
          value: value,
          path: path,
          line: currentLine,
          isRelative: value.startsWith('./') || value.startsWith('../'),
        });
      }
    }

    // Create section if value is complex enough
    if (shouldCreateSection(value, options)) {
      const content = JSON.stringify(value, null, 2);
      const contentLines = content.split('\n').length;

      const section: DataSection = {
        uuid: uuidv4(),
        path,
        key: key.replace(/^\[|\]$/g, ''), // Remove array brackets from key
        content,
        startLine: currentLine,
        endLine: currentLine + contentLines - 1,
        depth,
        parentPath: parentPath || undefined,
        children: [],
        valueType: getValueType(value),
      };

      // Recurse into children
      section.children = extractSections(
        value,
        options,
        references,
        path,
        depth + 1,
        currentLine + 1
      );

      sections.push(section);
      currentLine += contentLines;
    } else {
      // Still extract references from nested values
      if (options.extractReferences !== false && value !== null && typeof value === 'object') {
        extractReferencesFromValue(value, path, currentLine, references);
      }
      currentLine++;
    }
  }

  return sections;
}

/**
 * Extract references from a value without creating sections
 */
function extractReferencesFromValue(
  value: any,
  basePath: string,
  line: number,
  references: DataReference[]
): void {
  if (typeof value === 'string') {
    const refType = detectReferenceType(value, basePath);
    if (refType) {
      references.push({
        type: refType,
        value,
        path: basePath,
        line,
        isRelative: value.startsWith('./') || value.startsWith('../'),
      });
    }
  } else if (Array.isArray(value)) {
    value.forEach((item, i) => {
      extractReferencesFromValue(item, `${basePath}[${i}]`, line, references);
    });
  } else if (value !== null && typeof value === 'object') {
    for (const [key, val] of Object.entries(value)) {
      extractReferencesFromValue(val, `${basePath}.${key}`, line, references);
    }
  }
}

// =============================================================================
// Format-Specific Parsers
// =============================================================================

/**
 * Parse JSON content
 */
function parseJSON(content: string): any {
  // Strip comments (using strip-json-comments or simple regex)
  const withoutComments = content
    .replace(/\/\*[\s\S]*?\*\//g, '') // Block comments
    .replace(/\/\/.*$/gm, '');        // Line comments
  return JSON.parse(withoutComments);
}

/**
 * Parse YAML content
 */
function parseYAML(content: string): any {
  return YAML.parse(content);
}

/**
 * Parse XML content using LuciformXMLParser
 */
function parseXML(content: string): any {
  const parser = new LuciformXMLParser(content, { mode: 'luciform-permissive' });
  const result = parser.parse();

  if (!result.document?.root) {
    return {};
  }

  // Convert XML tree to object
  return xmlNodeToObject(result.document.root);
}

/**
 * Convert XML node to plain object
 */
function xmlNodeToObject(node: any): any {
  if (node.type === 'text') {
    return node.text?.trim() || '';
  }

  if (node.type !== 'element') {
    return null;
  }

  const result: any = {};

  // Add attributes
  if (node.attributes) {
    const attrs = node.attributes instanceof Map
      ? Object.fromEntries(node.attributes)
      : node.attributes;
    for (const [key, value] of Object.entries(attrs)) {
      result[`@${key}`] = value;
    }
  }

  // Process children
  const children = node.children || [];
  const childElements = children.filter((c: any) => c.type === 'element');
  const textNodes = children.filter((c: any) => c.type === 'text');

  // If only text content
  if (childElements.length === 0 && textNodes.length > 0) {
    const text = textNodes.map((t: any) => t.text || '').join('').trim();
    if (Object.keys(result).length === 0) {
      return text;
    }
    result['#text'] = text;
    return result;
  }

  // Group children by name
  const childGroups: Record<string, any[]> = {};
  for (const child of childElements) {
    const name = child.name || 'unknown';
    if (!childGroups[name]) {
      childGroups[name] = [];
    }
    childGroups[name].push(xmlNodeToObject(child));
  }

  // Add children (as array if multiple, single value otherwise)
  for (const [name, values] of Object.entries(childGroups)) {
    result[name] = values.length === 1 ? values[0] : values;
  }

  return result;
}

/**
 * Parse TOML content (simple implementation)
 */
function parseTOML(content: string): any {
  const result: any = {};
  let currentSection = result;
  let currentPath: string[] = [];

  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Section header [section] or [[array]]
    const sectionMatch = trimmed.match(/^\[{1,2}([^\]]+)\]{1,2}$/);
    if (sectionMatch) {
      const path = sectionMatch[1].split('.');
      currentPath = path;
      currentSection = result;
      for (const part of path) {
        if (!currentSection[part]) {
          currentSection[part] = trimmed.startsWith('[[') ? [] : {};
        }
        if (Array.isArray(currentSection[part])) {
          const newObj = {};
          currentSection[part].push(newObj);
          currentSection = newObj;
        } else {
          currentSection = currentSection[part];
        }
      }
      continue;
    }

    // Key = value
    const kvMatch = trimmed.match(/^([^=]+)=(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1].trim();
      let value: any = kvMatch[2].trim();

      // Parse value type
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      } else if (value.startsWith("'") && value.endsWith("'")) {
        value = value.slice(1, -1);
      } else if (value === 'true') {
        value = true;
      } else if (value === 'false') {
        value = false;
      } else if (/^-?\d+$/.test(value)) {
        value = parseInt(value, 10);
      } else if (/^-?\d+\.\d+$/.test(value)) {
        value = parseFloat(value);
      } else if (value.startsWith('[') && value.endsWith(']')) {
        // Simple array
        try {
          value = JSON.parse(value.replace(/'/g, '"'));
        } catch {
          // Keep as string
        }
      }

      currentSection[key] = value;
    }
  }

  return result;
}

/**
 * Parse ENV content
 */
function parseENV(content: string): any {
  const result: any = {};
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith('#')) continue;

    // KEY=value
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      let value = match[2].trim();

      // Remove quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      result[key] = value;
    }
  }

  return result;
}

// =============================================================================
// Main Parser
// =============================================================================

/**
 * Detect format from file extension
 */
export function detectDataFormat(filePath: string): DataFormat | null {
  const ext = filePath.toLowerCase().split('.').pop();

  switch (ext) {
    case 'json':
      return 'json';
    case 'yaml':
    case 'yml':
      return 'yaml';
    case 'xml':
      return 'xml';
    case 'toml':
      return 'toml';
    case 'env':
      return 'env';
    default:
      // Check for .env.* files
      if (filePath.includes('.env')) {
        return 'env';
      }
      return null;
  }
}

/**
 * Check if file is a data file
 */
export function isDataFile(filePath: string): boolean {
  return detectDataFormat(filePath) !== null;
}

/**
 * Parse a data file
 */
export function parseDataFile(
  filePath: string,
  content: string,
  options: DataFileParseOptions = {}
): DataFileInfo {
  const format = detectDataFormat(filePath);
  if (!format) {
    throw new Error(`Unknown data format for file: ${filePath}`);
  }

  // Parse content based on format
  let data: any;
  switch (format) {
    case 'json':
      data = parseJSON(content);
      break;
    case 'yaml':
      data = parseYAML(content);
      break;
    case 'xml':
      data = parseXML(content);
      break;
    case 'toml':
      data = parseTOML(content);
      break;
    case 'env':
      data = parseENV(content);
      break;
  }

  // Extract sections and references
  const references: DataReference[] = [];
  const sections = extractSections(data, options, references);

  // Calculate hash
  const hash = createHash('sha256').update(content).digest('hex').substring(0, 16);

  return {
    uuid: uuidv4(),
    file: filePath,
    format,
    hash,
    linesOfCode: content.split('\n').length,
    rawContent: content,
    sections,
    references,
  };
}

/**
 * Parse multiple data files
 */
export async function parseDataFiles(
  files: Map<string, string>,
  options: DataFileParseOptions = {}
): Promise<Map<string, DataFileInfo>> {
  const results = new Map<string, DataFileInfo>();

  for (const [filePath, content] of files) {
    try {
      const info = parseDataFile(filePath, content, options);
      results.set(filePath, info);
    } catch (err) {
      console.warn(`Failed to parse data file ${filePath}:`, err);
    }
  }

  return results;
}
