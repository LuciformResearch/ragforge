import React, { memo, useEffect, useRef } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Code, Box, Braces, Variable, ChevronDown, ChevronUp } from 'lucide-react';
import hljs from 'highlight.js/lib/core';
import typescript from 'highlight.js/lib/languages/typescript';
import javascript from 'highlight.js/lib/languages/javascript';
import python from 'highlight.js/lib/languages/python';
import css from 'highlight.js/lib/languages/css';
import json from 'highlight.js/lib/languages/json';
import 'highlight.js/styles/atom-one-dark.css';
import { useExpand } from '../ExpandContext';

// Register languages
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('css', css);
hljs.registerLanguage('json', json);

interface ScopeData {
  name?: string;
  type?: string;
  signature?: string;
  file?: string;
  startLine?: number;
  endLine?: number;
  linesOfCode?: number;
  source?: string;
  rawContent?: string;
  language?: string;
  isSearchResult?: boolean;
  score?: number;
}

function ScopeNode({ id, data, selected }: NodeProps<ScopeData>) {
  const { isExpanded, toggleExpanded } = useExpand();
  const expanded = isExpanded(id);
  const codeRef = useRef<HTMLElement>(null);

  const icon = getTypeIcon(data.type);
  const color = getTypeColor(data.type);
  const lines = data.endLine && data.startLine ? data.endLine - data.startLine + 1 : data.linesOfCode;

  // Get source content
  const sourceContent = data.source || data.rawContent || '';
  const hasSource = sourceContent.length > 0;

  // Detect language from file extension
  const getLanguage = (): string => {
    // Don't trust 'auto' as a language - hljs core doesn't support it
    if (data.language && data.language !== 'auto') return data.language;
    const file = data.file || '';
    // Extract extension - handle paths like "foo/bar.ts" and edge cases
    const lastDot = file.lastIndexOf('.');
    const ext = lastDot > 0 ? file.slice(lastDot + 1).toLowerCase() : '';
    switch (ext) {
      case 'ts':
      case 'tsx':
        return 'typescript';
      case 'js':
      case 'jsx':
        return 'javascript';
      case 'py':
        return 'python';
      case 'css':
      case 'scss':
      case 'less':
        return 'css';
      case 'json':
        return 'json';
      default:
        // Default to typescript for code-like content
        return 'typescript';
    }
  };

  // Highlight code when expanded
  useEffect(() => {
    if (expanded && sourceContent) {
      // Use requestAnimationFrame to ensure DOM is ready after render
      requestAnimationFrame(() => {
        if (codeRef.current) {
          const lang = getLanguage();
          console.log('[hljs] Highlighting', { lang, contentLength: sourceContent.length });
          // Clear any previous highlighting class data
          codeRef.current.removeAttribute('data-highlighted');
          codeRef.current.className = `language-${lang} hljs block p-3`;
          codeRef.current.textContent = sourceContent;
          const result = hljs.highlightElement(codeRef.current);
          console.log('[hljs] Result', result, 'Classes:', codeRef.current.className);
        }
      });
    }
  }, [expanded, sourceContent]);

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (hasSource) {
      toggleExpanded(id);
    }
  };

  return (
    <div
      className={`relative bg-gray-800 rounded-lg shadow-lg border-2 transition-all ${
        selected ? 'border-blue-500' : data.isSearchResult ? 'border-green-500/50' : 'border-gray-700 hover:border-gray-600'
      } ${expanded ? 'min-w-[400px] max-w-[600px]' : 'min-w-[180px] max-w-[280px]'}`}
      onDoubleClick={handleDoubleClick}
    >
      {/* Search result indicator */}
      {data.isSearchResult && data.score !== undefined && (
        <div className="absolute -top-2 -right-2 bg-green-600 text-white text-xs px-1.5 py-0.5 rounded-full font-mono">
          {data.score.toFixed(2)}
        </div>
      )}

      {/* Header */}
      <div className={`flex items-center gap-2 px-3 py-2 rounded-t-lg ${color}`}>
        {icon}
        <span className="text-xs font-medium uppercase tracking-wide opacity-80">
          {data.type || 'scope'}
        </span>
        {lines && (
          <span className="ml-auto text-xs opacity-60">{lines} lines</span>
        )}
        {hasSource && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleExpanded(id);
            }}
            className="ml-1 opacity-60 hover:opacity-100"
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>

      {/* Content */}
      <div className="px-3 py-2">
        <p className="font-mono text-sm font-medium truncate" title={data.name}>
          {data.name || 'Unknown'}
        </p>
        {data.signature && data.signature !== data.name && !expanded && (
          <p className="font-mono text-xs text-gray-500 truncate mt-1" title={data.signature}>
            {data.signature}
          </p>
        )}
        {data.file && !expanded && (
          <p className="text-xs text-gray-500 truncate mt-1">
            {data.file}
            {data.startLine ? `:${data.startLine}` : ''}
          </p>
        )}
      </div>

      {/* Expanded source code */}
      {expanded && hasSource && (
        <div className="border-t border-gray-700 max-h-[400px] overflow-auto bg-gray-900">
          <pre className="p-0 m-0 text-xs bg-transparent">
            <code
              ref={codeRef}
              className={`language-${getLanguage()} hljs block p-3`}
            />
          </pre>
        </div>
      )}

      {/* Handles */}
      <Handle
        type="target"
        position={Position.Top}
        className="w-2 h-2 !bg-blue-500"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="w-2 h-2 !bg-blue-500"
      />
    </div>
  );
}

function getTypeIcon(type?: string) {
  const className = 'w-3.5 h-3.5';
  switch (type) {
    case 'function':
      return <Code className={className} />;
    case 'class':
      return <Box className={className} />;
    case 'method':
      return <Braces className={className} />;
    case 'variable':
      return <Variable className={className} />;
    default:
      return <Code className={className} />;
  }
}

function getTypeColor(type?: string): string {
  switch (type) {
    case 'function':
      return 'bg-blue-900/50 text-blue-300';
    case 'class':
      return 'bg-purple-900/50 text-purple-300';
    case 'method':
      return 'bg-green-900/50 text-green-300';
    case 'variable':
      return 'bg-orange-900/50 text-orange-300';
    case 'interface':
      return 'bg-cyan-900/50 text-cyan-300';
    default:
      return 'bg-gray-700/50 text-gray-300';
  }
}

export default memo(ScopeNode);
