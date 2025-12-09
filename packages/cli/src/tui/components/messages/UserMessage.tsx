import React from 'react';
import { Box, Text } from 'ink';

interface UserMessageProps {
  content: string;
}

export const UserMessage: React.FC<UserMessageProps> = ({ content }) => {
  return (
    <Box marginY={1}>
      <Text bold color="green">You: </Text>
      <Text>{content}</Text>
    </Box>
  );
};
