/**
 * Tool Mention Extractor
 *
 * Programmatically extracts file and node mentions from tool call results.
 * This provides a reliable base of mentions that is then merged with
 * what the LLM extracts during summarization.
 */

import * as path from 'path';
import type { FileMention, NodeMention, ExtractedMentions } from './summarizer.js';

/**
 * Tool result structure from conversation turns
 */
export interface ToolResult {
  toolName: string;
  toolArgs?: Record<string, any>;
  toolResult: any;
  success: boolean;
}

/**
 * Extract mentions from an array of tool results
 *
 * Parses various tool types to extract:
 * - Files: from read_file, edit_file, write_file, grep_files, etc.
 * - Nodes: from brain_search, extract_dependency_hierarchy, etc.
 */
export function extractMentionsFromToolCalls(toolResults: ToolResult[]): ExtractedMentions {
  const files: FileMention[] = [];
  const nodes: NodeMention[] = [];

  const seenFilePaths = new Set<string>();
  const seenNodeUuids = new Set<string>();

  for (const tr of toolResults) {
    if (!tr.success) continue; // Skip failed tool calls

    // Extract based on tool type
    switch (tr.toolName) {
      // File operation tools - extract path from args
      case 'read_file':
      case 'edit_file':
      case 'write_file':
      case 'create_file':
      case 'delete_path':
      case 'move_file':
      case 'copy_file':
        extractFileFromArgs(tr.toolArgs, files, seenFilePaths);
        break;

      // brain_search - extract nodes from results
      case 'brain_search':
        extractNodesFromBrainSearch(tr.toolResult, nodes, seenNodeUuids);
        break;

      // grep_files - extract files from matches
      case 'grep_files':
      case 'search_files':
        extractFilesFromGrepResults(tr.toolResult, files, seenFilePaths);
        break;

      // extract_dependency_hierarchy - extract nodes from hierarchy
      case 'extract_dependency_hierarchy':
        extractNodesFromDependencyHierarchy(tr.toolResult, nodes, seenNodeUuids);
        break;

      // Web tools - extract webpage nodes if ingested
      case 'fetch_web_page':
      case 'ingest_web_page':
        extractWebPageNode(tr.toolArgs, tr.toolResult, nodes, seenNodeUuids);
        break;

      // glob_files, list_directory - extract files from results
      case 'glob_files':
      case 'list_directory':
        extractFilesFromListResults(tr.toolResult, files, seenFilePaths);
        break;
    }
  }

  return { files, nodes };
}

/**
 * Extract file path from tool args (read_file, edit_file, etc.)
 */
function extractFileFromArgs(
  args: Record<string, any> | undefined,
  files: FileMention[],
  seenPaths: Set<string>
): void {
  if (!args) return;

  // Check various path parameter names
  const pathValue = args.path || args.file_path || args.source || args.destination;

  if (typeof pathValue === 'string' && pathValue.trim() && !seenPaths.has(pathValue)) {
    seenPaths.add(pathValue);
    files.push({
      path: pathValue.trim(),
      isAbsolute: path.isAbsolute(pathValue)
    });
  }

  // For move/copy, also check destination
  if (args.destination && typeof args.destination === 'string' && !seenPaths.has(args.destination)) {
    seenPaths.add(args.destination);
    files.push({
      path: args.destination.trim(),
      isAbsolute: path.isAbsolute(args.destination)
    });
  }
}

/**
 * Extract nodes from brain_search results
 */
function extractNodesFromBrainSearch(
  result: any,
  nodes: NodeMention[],
  seenUuids: Set<string>
): void {
  if (!result || !Array.isArray(result.results)) return;

  for (const item of result.results) {
    const node = item.node;
    if (!node || !node.uuid || seenUuids.has(node.uuid)) continue;

    seenUuids.add(node.uuid);

    // Determine node type based on labels or type property
    const nodeType = determineNodeType(node);

    nodes.push({
      uuid: node.uuid,
      name: node.name || node.title || 'unnamed',
      type: nodeType,
      subtype: node.type, // function, method, class, etc.
      file: node.file || node.absolutePath,
      url: node.url,
      startLine: node.startLine,
      endLine: node.endLine
    });
  }
}

/**
 * Extract files from grep_files or search_files results
 */
function extractFilesFromGrepResults(
  result: any,
  files: FileMention[],
  seenPaths: Set<string>
): void {
  if (!result) return;

  // Handle matches array
  const matches = result.matches || result.results || result;
  if (!Array.isArray(matches)) return;

  for (const match of matches) {
    const filePath = match.file || match.path;
    if (typeof filePath === 'string' && filePath.trim() && !seenPaths.has(filePath)) {
      seenPaths.add(filePath);
      files.push({
        path: filePath.trim(),
        isAbsolute: path.isAbsolute(filePath)
      });
    }
  }
}

/**
 * Extract nodes from extract_dependency_hierarchy results
 */
