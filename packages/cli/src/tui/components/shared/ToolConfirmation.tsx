import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

interface ToolConfirmationProps {
  toolName: string;
  toolArgs: Record<string, unknown>;
  onConfirm: () => void;
  onReject: () => void;
}

export const ToolConfirmation: React.FC<ToolConfirmationProps> = ({
  toolName,
  toolArgs,
  onConfirm,
  onReject,
}) => {
  const [selected, setSelected] = useState<'allow' | 'deny'>('allow');

  useInput((input: string, key: { leftArrow?: boolean; rightArrow?: boolean; return?: boolean }) => {
    if (key.leftArrow || key.rightArrow || input === 'h' || input === 'l') {
      setSelected(selected === 'allow' ? 'deny' : 'allow');
    }
    if (key.return) {
      if (selected === 'allow') {
        onConfirm();
      } else {
        onReject();
      }
    }
    if (input === 'y' || input === 'Y') {
      onConfirm();
    }
    if (input === 'n' || input === 'N') {
      onReject();
    }
  });

  const argsPreview = Object.entries(toolArgs)
    .slice(0, 3)
    .map(([k, v]) => `${k}: ${JSON.stringify(v).slice(0, 50)}`)
    .join('\n  ');

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="yellow"
      paddingX={2}
      paddingY={1}
    >
      <Box marginBottom={1}>
        <Text bold color="yellow">Tool Confirmation Required</Text>
      </Box>

      <Box marginBottom={1}>
        <Text>Tool: </Text>
        <Text bold color="magenta">{toolName}</Text>
      </Box>

      {argsPreview && (
        <Box marginBottom={1} flexDirection="column">
          <Text dimColor>Arguments:</Text>
          <Text dimColor>  {argsPreview}</Text>
        </Box>
      )}

      <Box gap={2}>
        <Box>
          <Text
            bold={selected === 'allow'}
            color={selected === 'allow' ? 'green' : 'gray'}
          >
            {selected === 'allow' ? '▶ ' : '  '}[Y] Allow
          </Text>
        </Box>
        <Box>
          <Text
            bold={selected === 'deny'}
            color={selected === 'deny' ? 'red' : 'gray'}
          >
            {selected === 'deny' ? '▶ ' : '  '}[N] Deny
          </Text>
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Use ←/→ or h/l to select, Enter to confirm</Text>
      </Box>
    </Box>
  );
};
