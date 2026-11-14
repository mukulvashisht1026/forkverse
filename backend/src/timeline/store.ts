/**
 * Timeline persistence.
 *
 * - MongoTimelineStore (used by the server): one document per spine node in `timeline_nodes`
 *   (branches embedded, ordered by created_at) and a version counter in `timeline_meta`.
 * - MemoryTimelineStore: same behaviour in memory, for tests.
 *
 * Every mutation bumps the global timeline version, which the frontend uses for ordering.
 */
import type { Collection } from 'mongodb';
import { buildBranch, buildNode, patchNode, TimelineError } from './model.js';
import type { BranchNode, CreateBranchPayload, CreateNodePayload, SpineNode, TimelineSnapshot } from './types.js';

export interface TimelineStore {
  getSnapshot(): Promise<TimelineSnapshot>;
  getNode(nodeId: string): Promise<SpineNode | null>;
  addNode(input: CreateNodePayload): Promise<{ node: SpineNode; version: number }>;
  updateNode(nodeId: string, patch: Partial<CreateNodePayload>): Promise<{ node: SpineNode; version: number }>;
  deleteNode(nodeId: string): Promise<{ nodeId: string; version: number }>;
  addBranch(
    nodeId: string,
    input: CreateBranchPayload,
  ): Promise<{ node: SpineNode; branch: BranchNode; version: number }>;
  deleteBranch(nodeId: string, branchId: string): Promise<{ nodeId: string; branchId: string; version: number }>;
}

const notFound = (what: string, id: string) => new TimelineError(`${what} "${id}" not found.`, 404);

// ---- MongoDB ----------------------------------------------------------------

export interface TimelineNodeDoc extends Omit<SpineNode, 'id'> {
  _id: string;
  created_at: Date;
}

export interface TimelineMetaDoc {
  _id: string; // always 'timeline'
  version: number;
  updatedAt: string;
}

const META_ID = 'timeline';

export class MongoTimelineStore implements TimelineStore {
  constructor(
    private nodes: Collection<TimelineNodeDoc>,
    private meta: Collection<TimelineMetaDoc>,
  ) {}

  private async bump(): Promise<number> {
    const doc = await this.meta.findOneAndUpdate(
      { _id: META_ID },
      { $inc: { version: 1 }, $set: { updatedAt: new Date().toISOString() } },
      { upsert: true, returnDocument: 'after' },
    );
    return doc!.version;
  }

  async getSnapshot(): Promise<TimelineSnapshot> {
    const [docs, meta] = await Promise.all([
      this.nodes.find().sort({ created_at: 1 }).toArray(),
      this.meta.findOne({ _id: META_ID }),
    ]);
    return {
      nodes: docs.map(toNode),
      version: meta?.version ?? 1,
      updatedAt: meta?.updatedAt ?? new Date().toISOString(),
    };
  }

  async getNode(nodeId: string): Promise<SpineNode | null> {
    const doc = await this.nodes.findOne({ _id: nodeId });
    return doc ? toNode(doc) : null;
  }

  async addNode(input: CreateNodePayload) {
    const node = buildNode(input);
    const { id, ...rest } = node;
    // Upsert by id; keep the original position (created_at) when replacing.
    await this.nodes.updateOne(
      { _id: id },
      { $set: rest, $setOnInsert: { created_at: new Date() } },
      { upsert: true },
    );
    return { node, version: await this.bump() };
  }

  async updateNode(nodeId: string, patch: Partial<CreateNodePayload>) {
    const current = await this.getNode(nodeId);
    if (!current) throw notFound('Node', nodeId);
    const next = patchNode(current, patch);
    const { id: _nodeId, branches: _branches, ...rest } = next;
    const result = await this.nodes.updateOne({ _id: nodeId }, { $set: rest });
    if (!result.matchedCount) throw notFound('Node', nodeId);
    return { node: { ...next, branches: (await this.getNode(nodeId))?.branches ?? current.branches }, version: await this.bump() };
  }

  async deleteNode(nodeId: string) {
    const res = await this.nodes.deleteOne({ _id: nodeId });
    if (res.deletedCount === 0) throw notFound('Node', nodeId);
    return { nodeId, version: await this.bump() };
  }

