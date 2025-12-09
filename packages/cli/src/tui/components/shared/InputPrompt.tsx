import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

// Available slash commands for autocompletion
const SLASH_COMMANDS = [
  { cmd: '/help', desc: 'Show available commands' },
  { cmd: '/personas', desc: 'List all personas' },
  { cmd: '/set-persona', desc: 'Switch persona (name or index)' },
  { cmd: '/create-persona', desc: 'Create new persona' },
  { cmd: '/delete-persona', desc: 'Delete a custom persona' },
];

interface InputPromptProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export const InputPrompt: React.FC<InputPromptProps> = ({
  value,
  onChange,
  onSubmit,
  placeholder = 'Type a message...',
  disabled = false,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Filter commands based on current input
  const suggestions = useMemo(() => {
    if (!value.startsWith('/')) return [];
    // Don't show suggestions if there's already a space (command is complete)
    if (value.includes(' ') && value.trim().split(' ').length > 1) return [];
    const input = value.toLowerCase().trim();
    return SLASH_COMMANDS.filter(c => c.cmd.toLowerCase().startsWith(input));
  }, [value]);

  // Reset selection when suggestions change
  const prevSuggestionsLength = React.useRef(suggestions.length);
  if (suggestions.length !== prevSuggestionsLength.current) {
    prevSuggestionsLength.current = suggestions.length;
    if (selectedIndex >= suggestions.length) {
      setSelectedIndex(Math.max(0, suggestions.length - 1));
    }
  }

  // Handle ONLY Tab and arrow keys for autocomplete - let TextInput handle the rest
  useInput((input, key) => {
    if (disabled) return;

    // Tab for autocomplete
    if (key.tab && suggestions.length > 0) {
      const selected = suggestions[selectedIndex];
      if (selected) {
        const needsSpace = selected.cmd !== '/help' && selected.cmd !== '/personas';
        onChange(selected.cmd + (needsSpace ? ' ' : ''));
      }
    }

    // Arrow keys for navigation in suggestions (only when suggestions visible)
    if (suggestions.length > 0) {
      if (key.upArrow) {
        setSelectedIndex(i => (i > 0 ? i - 1 : suggestions.length - 1));
      } else if (key.downArrow) {
        setSelectedIndex(i => (i < suggestions.length - 1 ? i + 1 : 0));
      }
    }
  });

  const showSuggestions = !disabled && suggestions.length > 0;

  return (
    <Box flexDirection="column">
      {/* Autocomplete suggestions */}
      {showSuggestions && (
        <Box flexDirection="column" marginBottom={0} paddingX={1}>
          <Text dimColor>━━━ Commands ━━━</Text>
          {suggestions.map((s, i) => (
            <Box key={s.cmd}>
              <Text color={i === selectedIndex ? 'cyan' : 'gray'}>
                {i === selectedIndex ? '▸ ' : '  '}
              </Text>
              <Text color={i === selectedIndex ? 'cyan' : 'white'} bold={i === selectedIndex}>
                {s.cmd}
              </Text>
              <Text dimColor> - {s.desc}</Text>
            </Box>
          ))}
          <Text dimColor>Tab: complete, ↑↓: navigate</Text>
        </Box>
      )}

      {/* Input box */}
      <Box
        borderStyle="single"
        borderColor={disabled ? 'gray' : 'green'}
        paddingX={1}
      >
        <Text color="green" bold>❯ </Text>
        {disabled ? (
          <Text dimColor>{placeholder}</Text>
        ) : (
          <TextInput
            value={value}
            onChange={onChange}
            onSubmit={onSubmit}
            placeholder={placeholder}
          />
        )}
      </Box>
    </Box>
  );
};
