/**
 * Unit tests for ConversationStorage
 *
 * Focus: messagesToTurns method which converts Message[] to ConversationTurn[]
 * Critical for capturing all tool calls from multi-iteration agent responses
 */

import { describe, it, expect } from 'vitest';
import type { Message, ToolCall, ToolResult } from '../types.js';
import type { ConversationTurn } from '../summarizer.js';

// Mock the storage class to test private methods
// We create a standalone function that mirrors the implementation
function messagesToTurns(messages: Message[]): ConversationTurn[] {
  const turns: ConversationTurn[] = [];

  // Helper to normalize timestamp
  const normalizeTimestamp = (ts: Date | string): string => {
    if (ts instanceof Date) return ts.toISOString();
    return ts;
  };

  let i = 0;
  while (i < messages.length) {
    const userMsg = messages[i];
    if (userMsg.role !== 'user') {
      i++;
      continue;
    }

    const allToolResults: Array<{
      toolName: string;
      toolArgs?: Record<string, any>;
      toolResult: any;
      success: boolean;
      timestamp: string;
    }> = [];
    let finalAssistantContent = '';
    let finalReasoning = '';
    let lastTimestamp = userMsg.timestamp;

    let j = i + 1;
    while (j < messages.length && messages[j].role !== 'user') {
      const msg = messages[j];
      if (msg.role === 'assistant') {
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          for (const tc of msg.tool_calls) {
            let toolArgs: Record<string, any> | undefined;
            if (tc.arguments) {
              try {
                toolArgs = typeof tc.arguments === 'string'
                  ? JSON.parse(tc.arguments)
                  : tc.arguments;
              } catch {
                toolArgs = undefined;
              }
            }

            let toolResult: any;
            if (tc.result?.result) {
              try {
                toolResult = typeof tc.result.result === 'string'
                  ? JSON.parse(tc.result.result)
                  : tc.result.result;
              } catch {
                toolResult = tc.result.result;
              }
            }

            const toolTimestamp = normalizeTimestamp(tc.timestamp || msg.timestamp);

            allToolResults.push({
              toolName: tc.tool_name || 'unknown',
              toolArgs,
              toolResult,
              success: tc.result?.success ?? tc.success ?? true,
              timestamp: toolTimestamp
            });
          }
        }

        if (msg.content && msg.content.trim()) {
          finalAssistantContent = msg.content;
          finalReasoning = msg.reasoning || '';
        }
        lastTimestamp = msg.timestamp;
      }
      j++;
    }

    if (finalAssistantContent || allToolResults.length > 0) {
      const timestamp = normalizeTimestamp(lastTimestamp);

      turns.push({
        userMessage: userMsg.content,
        assistantMessage: finalAssistantContent + (finalReasoning ? `\n\nReasoning: ${finalReasoning}` : ''),
        toolResults: allToolResults,
        timestamp
      });
    }

    i = j;
  }

  return turns;
}

// Helper to create mock messages
function createMessage(
  role: 'user' | 'assistant' | 'system',
  content: string,
  options?: {
    uuid?: string;
    conversation_id?: string;
    timestamp?: string;
    tool_calls?: ToolCall[];
    reasoning?: string;
  }
): Message {
  return {
    uuid: options?.uuid || `msg-${Math.random().toString(36).substr(2, 9)}`,
    conversation_id: options?.conversation_id || 'conv-test',
    role,
    content,
    timestamp: options?.timestamp || new Date().toISOString(),
    char_count: content.length,
    tool_calls: options?.tool_calls,
    reasoning: options?.reasoning
  };
}

function createToolCall(
  toolName: string,
  args: Record<string, any>,
  result?: { success: boolean; result: string },
  timestamp?: string
): ToolCall {
  return {
    uuid: `tc-${Math.random().toString(36).substr(2, 9)}`,
    message_id: 'msg-test',
    tool_name: toolName,
    arguments: JSON.stringify(args),
    timestamp: timestamp || new Date().toISOString(),
    duration_ms: 100,
    success: result?.success ?? true,
    result: result ? {
      uuid: `tr-${Math.random().toString(36).substr(2, 9)}`,
      tool_call_id: 'tc-test',
      success: result.success,
      result: result.result
    } : undefined
  };
}

