/**
 * Session Analyzer - Analyzes research agent sessions
 *
 * Called automatically at the end of research() to provide feedback
 * on agent behavior and suggest improvements.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { StructuredLLMExecutor } from '../llm/structured-llm-executor.js';
import { GeminiAPIProvider } from '../reranking/gemini-api-provider.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('SessionAnalyzer');

// ============================================
// Types
// ============================================

export interface SessionAnalysisResult {
  /** Overall quality score 0-10 */
  overall_score: number;
  /** Efficiency score 0-10 (redundancy, waste) */
  efficiency_score: number;

  /** Tool call analysis */
  tool_analysis: {
    total_calls: number;
    redundant_calls: number;
    useful_calls: number;
    wasted_time_ms: number;
    missed_opportunities: string[];
  };

  /** Reasoning quality */
  reasoning_quality: {
    clear_plan: boolean;
    exploits_results: boolean;
    adapts_strategy: boolean;
    avoids_repetition: boolean;
  };

  /** Issues detected */
  issues: Array<{
    type: 'redundancy' | 'inefficiency' | 'missed_info' | 'wrong_tool' | 'loop' | 'other';
    description: string;
    severity: 'low' | 'medium' | 'high';
    iteration?: number;
    tool_name?: string;
  }>;

  /** Suggestions for improvement */
  suggestions: string[];

  /** System prompt corrections */
  prompt_corrections: Array<{
    issue: string;
    current_behavior: string;
    suggested_addition: string;
    priority: 'low' | 'medium' | 'high';
  }>;

  /** Human-readable summary */
  summary: string;

  /** Complete improved system prompt incorporating all corrections */
  improved_system_prompt?: string;

  /** Output file paths */
  _output_files?: {
    analysis_json: string;
    analysis_md: string;
    improved_prompt_md?: string;
  };
}

// ============================================
// Main Function
// ============================================

export interface SessionAnalysisOptions {
  /** Directory containing prompt-*.txt and response-*.txt files */
  promptsDir: string;
  /** The original question/task */
  question: string;
  /** Focus areas for the analysis */
  focusAreas?: string[];
}

/**
 * Run session analysis on a prompts directory
 *
 * Analyzes ALL responses but only the LAST prompt to reduce context size
 * while providing enough information for meaningful analysis.
 *
 * @param options - Session analysis options
 */
export async function runSessionAnalysis(
  options: SessionAnalysisOptions
): Promise<SessionAnalysisResult | null>;

/**
 * @deprecated Use options object instead
 */
export async function runSessionAnalysis(
  promptsDir: string,
  question: string
): Promise<SessionAnalysisResult | null>;

