import { promises as fs } from 'fs';
import path from 'path';
import pLimit from 'p-limit';

import type { Neo4jClient } from '../client/neo4j-client.js';
import { applyPreprocessors } from './preprocessors.js';
import { getLocalTimestamp, getFilenameTimestamp } from '../utils/timestamp.js';
import type {
  GeneratedEmbeddingPipelineConfig,
  GeneratedEmbeddingEntityConfig,
  GeneratedEmbeddingRelationshipConfig
} from './types.js';
import { GeminiEmbeddingProvider } from './gemini-provider.js';

const DEFAULT_BATCH_SIZE = 16;
const DEFAULT_CONCURRENCY = 1;
const DEFAULT_MAX_RETRIES = 4;
const DEFAULT_RETRY_DELAY_MS = 2000;

const LOG_DIR = process.env.RAGFORGE_LOG_DIR || path.resolve(process.cwd(), 'logs');
const LOG_FILE_ENV = process.env.RAGFORGE_LOG_FILE;
const DEFAULT_LOG_FILENAME = `embeddings-${getFilenameTimestamp()}.log`;
const LOG_FILE_PATH = LOG_FILE_ENV
  ? (path.isAbsolute(LOG_FILE_ENV) ? LOG_FILE_ENV : path.join(LOG_DIR, LOG_FILE_ENV))
  : path.join(LOG_DIR, DEFAULT_LOG_FILENAME);
let loggingInitialized = false;

async function writeLog(level: 'info' | 'warn' | 'error', pipeline: string, message: string, error?: unknown) {
  const timestamp = getLocalTimestamp();
  const line = `[${timestamp}] [${level.toUpperCase()}] [${pipeline}] ${message}`;

  // Console output
  switch (level) {
    case 'info':
      console.log(line);
      break;
    case 'warn':
      console.warn(line);
      break;
    case 'error':
      console.error(line);
      if (error) {
        console.error(formatError(error));
      }
      break;
  }

  try {
    await fs.mkdir(path.dirname(LOG_FILE_PATH), { recursive: true });
    const fileLine = error ? `${line}\n${formatError(error)}\n` : `${line}\n`;
    await fs.appendFile(LOG_FILE_PATH, fileLine, 'utf-8');
  } catch (logError) {
    console.warn('⚠️  Failed to write embeddings log:', logError);
  }
}

interface PipelineRunOptions {
  neo4j: Neo4jClient;
  entity: GeneratedEmbeddingEntityConfig;
  provider: GeminiEmbeddingProvider;
  defaults?: {
    model?: string;
    dimension?: number;
  };
  batchSize?: number;
}

export async function runEmbeddingPipelines(options: PipelineRunOptions): Promise<void> {
  const { neo4j, entity, provider, defaults } = options;

  if (!loggingInitialized) {
    loggingInitialized = true;
    await writeLog('info', 'system', `Embedding logs will be written to ${LOG_FILE_PATH}`);
  }

  await writeLog(
    'info',
    `entity:${entity.entity}`,
    `Running ${entity.pipelines.length} embedding pipeline(s)`
  );

  for (const pipeline of entity.pipelines) {
    const pipelineId = `${entity.entity}/${pipeline.name}`;
    await writeLog(
      'info',
      pipelineId,
      `Starting embedding generation (source=${pipeline.source}, target=${pipeline.targetProperty})`
    );

    try {
      const stats = await runSinglePipeline({ neo4j, entity: entity.entity, pipeline, provider, defaults });

      if (stats.total === 0) {
        await writeLog('warn', pipelineId, 'No records contained usable source text. Skipping.');
      } else {
        await writeLog(
          'info',
          pipelineId,
          `Completed embeddings for ${stats.processed}/${stats.total} records.`
        );
      }
    } catch (error) {
      await writeLog('error', pipelineId, 'Embedding pipeline failed', error);
      throw error;
    }
  }
}

