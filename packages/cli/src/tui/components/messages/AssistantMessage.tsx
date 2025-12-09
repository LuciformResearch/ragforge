import React from 'react';
import { Box, Text } from 'ink';

export interface AgentIdentity {
  name: string;
  color?: string;
  icon?: string;
}

// Predefined agent colors for consistency
const AGENT_COLORS: Record<string, string> = {
  default: 'blue',
  planner: 'magenta',
  coder: 'cyan',
  reviewer: 'yellow',
  researcher: 'green',
};

interface AssistantMessageProps {
  content: string;
  isStreaming?: boolean;
  /** Agent identity - if not provided, defaults to "Assistant" */
  agent?: AgentIdentity;
}

export const AssistantMessage: React.FC<AssistantMessageProps> = ({
  content,
  isStreaming,
  agent,
}) => {
  const agentName = agent?.name || 'Assistant';
  const agentColor = agent?.color || AGENT_COLORS[agentName.toLowerCase()] || AGENT_COLORS.default;
  const agentIcon = agent?.icon || '';

  return (
    <Box marginY={1} flexDirection="column">
      <Text bold color={agentColor}>
        {agentIcon && `${agentIcon} `}{agentName}:
      </Text>
      <Box marginLeft={2}>
        <Text>
          {content}
          {isStreaming && <Text dimColor>▊</Text>}
        </Text>
      </Box>
    </Box>
  );
};
