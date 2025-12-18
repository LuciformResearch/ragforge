/**
 * Neo4j Manager - Database queries and graph data
 */

import neo4j, { Driver, Session } from 'neo4j-driver';
import { homedir } from 'os';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// ============ DEBUG MODE ============
// Must match docker.ts DEBUG_MODE
const DEBUG_MODE = false;
// ====================================

const RAGFORGE_ENV_FILE = join(homedir(), '.ragforge', '.env');

/**
 * Read Neo4j password from ~/.ragforge/.env
 */
function getPasswordFromEnv(): string {
  if (existsSync(RAGFORGE_ENV_FILE)) {
    try {
      const envContent = readFileSync(RAGFORGE_ENV_FILE, 'utf-8');
      const match = envContent.match(/NEO4J_PASSWORD=(.+)/);
      if (match && match[1]) {
        return match[1].trim();
      }
    } catch {
      // Fall through to default
    }
  }
  return 'ragforge'; // Fallback for legacy setups
}

export interface ProjectInfo {
  id: string;
  name: string;
  path: string;
  nodeCount: number;
  lastAccessed: string;
  type: string;
}

export interface GraphStats {
  totalNodes: number;
  totalRelationships: number;
  nodesByLabel: Record<string, number>;
  relationshipsByType: Record<string, number>;
}