async function runSinglePipeline(params: {
  neo4j: Neo4jClient;
  entity: string;
  pipeline: GeneratedEmbeddingPipelineConfig;
  provider: GeminiEmbeddingProvider;
  defaults?: { model?: string; dimension?: number };
}): Promise<{ total: number; processed: number }> {
  const { neo4j, entity, pipeline, provider, defaults } = params;
  const pipelineId = `${entity}/${pipeline.name}`;
  const sourceField = pipeline.source;
  const targetProperty = pipeline.targetProperty;

  const query = `
    MATCH (n:\`${entity}\`)
    WHERE n.\`${sourceField}\` IS NOT NULL
    RETURN elementId(n) AS id, n
  `;

  // DEBUG: Log the query
  console.log(`DEBUG: Running query for ${entity}.${sourceField}:`, query.trim());

  const result = await neo4j.run(query);

  // DEBUG: Check what we got from the query
  console.log(`DEBUG: Query returned ${result.records.length} records for entity ${entity}`);
  if (result.records.length > 0) {
    console.log(`DEBUG: First record:`, result.records[0]);
  }

  const baseRows: Array<{ id: string; parts: string[]; index: number }> = [];

  result.records.forEach((record, index) => {
    const id = record.get('id') as string;
    const node = record.get('n');

    // DEBUG: Log what we're getting from Neo4j
    if (index === 0) {
      console.log('DEBUG: First node from Neo4j:', JSON.stringify(node, null, 2));
      console.log('DEBUG: node.properties:', node.properties);
      console.log('DEBUG: typeof node:', typeof node);
      console.log('DEBUG: node keys:', Object.keys(node));
    }

    const props = node.properties ?? {};

    const base = props[sourceField];
    if (typeof base !== 'string' || base.trim().length === 0) {
      return;
    }

    const parts: string[] = [base];

    if (pipeline.includeFields) {
      for (const field of pipeline.includeFields) {
        const value = props[field];
        if (typeof value === 'string' && value.trim().length > 0) {
          parts.push(value);
        }
      }
    }

    baseRows.push({ id, parts, index });
  });

  if (baseRows.length === 0) {
    return { total: 0, processed: 0 };
  }

  await writeLog(
    'info',
    pipelineId,
    `Found ${baseRows.length} node(s) with non-empty field "${sourceField}"`
  );

  if (pipeline.includeRelationships?.length) {
    await writeLog(
      'info',
      pipelineId,
      `Enriching texts with ${pipeline.includeRelationships.length} relationship(s)`
    );

    const relationshipSnippets = await loadRelationshipSnippets(
      neo4j,
      entity,
      baseRows.map(row => row.id),
      pipeline.includeRelationships,
      pipelineId
    );

    for (const row of baseRows) {
      const snippets = relationshipSnippets.get(row.id);
      if (snippets && snippets.length) {
        row.parts.push(...snippets);
      }
    }
  }

  const preparedRows = baseRows
    .map(({ id, parts, index }) => {
      const composed = parts.join('\n\n');
      const processed = applyPreprocessors(composed, pipeline.preprocessors ?? []).trim();
      if (!processed) {
        return undefined;
      }
      return { id, text: processed, index };
    })
    .filter((row): row is { id: string; text: string; index: number } => Boolean(row));

  if (preparedRows.length === 0) {
    return { total: baseRows.length, processed: 0 };
  }

  if (preparedRows.length !== baseRows.length) {
    await writeLog(
      'warn',
      pipelineId,
      `Filtered out ${baseRows.length - preparedRows.length} record(s) after preprocessing`
    );
  }

  const batchSize = Math.max(1, pipeline.batchSize ?? DEFAULT_BATCH_SIZE);
  const concurrency = Math.max(1, pipeline.concurrency ?? DEFAULT_CONCURRENCY);
  const throttleMs = Math.max(0, pipeline.throttleMs ?? 0);
  const maxRetries = Math.max(0, pipeline.maxRetries ?? DEFAULT_MAX_RETRIES);
  const retryDelayMs = Math.max(0, pipeline.retryDelayMs ?? pipeline.throttleMs ?? DEFAULT_RETRY_DELAY_MS);

  await writeLog(
    'info',
    pipelineId,
    `Preparing ${preparedRows.length} records for embedding (batchSize=${batchSize}, concurrency=${concurrency})`
  );

  const batches = chunkArray(preparedRows, batchSize);
  const embeddingsByIndex = new Map<number, number[]>();

  const embedOptions = {
    model: pipeline.model ?? defaults?.model,
    dimension: pipeline.dimension ?? defaults?.dimension
  };

  const totalBatches = batches.length;
  let completedBatches = 0;
  const limit = pLimit(concurrency);

  await Promise.all(
    batches.map((batch, batchIndex) =>
      limit(async () => {
        await writeLog(
          'info',
          pipelineId,
          `Batch ${batchIndex + 1}/${totalBatches}: embedding ${batch.length} item(s)`
        );

        const texts = batch.map(item => item.text);

        const embeddings = await embedWithRetry(
          provider,
          texts,
          embedOptions,
          maxRetries,
          retryDelayMs,
          pipelineId
        );

        batch.forEach((item, idx) => {
          const embedding = embeddings[idx];
          if (Array.isArray(embedding)) {
            embeddingsByIndex.set(item.index, embedding);
          }
        });

        completedBatches += 1;
        await writeLog(
          'info',
          pipelineId,
          `Batch ${batchIndex + 1}/${totalBatches} complete (${completedBatches}/${totalBatches} finished)`
        );

        if (throttleMs > 0) {
          await sleep(throttleMs);
        }
      })
    )
  );

  const payload = preparedRows
    .map(row => {
      const embedding = embeddingsByIndex.get(row.index);
      if (!embedding) {
        return undefined;
      }
      return {
        id: row.id,
        embedding
      };
    })
    .filter((item): item is { id: string; embedding: number[] } => Boolean(item));

  if (payload.length === 0) {
    return { total: preparedRows.length, processed: 0 };
  }

  await writeLog(
    'info',
    pipelineId,
    `Persisting ${payload.length} embedding vector(s) to Neo4j`
  );

  await neo4j.run(
    `UNWIND $rows AS row
     MATCH (n)
     WHERE elementId(n) = row.id
     SET n.\`${targetProperty}\` = row.embedding`,
    { rows: payload }
  );

  return {
    total: preparedRows.length,
    processed: payload.length
  };
}

