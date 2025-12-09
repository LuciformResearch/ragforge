import React from 'react';
import { Box, Text } from 'ink';
import type { AgentIdentity } from './AssistantMessage.js';

interface ToolMessageProps {
  toolName: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  args?: Record<string, unknown>;
  result?: string;
  duration?: number;
  /** Which agent triggered this tool */
  agent?: AgentIdentity;
}

export const ToolMessage: React.FC<ToolMessageProps> = ({
  toolName,
  status,
  args,
  result,
  duration,
  agent
}) => {
  const statusIcons: Record<string, string> = {
    pending: '○',
    running: '◐',
    completed: '●',
    error: '✗',
  };

  const statusColors: Record<string, string> = {
    pending: 'gray',
    running: 'yellow',
    completed: 'green',
    error: 'red',
  };

  // Format args for display (compact)
  const formatArgs = (a: Record<string, unknown> | undefined): string => {
    if (!a) return '';
    const entries = Object.entries(a);
    if (entries.length === 0) return '()';
    // Show first 2 args, truncated
    const formatted = entries.slice(0, 2).map(([k, v]) => {
      const val = typeof v === 'string'
        ? (v.length > 30 ? v.slice(0, 30) + '...' : v)
        : JSON.stringify(v);
      return `${k}: ${val}`;
    }).join(', ');
    return entries.length > 2 ? `(${formatted}, ...)` : `(${formatted})`;
  };

  return (
    <Box marginY={1} flexDirection="column">
      <Box>
        <Text color={statusColors[status]}>{statusIcons[status]} </Text>
        <Text bold color="magenta">{toolName}</Text>
        {args && <Text dimColor>{formatArgs(args)}</Text>}
        {status === 'running' && <Text color="yellow"> running...</Text>}
        {status === 'completed' && duration !== undefined && (
          <Text dimColor> ({duration}ms)</Text>
        )}
      </Box>
      {result && status === 'completed' && (
        <Box marginLeft={2} marginTop={1}>
          <Text dimColor>{result.slice(0, 300)}{result.length > 300 ? '...' : ''}</Text>
        </Box>
      )}
      {result && status === 'error' && (
        <Box marginLeft={2} marginTop={1}>
          <Text color="red">{result}</Text>
        </Box>
      )}
    </Box>
  );
};
