/**
 * Planning Tools - Task decomposition with sub-agent execution
 *
 * The plan_actions tool allows an agent to decompose complex tasks into steps
 * and spawn a sub-agent that executes them in order (or in batches).
 */

import type { GeneratedToolDefinition, ToolHandlerGenerator } from './types/index.js';

/**
 * A single planned action
 */
export interface PlannedAction {
  /** Description of the action */
  description: string;
  /** Tool to use (optional - sub-agent can decide) */
  tool?: string;
  /** Expected arguments (optional) */
  arguments?: Record<string, any>;
  /** Complexity estimate: 'simple' | 'medium' | 'complex' */
  complexity?: 'simple' | 'medium' | 'complex';
  /** Can be batched with next action? */
  batchable?: boolean;
}

/**
 * Plan submitted to plan_actions tool
 */
export interface ActionPlan {
  /** Overall goal */
  goal: string;
  /** Ordered list of actions */
  actions: PlannedAction[];
  /** Strategy hint: 'sequential' | 'batch_when_possible' | 'all_at_once' */
  strategy?: 'sequential' | 'batch_when_possible' | 'all_at_once';
}

/**
 * Result from plan execution
 */
export interface PlanExecutionResult {
  success: boolean;
  /** Results from each action */
  results: Array<{
    action: string;
    success: boolean;
    result?: any;
    error?: string;
  }>;
  /** Summary of execution */
  summary: string;
}

/**
 * Context passed to the sub-agent executor
 */
export interface PlanExecutorContext {
  /** Available tools (same as parent) */
  tools: GeneratedToolDefinition[];
  /** Tool handlers */
  handlers: Record<string, ToolHandlerGenerator>;
  /** RAG client */
  ragClient: any;
  /** Execute a sub-agent with the plan */
  executeSubAgent: (plan: ActionPlan) => Promise<PlanExecutionResult>;
}

/**
 * Generate the plan_actions tool
 */
export function generatePlanActionsTool(): {
  definition: GeneratedToolDefinition;
  handlerFactory: (context: PlanExecutorContext) => ToolHandlerGenerator;
} {
  const definition: GeneratedToolDefinition = {
    name: 'plan_actions',
    description: `Plan and execute a sequence of actions using a sub-agent.

Use this when you have a complex task that requires multiple steps.
The sub-agent will:
1. Receive the full context (all tools available)
2. Execute actions in order
3. Can batch multiple simple actions together
4. Report results back

Example plan:
{
  "goal": "Create a web app with HTML and CSS",
  "actions": [
    {"description": "Write index.html with basic structure", "tool": "write_file", "complexity": "simple", "batchable": true},
    {"description": "Write style.css with body styling", "tool": "write_file", "complexity": "simple", "batchable": true},
    {"description": "Ingest the new files", "tool": "ingest_code", "complexity": "medium"},
    {"description": "Query to verify ingestion", "tool": "query_entities", "complexity": "simple"}
  ],
  "strategy": "batch_when_possible"
}

The sub-agent has autonomy to:
- Execute actions one by one or in batches
- Adapt if an action fails
- Provide detailed results`,
    inputSchema: {
      type: 'object',
      properties: {
        goal: {
          type: 'string',
          description: 'Overall goal of the plan',
        },
        actions: {
          type: 'array',
          description: 'Ordered list of actions to execute',
          items: {
            type: 'object',
            properties: {
              description: { type: 'string', description: 'What this action does' },
              tool: { type: 'string', description: 'Tool to use (optional)' },
              arguments: { type: 'object', description: 'Tool arguments (optional)' },
              complexity: {
                type: 'string',
                enum: ['simple', 'medium', 'complex'],
                description: 'Complexity estimate for token budgeting'
              },
              batchable: { type: 'boolean', description: 'Can be batched with adjacent actions' },
            },
            required: ['description'],
          },
        },
        strategy: {
          type: 'string',
          enum: ['sequential', 'batch_when_possible', 'all_at_once'],
          description: 'Execution strategy hint for sub-agent',
        },
      },
      required: ['goal', 'actions'],
    },
  };

  const handlerFactory = (context: PlanExecutorContext): ToolHandlerGenerator => {
    return (_rag: any) => async (args: Record<string, any>) => {
      const plan: ActionPlan = {
        goal: args.goal,
        actions: args.actions || [],
        strategy: args.strategy || 'batch_when_possible',
      };

      if (!plan.actions || plan.actions.length === 0) {
        return { success: false, error: 'No actions provided in plan' };
      }

      console.log(`\n🎯 [plan_actions] Executing plan: "${plan.goal}"`);
      console.log(`   📋 ${plan.actions.length} action(s), strategy: ${plan.strategy}`);

      try {
        const result = await context.executeSubAgent(plan);

        console.log(`   ✅ Plan completed: ${result.results.filter(r => r.success).length}/${result.results.length} actions succeeded`);

        return result;
      } catch (error: any) {
        console.log(`   ❌ Plan failed: ${error.message}`);
        return {
          success: false,
          results: [],
          summary: `Plan execution failed: ${error.message}`,
        };
      }
    };
  };

  return { definition, handlerFactory };
}

/**
 * Calculate recommended maxOutputTokens based on plan complexity
 */
export function estimateTokensForPlan(plan: ActionPlan): number {
  const baseTokens = 4096;
  const tokensPerAction = {
    simple: 1000,
    medium: 2000,
    complex: 4000,
  };

  let totalTokens = baseTokens;

  for (const action of plan.actions) {
    const complexity = action.complexity || 'medium';
    totalTokens += tokensPerAction[complexity];
  }

  // If strategy allows batching, we might need more tokens per call
  if (plan.strategy === 'batch_when_possible' || plan.strategy === 'all_at_once') {
    const batchableCount = plan.actions.filter(a => a.batchable !== false).length;
    // Estimate average batch size of 3
    const estimatedBatches = Math.ceil(batchableCount / 3);
    const actionsPerBatch = batchableCount / estimatedBatches;
    totalTokens = Math.max(totalTokens, baseTokens + (actionsPerBatch * 2000));
  }

  // Cap at reasonable maximum
  return Math.min(totalTokens, 32768);
}
