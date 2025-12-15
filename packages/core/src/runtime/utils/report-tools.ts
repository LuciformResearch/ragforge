/**
 * Report Editing Tools
 *
 * Tool definitions and handlers for incremental report editing.
 * These are "internal" tools that operate on a ReportEditor instance,
 * not on the filesystem.
 *
 * @since 2025-12-15
 */

import { ReportEditor, type EditResult } from './report-editor.js';
import { type ToolDefinition } from '../llm/native-tool-calling/index.js';

// ============================================
// Tool Definitions
// ============================================

/**
 * Tool definitions for report editing
 */
export const REPORT_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'set_report',
      description: `Set the full report content. Use this ONLY for the initial draft or to completely rewrite the report.
For incremental changes, prefer edit_report, append_to_report, or replace_section.

Example:
  set_report({ content: "# Report Title\\n\\n## Summary\\n\\nInitial findings..." })`,
      parameters: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'The full markdown content for the report',
          },
        },
        required: ['content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_report',
      description: `Search and replace text in the report.
Use this for small, targeted edits when you know the exact text to change.

Example:
  edit_report({ old_text: "TODO: add details", new_text: "The function handles authentication via JWT tokens." })`,
      parameters: {
        type: 'object',
        properties: {
          old_text: {
            type: 'string',
            description: 'The exact text to find and replace',
          },
          new_text: {
            type: 'string',
            description: 'The replacement text',
          },
          replace_all: {
            type: 'boolean',
            description: 'Replace all occurrences (default: false, replaces first only)',
          },
        },
        required: ['old_text', 'new_text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'append_to_report',
      description: `Add content to the end of the report.
Use this to add new sections or conclusions.

Example:
  append_to_report({ content: "## Conclusion\\n\\nBased on the analysis..." })`,
      parameters: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'Content to append (can include markdown headings)',
          },
        },
        required: ['content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'insert_after_heading',
      description: `Insert content immediately after a specific heading.
The heading is matched case-insensitively and can be partial.

Example:
  insert_after_heading({ heading: "## Summary", content: "This section provides an overview..." })`,
      parameters: {
        type: 'object',
        properties: {
          heading: {
            type: 'string',
            description: 'The heading to insert after (e.g., "## Summary")',
          },
          content: {
            type: 'string',
            description: 'Content to insert after the heading',
          },
        },
        required: ['heading', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'replace_section',
      description: `Replace an entire section's content (everything from the heading to the next same-level heading).
The heading is preserved; only the content below it is replaced.

Example:
  replace_section({ heading: "## Details", new_content: "The updated details are as follows:\\n\\n- Point 1\\n- Point 2" })`,
      parameters: {
        type: 'object',
        properties: {
          heading: {
            type: 'string',
            description: 'The section heading to replace (e.g., "## Details")',
          },
          new_content: {
            type: 'string',
            description: 'New content for the section (heading will be preserved)',
          },
        },
        required: ['heading', 'new_content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_section',
      description: `Delete an entire section including its heading.
Use with caution - this removes the section completely.

Example:
  delete_section({ heading: "## Temporary Notes" })`,
      parameters: {
        type: 'object',
        properties: {
          heading: {
            type: 'string',
            description: 'The section heading to delete',
          },
        },
        required: ['heading'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'finalize_report',
      description: `Mark the report as complete with a confidence level.
Call this when you have gathered enough information and the report is ready.

Confidence levels:
- "high": All information gathered, no missing pieces
- "medium": Most information found, some minor gaps
- "low": Partial information, significant gaps remain

Example:
  finalize_report({ confidence: "high" })`,
      parameters: {
        type: 'object',
        properties: {
          confidence: {
            type: 'string',
            enum: ['high', 'medium', 'low'],
            description: 'Confidence level in the completeness of the report',
          },
        },
        required: ['confidence'],
      },
    },
  },
];

/**
 * Get tool names for report editing
 */
export const REPORT_TOOL_NAMES = REPORT_TOOL_DEFINITIONS.map(t => t.function.name);

// ============================================
// Tool Handlers
// ============================================

export interface ReportToolHandlers {
  set_report: (args: { content: string }) => EditResult;
  edit_report: (args: { old_text: string; new_text: string; replace_all?: boolean }) => EditResult;
  append_to_report: (args: { content: string }) => EditResult;
  insert_after_heading: (args: { heading: string; content: string }) => EditResult;
  replace_section: (args: { heading: string; new_content: string }) => EditResult;
  delete_section: (args: { heading: string }) => EditResult;
  finalize_report: (args: { confidence: 'high' | 'medium' | 'low' }) => { finalized: true; confidence: string; report: string };
}

/**
 * Create handlers for report tools bound to a ReportEditor instance
 */
export function createReportToolHandlers(editor: ReportEditor): ReportToolHandlers {
  return {
    set_report: (args) => editor.setReport(args.content),

    edit_report: (args) => editor.replace(args.old_text, args.new_text, args.replace_all),

    append_to_report: (args) => editor.append(args.content),

    insert_after_heading: (args) => editor.insertAfterHeading(args.heading, args.content),

    replace_section: (args) => editor.replaceSection(args.heading, args.new_content),

    delete_section: (args) => editor.deleteSection(args.heading),

    finalize_report: (args) => ({
      finalized: true,
      confidence: args.confidence,
      report: editor.getContent(),
    }),
  };
}

// ============================================
// Helper Types
// ============================================

export interface ReportToolCall {
  tool_name: keyof ReportToolHandlers;
  arguments: Record<string, any>;
}

export interface ReportState {
  content: string;
  isFinalized: boolean;
  confidence?: 'high' | 'medium' | 'low';
  editHistory: Array<{
    tool: string;
    success: boolean;
    timestamp: number;
  }>;
}

/**
 * Check if a tool name is a report editing tool
 */
export function isReportTool(toolName: string): boolean {
  return REPORT_TOOL_NAMES.includes(toolName);
}

/**
 * Check if a tool call finalizes the report
 */
export function isFinalizeTool(toolName: string): boolean {
  return toolName === 'finalize_report';
}
