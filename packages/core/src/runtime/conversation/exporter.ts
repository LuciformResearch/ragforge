/**
 * ConversationExporter - Export conversations to files for debugging
 *
 * Supports:
 * - JSON format (complete data structure)
 * - Markdown format (human-readable)
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { Conversation } from './conversation.js';
import type { ConversationFullData, Message, Summary } from './types.js';

export interface ExporterOptions {
  exportPath: string;
  exportFormat: 'json' | 'markdown';
}

export class ConversationExporter {
  private exportPath: string;
  private exportFormat: 'json' | 'markdown';

  constructor(options: ExporterOptions) {
    this.exportPath = options.exportPath;
    this.exportFormat = options.exportFormat;
  }

  /**
   * Export a conversation to file
   */
  async export(conversation: Conversation, data: ConversationFullData): Promise<void> {
    // Ensure export directory exists
    await fs.mkdir(this.exportPath, { recursive: true });

    const uuid = conversation.getUuid();
    const filename = this.exportFormat === 'json'
      ? `${uuid}.json`
      : `${uuid}.md`;

    const filepath = path.join(this.exportPath, filename);

    const content = this.exportFormat === 'json'
      ? this.exportToJSON(data)
      : this.exportToMarkdown(data);

    await fs.writeFile(filepath, content, 'utf-8');
  }

  /**
   * Export to JSON format
   */
  private exportToJSON(data: ConversationFullData): string {
    return JSON.stringify(data, null, 2);
  }

  /**
   * Export to Markdown format
   */
  private exportToMarkdown(data: ConversationFullData): string {
    let md = `# ${data.title}\n\n`;
    md += `**UUID:** ${data.uuid}\n`;
    md += `**Created:** ${data.created_at}\n`;
    md += `**Updated:** ${data.updated_at}\n`;
    md += `**Status:** ${data.status}\n`;
    md += `**Messages:** ${data.message_count}\n`;
    md += `**Total Characters:** ${data.total_chars}\n`;

    if (data.tags.length > 0) {
      md += `**Tags:** ${data.tags.join(', ')}\n`;
    }

    md += `\n---\n\n`;

    // Add summaries if present
    if (data.summaries && data.summaries.length > 0) {
      md += `## Summaries\n\n`;

      // Group by level
      const byLevel = new Map<number, Summary[]>();
      for (const summary of data.summaries) {
        if (!byLevel.has(summary.level)) {
          byLevel.set(summary.level, []);
        }
        byLevel.get(summary.level)!.push(summary);
      }

      // Sort levels
      const levels = Array.from(byLevel.keys()).sort();

      for (const level of levels) {
        const summaries = byLevel.get(level)!;
        md += `### Level ${level} Summaries (${summaries.length})\n\n`;

        for (const summary of summaries) {
          md += `**Chars ${summary.char_range_start}-${summary.char_range_end}** `;
          md += `(${summary.summary_char_count} chars, created ${summary.created_at})\n\n`;
          md += `**Conversation:**\n${summary.content.conversation_summary}\n\n`;
          md += `**Actions:**\n${summary.content.actions_summary}\n\n`;

          if (summary.parent_summaries && summary.parent_summaries.length > 0) {
            md += `*Summarizes: ${summary.parent_summaries.length} L${level - 1} summaries*\n\n`;
          }

          md += `---\n\n`;
        }
      }
    }

    // Add messages
    md += `## Messages (${data.messages.length})\n\n`;

    let turnNumber = 0;
    for (const message of data.messages) {
      if (message.role === 'user') {
        turnNumber++;
        md += `### Turn ${turnNumber}\n\n`;
      }

      md += this.formatMessage(message);
      md += `\n`;
    }

    return md;
  }

  /**
   * Format a single message
   */
  private formatMessage(message: Message): string {
    let md = `**${message.role.toUpperCase()}** `;
    md += `(${message.timestamp}, ${message.char_count} chars)\n\n`;
    md += `${message.content}\n\n`;

    if (message.reasoning) {
      md += `*Reasoning:* ${message.reasoning}\n\n`;
    }

    if (message.tool_calls && message.tool_calls.length > 0) {
      md += `**Tools Used:**\n\n`;
      for (const tc of message.tool_calls) {
        const status = tc.success ? '✅' : '❌';
        md += `- ${status} **${tc.tool_name}**\n`;
        md += `  - Arguments: \`${JSON.stringify(tc.arguments)}\`\n`;
        md += `  - Duration: ${tc.duration_ms}ms\n`;

        if (tc.result) {
          const resultStr = typeof tc.result.result === 'string'
            ? tc.result.result.substring(0, 200)
            : JSON.stringify(tc.result.result).substring(0, 200);
          md += `  - Result: ${resultStr}${resultStr.length >= 200 ? '...' : ''}\n`;

          if (tc.result.error) {
            md += `  - Error: ${tc.result.error}\n`;
          }
        }

        md += `\n`;
      }
    }

    if (message.embedding) {
      md += `*Has embedding (${message.embedding.length} dimensions)*\n\n`;
    }

    md += `---\n\n`;

    return md;
  }

  /**
   * Export multiple conversations at once
   */
  async exportBatch(conversations: Array<{ conversation: Conversation; data: ConversationFullData }>): Promise<void> {
    for (const { conversation, data } of conversations) {
      await this.export(conversation, data);
    }

    console.log(`📄 Exported ${conversations.length} conversations to ${this.exportPath}`);
  }

  /**
   * Clean up old exports
   */
  async cleanup(maxAgeInDays: number = 30): Promise<void> {
    const files = await fs.readdir(this.exportPath);
    const now = Date.now();
    const maxAgeMs = maxAgeInDays * 24 * 60 * 60 * 1000;

    let deletedCount = 0;

    for (const file of files) {
      const filepath = path.join(this.exportPath, file);
      const stats = await fs.stat(filepath);

      if (now - stats.mtime.getTime() > maxAgeMs) {
        await fs.unlink(filepath);
        deletedCount++;
      }
    }

    if (deletedCount > 0) {
      console.log(`🧹 Cleaned up ${deletedCount} old exports`);
    }
  }
}
