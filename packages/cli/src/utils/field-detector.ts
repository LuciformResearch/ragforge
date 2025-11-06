/**
 * Field Detector - Auto-detect optimal field mappings using LLM
 */

import neo4j, { Driver, Session } from 'neo4j-driver';
import { GoogleGenAI } from '@google/genai';
import { LuciformXMLParser } from '@luciformresearch/xmlparser';
import type { EntityConfig } from '@luciformresearch/ragforge-core';

interface FieldMappings {
  display_name_field: string;
  unique_field: string;
  query_field: string;
  example_display_fields: string[];
  embedding_fields?: string[];
}

interface ProjectMetadata {
  name: string;
  description: string;
}

interface SampleNode {
  [key: string]: any;
}

export class FieldDetector {
  private driver: Driver;
  private genAI: GoogleGenAI;

  constructor(
    uri: string,
    username: string,
    password: string,
    geminiKey: string
  ) {
    this.driver = neo4j.driver(uri, neo4j.auth.basic(username, password));
    this.genAI = new GoogleGenAI({ apiKey: geminiKey });
  }

  async close(): Promise<void> {
    await this.driver.close();
  }

  /**
   * Auto-detect project name and description based on entity types using LLM
   */
  async detectProjectMetadata(entityNames: string[]): Promise<ProjectMetadata> {
    const prompt = `You are analyzing a graph database schema to suggest a project name and description.

Entity types found in the database: ${entityNames.join(', ')}

Based on these entities, determine:
1. A concise project name (1-2 words) that captures the domain
2. A brief description (one sentence) of what this system manages

Guidelines:
- Name should be lowercase with hyphens if needed (e.g., "inventory-system", "social-network")
- Description should be clear and factual about what the system manages
- Avoid generic terms like "app", "system", "platform" in the name
- Infer the domain from the entity relationships

Return ONLY valid XML in this exact format (no markdown, no explanation):
<project>
  <name>domain-name</name>
  <description>Clear description of what the system manages</description>
</project>`;

    try {
      const response = await this.genAI.models.generateContent({
        model: 'gemma-3n-e2b-it',
        contents: prompt,
        config: {
          temperature: 0.3,
          maxOutputTokens: 100,
        }
      });

      if (!response.text) {
        throw new Error('No text in LLM response');
      }

      const text = response.text.trim();

      // Remove markdown code blocks if present and normalize whitespace
      const xmlText = text
        .replace(/```xml\n?/g, '')
        .replace(/```\n?/g, '')
        .trim()
        // Normalize whitespace between tags (remove indentation/newlines)
        .replace(/>\s+</g, '><');

      try {
        const parser = new LuciformXMLParser(xmlText, { mode: 'luciform-permissive' });
        const parsed = parser.parse() as any;

        // Access the root element (project)
        const rootElement = parsed.document?.children?.[0];

        if (!rootElement || rootElement.name !== 'project') {
          throw new Error('No project element found in XML root');
        }

        // Extract name and description from child elements
        let projectName: string | undefined;
        let projectDescription: string | undefined;

        for (const child of rootElement.children || []) {
          if (child.type === 'element') {
            if (child.name === 'name' && child.children?.[0]?.type === 'text') {
              projectName = child.children[0].content;
            } else if (child.name === 'description' && child.children?.[0]?.type === 'text') {
              projectDescription = child.children[0].content;
            }
          }
        }

        if (!projectName || typeof projectName !== 'string') {
          throw new Error(`Could not extract project name from XML. Type: ${typeof projectName}`);
        }

        if (!projectDescription || typeof projectDescription !== 'string') {
          throw new Error(`Could not extract project description from XML. Type: ${typeof projectDescription}`);
        }

        // Clean and slugify the name
        const cleanName = projectName
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9-]+/g, '-')
          .replace(/^-+|-+$/g, '');

        const cleanDescription = projectDescription.trim();

        console.log(`🎯  LLM suggested: "${cleanName}" - ${cleanDescription}`);
        return { name: cleanName, description: cleanDescription };
      } catch (parseError) {
        console.warn('⚠️  Failed to parse project metadata from LLM:', xmlText);
        // Fallback to a generic name based on first entity
        const fallback = entityNames[0].toLowerCase() + '-app';
        const fallbackDesc = `Generated RAG framework for ${entityNames.join(', ')}`;
        console.log(`   Using fallback: "${fallback}"`);
        return { name: fallback, description: fallbackDesc };
      }
    } catch (error) {
      console.warn('⚠️  Error detecting project metadata with LLM:', error);
      // Fallback to a generic name based on first entity
      const fallback = entityNames[0].toLowerCase() + '-app';
      const fallbackDesc = `Generated RAG framework for ${entityNames.join(', ')}`;
      console.log(`   Using fallback: "${fallback}"`);
      return { name: fallback, description: fallbackDesc };
    }
  }

  /**
   * Auto-detect field mappings for all entities in batch using a single LLM call
   */
  async detectFieldMappingsBatch(
    entities: EntityConfig[],
    database?: string
  ): Promise<Map<string, FieldMappings>> {
    const session = this.driver.session({ database });

    try {
      console.log('🤖  Auto-detecting field mappings using LLM...');

      // Collect samples for all entities
      const entitySamples: Array<{ entity: EntityConfig; samples: SampleNode[] }> = [];

      for (const entity of entities) {
        const samples = await this.getSampleNodes(session, entity.name);
        if (samples.length > 0) {
          const cleanedSamples = this.cleanSamples(samples, entity);
          entitySamples.push({ entity, samples: cleanedSamples });
        } else {
          console.warn(`⚠️  No samples found for ${entity.name}, using defaults`);
        }
      }

      // Call LLM once for all entities
      const allMappings = await this.analyzeSamplesBatchWithLLM(entitySamples);

      // Build result map
      const result = new Map<string, FieldMappings>();
      for (const entity of entities) {
        const mappings = allMappings.get(entity.name) || this.getDefaultMappings(entity);
        result.set(entity.name, mappings);
        console.log(`✅  ${entity.name}:`, mappings);
      }

      return result;
    } catch (error) {
      console.error('❌  Error in batch field detection:', error);
      // Fallback: return defaults for all
      const result = new Map<string, FieldMappings>();
      for (const entity of entities) {
        result.set(entity.name, this.getDefaultMappings(entity));
      }
      return result;
    } finally {
      await session.close();
    }
  }

  /**
   * Get sample nodes from Neo4j
   */
  private async getSampleNodes(session: Session, label: string): Promise<SampleNode[]> {
    const result = await session.run(
      `MATCH (n:${label}) RETURN n LIMIT 1`
    );

    return result.records.map(record => {
      const node = record.get('n');
      return node.properties;
    });
  }

  /**
   * Clean samples: remove embedding fields and trim long values
   */
  private cleanSamples(samples: SampleNode[], entity: EntityConfig): SampleNode[] {
    // Get all embedding-related field names from vector indexes
    const embeddingFields = new Set<string>();

    if (entity.vector_index) {
      embeddingFields.add(entity.vector_index.field);
      if (entity.vector_index.source_field) {
        embeddingFields.add(`embedding_${entity.vector_index.source_field}`);
      }
    }

    if (entity.vector_indexes) {
      entity.vector_indexes.forEach(idx => {
        embeddingFields.add(idx.field);
        if (idx.source_field) {
          embeddingFields.add(`embedding_${idx.source_field}`);
        }
      });
    }

    return samples.map(sample => {
      const cleaned: SampleNode = {};

      for (const [key, value] of Object.entries(sample)) {
        // Skip embedding-related fields
        if (embeddingFields.has(key)) {
          continue;
        }

        // Trim long string values to 600 chars
        if (typeof value === 'string' && value.length > 600) {
          cleaned[key] = value.substring(0, 600) + '...';
        } else {
          cleaned[key] = value;
        }
      }

      return cleaned;
    });
  }

  /**
   * Use LLM to analyze samples in batch for all entities (single LLM call)
   */
  private async analyzeSamplesBatchWithLLM(
    entitySamples: Array<{ entity: EntityConfig; samples: SampleNode[] }>
  ): Promise<Map<string, FieldMappings>> {

    // Build prompt with all entities
    let entitiesSection = '';
    for (const { entity, samples } of entitySamples) {
      entitiesSection += `
<entity name="${entity.name}">
${JSON.stringify(samples, null, 2)}
</entity>
`;
    }

    const prompt = `You are analyzing sample nodes from a graph database to determine optimal field mappings for multiple entities.

${entitiesSection}

For EACH entity above, analyze the samples and determine the best field for each purpose:

1. **display_name_field**: The best human-readable field to identify this entity
   - Should be concise and descriptive (e.g., "name", "title", "label")
   - Choose the most meaningful field for display

2. **unique_field**: The unique identifier field
   - Examples: "uuid", "id", "_id"
   - Must uniquely identify each node

3. **query_field**: The field users would naturally search by
   - Often same as display_name_field
   - The field you'd use in WHERE clauses

4. **example_display_fields**: Array of 0-2 additional SHORT fields for logging context
   - Should have SHORT values (< 100 chars ideally)
   - Provide useful context (like "file", "type", "category", "status")
   - DO NOT include long text fields (like "source", "content", "body", "description")
   - If no good candidates, omit the <example_display_fields> tag

5. **embedding_fields**: Up to 3 textual fields that should power semantic vector search
   - Prefer long descriptive text (content, description, docstring, notes, summary, source code)
   - Titles/names are valid if they are the most descriptive text available
   - Avoid purely numeric or categorical fields
   - Order from highest to lowest priority

Return ONLY valid XML in this exact format (no markdown, no explanation):
<entities>
  <entity name="EntityName1">
    <display_name_field>fieldName</display_name_field>
    <unique_field>fieldName</unique_field>
    <query_field>fieldName</query_field>
    <example_display_fields>
      <field>field1</field>
      <field>field2</field>
    </example_display_fields>
    <embedding_fields>
      <field>field1</field>
      <field>field2</field>
    </embedding_fields>
  </entity>
  <entity name="EntityName2">
    <display_name_field>fieldName</display_name_field>
    <unique_field>fieldName</unique_field>
    <query_field>fieldName</query_field>
  </entity>
</entities>`;

    // Safety: Ensure prompt doesn't exceed model's context limit
    // gemma-3n-e2b-it has ~8K token limit, we reserve 2K for output
    const MAX_INPUT_TOKENS = 6000;
    const estimatedTokens = Math.ceil(prompt.length / 4);

    let finalPrompt = prompt;
    if (estimatedTokens > MAX_INPUT_TOKENS) {
      console.warn(`⚠️  Prompt too large (${estimatedTokens} tokens), truncating to fit ${MAX_INPUT_TOKENS} tokens limit`);
      const maxChars = MAX_INPUT_TOKENS * 4;
      finalPrompt = prompt.substring(0, maxChars) + '\n</entities>';
    }

    const response = await this.genAI.models.generateContent({
      model: 'gemma-3n-e2b-it',
      contents: finalPrompt,
      config: {
        temperature: 0.1,
        maxOutputTokens: 2048,
      }
    });

    if (!response.text) {
      throw new Error('No text in LLM response');
    }

    const text = response.text.trim();

    // Remove markdown code blocks if present
    const xmlText = text
      .replace(/```xml\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    try {
      const parser = new LuciformXMLParser(xmlText, { mode: 'luciform-permissive' });
      const parsed = parser.parse() as any;

      const mappingsMap = new Map<string, FieldMappings>();

      // Handle single entity or array of entities
      const entities = Array.isArray(parsed.entities?.entity)
        ? parsed.entities.entity
        : parsed.entities?.entity ? [parsed.entities.entity] : [];

      for (const entityData of entities) {
        const entityName = entityData['@_name'] || entityData.name;

        const mappings: FieldMappings = {
          display_name_field: entityData.display_name_field,
          unique_field: entityData.unique_field,
          query_field: entityData.query_field,
          example_display_fields: []
        };

        // Handle example_display_fields (optional)
        if (entityData.example_display_fields?.field) {
          const fields = entityData.example_display_fields.field;
          if (Array.isArray(fields)) {
            mappings.example_display_fields = fields;
          } else {
            mappings.example_display_fields = [fields];
          }
        }

        if (entityData.embedding_fields?.field) {
          const fields = entityData.embedding_fields.field;
          if (Array.isArray(fields)) {
            mappings.embedding_fields = fields;
          } else {
            mappings.embedding_fields = [fields];
          }
        }

        mappingsMap.set(entityName, mappings);
      }

      return mappingsMap;
    } catch (error) {
      console.error('Failed to parse LLM XML response:', xmlText);
      throw error;
    }
  }

  /**
   * Get default field mappings as fallback
   */
  private getDefaultMappings(entity: EntityConfig): FieldMappings {
    const defaultEmbeddingFields =
      entity.vector_indexes?.map(idx => idx.source_field) ??
      (entity.vector_index ? [entity.vector_index.source_field] : []);

    return {
      display_name_field: entity.display_name_field || 'name',
      unique_field: entity.unique_field || 'uuid',
      query_field: entity.query_field || 'name',
      example_display_fields: entity.example_display_fields || [],
      embedding_fields: defaultEmbeddingFields
    };
  }
}
