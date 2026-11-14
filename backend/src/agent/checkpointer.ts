/**
 * Thread persistence.
 *
 * Contains: a LangGraph `MongoDBSaver` that stores graph state per `thread_id` in MongoDB,
 * reusing the app's MongoClient. Collections: `agent_checkpoints`, `agent_checkpoint_writes`.
 * Passing the same thread_id in `configurable` resumes that conversation.
 *
 * TODO:
 *   - Retention: prune old threads (e.g. a TTL job), since checkpoints grow every turn.
 *   - Add `agent_threads` metadata (title, entity_id, created_at) if the UI needs a thread list.
 */
import { MemorySaver, type BaseCheckpointSaver } from '@langchain/langgraph';
import { MongoDBSaver } from '@langchain/langgraph-checkpoint-mongodb';
import { config } from '../config.js';
import { mongo } from '../db/client.js';

/**
 * Demo mode (TIMELINE_MOCK=true) keeps threads in memory so the agent works without MongoDB;
 * threads are lost on restart. Otherwise threads persist in MongoDB.
 */
export const checkpointer: BaseCheckpointSaver = config.TIMELINE_MOCK
  ? new MemorySaver()
  : new MongoDBSaver({
      client: mongo,
      dbName: config.MONGODB_DB,
      checkpointCollectionName: 'agent_checkpoints',
      checkpointWritesCollectionName: 'agent_checkpoint_writes',
    });
