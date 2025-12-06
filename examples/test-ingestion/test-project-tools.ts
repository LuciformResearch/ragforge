/**
 * Test Project Tools - Agent with CLI capabilities
 *
 * Demonstrates:
 * - Using project tools (create, setup, ingest, embeddings)
 * - Callback pattern for CLI operations
 * - Agent that can manage RagForge projects
 *
 * This script tests the project tools WITHOUT a full agent setup.
 * For a full agent with RAG + File + Project tools, see test-ragforge-agent.ts
 *
 * @since 2025-12-06
 */

import { config } from 'dotenv';
import { resolve, join } from 'path';
import { promises as fs } from 'fs';
import {
  generateProjectTools,
  type ProjectToolsContext,
  type CreateProjectParams,
  type SetupProjectParams,
  type IngestCodeParams,
  type GenerateEmbeddingsParams,
  type ProjectToolResult,
} from '@luciformresearch/ragforge';

// Load environment from generated folder
config({ path: resolve(process.cwd(), 'generated', '.env') });

// ============================================
// Mock CLI Handlers (for testing without actual CLI)
// ============================================

/**
 * Mock handler for create_project
 * In real usage, this would call runCreate from CLI
 */
async function mockCreateProject(params: CreateProjectParams): Promise<ProjectToolResult> {
  console.log(`   [MOCK] Would create project: ${params.name}`);
  console.log(`   [MOCK] Path: ${params.path || 'current directory'}`);
  console.log(`   [MOCK] Language: ${params.language || 'typescript'}`);
  console.log(`   [MOCK] Template: ${params.template || 'minimal'}`);
  console.log(`   [MOCK] Include RAG: ${params.rag !== false}`);

  return {
    success: true,
    message: `Project ${params.name} would be created at ${params.path || '.'}/${params.name}`,
    projectPath: join(params.path || '.', params.name),
    stats: {
      filesProcessed: 5, // Mocked
    },
  };
}

/**
 * Mock handler for setup_project
 * In real usage, this would call runQuickstart from CLI
 */
async function mockSetupProject(params: SetupProjectParams): Promise<ProjectToolResult> {
  console.log(`   [MOCK] Would setup project with quickstart`);
  console.log(`   [MOCK] Root: ${params.root || 'current directory'}`);
  console.log(`   [MOCK] Language: ${params.language || 'auto-detect'}`);
  console.log(`   [MOCK] Ingest: ${params.ingest !== false}`);
  console.log(`   [MOCK] Embeddings: ${params.embeddings !== false}`);

  return {
    success: true,
    message: 'Project setup complete (mocked)',
    stats: {
      filesProcessed: 15,
      nodesCreated: 42,
      relationshipsCreated: 87,
    },
  };
}

/**
 * Mock handler for ingest_code
 * In real usage, this would run npm run ingest or call the ingestion API
 */
async function mockIngestCode(params: IngestCodeParams): Promise<ProjectToolResult> {
  console.log(`   [MOCK] Would ingest code`);
  console.log(`   [MOCK] Files: ${params.files?.join(', ') || 'all'}`);
  console.log(`   [MOCK] Incremental: ${params.incremental !== false}`);

  return {
    success: true,
    message: 'Code ingestion complete (mocked)',
    stats: {
      filesProcessed: params.files?.length || 20,
      nodesCreated: 150,
      relationshipsCreated: 300,
    },
  };
}

/**
 * Mock handler for generate_embeddings
 * In real usage, this would run npm run embeddings:generate
 */
async function mockGenerateEmbeddings(params: GenerateEmbeddingsParams): Promise<ProjectToolResult> {
  console.log(`   [MOCK] Would generate embeddings`);
  console.log(`   [MOCK] Entity: ${params.entity || 'Scope'}`);
  console.log(`   [MOCK] Force: ${params.force || false}`);
  console.log(`   [MOCK] Index only: ${params.indexOnly || false}`);

  return {
    success: true,
    message: 'Embeddings generated (mocked)',
    stats: {
      embeddingsGenerated: 42,
    },
  };
}

// ============================================
// Tests
// ============================================

async function testProjectToolsGeneration() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 1: Generate Project Tools');
  console.log('='.repeat(60));

  const ctx: ProjectToolsContext = {
    workingDirectory: process.cwd(),
    verbose: true,
    onCreate: mockCreateProject,
    onSetup: mockSetupProject,
    onIngest: mockIngestCode,
    onEmbeddings: mockGenerateEmbeddings,
  };

  const { tools, handlers } = generateProjectTools(ctx);

  console.log(`\n✅ Generated ${tools.length} project tools:`);
  for (const tool of tools) {
    console.log(`   - ${tool.name}: ${tool.description.split('\n')[0]}`);
  }

  console.log(`\n✅ Generated ${Object.keys(handlers).length} handlers:`);
  for (const name of Object.keys(handlers)) {
    console.log(`   - ${name}`);
  }
}

