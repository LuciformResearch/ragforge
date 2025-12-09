import React from 'react';
import { Box, Text } from 'ink';

interface HeaderProps {
  projectName?: string;
  status?: 'idle' | 'thinking' | 'executing';
}

export const Header: React.FC<HeaderProps> = ({ projectName, status = 'idle' }) => {
  const statusColors: Record<string, string> = {
    idle: 'gray',
    thinking: 'yellow',
    executing: 'cyan',
  };

  const statusLabels: Record<string, string> = {
    idle: 'Ready',
    thinking: 'Thinking...',
    executing: 'Executing...',
  };

  return (
    <Box
      borderStyle="single"
      borderColor="blue"
      paddingX={1}
      justifyContent="space-between"
    >
      <Text bold color="blue">
        RagForge
      </Text>
      {projectName && (
        <Text dimColor>
          {projectName}
        </Text>
      )}
      <Text color={statusColors[status]}>
        {statusLabels[status]}
      </Text>
    </Box>
  );
};
