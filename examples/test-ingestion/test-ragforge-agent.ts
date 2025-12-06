/**
 * Test RagForge Agent - Full Agent with RAG + File + Project Tools
 *
 * Demonstrates:
 * - Creating a RagAgent with all tool categories
 * - RAG tools for querying the knowledge graph
 * - File tools for reading/writing code
 * - Project tools for project management (create, setup, ingest, embeddings)
 *
 * This is the "meta-agent" that can do everything RagForge CLI can do,
 * plus interact with the knowledge graph.
 *
 * @since 2025-12-06
 */

import { config } from 'dotenv';
import { resolve, join } from 'path';
import { promises as fs } from 'fs';
import {
  createRagAgent,
  type ProjectToolResult,
} from '@luciformresearch/ragforge';
import { createRagClient } from './generated/client.js';

// Load environment from generated folder
config({ path: resolve(process.cwd(), 'generated', '.env') });

// ============================================
// CLI Handlers (connect to actual CLI commands)
// ============================================

/**
 * Create project handler
 * In production, this would call runCreate from CLI
 */
async function handleCreateProject(params: any): Promise<ProjectToolResult> {
  // For now, just log what would happen
  console.log(`\n🚀 [PROJECT] Creating project: ${params.name}`);
  console.log(`   Path: ${params.path || 'current directory'}`);
  console.log(`   Language: ${params.language || 'typescript'}`);

  // In production:
  // const { runCreate } = await import('@luciformresearch/ragforge-cli/commands/create');
  // await runCreate({ name: params.name, path: params.path, dev: true, rag: true });

  return {
    success: true,
    message: `Project ${params.name} created successfully`,
    projectPath: join(params.path || '.', params.name),
  };
}

/**
 * Setup project handler
 * In production, this would call runQuickstart from CLI
 */
async function handleSetupProject(params: any): Promise<ProjectToolResult> {
  console.log(`\n🔧 [PROJECT] Setting up project`);
  console.log(`   Root: ${params.root || 'current directory'}`);
  console.log(`   Embeddings: ${params.embeddings !== false}`);

  // In production:
  // const { runQuickstart } = await import('@luciformresearch/ragforge-cli/commands/quickstart');
  // await runQuickstart({ ...params, rootDir: process.cwd() });

  return {
    success: true,
    message: 'Project setup complete',
    stats: {
      filesProcessed: 15,
      nodesCreated: 42,
      relationshipsCreated: 87,
    },
  };
}

/**
 * Ingest code handler
 * In production, this would run the ingestion script
 */
async function handleIngestCode(params: any): Promise<ProjectToolResult> {
  console.log(`\n📦 [PROJECT] Ingesting code`);
  console.log(`   Files: ${params.files?.join(', ') || 'all'}`);
  console.log(`   Incremental: ${params.incremental !== false}`);

  // In production:
  // const { execSync } = await import('child_process');
  // execSync('npm run ingest', { cwd: projectPath, stdio: 'inherit' });

  return {
    success: true,
    message: 'Code ingestion complete',
    stats: {
      filesProcessed: params.files?.length || 20,
      nodesCreated: 150,
      relationshipsCreated: 300,
    },
  };
}

/**
 * Generate embeddings handler
 * In production, this would run the embeddings script
 */
async function handleGenerateEmbeddings(params: any): Promise<ProjectToolResult> {
  console.log(`\n🔢 [PROJECT] Generating embeddings`);
  console.log(`   Entity: ${params.entity || 'Scope'}`);
  console.log(`   Force: ${params.force || false}`);

  // In production:
  // const { execSync } = await import('child_process');
  // execSync('npm run embeddings:generate', { cwd: projectPath, stdio: 'inherit' });

  return {
    success: true,
    message: 'Embeddings generated',
    stats: {
      embeddingsGenerated: 42,
    },
  };
}

// ============================================
// Tests
// ============================================

