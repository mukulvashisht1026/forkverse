/**
 * Agent graph state.
 *
 * Contains:
 * - `messages`: the chat history (user, assistant, tool messages). Persisted per thread by the
 *   checkpointer, so a follow-up turn on the same thread_id sees everything before it.
 * - `entityId`: optional entity the conversation is scoped to (the tree being viewed in the UI).
 *   Tools read it to filter Mongo queries.
 *
 * TODO: add fields as the agent grows, e.g.
 *   - `citations`: source URLs/quotes collected by tools, returned alongside the reply.
 *   - `retrievedNodeIds`: nodes already pulled into context, to avoid refetching.
 */
import { Annotation, MessagesAnnotation } from '@langchain/langgraph';

export const AgentState = Annotation.Root({
  ...MessagesAnnotation.spec,
  entityId: Annotation<string | null>({
    // Last non-undefined value wins, so a later turn can re-scope the thread.
    reducer: (prev, next) => (next === undefined ? prev : next),
    default: () => null,
  }),
});

export type AgentStateType = typeof AgentState.State;
