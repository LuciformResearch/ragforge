/**
 * Example Usage: Field-Level Summarization
 *
 * This file demonstrates how to use the generic summarization system.
 * It shows the complete workflow from configuration to summary generation.
 */

import { GenericSummarizer } from './generic-summarizer.js';
import { getDefaultStrategies, CODE_ANALYSIS_STRATEGY } from './default-strategies.js';
import type { LLMProvider } from '../reranking/llm-provider.js';

/**
 * Example: Summarize code source fields
 */
export async function exampleCodeSummarization(llmProvider: LLMProvider) {
  console.log('🔍 Example: Code Summarization with Improvement Suggestions\n');

  // 1. Create summarizer with default strategies
  const strategies = getDefaultStrategies();
  const summarizer = new GenericSummarizer(llmProvider, strategies);

  // 2. Sample code entity
  const codeEntity = {
    uuid: 'abc-123',
    name: 'authenticateUser',
    type: 'function',
    file: 'src/auth/authenticate.ts',
    source: `
async function authenticateUser(username, password) {
  const user = await db.query('SELECT * FROM users WHERE username = ' + username);

  if (!user) {
    return null;
  }

  if (user.password === password) {
    const token = Math.random().toString(36);
    global.tokens[token] = user.id;
    return { success: true, token: token };
  }

  return { success: false };
}
    `.trim()
  };

  // 3. Config for source field summarization
  const config = {
    enabled: true,
    strategy: 'code_analysis',
    threshold: 100, // Low threshold for demo
    cache: true,
    output_fields: [
      'purpose',
      'operation',
      'concept',
      'complexity',
      'suggestion'  // ← The improvement suggestions!
    ],
    rerank_use: 'prefer_summary' as const
  };

  // 4. Check if needs summary
  if (summarizer.needsSummary(codeEntity.source, config)) {
    console.log('✅ Field needs summarization (length:', codeEntity.source.length, 'chars)\n');

    // 5. Generate summary
    console.log('🤖 Generating code summary with LLM...\n');
    const summary = await summarizer.summarizeField(
      'Scope',
      'source',
      codeEntity.source,
      codeEntity,
      config
    );

    // 6. Display results
    console.log('📊 Summary Results:\n');
    console.log('Purpose:', summary.purpose);
    console.log('\nOperations:', (summary.operation as string[])?.join(', '));
    console.log('Concepts:', (summary.concept as string[])?.join(', '));
    console.log('Complexity:', summary.complexity);

    console.log('\n🔧 Improvement Suggestions:');
    if (Array.isArray(summary.suggestion) && summary.suggestion.length > 0) {
      summary.suggestion.forEach((s: string, i: number) => {
        console.log(`  ${i + 1}. ${s}`);
      });
    } else {
      console.log('  (No suggestions)');
    }

    // Expected output might be:
    // Purpose: Authenticates a user by checking username and password against database
    // Operations: database query, password validation, token generation
    // Concepts: authentication, database, session management
    // Complexity: moderate
    //
    // Improvement Suggestions:
    //   1. SQL injection vulnerability: Use parameterized queries instead of string concatenation
    //   2. Security risk: Passwords should be hashed, not stored in plain text
    //   3. Weak token generation: Use cryptographically secure random tokens (crypto.randomBytes)
    //   4. Memory leak: global.tokens grows indefinitely, implement token expiration
    //   5. Missing error handling: Database errors are not caught or logged

    return summary;
  } else {
    console.log('Field is too short, no summarization needed');
    return null;
  }
}

/**
 * Example: Batch summarization for efficiency
 */
