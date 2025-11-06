/**
 * Iterative Code Agent
 *
 * An LLM-powered agent that writes and executes RagForge queries
 * to progressively build the perfect code context.
 *
 * The agent:
 * 1. Receives a user question
 * 2. Generates TypeScript code to query RagForge
 * 3. Executes the code and gets results
 * 4. Analyzes results with LLM (structured XML output)
 * 5. Decides next action and iterates
 * 6. Returns final context when complete
 */

import { LuciformXMLParser } from '@luciformresearch/xmlparser';
import { writeFileSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import type { SearchResult } from '../types/index.js';

// ============================================================================
// XML Helper
// ============================================================================

/**
 * Extract text content from an XML element
 */
function getElementText(element: any): string {
  if (!element || !element.children) return '';
  const textNodes = element.children.filter((c: any) => c.type === 'text');
  return textNodes.map((n: any) => n.content || '').join('').trim();
}

// ============================================================================
// Types
// ============================================================================

export interface LLMClient {
  /**
   * Generate a completion with structured XML output
   */
  generate(prompt: string): Promise<string>;
}

export interface AgentConfig {
  llm: LLMClient;
  ragClientPath: string; // Path to the generated RAG client
  workDir: string; // Working directory for temp scripts
  maxIterations?: number;
  verbose?: boolean;
  frameworkDocs: string; // Documentation injected by generated client (REQUIRED)
}

export interface IterationStep {
  iteration: number;
  action: 'search' | 'analyze' | 'expand' | 'refine' | 'complete';
  query?: string;
  code?: string;
  results?: any;
  analysis?: IterationAnalysis;
  timestamp: number;
}

export interface IterationAnalysis {
  resultsCount: number;
  quality: 'excellent' | 'good' | 'insufficient' | 'irrelevant';
  findings: string[];
  nextAction: 'search' | 'expand' | 'refine' | 'complete';
  reasoning: string;
  nextQuery?: string;
}

export interface AgentResult {
  answer: string;
  context: SearchResult[];
  steps: IterationStep[];
  totalIterations: number;
  totalTime: number;
}

// ============================================================================
// Iterative Code Agent
// ============================================================================

export class IterativeCodeAgent {
  private steps: IterationStep[] = [];
  private startTime: number = 0;
  private lastSearchReasoning: string = ''; // Store reasoning from previous iteration
  private frameworkDocs: string;

  constructor(private config: AgentConfig) {
    this.frameworkDocs = config.frameworkDocs;
  }

  /**
   * Summarize a code scope using LLM (for long code)
   * The summary is oriented toward the user's question AND the agent's search intention
   */
  private async summarizeScope(entity: any, userQuestion: string): Promise<string> {
    // Build context for summarization
    let contextInfo = `User Question: "${userQuestion}"`;

    if (this.lastSearchReasoning) {
      contextInfo += `\n\nAgent's Current Search Intent:\n${this.lastSearchReasoning}`;
    }

    const prompt = `Summarize this code scope in 1-2 sentences, focusing on aspects relevant to the user's question and the agent's search intent.

${contextInfo}

Code Scope:
Name: ${entity.name}
Type: ${entity.type}
Signature: ${entity.signature || 'N/A'}
Source:
${entity.source}

IMPORTANT:
- Orient your summary toward BOTH the user's question AND the agent's search intent
- Highlight what this code does that relates to their query and the current search strategy
- Explain if this code is relevant or NOT relevant to what's being searched for
- Focus on WHAT it does and HOW, emphasizing aspects relevant to the search

Output a concise, context-oriented summary (max 100 words):`;

    try {
      const summary = await this.config.llm.generate(prompt);
      return summary.trim();
    } catch (error) {
      // Fallback: just truncate
      return entity.source.substring(0, 200) + '...';
    }
  }

  /**
   * Main entry point: answer a user question by iteratively
   * building context through code execution
   */
  async answer(userQuestion: string): Promise<AgentResult> {
    this.steps = [];
    this.startTime = Date.now();
    this.lastSearchReasoning = ''; // Reset for new session

    const maxIterations = this.config.maxIterations || 5;
    let iteration = 0;
    let allResults: SearchResult[] = [];
    let shouldContinue = true;

    this.log(`\n🤖 Agent starting: "${userQuestion}"\n`);

    while (shouldContinue && iteration < maxIterations) {
      iteration++;
      this.log(`\n${'='.repeat(70)}`);
      this.log(`Iteration ${iteration}/${maxIterations}`);
      this.log('='.repeat(70));

      // Step 1: Generate query code
      const code = await this.generateQueryCode(userQuestion, allResults, iteration);
      this.log(`\n📝 Generated code:\n${code}\n`);

      // Step 2: Execute code
      const results = await this.executeCode(code);
      this.log(`\n✅ Execution complete: ${results.length} results`);

      // Step 3: Analyze results with LLM
      const analysis = await this.analyzeResults(userQuestion, results, iteration);
      this.log(`\n🔍 Analysis:`);
      this.log(`   Quality: ${analysis.quality}`);
      this.log(`   Next action: ${analysis.nextAction}`);
      this.log(`   Reasoning: ${analysis.reasoning}`);

      // Record step
      this.steps.push({
        iteration,
        action: iteration === 1 ? 'search' : analysis.nextAction,
        code,
        results,
        analysis,
        timestamp: Date.now() - this.startTime
      });

      // Merge results (dedupe by UUID)
      allResults = this.mergeResults(allResults, results);

      // Decide if we continue
      shouldContinue = analysis.nextAction !== 'complete' && iteration < maxIterations;
    }

    // Final synthesis
    this.log(`\n${'='.repeat(70)}`);
    this.log('Synthesizing final answer...');
    this.log('='.repeat(70));

    const answer = await this.synthesizeAnswer(userQuestion, allResults);

    const totalTime = Date.now() - this.startTime;
    this.log(`\n✅ Complete in ${totalTime}ms after ${iteration} iterations\n`);

    return {
      answer,
      context: allResults,
      steps: this.steps,
      totalIterations: iteration,
      totalTime
    };
  }

  /**
   * Generate TypeScript code for querying RagForge
   */
  private async generateQueryCode(
    userQuestion: string,
    previousResults: SearchResult[],
    iteration: number
  ): Promise<string> {
    const isFirstIteration = iteration === 1;

    // Build context summary for non-first iterations
    let contextSummary = '';
    if (!isFirstIteration && previousResults.length > 0) {
      const CODE_LENGTH_THRESHOLD = 300;

      // Summarize top 5 results (in parallel for speed)
      const summaries = await Promise.all(
        previousResults.slice(0, 5).map(async (r) => {
          const entity = r.entity as any;
          let summary = `\n${r.entity.name} (${r.entity.type}) in ${r.entity.file} [score: ${r.score.toFixed(3)}]`;

          // Add signature if available
          if (entity.signature) {
            summary += `\n  Signature: ${entity.signature.substring(0, 150)}${entity.signature.length > 150 ? '...' : ''}`;
          }

          // Add source - smart handling based on length
          if (entity.source) {
            if (entity.source.length <= CODE_LENGTH_THRESHOLD) {
              // Short code: include as-is
              summary += `\n  Code:\n${entity.source}`;
            } else {
              // Long code: summarize with LLM (question-oriented)
              const codeSummary = await this.summarizeScope(entity, userQuestion);
              summary += `\n  Summary: ${codeSummary}`;
            }
          }

          // Add CONSUMES if available
          if (entity.consumes && entity.consumes.length > 0) {
            summary += `\n  Uses: ${entity.consumes.slice(0, 5).join(', ')}`;
          }

          return summary;
        })
      );

      contextSummary = summaries.join('\n');
    }

    const prompt = `You are a code generation assistant for RagForge, a RAG framework for code analysis.

Framework Documentation:
${this.frameworkDocs}

User question: "${userQuestion}"

${isFirstIteration ? `
This is the FIRST iteration. Generate TypeScript code to perform an initial broad search.
Use semantic search with a high topK (50-100) to cast a wide net.
` : `
This is iteration ${iteration}. Previous results: ${previousResults.length} scopes found.

Previous results summary (top 5):
${contextSummary}

Based on what you found above, generate code to REFINE or EXPAND the search.
Consider:
- Use whereConsumesScope() or whereConsumedByScope() to explore relationships
- Filter by file paths if patterns emerge
- Use different semantic queries to find missing pieces
- Expand with withConsumes() or withConsumedBy() to get related code
- Use rerankWithLLM() for better ranking if needed
`}

You MUST respond with a structured XML response following this EXACT format:

<response>
  <reasoning>
    Explain your strategy:
    - What search approach are you using?
    - Why will this find relevant results?
    - What topK/filters/relationships?
  </reasoning>
  <code>
// The 'rag' client is ALREADY CREATED - just write the query
const results = await rag.scope()
  .semanticSearchBySource('your query', { topK: 50 })
  .execute();

console.log(JSON.stringify(results, null, 2));
  </code>
</response>

IMPORTANT:
- Use ONLY XML tags (no markdown \`\`\` blocks)
- The <code> must contain ONLY the query logic (rag client already exists)
- Do NOT include imports, config, or rag.close()
- The <reasoning> explains your strategy

Generate your structured XML response now:`;

    const response = await this.config.llm.generate(prompt);

    // Try to extract from XML structure (handle potential ```xml wrapper)
    let cleanResponse = response.trim();

    // Remove markdown code fence if present
    if (cleanResponse.startsWith('```xml') || cleanResponse.startsWith('```')) {
      cleanResponse = cleanResponse.replace(/^```(?:xml)?\s*\n/, '').replace(/\n```\s*$/, '');
    }

    // Extract reasoning and code
    const reasoningMatch = cleanResponse.match(/<reasoning>([\s\S]*?)<\/reasoning>/);
    const codeMatch = cleanResponse.match(/<code>([\s\S]*?)<\/code>/);

    if (!codeMatch) {
      // Fallback: try old format
      const result = new LuciformXMLParser(cleanResponse, { mode: 'luciform-permissive' }).parse();
      const codeNode = result.document?.root?.children?.find((c: any) => c.name === 'code');
      if (codeNode) {
        const code = getElementText(codeNode);
        if (code) return this.wrapCodeInRunner(code);
      }
      throw new Error('LLM did not return code in <code> tags');
    }

    const code = codeMatch[1].trim();
    if (!code) {
      throw new Error('Code block is empty');
    }

    // Store reasoning for next iteration's context
    if (reasoningMatch) {
      this.lastSearchReasoning = reasoningMatch[1].trim();
    }

    // Log reasoning if verbose
    if (this.config.verbose && reasoningMatch) {
      this.log(`\n💭 LLM Reasoning: ${this.lastSearchReasoning}\n`);
    }

    return this.wrapCodeInRunner(code);
  }

  /**
   * Wrap query code in a complete runnable script
   */
  private wrapCodeInRunner(queryCode: string): string {
    return `import { createRagClient } from '${this.config.ragClientPath}';

const rag = createRagClient({
  neo4j: {
    uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
    username: process.env.NEO4J_USERNAME || 'neo4j',
    password: process.env.NEO4J_PASSWORD || '',
    database: 'neo4j'
  }
});

${queryCode}

await rag.close();`;
  }

  /**
   * Execute TypeScript code and return results
   */
  private async executeCode(code: string): Promise<SearchResult[]> {
    const tempFile = join(this.config.workDir, `agent-query-${Date.now()}.ts`);

    try {
      // Write code to temp file
      writeFileSync(tempFile, code);

      // Execute with tsx
      const output = execSync(`npx tsx ${tempFile}`, {
        cwd: this.config.workDir,
        encoding: 'utf-8',
        env: { ...process.env }
      });

      // Parse JSON output
      const results = JSON.parse(output);
      return results;

    } catch (error: any) {
      this.log(`\n❌ Execution error: ${error.message}`);
      throw error;
    } finally {
      // Cleanup
      try {
        unlinkSync(tempFile);
      } catch {}
    }
  }

  /**
   * Analyze results with LLM and decide next action
   */
  private async analyzeResults(
    userQuestion: string,
    results: SearchResult[],
    iteration: number
  ): Promise<IterationAnalysis> {
    const resultsSummary = results.slice(0, 10).map(r =>
      `- ${r.entity.name} (${r.entity.type}) in ${r.entity.file} [score: ${r.score.toFixed(3)}]`
    ).join('\n');

    const prompt = `You are analyzing search results for: "${userQuestion}"

Iteration: ${iteration}
Results found: ${results.length}

Top results:
${resultsSummary}

Analyze these results and provide a structured assessment.

Output XML with this structure:
<analysis>
  <quality>excellent|good|insufficient|irrelevant</quality>
  <findings>
    <finding>Key observation 1</finding>
    <finding>Key observation 2</finding>
  </findings>
  <nextAction>search|expand|refine|complete</nextAction>
  <reasoning>Explain why this is the next action</reasoning>
  <nextQuery>If nextAction is search/refine, provide the query here</nextQuery>
</analysis>

Guidelines:
- quality=excellent: Found exactly what we need, ready to answer
- quality=good: Found relevant results but need to expand for full context
- quality=insufficient: Results are on-topic but missing key pieces
- quality=irrelevant: Results don't answer the question, need different approach

- nextAction=complete: We have enough context to answer
- nextAction=expand: Get related code (dependencies, consumers)
- nextAction=refine: Try a different search query
- nextAction=search: Initial broad search (only for iteration 1)

Analyze now:`;

    const response = await this.config.llm.generate(prompt);

    // Parse XML
    const result = new LuciformXMLParser(response, { mode: 'luciform-permissive' }).parse();
    const analysisNode = result.document?.root?.children?.find((c: any) => c.name === 'analysis');

    if (!analysisNode) {
      throw new Error('LLM did not return <analysis> tag');
    }

    const quality = getElementText(analysisNode.children?.find((c: any) => c.name === 'quality')) as any || 'insufficient';
    const nextAction = getElementText(analysisNode.children?.find((c: any) => c.name === 'nextAction')) as any || 'search';
    const reasoning = getElementText(analysisNode.children?.find((c: any) => c.name === 'reasoning')) || '';
    const nextQuery = getElementText(analysisNode.children?.find((c: any) => c.name === 'nextQuery'));

    const findingsNode = analysisNode.children?.find((c: any) => c.name === 'findings');
    const findings = findingsNode?.children
      ?.filter((c: any) => c.name === 'finding')
      .map((c: any) => getElementText(c))
      .filter(Boolean) || [];

    return {
      resultsCount: results.length,
      quality,
      findings,
      nextAction,
      reasoning,
      nextQuery
    };
  }

  /**
   * Synthesize final answer from all collected context
   */
  private async synthesizeAnswer(
    userQuestion: string,
    allResults: SearchResult[]
  ): Promise<string> {
    const contextSummary = allResults.slice(0, 20).map(r =>
      `${r.entity.name} (${r.entity.type}) in ${r.entity.file}`
    ).join('\n');

    const prompt = `Based on the code context found, answer this question: "${userQuestion}"

Context (${allResults.length} code scopes):
${contextSummary}

Provide a clear, concise answer wrapped in <answer> tags.
Reference specific scopes by name when relevant.

<answer>
Your answer here...
</answer>`;

    const response = await this.config.llm.generate(prompt);

    const result = new LuciformXMLParser(response, { mode: 'luciform-permissive' }).parse();
    const answerNode = result.document?.root?.children?.find((c: any) => c.name === 'answer');

    return answerNode ? getElementText(answerNode) : response;
  }

  /**
   * Merge results, deduplicating by UUID
   */
  private mergeResults(existing: SearchResult[], newResults: SearchResult[]): SearchResult[] {
    const uuidSet = new Set(existing.map(r => r.entity.uuid));
    const unique = newResults.filter(r => !uuidSet.has(r.entity.uuid));

    // Combine and sort by score
    return [...existing, ...unique].sort((a, b) => b.score - a.score);
  }

  /**
   * Log if verbose mode enabled
   */
  private log(message: string): void {
    if (this.config.verbose) {
      console.log(message);
    }
  }
}