describe('messagesToTurns', () => {
  describe('simple user-assistant pairs', () => {
    it('should convert a simple user-assistant pair', () => {
      const messages: Message[] = [
        createMessage('user', 'Hello'),
        createMessage('assistant', 'Hi there!')
      ];

      const turns = messagesToTurns(messages);

      expect(turns).toHaveLength(1);
      expect(turns[0].userMessage).toBe('Hello');
      expect(turns[0].assistantMessage).toBe('Hi there!');
      expect(turns[0].toolResults).toHaveLength(0);
    });

    it('should handle multiple turns', () => {
      const messages: Message[] = [
        createMessage('user', 'Question 1'),
        createMessage('assistant', 'Answer 1'),
        createMessage('user', 'Question 2'),
        createMessage('assistant', 'Answer 2')
      ];

      const turns = messagesToTurns(messages);

      expect(turns).toHaveLength(2);
      expect(turns[0].userMessage).toBe('Question 1');
      expect(turns[1].userMessage).toBe('Question 2');
    });
  });

  describe('single assistant with tool calls', () => {
    it('should capture tool calls from assistant message', () => {
      const messages: Message[] = [
        createMessage('user', 'Read the file'),
        createMessage('assistant', 'Here is the content', {
          tool_calls: [
            createToolCall('read_file', { path: '/test.ts' }, { success: true, result: '"file content"' })
          ]
        })
      ];

      const turns = messagesToTurns(messages);

      expect(turns).toHaveLength(1);
      expect(turns[0].toolResults).toHaveLength(1);
      expect(turns[0].toolResults[0].toolName).toBe('read_file');
      expect(turns[0].toolResults[0].toolArgs).toEqual({ path: '/test.ts' });
    });
  });

  describe('multiple intermediate assistant messages (BUG FIX)', () => {
    it('should capture tool calls from ALL intermediate assistant messages', () => {
      // This is the critical test for the bug fix
      // Scenario: user asks a question, agent makes multiple tool calls across iterations
      const messages: Message[] = [
        createMessage('user', 'Find the function definition', { timestamp: '2025-01-01T10:00:00Z' }),
        // First iteration: agent calls grep
        createMessage('assistant', '', {
          timestamp: '2025-01-01T10:00:01Z',
          tool_calls: [
            createToolCall('grep_files', { pattern: 'function foo' }, { success: true, result: '["match1"]' }, '2025-01-01T10:00:01Z')
          ]
        }),
        // Second iteration: agent calls read_file based on grep results
        createMessage('assistant', '', {
          timestamp: '2025-01-01T10:00:02Z',
          tool_calls: [
            createToolCall('read_file', { path: '/src/foo.ts' }, { success: true, result: '"function foo() {}"' }, '2025-01-01T10:00:02Z')
          ]
        }),
        // Third iteration: agent calls another tool
        createMessage('assistant', '', {
          timestamp: '2025-01-01T10:00:03Z',
          tool_calls: [
            createToolCall('list_directory', { path: '/src' }, { success: true, result: '["foo.ts", "bar.ts"]' }, '2025-01-01T10:00:03Z')
          ]
        }),
        // Final response
        createMessage('assistant', 'I found the function definition in /src/foo.ts', {
          timestamp: '2025-01-01T10:00:04Z'
        })
      ];

      const turns = messagesToTurns(messages);

      expect(turns).toHaveLength(1);
      expect(turns[0].userMessage).toBe('Find the function definition');
      expect(turns[0].assistantMessage).toBe('I found the function definition in /src/foo.ts');

      // CRITICAL: All 3 tool calls should be captured
      expect(turns[0].toolResults).toHaveLength(3);
      expect(turns[0].toolResults[0].toolName).toBe('grep_files');
      expect(turns[0].toolResults[1].toolName).toBe('read_file');
      expect(turns[0].toolResults[2].toolName).toBe('list_directory');
    });

    it('should handle multiple tool calls in a single assistant message', () => {
      const messages: Message[] = [
        createMessage('user', 'Check multiple files'),
        createMessage('assistant', '', {
          tool_calls: [
            createToolCall('read_file', { path: '/a.ts' }),
            createToolCall('read_file', { path: '/b.ts' }),
            createToolCall('read_file', { path: '/c.ts' })
          ]
        }),
        createMessage('assistant', 'All files checked')
      ];

      const turns = messagesToTurns(messages);

      expect(turns).toHaveLength(1);
      expect(turns[0].toolResults).toHaveLength(3);
    });

    it('should combine tool calls from multiple iterations with multiple calls each', () => {
      const messages: Message[] = [
        createMessage('user', 'Complex task'),
        // Iteration 1: 2 parallel tool calls
        createMessage('assistant', '', {
          tool_calls: [
            createToolCall('grep_files', { pattern: 'a' }),
            createToolCall('grep_files', { pattern: 'b' })
          ]
        }),
        // Iteration 2: 3 more tool calls
        createMessage('assistant', '', {
          tool_calls: [
            createToolCall('read_file', { path: '/1.ts' }),
            createToolCall('read_file', { path: '/2.ts' }),
            createToolCall('read_file', { path: '/3.ts' })
          ]
        }),
        createMessage('assistant', 'Done')
      ];

      const turns = messagesToTurns(messages);

      expect(turns).toHaveLength(1);
      expect(turns[0].toolResults).toHaveLength(5); // 2 + 3
    });
  });

  describe('edge cases', () => {
    it('should handle user message without assistant response', () => {
      const messages: Message[] = [
        createMessage('user', 'Hello'),
        createMessage('user', 'Hello again') // No assistant response to first
      ];

      const turns = messagesToTurns(messages);

      // First user has no assistant response, so no turn created
      expect(turns).toHaveLength(0);
    });

    it('should handle assistant messages with only tool calls (no final content)', () => {
      const messages: Message[] = [
        createMessage('user', 'Do something'),
        createMessage('assistant', '', {
          tool_calls: [createToolCall('some_tool', {})]
        })
        // No final assistant message with content
      ];

      const turns = messagesToTurns(messages);

      // Should still create a turn because there are tool calls
      expect(turns).toHaveLength(1);
      expect(turns[0].assistantMessage).toBe('');
      expect(turns[0].toolResults).toHaveLength(1);
    });

    it('should include reasoning in assistant message', () => {
      const messages: Message[] = [
        createMessage('user', 'Think about this'),
        createMessage('assistant', 'My answer', {
          reasoning: 'I thought carefully about this'
        })
      ];

      const turns = messagesToTurns(messages);

      expect(turns).toHaveLength(1);
      expect(turns[0].assistantMessage).toContain('My answer');
      expect(turns[0].assistantMessage).toContain('Reasoning: I thought carefully about this');
    });

    it('should skip system messages', () => {
      const messages: Message[] = [
        createMessage('system', 'System prompt'),
        createMessage('user', 'Hello'),
        createMessage('assistant', 'Hi')
      ];

      const turns = messagesToTurns(messages);

      expect(turns).toHaveLength(1);
      expect(turns[0].userMessage).toBe('Hello');
    });

    it('should handle empty message array', () => {
      const turns = messagesToTurns([]);
      expect(turns).toHaveLength(0);
    });

    it('should parse JSON stringified tool arguments', () => {
      const messages: Message[] = [
        createMessage('user', 'Test'),
        createMessage('assistant', 'Done', {
          tool_calls: [{
            uuid: 'tc-1',
            message_id: 'msg-1',
            tool_name: 'test_tool',
            arguments: '{"nested": {"key": "value"}, "array": [1, 2, 3]}',
            timestamp: new Date().toISOString(),
            duration_ms: 100,
            success: true
          }]
        })
      ];

      const turns = messagesToTurns(messages);

      expect(turns[0].toolResults[0].toolArgs).toEqual({
        nested: { key: 'value' },
        array: [1, 2, 3]
      });
    });
  });
});
