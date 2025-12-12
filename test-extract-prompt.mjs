import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

// Utiliser le package compilé ou tsx
import { callToolViaDaemon } from './packages/cli/dist/esm/commands/daemon-client.js';

async function testExtractPrompt() {
  console.log('🧪 Testing extract_agent_prompt via daemon...\n');
  
  // 1. Créer une conversation pour activer le fuzzy search
  console.log('📝 Creating conversation...');
  const convResult = await callToolViaDaemon('create_conversation', {
    title: 'Test fuzzy search debug',
    tags: ['test', 'fuzzy-search']
  }, { verbose: true });
  
  if (!convResult.success) {
    console.error('❌ Failed to create conversation:', convResult.error);
    process.exit(1);
  }
  
  const conversationId = convResult.result.conversationId;
  console.log(`✅ Conversation created: ${conversationId}\n`);
  
  // 2. Activer la conversation
  console.log('🔄 Switching to conversation...');
  const switchResult = await callToolViaDaemon('switch_conversation', {
    conversation_id: conversationId
  }, { verbose: true });
  
  if (!switchResult.success) {
    console.error('❌ Failed to switch conversation:', switchResult.error);
    process.exit(1);
  }
  console.log('✅ Conversation activated\n');
  
  // 3. Maintenant extraire le prompt avec le fuzzy search activé
  console.log('📋 Extracting prompt with fuzzy search...');
  const result = await callToolViaDaemon('extract_agent_prompt', {
    question: "Comment fonctionne searchCodeFuzzyWithLLM? Comment le fuzzy search utilise-t-il les outils grep_files et search_files pour rechercher du code?",
    iteration: 0,
    return_prompt: true,
    return_response: false,
  }, { verbose: true });

  if (!result.success) {
    console.error('❌ Error:', result.error);
    process.exit(1);
  }

  const prompt = result.result.prompt || result.result;
  
  // Vérifier si le fuzzy search est présent dans le prompt
  console.log('📋 Prompt extracted (first 2000 chars):\n');
  console.log(prompt.substring(0, 2000));
  console.log('\n...\n');
  
  // Chercher des indices de fuzzy search
  const hasFuzzySearch = prompt.includes('fuzzy') || 
                         prompt.includes('Fuzzy') || 
                         prompt.includes('code semantic') ||
                         prompt.includes('semantic search') ||
                         prompt.includes('Enriched Context') ||
                         prompt.includes('## Context');
  
  if (hasFuzzySearch) {
    console.log('✅ Fuzzy search / enriched context détecté dans le prompt!');
  } else {
    console.log('⚠️  Aucun indice de fuzzy search / enriched context trouvé dans le prompt');
  }
  
  // Afficher les sections du prompt pour vérifier
  const sections = prompt.split('\n## ');
  console.log('\n📑 Sections du prompt:');
  sections.forEach((section, i) => {
    const title = i === 0 ? section.split('\n')[0] : `## ${section.split('\n')[0]}`;
    console.log(`  ${i + 1}. ${title.substring(0, 80)}...`);
  });
}

testExtractPrompt().catch(console.error);
