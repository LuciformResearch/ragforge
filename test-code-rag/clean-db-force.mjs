import { createRagClient } from './client.js';

const client = createRagClient();

try {
  console.log('🗑️  Cleaning database...');
  await client.client.run('MATCH (n) DETACH DELETE n');
  console.log('✅ Database cleaned');
} catch (error) {
  console.error('Error:', error);
} finally {
  await client.close();
}