function extractNodesFromDependencyHierarchy(
  result: any,
  nodes: NodeMention[],
  seenUuids: Set<string>
): void {
  if (!result) return;

  // Extract root node
  if (result.root && result.root.uuid && !seenUuids.has(result.root.uuid)) {
    seenUuids.add(result.root.uuid);
    nodes.push({
      uuid: result.root.uuid,
      name: result.root.name || 'unnamed',
      type: 'scope',
      subtype: result.root.type,
      file: result.root.file,
      startLine: result.root.startLine,
      endLine: result.root.endLine
    });
  }

  // Extract dependencies
  if (Array.isArray(result.dependencies)) {
    for (const dep of result.dependencies) {
      if (dep.uuid && !seenUuids.has(dep.uuid)) {
        seenUuids.add(dep.uuid);
        nodes.push({
          uuid: dep.uuid,
          name: dep.name || 'unnamed',
          type: 'scope',
          subtype: dep.type,
          file: dep.file,
          startLine: dep.startLine,
          endLine: dep.endLine
        });
      }
    }
  }

  // Extract consumers
  if (Array.isArray(result.consumers)) {
    for (const consumer of result.consumers) {
      if (consumer.uuid && !seenUuids.has(consumer.uuid)) {
        seenUuids.add(consumer.uuid);
        nodes.push({
          uuid: consumer.uuid,
          name: consumer.name || 'unnamed',
          type: 'scope',
          subtype: consumer.type,
          file: consumer.file,
          startLine: consumer.startLine,
          endLine: consumer.endLine
        });
      }
    }
  }
}

/**
 * Extract webpage node from fetch/ingest results
 */
function extractWebPageNode(
  args: Record<string, any> | undefined,
  result: any,
  nodes: NodeMention[],
  seenUuids: Set<string>
): void {
  if (!result) return;

  // Check if result contains node info (from ingest_web_page)
  const uuid = result.uuid || result.nodeUuid;
  if (uuid && !seenUuids.has(uuid)) {
    seenUuids.add(uuid);
    nodes.push({
      uuid,
      name: result.title || args?.url || 'webpage',
      type: 'webpage',
      url: args?.url || result.url
    });
  }
}

/**
 * Extract files from glob_files or list_directory results
 */
function extractFilesFromListResults(
  result: any,
  files: FileMention[],
  seenPaths: Set<string>
): void {
  if (!result) return;

  // Handle files array
  const fileList = result.files || result.matches || result;
  if (!Array.isArray(fileList)) return;

  for (const item of fileList) {
    const filePath = typeof item === 'string' ? item : (item.path || item.file);
    if (typeof filePath === 'string' && filePath.trim() && !seenPaths.has(filePath)) {
      seenPaths.add(filePath);
      files.push({
        path: filePath.trim(),
        isAbsolute: path.isAbsolute(filePath)
      });
    }
  }
}

/**
 * Determine the node type based on node properties
 */
function determineNodeType(node: any): NodeMention['type'] {
  // Check for explicit type indicators
  if (node.url) return 'webpage';
  if (node.labels) {
    const labels = Array.isArray(node.labels) ? node.labels : [node.labels];
    if (labels.includes('WebPage')) return 'webpage';
    if (labels.includes('MarkdownSection')) return 'markdown_section';
    if (labels.includes('CodeBlock')) return 'codeblock';
    if (labels.includes('DocumentFile') || labels.includes('PDFDocument') || labels.includes('WordDocument')) return 'document';
    if (labels.includes('File')) return 'file';
  }

  // Default to scope for code entities
  return 'scope';
}

/**
 * Merge and deduplicate mentions from multiple sources
 * Preserves LLM-provided "reason" when available
 */
export function mergeMentions(
  programmatic: ExtractedMentions,
  llmExtracted: { files?: FileMention[]; nodes?: NodeMention[] }
): ExtractedMentions {
  const mergedFiles: FileMention[] = [];
  const mergedNodes: NodeMention[] = [];

  const seenFilePaths = new Set<string>();
  const seenNodeUuids = new Set<string>();

  // Add programmatic extractions first
  for (const file of programmatic.files) {
    if (!seenFilePaths.has(file.path)) {
      seenFilePaths.add(file.path);
      mergedFiles.push(file);
    }
  }

  for (const node of programmatic.nodes) {
    if (!seenNodeUuids.has(node.uuid)) {
      seenNodeUuids.add(node.uuid);
      mergedNodes.push(node);
    }
  }

  // Add LLM extractions, potentially enriching with "reason"
  if (llmExtracted.files) {
    for (const file of llmExtracted.files) {
      if (!seenFilePaths.has(file.path)) {
        seenFilePaths.add(file.path);
        mergedFiles.push(file);
      }
    }
  }

  if (llmExtracted.nodes) {
    for (const node of llmExtracted.nodes) {
      if (!seenNodeUuids.has(node.uuid)) {
        seenNodeUuids.add(node.uuid);
        mergedNodes.push(node);
      } else {
        // Node already exists from programmatic extraction
        // Enrich with LLM's reason if provided
        if (node.reason) {
          const existing = mergedNodes.find(n => n.uuid === node.uuid);
          if (existing && !existing.reason) {
            existing.reason = node.reason;
          }
        }
      }
    }
  }

  return { files: mergedFiles, nodes: mergedNodes };
}
