import type { Collection, Document } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';
import { getVectorStore } from '../src/db/vectorStore.js';

function fakeCollection(rows: Document[] = []) {
  const updateOne = vi.fn().mockResolvedValue({});
  const aggregate = vi.fn().mockImplementation(() => ({
    map: (fn: (d: Document) => unknown) => ({ toArray: async () => rows.map(fn) }),
  }));
  const db = { client: { appendMetadata: () => {} } };
  return { coll: { updateOne, aggregate, db } as unknown as Collection<Document>, updateOne, aggregate };
}

describe('vector store (GitPayBit setup)', () => {
  it('stores pageContent as embedding_text + embedding, upserted by _id', async () => {
    const { coll, updateOne } = fakeCollection();
    const store = getVectorStore(coll);
    vi.spyOn(store.embeddings, 'embedDocuments').mockResolvedValue([[0.1, 0.2]]);

    await store.addDocuments([{ pageContent: 'CEO pledged net zero', metadata: { entity_id: 'e1' } }], { ids: ['n1'] });

    const [filter, update] = updateOne.mock.calls[0]!;
    expect(filter).toEqual({ _id: 'n1' });
    expect(update.$set).toEqual({ _id: 'n1', embedding_text: 'CEO pledged net zero', embedding: [0.1, 0.2], entity_id: 'e1' });
  });

  it('similaritySearchWithScore runs $vectorSearch on vector_index', async () => {
    const { coll, aggregate } = fakeCollection([{ _id: 'n1', embedding_text: 'hit', score: 0.9 }]);
    const store = getVectorStore(coll);
    vi.spyOn(store.embeddings, 'embedQuery').mockResolvedValue([0.5, 0.25]);

    const result = await store.similaritySearchWithScore('pledge', 10);

    expect(aggregate.mock.calls[0]![0][0].$vectorSearch).toMatchObject({
      index: 'vector_index',
      path: 'embedding',
      queryVector: [0.5, 0.25],
      limit: 10,
    });
    expect(result[0]![0].pageContent).toBe('hit');
    expect(result[0]![1]).toBe(0.9);
  });
});
