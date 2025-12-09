/**
 * useAgent Hook
 *
 * Manages RagAgent lifecycle and provides callbacks for the TUI.
 * Handles tool confirmation, streaming responses, and state management.
 * Also handles slash commands for persona management.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { createRagForgeAgent, type AgentOptions, type AgentProjectContext } from '../../commands/agent.js';
import type { BrainManager, PersonaDefinition, TerminalColor } from '@luciformresearch/ragforge';

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
  const [agentIdentity, setAgentIdentity] = useState<{ name: string; color?: string; icon?: string }>({
    name: 'Assistant',
    color: 'blue',
  });

  const agentRef = useRef<Awaited<ReturnType<typeof createRagForgeAgent>> | null>(null);
  const contextRef = useRef<AgentProjectContext | null>(null);
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
        contextRef.current = result.context;

        // Get agent identity from brain's active persona
        if (result.context.brainManager) {
          const persona = result.context.brainManager.getActivePersona();
          setAgentIdentity({
            name: persona.name,
            color: persona.color,
            icon: persona.name === 'Ragnarök' ? '✶' : undefined,
          });
        }

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

  // Helper to handle slash commands for persona management
  const handleSlashCommand = useCallback(async (command: string): Promise<string | null> => {
    const brain = contextRef.current?.brainManager;
    if (!brain) {
      return '⚠️ Brain not available. Persona commands require BrainManager.';
    }

    const parts = command.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    switch (cmd) {
      case '/help': {
        return `📖 **Available Commands:**

**Persona Management:**
  \`/personas\` or \`/list-personas\`
      List all available personas

  \`/set-persona <name|index>\`
      Switch to a different persona
      Examples: \`/set-persona Dev\`, \`/set-persona 2\`

  \`/create-persona Name | color | language | description\`
      Create a new custom persona with LLM-enhanced prompt
      Colors: red, green, yellow, blue, magenta, cyan, white, gray
      Example: \`/create-persona Buddy | cyan | en | A friendly helper\`

  \`/delete-persona <name>\`
      Delete a custom persona (built-ins cannot be deleted)

**Other:**
  \`/help\` - Show this help message

All other input is sent to the RagForge agent.`;
      }

      case '/personas':
      case '/list-personas': {
        const personas = brain.listPersonas();
        const active = brain.getActivePersona();
        let output = '📋 **Available Personas:**\n\n';
        personas.forEach((p, i) => {
          const isActive = p.id === active.id;
          const marker = isActive ? ' ✶ (active)' : '';
          const defaultTag = p.isDefault ? '' : ' [custom]';
          output += `  **[${i + 1}]** ${p.name}${marker}${defaultTag}\n`;
          output += `      ${p.description}\n\n`;
        });
        output += '\nUse `/set-persona <name|index>` to switch personas.';
        return output;
      }

      case '/set-persona': {
        if (args.length === 0) {
          return '⚠️ Usage: `/set-persona <name|index>`\n\nExamples:\n  /set-persona Dev\n  /set-persona 2';
        }
        const idOrName = args.join(' ');
        const index = parseInt(idOrName, 10);
        try {
          const persona = await brain.setActivePersona(isNaN(index) ? idOrName : index);
          // Update the agent identity in the UI
          setAgentIdentity({
            name: persona.name,
            color: persona.color,
            icon: persona.name === 'Ragnarök' ? '✶' : undefined,
          });
          return `✓ Persona switched to: **${persona.name}**\n\n_${persona.description}_`;
        } catch (err: any) {
          return `⚠️ ${err.message}`;
        }
      }

      case '/create-persona': {
        // Format: /create-persona Name | color | lang | description
        // Example: /create-persona Buddy | cyan | en | A friendly helper who explains things clearly
        const fullArg = args.join(' ');
        const segments = fullArg.split('|').map(s => s.trim());

        if (segments.length < 4) {
          return `⚠️ Usage: \`/create-persona Name | color | language | description\`

**Colors:** red, green, yellow, blue, magenta, cyan, white, gray
**Languages:** en, fr, es, de, it, pt, ja, ko, zh

**Example:**
\`/create-persona Buddy | cyan | en | A friendly helper who explains things clearly\``;
        }

        const [name, color, language, ...descParts] = segments;
        const description = descParts.join('|').trim();

        const validColors = ['red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'gray'];
        if (!validColors.includes(color)) {
          return `⚠️ Invalid color "${color}". Valid colors: ${validColors.join(', ')}`;
        }

        try {
          const persona = await brain.createEnhancedPersona({
            name,
            color: color as TerminalColor,
            language,
            description,
          });
          return `✓ Persona created: **${persona.name}**\n\nGenerated persona:\n_${persona.persona}_\n\nUse \`/set-persona ${persona.name}\` to activate it.`;
        } catch (err: any) {
          return `⚠️ ${err.message}`;
        }
      }

      case '/delete-persona': {
        if (args.length === 0) {
          return '⚠️ Usage: `/delete-persona <name>`\n\nNote: Built-in personas cannot be deleted.';
        }
        const name = args.join(' ');
        try {
          await brain.deletePersona(name);
          return `✓ Persona deleted: **${name}**`;
        } catch (err: any) {
          return `⚠️ ${err.message}`;
        }
      }

      default:
        return null; // Not a persona command
    }
  }, []);

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

    // Check for slash commands
    if (content.trim().startsWith('/')) {
      const slashResult = await handleSlashCommand(content.trim());
      if (slashResult !== null) {
        // It was a slash command, show the result
        setMessages(prev => [...prev, {
          id: generateId(),
          type: 'assistant',
          content: slashResult,
          isStreaming: false,
          agent: agentIdentity,
        }]);
        return; // Don't send to agent
      }
    }

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
        agent: agentIdentity,
      }]);

      setStatus('idle');
    } catch (err: any) {
      setError(err.message);
      setMessages(prev => [...prev, {
        id: generateId(),
        type: 'assistant',
        content: `Error: ${err.message}`,
        agent: agentIdentity,
      }]);
      setStatus('idle');
    }
  }, [status, handleSlashCommand, agentIdentity]);

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
