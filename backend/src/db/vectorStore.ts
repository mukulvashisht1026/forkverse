/**
 * MongoDB vector store, same setup as Agentic-GitPayBit (lib/agent.ts):
 * LangChain `MongoDBAtlasVectorSearch` + `OpenAIEmbeddings`, with
 *   indexName "vector_index", textKey "embedding_text", embeddingKey "embedding".
 *
 * Storing: `getVectorStore(collection).addDocuments(docs, { ids })` embeds each pageContent and
 *   upserts { _id, embedding_text, embedding, ...metadata }.
 * Searching: `getVectorStore(collection).similaritySearchWithScore(query, n)`.
 */
import { MongoDBAtlasVectorSearch } from '@langchain/mongodb';
import { OpenAIEmbeddings } from '@langchain/openai';
import type { Collection, Document } from 'mongodb';
import { config } from '../config.js';
import { VECTOR_INDEX_NAME } from './schema.js';

export function getEmbeddings() {
  return new OpenAIEmbeddings({
    model: config.EMBEDDING_MODEL,
    apiKey: config.EMBEDDING_API_KEY,
    configuration: { baseURL: config.EMBEDDING_BASE_URL || undefined },
  });
}

export function getVectorStore(collection: Collection<Document>) {
  const dbConfig = {
    collection: collection,
    indexName: VECTOR_INDEX_NAME, // "vector_index"
    textKey: 'embedding_text',
    embeddingKey: 'embedding',
  };
  return new MongoDBAtlasVectorSearch(getEmbeddings(), dbConfig);
}
