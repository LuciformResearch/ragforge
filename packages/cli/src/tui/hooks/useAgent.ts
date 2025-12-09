/**
 * useAgent Hook
 *
 * Manages RagAgent lifecycle and provides callbacks for the TUI.
 * Handles tool confirmation, streaming responses, and state management.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { createRagForgeAgent, type AgentOptions } from '../../commands/agent.js';

export interface ToolConfirmationRequest {
  id: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  resolve: (confirmed: boolean) => void;
}

export interface AgentMessage {
  id: string;
  type: 'user' | 'assistant' | 'tool';
  content?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolStatus?: 'pending' | 'running' | 'completed' | 'error';
  toolResult?: string;
  toolDuration?: number;
  isStreaming?: boolean;
  agent?: {
    name: string;
    color?: string;
    icon?: string;
  };
}

export interface UseAgentOptions {
  projectPath?: string;
  model?: string;
  verbose?: boolean;
}

export interface UseAgentReturn {
  messages: AgentMessage[];
  status: 'initializing' | 'idle' | 'thinking' | 'executing' | 'awaiting_confirmation' | 'error';
  pendingConfirmation: ToolConfirmationRequest | null;
  error: string | null;

  // Actions
  sendMessage: (content: string) => Promise<void>;
  confirmTool: (confirmed: boolean) => void;
  reset: () => void;
}

let messageIdCounter = 0;
const generateId = () => `msg_${++messageIdCounter}_${Date.now()}`;

export function useAgent(options: UseAgentOptions = {}): UseAgentReturn {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [status, setStatus] = useState<UseAgentReturn['status']>('initializing');
  const [pendingConfirmation, setPendingConfirmation] = useState<ToolConfirmationRequest | null>(null);
  const [error, setError] = useState<string | null>(null);

  const agentRef = useRef<Awaited<ReturnType<typeof createRagForgeAgent>> | null>(null);
  const initializingRef = useRef(false);

  // Track tool messages by name during execution
  const toolMessageIds = useRef<Map<string, string>>(new Map());

  // Initialize agent on mount
  useEffect(() => {
    if (initializingRef.current) return;
    initializingRef.current = true;

    const initAgent = async () => {
      try {
        const agentOptions: AgentOptions = {
          project: options.projectPath || process.cwd(),
          model: options.model || 'gemini-2.0-flash',
          verbose: options.verbose || false,

          // Real-time tool call callback
          onToolCall: (toolName: string, args: Record<string, any>) => {
            const msgId = generateId();
            toolMessageIds.current.set(toolName, msgId);

            setMessages(prev => [...prev, {
              id: msgId,
              type: 'tool',
              toolName,
              toolArgs: args,
              toolStatus: 'running',
            }]);
          },

          // Real-time tool result callback
          onToolResult: (toolName: string, result: any, success: boolean, durationMs: number) => {
            const msgId = toolMessageIds.current.get(toolName);
            if (msgId) {
              setMessages(prev => prev.map(msg =>
                msg.id === msgId
                  ? {
                      ...msg,
                      toolStatus: success ? 'completed' : 'error',
                      toolResult: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
                      toolDuration: durationMs,
                    }
                  : msg
              ));
              toolMessageIds.current.delete(toolName);
            }
          },
        };

        const result = await createRagForgeAgent(agentOptions);
        agentRef.current = result;
        setStatus('idle');
      } catch (err: any) {
        setError(`Failed to initialize agent: ${err.message}`);
        setStatus('error');
      }
    };

    initAgent();

    return () => {
      // Cleanup on unmount
      if (agentRef.current?.context?.registry) {
        agentRef.current.context.registry.dispose().catch(() => {});
      }
    };
  }, [options.projectPath, options.model, options.verbose]);

  const sendMessage = useCallback(async (content: string) => {
    if (!agentRef.current || status !== 'idle') return;

    const userMessageId = generateId();

    // Clear tool message tracking for new request
    toolMessageIds.current.clear();

    // Add user message
    setMessages(prev => [...prev, {
      id: userMessageId,
      type: 'user',
      content,
    }]);

    setStatus('thinking');

    try {
      const { agent } = agentRef.current;

      // Call agent (tool messages are added via callbacks in real-time)
      const result = await agent.ask(content);

      // Add assistant message with final response
      setMessages(prev => [...prev, {
        id: generateId(),
        type: 'assistant',
        content: result.answer,
        isStreaming: false,
      }]);

      setStatus('idle');
    } catch (err: any) {
      setError(err.message);
      setMessages(prev => [...prev, {
        id: generateId(),
        type: 'assistant',
        content: `Error: ${err.message}`,
      }]);
      setStatus('idle');
    }
  }, [status]);

  const confirmTool = useCallback((confirmed: boolean) => {
    if (pendingConfirmation) {
      pendingConfirmation.resolve(confirmed);
      setPendingConfirmation(null);
      setStatus(confirmed ? 'executing' : 'idle');
    }
  }, [pendingConfirmation]);

  const reset = useCallback(() => {
    setMessages([]);
    setError(null);
    setStatus('idle');
  }, []);

  return {
    messages,
    status,
    pendingConfirmation,
    error,
    sendMessage,
    confirmTool,
    reset,
  };
}
