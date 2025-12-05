import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { Neo4jClient, ChangeTracker } from '@luciformresearch/ragforge';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

/**
 * Change Statistics Script
 *
 * Analyzes change history stored in Neo4j and displays useful statistics.
 * Run this script to understand how your codebase/data has evolved over time.
 *
 * Usage:
 *   npm run stats:changes
 */
async function main(): Promise<void> {
  const client = new Neo4jClient({
    uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
    username: process.env.NEO4J_USERNAME || 'neo4j',
    password: process.env.NEO4J_PASSWORD || '',
    database: process.env.NEO4J_DATABASE
  });

  const changeTracker = new ChangeTracker(client);

  try {
    console.log('📊 Change History Statistics\n');
    console.log('═'.repeat(60));
    console.log('');

    // Overall statistics
    console.log('📈 Overall Statistics\n');
    const stats = await changeTracker.getChangeStats();
    console.log(`  Total Changes: ${stats.totalChanges}`);
    console.log(`  Lines Added:   ${stats.totalLinesAdded.toLocaleString()}`);
    console.log(`  Lines Removed: ${stats.totalLinesRemoved.toLocaleString()}`);
    console.log('');

    // Changes by type
    console.log('📝 Changes by Type\n');
    for (const [type, count] of Object.entries(stats.byType)) {
      const percentage = ((count / stats.totalChanges) * 100).toFixed(1);
      console.log(`  ${type.padEnd(10)} ${count.toString().padStart(5)} (${percentage}%)`);
    }
    console.log('');

    // Changes by entity type
    console.log('🏷️  Changes by Entity Type\n');
    for (const [entityType, count] of Object.entries(stats.byEntityType)) {
      const percentage = ((count / stats.totalChanges) * 100).toFixed(1);
      console.log(`  ${entityType.padEnd(15)} ${count.toString().padStart(5)} (${percentage}%)`);
    }
    console.log('');

    // Recent changes
    console.log('🕐 Recent Changes (Last 10)\n');
    const recentChanges = await changeTracker.getRecentChanges(10);
    for (const change of recentChanges) {
      const timestamp = change.timestamp.toLocaleString();
      const metadata = JSON.stringify(change.metadata);
      console.log(`  ${timestamp} | ${change.entityType} | ${change.changeType} | ${metadata}`);
    }
    console.log('');

    // Most modified entities (top 10 for each entity type)
    const entityTypes = Object.keys(stats.byEntityType);
    for (const entityType of entityTypes) {
      console.log(`🔥 Most Modified ${entityType} Entities (Top 10)\n`);
      const mostModified = await changeTracker.getMostModifiedEntities(entityType, 10);

      if (mostModified.length === 0) {
        console.log(`  No changes tracked for ${entityType}\n`);
        continue;
      }

      for (const entity of mostModified) {
        const displayName = entity.metadata.name || entity.metadata.title || entity.entityUuid.substring(0, 8);
        console.log(`  ${displayName.padEnd(30)} ${entity.changeCount.toString().padStart(3)} changes`);
      }
      console.log('');
    }

    // Date range analysis (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const now = new Date();

    console.log('📅 Changes in Last 30 Days\n');
    const recentChangesByDate = await changeTracker.getChangesByDateRange(thirtyDaysAgo, now);
    console.log(`  Total: ${recentChangesByDate.length} changes`);

    if (recentChangesByDate.length > 0) {
      const linesAdded = recentChangesByDate.reduce((sum, c) => sum + c.linesAdded, 0);
      const linesRemoved = recentChangesByDate.reduce((sum, c) => sum + c.linesRemoved, 0);
      console.log(`  Lines Added:   ${linesAdded.toLocaleString()}`);
      console.log(`  Lines Removed: ${linesRemoved.toLocaleString()}`);
      console.log(`  Net Change:    ${(linesAdded - linesRemoved).toLocaleString()}`);
    }
    console.log('');

    console.log('═'.repeat(60));
    console.log('✅ Statistics generation complete');
  } catch (error) {
    console.error('❌ Failed to generate statistics:', error);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

void main();
