import { IterativeCodeAgent, type AgentConfig } from '@luciformresearch/ragforge-runtime';
import { CLIENT_DOCUMENTATION } from './documentation.js';

/**
 * Configuration for the generated iterative agent.
 * Accepts the same parameters as AgentConfig, but wraps ragClientPath and documentation.
 */
export interface GeneratedAgentConfig extends Omit<AgentConfig, 'ragClientPath' | 'frameworkDocs'> {
  /** Optional override for the path to the generated client (default: './client.js') */
  ragClientPath?: string;
}

/**
 * Create an IterativeCodeAgent pre-configured with generated documentation.
 */
export function createIterativeAgent(config: GeneratedAgentConfig): IterativeCodeAgent {
  const agentConfig: AgentConfig = {
    ...config,
    ragClientPath: config.ragClientPath || './client.js',
    frameworkDocs: CLIENT_DOCUMENTATION
  };

  return new IterativeCodeAgent(agentConfig);
}