async function testFullAgent() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST: Full RagForge Agent (RAG + File + Project Tools)');
  console.log('='.repeat(60));

  // Create RAG client
  const rag = createRagClient();

  // Create agent with all tools
  const agent = await createRagAgent({
    configPath: './generated/ragforge.config.yaml',
    ragClient: rag,
    apiKey: process.env.GEMINI_API_KEY,
    model: 'gemini-2.0-flash',
    toolCallMode: 'structured',
    verbose: true,

    // Enable file tools
    includeFileTools: true,
    projectRoot: process.cwd(),

    // Enable project tools
    includeProjectTools: true,
    projectToolsContext: {
      currentProject: process.cwd(),
      onCreate: handleCreateProject,
      onSetup: handleSetupProject,
      onIngest: handleIngestCode,
      onEmbeddings: handleGenerateEmbeddings,
    },
  });

  // List all available tools
  const tools = agent.getTools();
  console.log(`\n✅ Agent created with ${tools.length} tools:`);

  const toolsByCategory: Record<string, string[]> = {
    'RAG': [],
    'File': [],
    'Project': [],
    'Other': [],
  };

  for (const tool of tools) {
    if (['query_entities', 'semantic_search', 'explore_relationships', 'get_schema', 'describe_entity'].includes(tool.name)) {
      toolsByCategory['RAG'].push(tool.name);
    } else if (['read_file', 'write_file', 'edit_file', 'install_package'].includes(tool.name)) {
      toolsByCategory['File'].push(tool.name);
    } else if (['create_project', 'setup_project', 'ingest_code', 'generate_embeddings'].includes(tool.name)) {
      toolsByCategory['Project'].push(tool.name);
    } else {
      toolsByCategory['Other'].push(tool.name);
    }
  }

  for (const [category, names] of Object.entries(toolsByCategory)) {
    if (names.length > 0) {
      console.log(`   ${category}: ${names.join(', ')}`);
    }
  }

  await rag.close();
  return agent;
}

async function testRagQuery() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST: RAG Query with Full Agent');
  console.log('='.repeat(60));

  const rag = createRagClient();

  const agent = await createRagAgent({
    configPath: './generated/ragforge.config.yaml',
    ragClient: rag,
    apiKey: process.env.GEMINI_API_KEY,
    model: 'gemini-2.0-flash',
    toolCallMode: 'structured',
    verbose: true,
    includeFileTools: true,
    projectRoot: process.cwd(),
    includeProjectTools: true,
    projectToolsContext: {
      currentProject: process.cwd(),
      onCreate: handleCreateProject,
      onSetup: handleSetupProject,
      onIngest: handleIngestCode,
      onEmbeddings: handleGenerateEmbeddings,
    },
  });

  try {
    // Ask a question that uses RAG tools
    const result = await agent.ask('What are the main functions in this codebase?');

    console.log('\n📤 Result:');
    console.log(`   Answer: ${result.answer?.substring(0, 300)}...`);
    console.log(`   Tools used: ${result.toolsUsed?.join(', ') || 'none'}`);
    console.log('\n✅ RAG query test passed!');
  } catch (error) {
    console.error('❌ Error:', error);
  }

  await rag.close();
}

async function testFileOperation() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST: File Operation with Full Agent');
  console.log('='.repeat(60));

  const rag = createRagClient();

  const agent = await createRagAgent({
    configPath: './generated/ragforge.config.yaml',
    ragClient: rag,
    apiKey: process.env.GEMINI_API_KEY,
    model: 'gemini-2.0-flash',
    toolCallMode: 'structured',
    verbose: true,
    includeFileTools: true,
    projectRoot: process.cwd(),
    includeProjectTools: true,
    projectToolsContext: {
      currentProject: process.cwd(),
      onCreate: handleCreateProject,
    },
  });

  try {
    // Ask to read a file
    const result = await agent.ask('Read the package.json file and tell me the project name');

    console.log('\n📤 Result:');
    console.log(`   Answer: ${result.answer?.substring(0, 200)}...`);
    console.log(`   Tools used: ${result.toolsUsed?.join(', ') || 'none'}`);
    console.log('\n✅ File operation test passed!');
  } catch (error) {
    console.error('❌ Error:', error);
  }

  await rag.close();
}

// ============================================
// Main
// ============================================

async function main() {
  console.log('🧪 RagForge Full Agent Tests\n');
  console.log('Testing the unified agent with RAG + File + Project capabilities');

  // Check if generated folder exists
  try {
    await fs.access('./generated/ragforge.config.yaml');
  } catch {
    console.error('❌ Generated folder not found. Run from test-ingestion directory after quickstart.');
    console.error('   cd examples/test-ingestion');
    console.error('   npm run quickstart (in .ragforge/generated)');
    process.exit(1);
  }

  // Run tests
  await testFullAgent();

  // Only run these if GEMINI_API_KEY is set
  if (process.env.GEMINI_API_KEY) {
    await testRagQuery();
    await testFileOperation();
  } else {
    console.log('\n⚠️  Skipping LLM tests (no GEMINI_API_KEY)');
  }

  console.log('\n' + '='.repeat(60));
  console.log('🎉 All RagForge agent tests completed!');
  console.log('='.repeat(60));
}

main().catch(console.error);
