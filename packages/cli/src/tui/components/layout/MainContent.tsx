import React from 'react';
import { Box } from 'ink';

interface MainContentProps {
  children: React.ReactNode;
}

export const MainContent: React.FC<MainContentProps> = ({ children }) => {
  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {children}
    </Box>
  );
};