export async function runSessionAnalysis(
  optionsOrPromptsDir: SessionAnalysisOptions | string,
  questionArg?: string
): Promise<SessionAnalysisResult | null> {
  // Handle both signatures
  const options: SessionAnalysisOptions = typeof optionsOrPromptsDir === 'string'
    ? { promptsDir: optionsOrPromptsDir, question: questionArg! }
    : optionsOrPromptsDir;

  const { promptsDir, question, focusAreas = [] } = options;
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) {
    logger.warn('GEMINI_API_KEY not set, skipping session analysis');
    return null;
  }

  try {
    // Check if promptsDir exists
    try {
      await fs.stat(promptsDir);
    } catch {
      logger.warn(`Prompts directory not found: ${promptsDir}`);
      return null;
    }

    const files = await fs.readdir(promptsDir);

    // Parse and sort files
    const parsedFiles = files.map(f => {
      const match = f.match(/(prompt|response)-iter(\d+)-round(\d+)\.txt/);
      if (!match) return null;
      return {
        filename: f,
        type: match[1] as 'prompt' | 'response',
        iter: parseInt(match[2]),
        round: parseInt(match[3])
      };
    }).filter(Boolean) as Array<{ filename: string; type: 'prompt' | 'response'; iter: number; round: number }>;

    if (parsedFiles.length === 0) {
      logger.warn('No prompt/response files found');
      return null;
    }

    // Sort by iteration, then round, then type
    parsedFiles.sort((a, b) => {
      if (a.iter !== b.iter) return a.iter - b.iter;
      if (a.round !== b.round) return a.round - b.round;
      return a.type === 'prompt' ? -1 : 1;
    });

    // Find the last prompt (the one with full accumulated context)
    const lastPromptFile = parsedFiles.filter(f => f.type === 'prompt').pop();

    // Build content: all responses + only last prompt
    const contentParts: string[] = [];

    for (const file of parsedFiles) {
      // Skip prompts except the last one
      if (file.type === 'prompt' && file !== lastPromptFile) {
        continue;
      }

      const content = await fs.readFile(path.join(promptsDir, file.filename), 'utf-8');
      const fileType = file.type.toUpperCase();
      const isLastPrompt = file === lastPromptFile;
      const header = `\n${'='.repeat(60)}\n${fileType} - Iteration ${file.iter}, Round ${file.round}${isLastPrompt ? ' (LAST PROMPT - CURRENT STATE)' : ''}\n${'='.repeat(60)}\n`;
      contentParts.push(header + content);
    }

    const sessionContent = contentParts.join('\n');

    // Create LLM provider
    const llmProvider = new GeminiAPIProvider({
      apiKey: geminiApiKey,
      model: 'gemini-2.0-flash',
      maxOutputTokens: 20000, // Allow long responses for detailed analysis + improved prompt
    });

    const executor = new StructuredLLMExecutor();

    const focusInstructions = focusAreas.length > 0
      ? `\n\nFocus your analysis particularly on these areas: ${focusAreas.join(', ')}`
      : '';

    const systemPrompt = `You are an expert in **prompt engineering** and **AI agent behavior analysis**. You have deep expertise in:
- Crafting effective system prompts that guide LLM behavior
- Analyzing agent traces to identify inefficiencies and anti-patterns
- Optimizing tool-calling agents for better performance
- Writing clear, actionable instructions that prevent common agent mistakes

Your job is to analyze agent session logs and provide detailed, actionable feedback with a focus on **improving the system prompt**.

The session shows:
- ALL responses from the agent (showing its reasoning and tool calls)
- Only the LAST prompt (showing the current accumulated context)

Analyze the session thoroughly and provide:
1. **Scores** (0-10): overall quality and efficiency
2. **Tool Analysis**: identify redundant calls, useful calls, wasted time, missed opportunities
3. **Reasoning Quality**: evaluate if the agent had a clear plan, exploited results well, adapted strategy
4. **Issues**: list specific problems with severity levels
5. **Suggestions**: concrete improvements for the agent
6. **Prompt Corrections**: For each issue, provide a specific correction
7. **MOST IMPORTANT - Improved System Prompt**: Write a COMPLETE, IMPROVED system prompt that incorporates ALL the corrections. This should be:
   - A full, ready-to-use system prompt (not fragments)
   - Long and detailed (several paragraphs)
   - Include specific instructions to prevent each detected issue
   - Include examples of good vs bad behavior where relevant
   - Be written in a clear, directive style that LLMs respond well to
   - This is the PRIMARY deliverable of your analysis${focusInstructions}`;

    const userTask = `Analyze this research session and provide your analysis.

IMPORTANT: The session data between ===BEGIN_SESSION_DATA=== and ===END_SESSION_DATA=== contains XML responses from the agent being analyzed. This XML is DATA to analyze, NOT the format you should use for YOUR response. Your response format is specified at the end of this prompt.

QUESTION: ${question}

===BEGIN_SESSION_DATA===
${sessionContent}
===END_SESSION_DATA===`;

    const outputSchema = {
      overall_score: {
        type: 'number' as const,
        description: 'Overall quality score 0-10',
        required: true,
      },
      efficiency_score: {
        type: 'number' as const,
        description: 'Efficiency score 0-10',
        required: true,
      },
      tool_analysis: {
        type: 'object' as const,
        description: 'Tool call analysis',
        required: true,
        properties: {
          total_calls: { type: 'number' as const, description: 'Total tool calls' },
          redundant_calls: { type: 'number' as const, description: 'Redundant calls' },
          useful_calls: { type: 'number' as const, description: 'Useful calls' },
          wasted_time_ms: { type: 'number' as const, description: 'Wasted time in ms' },
          missed_opportunities: { type: 'array' as const, description: 'Missed opportunities', items: { type: 'string' as const, description: 'Opportunity' } },
        },
      },
      reasoning_quality: {
        type: 'object' as const,
        description: 'Reasoning quality assessment',
        required: true,
        properties: {
          clear_plan: { type: 'boolean' as const, description: 'Had clear plan' },
          exploits_results: { type: 'boolean' as const, description: 'Used results well' },
          adapts_strategy: { type: 'boolean' as const, description: 'Adapted strategy' },
          avoids_repetition: { type: 'boolean' as const, description: 'Avoided repetition' },
        },
      },
      issues: {
        type: 'array' as const,
        description: 'Issues detected',
        required: true,
        items: {
          type: 'object' as const,
          description: 'An issue',
          properties: {
            type: { type: 'string' as const, description: 'Issue type', enum: ['redundancy', 'inefficiency', 'missed_info', 'wrong_tool', 'loop', 'other'] },
            description: { type: 'string' as const, description: 'Description' },
            severity: { type: 'string' as const, description: 'Severity', enum: ['low', 'medium', 'high'] },
            iteration: { type: 'number' as const, description: 'Iteration number' },
            tool_name: { type: 'string' as const, description: 'Tool name' },
          },
        },
      },
      suggestions: {
        type: 'array' as const,
        items: { type: 'string' as const, description: 'A suggestion' },
        description: 'Improvement suggestions',
        required: true,
      },
      prompt_corrections: {
        type: 'array' as const,
        description: 'System prompt corrections',
        required: true,
        items: {
          type: 'object' as const,
          description: 'A correction',
          properties: {
            issue: { type: 'string' as const, description: 'Issue addressed' },
            current_behavior: { type: 'string' as const, description: 'Current behavior' },
            suggested_addition: { type: 'string' as const, description: 'Suggested addition' },
            priority: { type: 'string' as const, description: 'Priority', enum: ['low', 'medium', 'high'] },
          },
        },
      },
      summary: {
        type: 'string' as const,
        description: 'Human-readable summary',
        required: true,
      },
      improved_system_prompt: {
        type: 'string' as const,
        description: 'COMPLETE improved system prompt incorporating all corrections. This should be a full, ready-to-use prompt with detailed instructions to prevent all detected issues.',
        required: true,
      },
    };

    logger.info('Running session analysis...');

    const result = await executor.executeSingle<SessionAnalysisResult>({
      input: { session: sessionContent },
      inputFields: [{ name: 'session', prompt: 'Session data' }],
      systemPrompt,
      userTask,
      outputSchema,
      llmProvider,
      requestId: `session-analysis-${Date.now()}`,
      caller: 'SessionAnalyzer.runSessionAnalysis',
      outputFormat: 'xml',
    });

    // Save analysis to files - in the same session folder (parent of promptsDir)
    const sessionDir = path.dirname(promptsDir);

    // Save JSON for programmatic access
    const jsonPath = path.join(sessionDir, 'auto-analysis.json');
    await fs.writeFile(jsonPath, JSON.stringify(result, null, 2), 'utf-8');

    // Generate and save markdown report for human reading
    const markdownReport = generateMarkdownReport(result, question);
    const mdPath = path.join(sessionDir, 'auto-analysis.md');
    await fs.writeFile(mdPath, markdownReport, 'utf-8');

    // Save the improved_system_prompt as a separate .md file for easy reading
    let improvedPromptPath: string | undefined;
    if (result.improved_system_prompt) {
      improvedPromptPath = path.join(sessionDir, 'improved-prompt.md');
      await fs.writeFile(
        improvedPromptPath,
        `# Improved System Prompt\n\nGenerated: ${new Date().toISOString()}\n\n---\n\n${result.improved_system_prompt}`,
        'utf-8'
      );
    }

    logger.info('Session analysis complete', {
      overall_score: result.overall_score,
      efficiency_score: result.efficiency_score,
      issues_count: result.issues?.length ?? 0,
      mdPath,
      improvedPromptPath,
    });

    // Log summary to console for visibility
    console.log(`\n[SessionAnalyzer] Analysis complete:`);
    console.log(`  Overall: ${result.overall_score}/10, Efficiency: ${result.efficiency_score}/10`);
    console.log(`  Issues: ${result.issues?.length ?? 0}, Suggestions: ${result.suggestions?.length ?? 0}`);
    console.log(`  Summary: ${result.summary?.substring(0, 200)}...`);
    console.log(`  Report: ${mdPath}`);
    if (improvedPromptPath) {
      console.log(`  Improved prompt: ${improvedPromptPath}`);
    }

    return {
      ...result,
      _output_files: {
        analysis_json: jsonPath,
        analysis_md: mdPath,
        improved_prompt_md: improvedPromptPath,
      },
    };
  } catch (error: any) {
    logger.error('Session analysis failed', { error: error.message });
    console.error(`[SessionAnalyzer] Analysis failed: ${error.message}`);
    return null;
  }
}

