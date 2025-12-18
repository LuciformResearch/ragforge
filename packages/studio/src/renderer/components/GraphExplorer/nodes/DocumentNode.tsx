import React, { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { FileText, Globe, BookOpen, Hash, ChevronDown, ChevronUp } from 'lucide-react';
import { useExpand } from '../ExpandContext';

interface DocumentData {
  name?: string;
  title?: string;
  url?: string;
  relativePath?: string;
  absolutePath?: string;
  textContent?: string;
  rawContent?: string;
  content?: string;
  heading?: string;
  level?: number;
  labels?: string[];
}

function DocumentNode({ id, data, selected }: NodeProps<DocumentData>) {
  const { isExpanded, toggleExpanded } = useExpand();
  const expanded = isExpanded(id);

  const labels = data.labels || [];
  const isWebPage = labels.includes('WebPage');
  const isMarkdownDoc = labels.includes('MarkdownDocument');
  const isMarkdownSection = labels.includes('MarkdownSection');
  const isCodeBlock = labels.includes('CodeBlock');

  // Get display name
  const displayName = data.title || data.name || data.heading ||
    data.relativePath?.split('/').pop() ||
    data.url || 'Unknown';

  // Get content
  const content = data.textContent || data.rawContent || data.content || '';
  const hasContent = content.length > 0;

  // Get icon and color based on type
  const { icon, color, typeLabel } = getTypeInfo(labels);

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (hasContent) {
      toggleExpanded(id);
    }
  };

  return (
    <div
      className={`bg-gray-800 rounded-lg shadow-lg border-2 transition-all ${
        selected ? 'border-pink-500' : 'border-gray-700 hover:border-gray-600'
      } ${expanded ? 'min-w-[400px] max-w-[600px]' : 'min-w-[180px] max-w-[280px]'}`}
      onDoubleClick={handleDoubleClick}
    >
      {/* Header */}
      <div className={`flex items-center gap-2 px-3 py-2 rounded-t-lg ${color}`}>
        {icon}
        <span className="text-xs font-medium uppercase tracking-wide opacity-80">
          {typeLabel}
        </span>
        {isMarkdownSection && data.level && (
          <span className="text-xs opacity-60">H{data.level}</span>
        )}
        {hasContent && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleExpanded(id);
            }}
            className="ml-auto opacity-60 hover:opacity-100"
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>

      {/* Content */}
      <div className="px-3 py-2">
        <p className="font-medium text-sm truncate" title={displayName}>
          {displayName}
        </p>
        {isWebPage && data.url && !expanded && (
          <p className="text-xs text-gray-500 truncate mt-1" title={data.url}>
            {data.url}
          </p>
        )}
        {(isMarkdownDoc || isMarkdownSection) && data.relativePath && !expanded && (
          <p className="text-xs text-gray-500 truncate mt-1">
            {data.relativePath}
          </p>
        )}
      </div>

      {/* Expanded content */}
      {expanded && hasContent && (
        <div className="border-t border-gray-700 max-h-[400px] overflow-auto">
          <div className="p-3 text-xs text-gray-300 whitespace-pre-wrap font-mono">
            {content}
          </div>
        </div>
      )}

      {/* Handles */}
      <Handle
        type="target"
        position={Position.Top}
        className="w-2 h-2 !bg-pink-500"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="w-2 h-2 !bg-pink-500"
      />
    </div>
  );
}

function getTypeInfo(labels: string[]): { icon: React.ReactNode; color: string; typeLabel: string } {
  const iconClass = 'w-3.5 h-3.5';

  if (labels.includes('WebPage')) {
    return {
      icon: <Globe className={iconClass} />,
      color: 'bg-indigo-900/50 text-indigo-300',
      typeLabel: 'Web Page',
    };
  }
  if (labels.includes('MarkdownDocument')) {
    return {
      icon: <BookOpen className={iconClass} />,
      color: 'bg-pink-900/50 text-pink-300',
      typeLabel: 'Document',
    };
  }
  if (labels.includes('MarkdownSection')) {
    return {
      icon: <Hash className={iconClass} />,
      color: 'bg-rose-900/50 text-rose-300',
      typeLabel: 'Section',
    };
  }
  if (labels.includes('CodeBlock')) {
    return {
      icon: <FileText className={iconClass} />,
      color: 'bg-teal-900/50 text-teal-300',
      typeLabel: 'Code Block',
    };
  }

  return {
    icon: <FileText className={iconClass} />,
    color: 'bg-gray-700/50 text-gray-300',
    typeLabel: 'Document',
  };
}

export default memo(DocumentNode);
