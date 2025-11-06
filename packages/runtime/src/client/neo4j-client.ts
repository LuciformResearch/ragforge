/**
 * Neo4j Client
 *
 * Manages Neo4j connections, query execution, and transaction handling
 */

import neo4j, { Driver, Session, Result, QueryResult } from 'neo4j-driver';
import type { Neo4jConfig, CypherQuery, QueryPlan, VectorSearchResult } from '../types/index.js';

export class Neo4jClient {
  private driver: Driver;
  private database?: string;

  constructor(config: Neo4jConfig) {
    this.driver = neo4j.driver(
      config.uri,
      neo4j.auth.basic(config.username, config.password),
      {
        maxConnectionPoolSize: config.maxConnectionPoolSize || 50,
        connectionTimeout: config.connectionTimeout || 30000
      }
    );
    this.database = config.database;
  }

  /**
   * Execute a Cypher query
   */
  async run(
    cypher: string | CypherQuery,
    params?: Record<string, any>
  ): Promise<QueryResult> {
    const session = this.driver.session({ database: this.database });

    try {
      if (typeof cypher === 'string') {
        return await session.run(cypher, params || {});
      } else {
        return await session.run(cypher.query, cypher.params);
      }
    } finally {
      await session.close();
    }
  }

  /**
   * Execute multiple queries in a transaction
   */
  async transaction<T>(
    fn: (tx: any) => Promise<T>
  ): Promise<T> {
    const session = this.driver.session({ database: this.database });

    try {
      return await session.executeWrite(fn);
    } finally {
      await session.close();
    }
  }

  /**
   * Execute a read-only transaction
   */
  async readTransaction<T>(
    fn: (tx: any) => Promise<T>
  ): Promise<T> {
    const session = this.driver.session({ database: this.database });

    try {
      return await session.executeRead(fn);
    } finally {
      await session.close();
    }
  }

  /**
   * Explain query execution plan
   */
  async explain(cypher: string, params: Record<string, any> = {}): Promise<QueryPlan> {
    const explainQuery = `EXPLAIN ${cypher}`;
    const result = await this.run(explainQuery, params);

    const plan = result.summary.plan;

    return {
      cypher,
      params,
      estimatedRows: plan && 'arguments' in plan ? (plan as any).arguments?.EstimatedRows : undefined,
      indexesUsed: this.extractIndexes(plan),
      executionSteps: this.extractSteps(plan)
    };
  }

  /**
   * Vector similarity search
   */
  async vectorSearch(
    indexName: string,
    embedding: number[],
    topK: number = 10
  ): Promise<VectorSearchResult[]> {
    const cypher = `
      CALL db.index.vector.queryNodes($indexName, $topK, $embedding)
      YIELD node, score
      RETURN node, score
      ORDER BY score DESC
    `;

    const result = await this.run(cypher, {
      indexName,
      topK,
      embedding
    });

    return result.records.map(record => ({
      node: record.get('node').properties,
      score: record.get('score')
    }));
  }

  /**
   * Full-text search
   */
  async fullTextSearch(
    indexName: string,
    query: string,
    options: { limit?: number } = {}
  ): Promise<any[]> {
    const cypher = `
      CALL db.index.fulltext.queryNodes($indexName, $query)
      YIELD node, score
      RETURN node, score
      ORDER BY score DESC
      LIMIT $limit
    `;

    const result = await this.run(cypher, {
      indexName,
      query,
      limit: options.limit || 10
    });

    return result.records.map(record => ({
      node: record.get('node').properties,
      score: record.get('score')
    }));
  }

  /**
   * Check if connection is healthy
   */
  async verifyConnectivity(): Promise<boolean> {
    try {
      await this.driver.verifyConnectivity();
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Close the driver connection
   */
  async close(): Promise<void> {
    await this.driver.close();
  }

  /**
   * Extract indexes used from query plan
   */
  private extractIndexes(plan: any): string[] {
    if (!plan) return [];

    const indexes: string[] = [];

    if (plan.arguments?.Index) {
      indexes.push(plan.arguments.Index);
    }

    if (plan.children) {
      for (const child of plan.children) {
        indexes.push(...this.extractIndexes(child));
      }
    }

    return indexes;
  }

  /**
   * Extract execution steps from query plan
   */
  private extractSteps(plan: any): string[] {
    if (!plan) return [];

    const steps: string[] = [];

    if (plan.operatorType) {
      steps.push(plan.operatorType);
    }

    if (plan.children) {
      for (const child of plan.children) {
        steps.push(...this.extractSteps(child));
      }
    }

    return steps;
  }
}
