import React, { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { FileCode, FileText, FileJson, File, FolderOpen, Package, Library } from 'lucide-react';

interface FileData {
  name?: string;
  relativePath?: string;
  absolutePath?: string;
  language?: string;
  linesOfCode?: number;
  extension?: string;
  type?: string;
  labels?: string[];
  isSearchResult?: boolean;
  score?: number;
}

function FileNode({ data, selected }: NodeProps<FileData>) {
  // Determine display name from various possible properties
  const fileName = data.name || data.relativePath?.split('/').pop() || data.absolutePath?.split('/').pop() || 'Unknown';
  const ext = data.extension || fileName.split('.').pop() || '';

  // Check what kind of "file" node this is (could be Project, ExternalLibrary, Directory, or actual File)
  const nodeType = data.type || data.labels?.[0] || 'File';
  const isProject = nodeType === 'Project';
  const isExternalLib = nodeType === 'ExternalLibrary';

  const { icon, label, colorClasses } = getNodeStyle(nodeType, ext);

  return (
    <div
      className={`relative bg-gray-800 rounded-lg shadow-lg min-w-[160px] max-w-[240px] border-2 transition-colors ${
        selected ? `border-${colorClasses.border}` : data.isSearchResult ? 'border-green-500/50' : 'border-gray-700 hover:border-gray-600'
      }`}
    >
      {/* Search result indicator */}
      {data.isSearchResult && data.score !== undefined && (
        <div className="absolute -top-2 -right-2 bg-green-600 text-white text-xs px-1.5 py-0.5 rounded-full font-mono">
          {data.score.toFixed(2)}
        </div>
      )}

      {/* Header */}
      <div className={`flex items-center gap-2 px-3 py-2 ${colorClasses.bg} rounded-t-lg`}>
        {icon}
        <span className={`text-xs font-medium ${colorClasses.text}`}>{label}</span>
        {data.linesOfCode && !isProject && !isExternalLib && (
          <span className={`ml-auto text-xs ${colorClasses.text} opacity-60`}>
            {data.linesOfCode} lines
          </span>
        )}
      </div>

      {/* Content */}
      <div className="px-3 py-2">
        <p className="font-mono text-sm font-medium truncate" title={fileName}>
          {fileName}
        </p>
        {data.relativePath && data.relativePath !== fileName && (
          <p className="text-xs text-gray-500 truncate mt-1" title={data.relativePath}>
            {data.relativePath}
          </p>
        )}
        {data.language && !isProject && !isExternalLib && (
          <span className="inline-block mt-1 px-1.5 py-0.5 bg-gray-700 rounded text-xs text-gray-400">
            {data.language}
          </span>
        )}
      </div>

      {/* Handles */}
      <Handle
        type="target"
        position={Position.Top}
        className="w-2 h-2 !bg-yellow-500"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="w-2 h-2 !bg-yellow-500"
      />
    </div>
  );
}

function getNodeStyle(nodeType: string, ext: string) {
  const iconSize = 'w-3.5 h-3.5';

  switch (nodeType) {
    case 'Project':
      return {
        icon: <Package className={`${iconSize} text-indigo-400`} />,
        label: 'PROJECT',
        colorClasses: {
          bg: 'bg-indigo-900/30',
          text: 'text-indigo-300',
          border: 'indigo-500',
        },
      };
    case 'ExternalLibrary':
      return {
        icon: <Library className={`${iconSize} text-pink-400`} />,
        label: 'LIBRARY',
        colorClasses: {
          bg: 'bg-pink-900/30',
          text: 'text-pink-300',
          border: 'pink-500',
        },
      };
    case 'Directory':
      return {
        icon: <FolderOpen className={`${iconSize} text-amber-400`} />,
        label: 'DIRECTORY',
        colorClasses: {
          bg: 'bg-amber-900/30',
          text: 'text-amber-300',
          border: 'amber-500',
        },
      };
    case 'File':
    default:
      return {
        icon: getFileIcon(ext),
        label: 'FILE',
        colorClasses: {
          bg: 'bg-yellow-900/30',
          text: 'text-yellow-300',
          border: 'yellow-500',
        },
      };
  }
}

function getFileIcon(ext: string) {
  const className = 'w-3.5 h-3.5 text-yellow-400';

  switch (ext.toLowerCase()) {
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
    case 'py':
    case 'go':
    case 'rs':
      return <FileCode className={className} />;
    case 'json':
    case 'yaml':
    case 'yml':
      return <FileJson className={className} />;
    case 'md':
    case 'txt':
      return <FileText className={className} />;
    default:
      return <File className={className} />;
  }
}

export default memo(FileNode);
