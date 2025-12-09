import React, { useState, useCallback } from 'react';
import { Box, Text } from 'ink';
import { Header, Footer, MainContent } from './components/layout/index.js';
import { UserMessage, AssistantMessage, ToolMessage, type AgentIdentity } from './components/messages/index.js';
import { InputPrompt, ToolConfirmation, Spinner } from './components/shared/index.js';
import { useAgent, type AgentMessage as AgentMessageType } from './hooks/index.js';

interface AppProps {
  projectName?: string;
  projectPath?: string;
  model?: string;
  verbose?: boolean;
}

export const App: React.FC<AppProps> = ({ projectName, projectPath, model, verbose }) => {
  const [input, setInput] = useState('');

  const {
    messages,
    status,
    pendingConfirmation,
    error,
    sendMessage,
    confirmTool,
  } = useAgent({
    projectPath,
    model,
    verbose,
  });

  const handleSubmit = useCallback(async (value: string) => {
    if (!value.trim() || status !== 'idle') return;
    setInput('');
    await sendMessage(value);
  }, [status, sendMessage]);

  const handleToolConfirm = useCallback(() => {
    confirmTool(true);
  }, [confirmTool]);

  const handleToolReject = useCallback(() => {
    confirmTool(false);
  }, [confirmTool]);

  // Map status to header status
  const headerStatus = status === 'initializing' || status === 'thinking' || status === 'executing'
    ? 'thinking'
    : status === 'awaiting_confirmation'
      ? 'executing'
      : 'idle';

  // Determine if input should be disabled
  const inputDisabled = status !== 'idle';
  const inputPlaceholder = status === 'initializing'
    ? 'Initializing agent...'
    : status === 'awaiting_confirmation'
      ? 'Waiting for confirmation...'
      : status !== 'idle'
        ? 'Processing...'
        : 'Type a message...';

  return (
    <Box flexDirection="column" height="100%">
      <Header projectName={projectName} status={headerStatus} />

      <MainContent>
        {/* Show initialization message */}
        {status === 'initializing' && (
          <Box marginY={1}>
            <Spinner label="Initializing RagForge agent..." />
          </Box>
        )}

        {/* Show error if any */}
        {error && (
          <Box marginY={1}>
            <Text color="red">Error: {error}</Text>
          </Box>
        )}

        {/* Render messages */}
        {messages.map((msg) => {
          switch (msg.type) {
            case 'user':
              return <UserMessage key={msg.id} content={msg.content || ''} />;
            case 'assistant':
              return (
                <AssistantMessage
                  key={msg.id}
                  content={msg.content || ''}
                  isStreaming={msg.isStreaming}
                  agent={msg.agent}
                />
              );
            case 'tool':
              return (
                <ToolMessage
                  key={msg.id}
                  toolName={msg.toolName || 'unknown'}
                  status={msg.toolStatus || 'pending'}
                  args={msg.toolArgs}
                  result={msg.toolResult}
                  duration={msg.toolDuration}
                />
              );
          }
        })}

        {/* Show thinking indicator */}
        {status === 'thinking' && <Spinner label="Thinking..." />}

        {/* Show tool confirmation dialog */}
        {pendingConfirmation && (
          <ToolConfirmation
            toolName={pendingConfirmation.toolName}
            toolArgs={pendingConfirmation.toolArgs}
            onConfirm={handleToolConfirm}
            onReject={handleToolReject}
          />
        )}
      </MainContent>

      <InputPrompt
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        disabled={inputDisabled}
        placeholder={inputPlaceholder}
      />

      <Footer />
    </Box>
  );
};