export async function exampleBatchSummarization(llmProvider: LLMProvider) {
  console.log('⚡ Example: Batch Summarization\n');

  const strategies = getDefaultStrategies();
  const summarizer = new GenericSummarizer(llmProvider, strategies);

  // Multiple code entities
  const entities = [
    {
      uuid: '1',
      name: 'validateEmail',
      type: 'function',
      file: 'src/utils/validation.ts',
      source: 'function validateEmail(email) { return email.includes("@"); }'
    },
    {
      uuid: '2',
      name: 'hashPassword',
      type: 'function',
      file: 'src/auth/crypto.ts',
      source: 'function hashPassword(pwd) { return md5(pwd); }'
    },
    {
      uuid: '3',
      name: 'sendEmail',
      type: 'function',
      file: 'src/email/sender.ts',
      source: 'async function sendEmail(to, subject, body) { await smtp.send({to, subject, html: body}); }'
    }
  ];

  const config = {
    enabled: true,
    strategy: 'code_analysis',
    threshold: 10,
    output_fields: ['purpose', 'suggestion']
  };

  // Prepare batch input
  const batchInput = entities.map(entity => ({
    entityType: 'Scope',
    fieldName: 'source',
    fieldValue: entity.source,
    entity: entity,
    config: config
  }));

  // Estimate cost before running
  const estimate = summarizer.estimateTokens(batchInput);
  console.log('📊 Cost Estimate:');
  console.log(`  Prompt tokens: ~${estimate.totalPromptTokens}`);
  console.log(`  Response tokens: ~${estimate.totalResponseTokens}`);
  console.log(`  Estimated cost: $${estimate.estimatedCost.toFixed(4)}\n`);

  // Generate summaries in batch (much faster than sequential)
  console.log('🤖 Generating summaries in batch...\n');
  const summaries = await summarizer.summarizeBatch(batchInput);

  // Display results
  summaries.forEach((summary, i) => {
    console.log(`[${i + 1}] ${entities[i].name}`);
    console.log(`    Purpose: ${summary.purpose}`);
    if (Array.isArray(summary.suggestion) && summary.suggestion.length > 0) {
      console.log(`    Suggestions: ${summary.suggestion.length}`);
      summary.suggestion.forEach((s: string) => {
        console.log(`      - ${s}`);
      });
    }
    console.log('');
  });

  return summaries;
}

/**
 * Example: Different strategies for different fields
 */
export async function exampleMultiStrategy(llmProvider: LLMProvider) {
  console.log('🎯 Example: Multiple Strategies\n');

  const strategies = getDefaultStrategies();
  const summarizer = new GenericSummarizer(llmProvider, strategies);

  // Entity with multiple fields to summarize
  const entity = {
    id: 'product-123',
    name: 'UltraWidget Pro',
    category: 'Electronics',

    // Technical description (use code_analysis-like strategy)
    technical_specs: `
      Processor: Quad-core ARM Cortex-A72 @ 2.4GHz
      Memory: 8GB LPDDR4
      Storage: 256GB NVMe SSD
      Connectivity: WiFi 6, Bluetooth 5.2, Gigabit Ethernet
      Power: USB-C PD 3.0, 65W
    `,

    // Marketing description (use product_features strategy)
    description: `
      The UltraWidget Pro is the ultimate productivity device for professionals.
      With its powerful quad-core processor and 8GB of memory, you can run
      multiple applications smoothly. The 256GB storage provides ample space
      for all your files. Stay connected with the latest WiFi 6 and Bluetooth 5.2
      technology. Perfect for remote workers, content creators, and tech enthusiasts.
    `
  };

  // Different configs for different fields
  const techConfig = {
    enabled: true,
    strategy: 'text_extraction',
    threshold: 50,
    output_fields: ['main_topic', 'keyword']
  };

  const descConfig = {
    enabled: true,
    strategy: 'product_features',
    threshold: 50,
    output_fields: ['summary', 'feature', 'target_audience']
  };

  // Summarize tech specs
  console.log('📝 Summarizing technical specifications...');
  const techSummary = await summarizer.summarizeField(
    'Product',
    'technical_specs',
    entity.technical_specs,
    entity,
    techConfig
  );

  console.log('  Topic:', techSummary.main_topic);
  console.log('  Keywords:', (techSummary.keyword as string[])?.join(', '));
  console.log('');

  // Summarize description
  console.log('📝 Summarizing product description...');
  const descSummary = await summarizer.summarizeField(
    'Product',
    'description',
    entity.description,
    entity,
    descConfig
  );

  console.log('  Summary:', descSummary.summary);
  console.log('  Features:', (descSummary.feature as string[])?.join(', '));
  console.log('  Target:', descSummary.target_audience);
  console.log('');

  return { techSummary, descSummary };
}

/**
 * Run all examples
 */
export async function runAllExamples(llmProvider: LLMProvider) {
  console.log('═══════════════════════════════════════════════════');
  console.log('  Field-Level Summarization Examples');
  console.log('═══════════════════════════════════════════════════\n');

  try {
    await exampleCodeSummarization(llmProvider);
    console.log('\n' + '─'.repeat(50) + '\n');

    await exampleBatchSummarization(llmProvider);
    console.log('\n' + '─'.repeat(50) + '\n');

    await exampleMultiStrategy(llmProvider);
    console.log('\n═══════════════════════════════════════════════════');
    console.log('✅ All examples completed successfully!');
  } catch (error) {
    console.error('❌ Example failed:', error);
    throw error;
  }
}