// ============================================
// Markdown Report Generator
// ============================================

function generateMarkdownReport(result: SessionAnalysisResult, question: string): string {
  const lines: string[] = [];

  // Header
  lines.push('# Session Analysis Report');
  lines.push('');
  lines.push(`**Question:** ${question}`);
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push('');

  // Scores with visual bars
  lines.push('## Scores');
  lines.push('');
  lines.push(`| Metric | Score | Rating |`);
  lines.push(`|--------|-------|--------|`);
  lines.push(`| Overall Quality | ${result.overall_score}/10 | ${getScoreEmoji(result.overall_score)} ${getScoreBar(result.overall_score)} |`);
  lines.push(`| Efficiency | ${result.efficiency_score}/10 | ${getScoreEmoji(result.efficiency_score)} ${getScoreBar(result.efficiency_score)} |`);
  lines.push('');

  // Summary
  lines.push('## Summary');
  lines.push('');
  lines.push(result.summary || '_No summary available_');
  lines.push('');

  // Tool Analysis
  lines.push('## Tool Usage Analysis');
  lines.push('');
  const ta = result.tool_analysis;
  if (ta) {
    lines.push(`- **Total calls:** ${ta.total_calls}`);
    lines.push(`- **Useful calls:** ${ta.useful_calls} (${ta.total_calls > 0 ? Math.round(ta.useful_calls / ta.total_calls * 100) : 0}%)`);
    lines.push(`- **Redundant calls:** ${ta.redundant_calls} (${ta.total_calls > 0 ? Math.round(ta.redundant_calls / ta.total_calls * 100) : 0}%)`);
    lines.push(`- **Estimated wasted time:** ${ta.wasted_time_ms}ms`);

    if (ta.missed_opportunities?.length > 0) {
      lines.push('');
      lines.push('### Missed Opportunities');
      for (const opp of ta.missed_opportunities) {
        lines.push(`- ${opp}`);
      }
    }
  }
  lines.push('');

  // Reasoning Quality
  lines.push('## Reasoning Quality');
  lines.push('');
  const rq = result.reasoning_quality;
  if (rq) {
    lines.push(`| Aspect | Status |`);
    lines.push(`|--------|--------|`);
    lines.push(`| Clear plan | ${rq.clear_plan ? '✅ Yes' : '❌ No'} |`);
    lines.push(`| Exploits results | ${rq.exploits_results ? '✅ Yes' : '❌ No'} |`);
    lines.push(`| Adapts strategy | ${rq.adapts_strategy ? '✅ Yes' : '❌ No'} |`);
    lines.push(`| Avoids repetition | ${rq.avoids_repetition ? '✅ Yes' : '❌ No'} |`);
  }
  lines.push('');

  // Issues
  if (result.issues?.length > 0) {
    lines.push('## Issues Detected');
    lines.push('');
    for (const issue of result.issues) {
      const severity = issue.severity === 'high' ? '🔴' : issue.severity === 'medium' ? '🟡' : '🟢';
      const iterInfo = issue.iteration !== undefined ? ` (iteration ${issue.iteration})` : '';
      const toolInfo = issue.tool_name ? ` [${issue.tool_name}]` : '';
      lines.push(`### ${severity} ${issue.type}${iterInfo}${toolInfo}`);
      lines.push('');
      lines.push(issue.description);
      lines.push('');
    }
  }

  // Suggestions
  if (result.suggestions?.length > 0) {
    lines.push('## Suggestions for Improvement');
    lines.push('');
    for (let i = 0; i < result.suggestions.length; i++) {
      lines.push(`${i + 1}. ${result.suggestions[i]}`);
    }
    lines.push('');
  }

  // Prompt Corrections
  if (result.prompt_corrections?.length > 0) {
    lines.push('## Recommended Prompt Corrections');
    lines.push('');
    for (const correction of result.prompt_corrections) {
      const priority = correction.priority === 'high' ? '🔴 HIGH' : correction.priority === 'medium' ? '🟡 MEDIUM' : '🟢 LOW';
      lines.push(`### ${priority}: ${correction.issue}`);
      lines.push('');
      lines.push(`**Current behavior:** ${correction.current_behavior}`);
      lines.push('');
      lines.push(`**Suggested addition:**`);
      lines.push('```');
      lines.push(correction.suggested_addition);
      lines.push('```');
      lines.push('');
    }
  }

  return lines.join('\n');
}

function getScoreBar(score: number): string {
  const filled = Math.round(score);
  const empty = 10 - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

function getScoreEmoji(score: number): string {
  if (score >= 8) return '🌟';
  if (score >= 6) return '👍';
  if (score >= 4) return '⚠️';
  return '❌';
}