async function loadRelationshipSnippets(
  neo4j: Neo4jClient,
  entity: string,
  nodeIds: string[],
  relationships: GeneratedEmbeddingRelationshipConfig[],
  pipelineId: string
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();

  if (nodeIds.length === 0) {
    return map;
  }

  for (const rel of relationships) {
    const depth = Math.max(1, rel.depth ?? 1);
    const range = depth > 1 ? `*1..${depth}` : '';

    let pattern: string;
    switch (rel.direction) {
      case 'incoming':
        pattern = `<-[:${rel.type}]${range}-(m)`;
        break;
      case 'both':
        pattern = `-[:${rel.type}]${range}-(m)`;
        break;
      default:
        pattern = `-[:${rel.type}]${range}->(m)`;
        break;
    }

    const query = `
      MATCH (n:\`${entity}\`)
      WHERE elementId(n) IN $ids
      OPTIONAL MATCH (n)${pattern}
      WITH elementId(n) AS id, collect(DISTINCT properties(m)) AS related
      RETURN id, related
    `;

    await writeLog(
      'info',
      pipelineId,
      `Fetching relationship data: type=${rel.type}, direction=${rel.direction}, depth=${depth}`
    );

    const response = await neo4j.run(query, { ids: nodeIds });

    const fields = rel.fields && rel.fields.length > 0
      ? rel.fields
      : ['signature', 'name', 'title'];
    const limit = rel.maxItems ?? 10;

    let recordsWithData = 0;

    for (const record of response.records) {
      const id = record.get('id') as string;
      const related = record.get('related');

      if (!Array.isArray(related) || related.length === 0) {
        continue;
      }

      const formatted = related
        .map((props: Record<string, unknown>) => formatRelationshipEntry(props, fields))
        .filter((line): line is string => Boolean(line))
        .slice(0, limit);

      if (formatted.length === 0) {
        continue;
      }

      const bucket = map.get(id) ?? [];
      bucket.push(`[${rel.type}]\n${formatted.join('\n')}`);
      map.set(id, bucket);
      recordsWithData += 1;
    }

    await writeLog(
      'info',
      pipelineId,
      `Collected relationship data for ${recordsWithData} node(s) via ${rel.type}`
    );
  }

  return map;
}

function formatRelationshipEntry(props: Record<string, unknown>, fields: string[]): string | undefined {
  if (!props) return undefined;

  const pieces = fields
    .map(field => props[field])
    .flat()
    .map(value => formatValue(value))
    .filter((value): value is string => Boolean(value && value.trim().length > 0));

  if (pieces.length > 0) {
    return pieces.join(' • ');
  }

  const fallback = props['signature'] || props['name'] || props['title'] || props['id'];
  if (fallback) {
    const text = formatValue(fallback);
    return text && text.trim().length > 0 ? text : undefined;
  }

  try {
    return JSON.stringify(props);
  } catch {
    return undefined;
  }
}

function formatValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map(formatValue).filter(Boolean).join(', ');
  }
  if (typeof value === 'object' && typeof (value as any).toString === 'function') {
    const str = (value as any).toString();
    return str === '[object Object]' ? JSON.stringify(value) : str;
  }
  return String(value);
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function embedWithRetry(
  provider: GeminiEmbeddingProvider,
  texts: string[],
  options: { model?: string; dimension?: number },
  maxRetries: number,
  retryDelayMs: number,
  pipelineId: string
): Promise<number[][]> {
  let attempt = 0;

  while (true) {
    try {
      return await provider.embed(texts, options);
    } catch (error) {
      if (attempt >= maxRetries || !isRateLimitError(error)) {
        throw error;
      }

      const delay = retryDelayMs * Math.pow(2, attempt);
      await writeLog(
        'warn',
        pipelineId,
        `Rate limit encountered (attempt ${attempt + 1}/${maxRetries + 1}). Retrying in ${delay}ms`,
        error
      );
      await sleep(delay);
      attempt += 1;
    }
  }
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise(resolve => setTimeout(resolve, ms));
}

function isRateLimitError(error: unknown): boolean {
  const message =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : '';

  const normalized = message.toLowerCase();
  return normalized.includes('quota')
    || normalized.includes('429')
    || normalized.includes('rate limit')
    || normalized.includes('exhausted');
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}\n${error.stack ?? ''}`;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
