import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Collection, Document } from 'mongodb';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { db, mongo } from './client.js';
import { COLLECTIONS, VECTOR_INDEX_NAME, vectorIndexDefinition, type CollectionSpec } from './schema.js';

/**
 * Idempotently bring the database in line with db/schema.ts: create collections,
 * (re)apply validators, create indexes and vector search indexes. Safe to run on every boot.
 */
export async function migrate(): Promise<void> {
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));

  for (const [name, spec] of Object.entries(COLLECTIONS) as [string, CollectionSpec][]) {
    if (existing.has(name)) {
      await db.command({ collMod: name, validator: spec.validator, validationLevel: 'strict' });
    } else {
      logger.info({ collection: name }, 'creating collection');
      await db.createCollection(name, { validator: spec.validator, validationLevel: 'strict' });
    }
    const coll = db.collection(name);
    if (spec.indexes.length) await coll.createIndexes(spec.indexes);
    if (spec.vectorFields) await ensureVectorIndex(coll, vectorIndexDefinition(spec.vectorFields, config.EMBEDDING_DIM));
  }
}

async function ensureVectorIndex(coll: Collection, definition: Document): Promise<void> {
  const current = (await coll.listSearchIndexes(VECTOR_INDEX_NAME).toArray())[0] as
    | { latestDefinition?: Document }
    | undefined;
  if (!current) {
    logger.info({ collection: coll.collectionName }, 'creating vector search index');
    await coll.createSearchIndex({ name: VECTOR_INDEX_NAME, type: 'vectorSearch', definition });
    return;
  }
  const dim = (current.latestDefinition?.fields as Document[] | undefined)?.find((f) => f.type === 'vector')?.numDimensions;
  if (dim !== config.EMBEDDING_DIM) {
    // Changing EMBEDDING_DIM means the stored vectors are from another model: re-embed everything.
    throw new Error(
      `${coll.collectionName}.${VECTOR_INDEX_NAME} has numDimensions=${dim}, EMBEDDING_DIM=${config.EMBEDDING_DIM}. ` +
        'Re-embed all documents, then drop the index and rerun migrate.',
    );
  }
  // Only update when fields changed: an update triggers a full index rebuild.
  if (fieldsKey(current.latestDefinition) !== fieldsKey(definition)) {
    logger.info({ collection: coll.collectionName }, 'updating vector search index');
    await coll.updateSearchIndex(VECTOR_INDEX_NAME, definition);
  }
}

function fieldsKey(def: Document | undefined): string {
  const fields = (def?.fields as Document[] | undefined) ?? [];
  return fields
    .map((f) => `${f.type}:${f.path}:${f.numDimensions ?? ''}:${f.similarity ?? ''}`)
    .sort()
    .join('|');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  migrate()
    .then(() => mongo.close())
    .catch(async (err) => {
      logger.error(err, 'migration failed');
      await mongo.close();
      process.exit(1);
    });
}