export interface GraphNode {
  id: string;
  labels: string[];
  properties: Record<string, any>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  properties: Record<string, any>;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export class Neo4jManager {
  private driver: Driver | null = null;
  private uri = 'bolt://localhost:7687';
  private user = 'neo4j';
  private password = getPasswordFromEnv();

  /**
   * Connect to Neo4j
   */
  async connect(): Promise<boolean> {
    // DEBUG MODE - simulate successful connection
    if (DEBUG_MODE) {
      console.log('[DEBUG] connect - simulating Neo4j connection');
      await new Promise(r => setTimeout(r, 500));
      return true;
    }

    try {
      this.driver = neo4j.driver(
        this.uri,
        neo4j.auth.basic(this.user, this.password)
      );

      // Verify connection
      await this.driver.verifyConnectivity();
      return true;
    } catch (err) {
      console.error('Failed to connect to Neo4j:', err);
      this.driver = null;
      return false;
    }
  }

  /**
   * Run a Cypher query
   */
  async query(cypher: string, params?: Record<string, unknown>): Promise<any[]> {
    if (!this.driver) {
      throw new Error('Not connected to Neo4j');
    }

    const session = this.driver.session();
    try {
      const result = await session.run(cypher, params);
      return result.records.map(record => record.toObject());
    } finally {
      await session.close();
    }
  }

  /**
   * Get all projects
   */
  async getProjects(): Promise<ProjectInfo[]> {
    if (!this.driver) return [];

    try {
      // Projects are linked to nodes via projectId property, not CONTAINS relationship
      const result = await this.query(`
        MATCH (p:Project)
        OPTIONAL MATCH (n) WHERE n.projectId STARTS WITH p.name
        WITH p, count(n) as nodeCount
        RETURN
          p.id as id,
          p.name as name,
          p.rootPath as path,
          nodeCount,
          p.lastAccessed as lastAccessed,
          p.type as type
        ORDER BY p.lastAccessed DESC
      `);

      return result.map(r => ({
        id: r.id || '',
        name: r.name || 'Unknown',
        path: r.path || '',
        nodeCount: typeof r.nodeCount === 'object' ? r.nodeCount.toNumber() : r.nodeCount || 0,
        lastAccessed: r.lastAccessed || '',
        type: r.type || 'project',
      }));
    } catch (err) {
      console.error('Failed to get projects:', err);
      return [];
    }
  }

  /**
   * Get global stats
   */
  async getStats(): Promise<GraphStats> {
    if (!this.driver) {
      return {
        totalNodes: 0,
        totalRelationships: 0,
        nodesByLabel: {},
        relationshipsByType: {},
      };
    }

    try {
      // Get node counts by label
      const nodeResult = await this.query(`
        CALL db.labels() YIELD label
        CALL apoc.cypher.run('MATCH (n:' + label + ') RETURN count(n) as count', {}) YIELD value
        RETURN label, value.count as count
      `);

      const nodesByLabel: Record<string, number> = {};
      let totalNodes = 0;
      for (const r of nodeResult) {
        const count = typeof r.count === 'object' ? r.count.toNumber() : r.count;
        nodesByLabel[r.label] = count;
        totalNodes += count;
      }

      // Get relationship counts by type
      const relResult = await this.query(`
        CALL db.relationshipTypes() YIELD relationshipType
        CALL apoc.cypher.run('MATCH ()-[r:' + relationshipType + ']->() RETURN count(r) as count', {}) YIELD value
        RETURN relationshipType, value.count as count
      `);

      const relationshipsByType: Record<string, number> = {};
      let totalRelationships = 0;
      for (const r of relResult) {
        const count = typeof r.count === 'object' ? r.count.toNumber() : r.count;
        relationshipsByType[r.relationshipType] = count;
        totalRelationships += count;
      }

      return {
        totalNodes,
        totalRelationships,
        nodesByLabel,
        relationshipsByType,
      };
    } catch (err) {
      console.error('Failed to get stats:', err);
      // Fallback without APOC
      try {
        const simpleResult = await this.query(`
          MATCH (n) WITH count(n) as nodes
          MATCH ()-[r]->() WITH nodes, count(r) as rels
          RETURN nodes, rels
        `);
        return {
          totalNodes: simpleResult[0]?.nodes?.toNumber?.() || simpleResult[0]?.nodes || 0,
          totalRelationships: simpleResult[0]?.rels?.toNumber?.() || simpleResult[0]?.rels || 0,
          nodesByLabel: {},
          relationshipsByType: {},
        };
      } catch {
        return {
          totalNodes: 0,
          totalRelationships: 0,
          nodesByLabel: {},
          relationshipsByType: {},
        };
      }
    }
  }

  /**
   * Get graph data for visualization
   */
  async getGraphData(cypher: string, limit: number = 100): Promise<GraphData> {
    if (!this.driver) {
      return { nodes: [], edges: [] };
    }

    try {
      const session = this.driver.session();
      try {
        const result = await session.run(cypher + ` LIMIT ${limit}`);

        const nodesMap = new Map<string, GraphNode>();
        const edgesMap = new Map<string, GraphEdge>();

        for (const record of result.records) {
          for (const value of record.values()) {
            this.extractGraphElements(value, nodesMap, edgesMap);
          }
        }

        return {
          nodes: Array.from(nodesMap.values()),
          edges: Array.from(edgesMap.values()),
        };
      } finally {
        await session.close();
      }
    } catch (err) {
      console.error('Failed to get graph data:', err);
      return { nodes: [], edges: [] };
    }
  }

  private extractGraphElements(
    value: any,
    nodes: Map<string, GraphNode>,
    edges: Map<string, GraphEdge>
  ): void {
    if (!value) return;

    // Node
    if (value.labels && value.properties) {
      const id = value.elementId || value.identity?.toString();
      if (id && !nodes.has(id)) {
        nodes.set(id, {
          id,
          labels: value.labels,
          properties: this.convertProperties(value.properties),
        });
      }
    }

    // Relationship
    if (value.type && value.start && value.end) {
      const id = value.elementId || value.identity?.toString();
      if (id && !edges.has(id)) {
        edges.set(id, {
          id,
          source: value.startNodeElementId || value.start?.toString(),
          target: value.endNodeElementId || value.end?.toString(),
          type: value.type,
          properties: this.convertProperties(value.properties || {}),
        });
      }
    }

    // Path
    if (value.segments) {
      for (const segment of value.segments) {
        this.extractGraphElements(segment.start, nodes, edges);
        this.extractGraphElements(segment.end, nodes, edges);
        this.extractGraphElements(segment.relationship, nodes, edges);
      }
    }

    // Array
    if (Array.isArray(value)) {
      for (const item of value) {
        this.extractGraphElements(item, nodes, edges);
      }
    }
  }

  private convertProperties(props: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(props)) {
      if (value && typeof value === 'object' && 'toNumber' in value) {
        result[key] = value.toNumber();
      } else if (value && typeof value === 'object' && 'toString' in value && value.constructor.name === 'Integer') {
        result[key] = value.toNumber();
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  /**
   * Close connection
   */
  async close(): Promise<void> {
    if (this.driver) {
      await this.driver.close();
      this.driver = null;
    }
  }
}
