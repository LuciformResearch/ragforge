import React from 'react';
import { Box, Text } from 'ink';

interface FooterProps {
  hints?: string[];
}

export const Footer: React.FC<FooterProps> = ({ hints = ['Ctrl+C: Quit', 'Enter: Send'] }) => {
  return (
    <Box
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      justifyContent="space-between"
    >
      <Box gap={2}>
        {hints.map((hint, i) => (
          <Text key={i} dimColor>
            {hint}
          </Text>
        ))}
      </Box>
    </Box>
  );
};