async function testCreateProjectTool() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 2: create_project Tool');
  console.log('='.repeat(60));

  const ctx: ProjectToolsContext = {
    workingDirectory: process.cwd(),
    verbose: true,
    onCreate: mockCreateProject,
  };

  const { handlers } = generateProjectTools(ctx);

  // Call the handler directly
  const result = await handlers['create_project']({
    name: 'my-test-api',
    language: 'typescript',
    template: 'express',
  });

  console.log('\n📤 Result:');
  console.log(`   Success: ${result.success}`);
  console.log(`   Message: ${result.message}`);
  console.log(`   Project path: ${result.projectPath}`);

  if (result.success) {
    console.log('\n✅ create_project test passed!');
  } else {
    console.log('\n❌ create_project test failed:', result.error);
  }
}

async function testSetupProjectTool() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 3: setup_project Tool');
  console.log('='.repeat(60));

  const ctx: ProjectToolsContext = {
    workingDirectory: process.cwd(),
    currentProject: '/path/to/project',
    verbose: true,
    onSetup: mockSetupProject,
  };

  const { handlers } = generateProjectTools(ctx);

  const result = await handlers['setup_project']({
    embeddings: true,
    ingest: true,
  });

  console.log('\n📤 Result:');
  console.log(`   Success: ${result.success}`);
  console.log(`   Message: ${result.message}`);
  console.log(`   Stats: ${JSON.stringify(result.stats)}`);

  if (result.success) {
    console.log('\n✅ setup_project test passed!');
  } else {
    console.log('\n❌ setup_project test failed:', result.error);
  }
}

async function testIngestCodeTool() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 4: ingest_code Tool');
  console.log('='.repeat(60));

  const ctx: ProjectToolsContext = {
    workingDirectory: process.cwd(),
    verbose: true,
    onIngest: mockIngestCode,
  };

  const { handlers } = generateProjectTools(ctx);

  // Test incremental ingestion
  const result = await handlers['ingest_code']({
    incremental: true,
  });

  console.log('\n📤 Result (incremental):');
  console.log(`   Success: ${result.success}`);
  console.log(`   Stats: ${JSON.stringify(result.stats)}`);

  // Test specific files
  const result2 = await handlers['ingest_code']({
    files: ['src/index.ts', 'src/utils.ts'],
    incremental: false,
  });

  console.log('\n📤 Result (specific files):');
  console.log(`   Success: ${result2.success}`);
  console.log(`   Stats: ${JSON.stringify(result2.stats)}`);

  if (result.success && result2.success) {
    console.log('\n✅ ingest_code test passed!');
  } else {
    console.log('\n❌ ingest_code test failed');
  }
}

async function testGenerateEmbeddingsTool() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 5: generate_embeddings Tool');
  console.log('='.repeat(60));

  const ctx: ProjectToolsContext = {
    workingDirectory: process.cwd(),
    verbose: true,
    onEmbeddings: mockGenerateEmbeddings,
  };

  const { handlers } = generateProjectTools(ctx);

  const result = await handlers['generate_embeddings']({
    entity: 'Scope',
    force: false,
  });

  console.log('\n📤 Result:');
  console.log(`   Success: ${result.success}`);
  console.log(`   Stats: ${JSON.stringify(result.stats)}`);

  if (result.success) {
    console.log('\n✅ generate_embeddings test passed!');
  } else {
    console.log('\n❌ generate_embeddings test failed:', result.error);
  }
}

async function testMissingHandler() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 6: Missing Handler Behavior');
  console.log('='.repeat(60));

  // Context without handlers - tools should not be generated
  const ctx: ProjectToolsContext = {
    workingDirectory: process.cwd(),
    verbose: true,
    // No handlers configured
  };

  const { tools, handlers } = generateProjectTools(ctx);

  console.log(`\n📋 Tools generated: ${tools.length}`);
  console.log(`📋 Handlers generated: ${Object.keys(handlers).length}`);

  if (tools.length === 0 && Object.keys(handlers).length === 0) {
    console.log('\n✅ Missing handler test passed! (no tools generated when no handlers)');
  } else {
    console.log('\n⚠️  Tools were generated without handlers');
  }
}

// ============================================
// Main
// ============================================

async function main() {
  console.log('🧪 Project Tools Tests\n');
  console.log('Testing project management tools for RagForge Agent');

  // Run all tests
  await testProjectToolsGeneration();
  await testCreateProjectTool();
  await testSetupProjectTool();
  await testIngestCodeTool();
  await testGenerateEmbeddingsTool();
  await testMissingHandler();

  console.log('\n' + '='.repeat(60));
  console.log('🎉 All project tools tests completed!');
  console.log('='.repeat(60));
  console.log('\nNext steps:');
  console.log('1. Create real CLI handlers that call runCreate, runQuickstart, etc.');
  console.log('2. Integrate with RagAgent using includeProjectTools option');
  console.log('3. Create a full test with RagAgent + FileTools + ProjectTools');
}

main().catch(console.error);