  async addBranch(nodeId: string, input: CreateBranchPayload) {
    const node = await this.getNode(nodeId);
    if (!node) throw notFound('Node', nodeId);
    const branch = buildBranch(node, input);
    const existing = await this.nodes.updateOne(
      { _id: nodeId, 'branches.id': branch.id },
      { $set: { 'branches.$': branch } },
    );
    if (!existing.matchedCount) {
      const appended = await this.nodes.updateOne(
        { _id: nodeId, 'branches.id': { $ne: branch.id } },
        { $push: { branches: branch } },
      );
      if (!appended.matchedCount) {
        const latest = await this.getNode(nodeId);
        if (!latest) throw notFound('Node', nodeId);
        await this.nodes.updateOne(
          { _id: nodeId, 'branches.id': branch.id },
          { $set: { 'branches.$': branch } },
        );
      }
    }
    const updated = await this.getNode(nodeId);
    if (!updated) throw notFound('Node', nodeId);
    return { node: updated, branch, version: await this.bump() };
  }

  async deleteBranch(nodeId: string, branchId: string) {
    const node = await this.getNode(nodeId);
    if (!node) throw notFound('Node', nodeId);
    if (!node.branches.some((b) => b.id === branchId)) throw notFound('Branch', branchId);
    await this.nodes.updateOne({ _id: nodeId }, { $pull: { branches: { id: branchId } } });
    return { nodeId, branchId, version: await this.bump() };
  }
}

function toNode({ _id, created_at: _c, ...rest }: TimelineNodeDoc): SpineNode {
  return { id: _id, ...rest };
}

// ---- in memory (tests) ------------------------------------------------------

export class MemoryTimelineStore implements TimelineStore {
  private nodes: SpineNode[] = [];
  private version = 1;
  private updatedAt = new Date().toISOString();

  private bump(): number {
    this.version += 1;
    this.updatedAt = new Date().toISOString();
    return this.version;
  }

  async getSnapshot(): Promise<TimelineSnapshot> {
    return { nodes: structuredClone(this.nodes), version: this.version, updatedAt: this.updatedAt };
  }

  async getNode(nodeId: string) {
    const n = this.nodes.find((x) => x.id === nodeId);
    return n ? structuredClone(n) : null;
  }

  async addNode(input: CreateNodePayload) {
    const node = buildNode(input);
    const idx = this.nodes.findIndex((n) => n.id === node.id);
    if (idx >= 0) this.nodes[idx] = node;
    else this.nodes.push(node);
    return { node: structuredClone(node), version: this.bump() };
  }

  async updateNode(nodeId: string, patch: Partial<CreateNodePayload>) {
    const idx = this.nodes.findIndex((n) => n.id === nodeId);
    if (idx < 0) throw notFound('Node', nodeId);
    const next = patchNode(this.nodes[idx]!, patch);
    this.nodes[idx] = next;
    return { node: structuredClone(next), version: this.bump() };
  }

  async deleteNode(nodeId: string) {
    const idx = this.nodes.findIndex((n) => n.id === nodeId);
    if (idx < 0) throw notFound('Node', nodeId);
    this.nodes.splice(idx, 1);
    return { nodeId, version: this.bump() };
  }

  async addBranch(nodeId: string, input: CreateBranchPayload) {
    const node = this.nodes.find((n) => n.id === nodeId);
    if (!node) throw notFound('Node', nodeId);
    const branch = buildBranch(node, input);
    const index = node.branches.findIndex((item) => item.id === branch.id);
    if (index < 0) node.branches.push(branch);
    else node.branches[index] = branch;
    return { node: structuredClone(node), branch: structuredClone(branch), version: this.bump() };
  }

  async deleteBranch(nodeId: string, branchId: string) {
    const node = this.nodes.find((n) => n.id === nodeId);
    if (!node) throw notFound('Node', nodeId);
    const idx = node.branches.findIndex((b) => b.id === branchId);
    if (idx < 0) throw notFound('Branch', branchId);
    node.branches.splice(idx, 1);
    return { nodeId, branchId, version: this.bump() };
  }
}
