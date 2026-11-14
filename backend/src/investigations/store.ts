/**
 * Investigation persistence.
 *
 * - MongoInvestigationStore: `investigations` (metadata + revision + events with embedded
 *   evidence) and `research_runs` (one document per run, linked by investigationId).
 * - MemoryInvestigationStore: same behaviour in memory (TIMELINE_MOCK demo mode and tests).
 *
 * Every graph change (event or evidence added, event summary set) bumps `revision` and
 * `updatedAt`, so clients can discard stale updates. Existing events/evidence are never
 * removed by research runs.
 */
import type { Collection } from 'mongodb';
import type {
  ChatMessageDto,
  InvestigationEventDto,
  InvestigationEvidenceDto,
  InvestigationRecord,
  ResearchRunDto,
} from './types.js';

export interface ListPage {
  items: InvestigationRecord[];
  nextCursor?: string;
}

export interface InvestigationStore {
  create(record: InvestigationRecord): Promise<void>;
  get(id: string): Promise<InvestigationRecord | null>;
  rename(id: string, title: string): Promise<void>;
  listPublic(opts: { limit: number; cursor?: string }): Promise<ListPage>;
  addEvent(id: string, event: InvestigationEventDto): Promise<number>;
  addEvidence(id: string, eventId: string, evidence: InvestigationEvidenceDto): Promise<number>;
  setEventSummary(id: string, eventId: string, summary: string): Promise<number>;

  createRun(run: ResearchRunDto): Promise<void>;
  updateRun(run: ResearchRunDto): Promise<void>;
  getRun(investigationId: string, runId: string): Promise<ResearchRunDto | null>;
  listRuns(investigationId: string): Promise<ResearchRunDto[]>;
  /** Queued or running run for this investigation, if any. */
  activeRun(investigationId: string): Promise<ResearchRunDto | null>;
  /** Mark queued/running runs as failed (they cannot survive a restart). Returns how many. */
  failStaleRuns(reason: string): Promise<number>;

  addMessage(message: ChatMessageDto): Promise<void>;
  /** Newest `limit` messages older than the cursor, returned oldest-first; nextCursor pages further back. */
  listMessages(investigationId: string, opts: { limit: number; cursor?: string }): Promise<{ items: ChatMessageDto[]; nextCursor?: string }>;
}

/** Message cursor: (createdAt, id) of the oldest message on the current page. */
function encodeMessageCursor(m: Pick<ChatMessageDto, 'createdAt' | 'id'>): string {
  return Buffer.from(JSON.stringify({ u: m.createdAt, i: m.id })).toString('base64url');
}

// ---- cursor: opaque to clients, (updatedAt desc, id desc) keyset -------------

interface Cursor {
  u: string;
  i: string;
}
export function encodeCursor(r: Pick<InvestigationRecord, 'updatedAt' | 'id'>): string {
  return Buffer.from(JSON.stringify({ u: r.updatedAt, i: r.id })).toString('base64url');
}
export function decodeCursor(cursor: string): Cursor | null {
  try {
    const c = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Cursor;
    return typeof c.u === 'string' && typeof c.i === 'string' ? c : null;
  } catch {
    return null;
  }
}

const newer = (a: Pick<InvestigationRecord, 'updatedAt' | 'id'>, b: Pick<InvestigationRecord, 'updatedAt' | 'id'>) =>
  a.updatedAt === b.updatedAt ? b.id.localeCompare(a.id) : b.updatedAt.localeCompare(a.updatedAt);

const isActive = (r: ResearchRunDto) => r.status === 'queued' || r.status === 'running';
const nowIso = () => new Date().toISOString();

// ---- MongoDB ----------------------------------------------------------------

export type InvestigationDoc = Omit<InvestigationRecord, 'id'> & { _id: string };
export type ResearchRunDoc = Omit<ResearchRunDto, 'id'> & { _id: string };
export type ChatMessageDoc = Omit<ChatMessageDto, 'id'> & { _id: string };

const fromDoc = ({ _id, ...rest }: InvestigationDoc): InvestigationRecord => ({ id: _id, ...rest });
const runFromDoc = ({ _id, ...rest }: ResearchRunDoc): ResearchRunDto => ({ id: _id, ...rest });

export class MongoInvestigationStore implements InvestigationStore {
  constructor(
    private investigations: Collection<InvestigationDoc>,
    private runs: Collection<ResearchRunDoc>,
    private messages?: Collection<ChatMessageDoc>,
  ) {}

  private messageCol(): Collection<ChatMessageDoc> {
    if (!this.messages) throw new Error('chat_messages collection not configured');
    return this.messages;
  }

  async addMessage({ id, ...rest }: ChatMessageDto) {
    await this.messageCol().insertOne({ _id: id, ...rest });
  }

  async listMessages(investigationId: string, { limit, cursor }: { limit: number; cursor?: string }) {
    const c = cursor ? decodeCursor(cursor) : null;
    const docs = await this.messageCol()
      .find({ investigationId, ...(c && { $or: [{ createdAt: { $lt: c.u } }, { createdAt: c.u, _id: { $lt: c.i } }] }) })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .toArray();
    const page = docs.slice(0, limit).map(({ _id, ...rest }) => ({ id: _id, ...rest }));
    const oldest = page.at(-1);
    return { items: page.reverse(), ...(docs.length > limit && oldest && { nextCursor: encodeMessageCursor(oldest) }) };
  }

  async create({ id, ...rest }: InvestigationRecord) {
    await this.investigations.insertOne({ _id: id, ...rest });
  }

  async get(id: string) {
    const doc = await this.investigations.findOne({ _id: id });
    return doc ? fromDoc(doc) : null;
  }

  async rename(id: string, title: string) {
    const result = await this.investigations.updateOne({ _id: id }, { $set: { title, updatedAt: nowIso() } });
    if (!result.matchedCount) throw new Error(`Investigation "${id}" not found.`);
  }

  async listPublic({ limit, cursor }: { limit: number; cursor?: string }): Promise<ListPage> {
    const c = cursor ? decodeCursor(cursor) : null;
    const docs = await this.investigations
      .find(
        {
          visibility: 'public',
          status: 'active',
          ...(c && { $or: [{ updatedAt: { $lt: c.u } }, { updatedAt: c.u, _id: { $lt: c.i } }] }),
        },
        { projection: { events: 0 } },
      )
      .sort({ updatedAt: -1, _id: -1 })
      .limit(limit + 1)
      .toArray();
    const items = docs.slice(0, limit).map((d) => fromDoc({ ...d, events: d.events ?? [] }));
    return { items, ...(docs.length > limit && { nextCursor: encodeCursor(items.at(-1)!) }) };
  }

  private async bump(id: string, update: Record<string, unknown>, filter: Record<string, unknown> = {}): Promise<number> {
    const doc = await this.investigations.findOneAndUpdate(
      { _id: id, ...filter },
      { ...update, $inc: { revision: 1 }, $set: { ...((update.$set as object) ?? {}), updatedAt: nowIso() } },
      { returnDocument: 'after', projection: { revision: 1 } },
    );
    if (!doc) throw new Error(`Investigation "${id}" (or event) not found.`);
    return doc.revision;
  }

  addEvent(id: string, event: InvestigationEventDto) {
    return this.bump(id, { $push: { events: event } });
  }

  addEvidence(id: string, eventId: string, evidence: InvestigationEvidenceDto) {
    return this.bump(id, { $push: { 'events.$.evidence': evidence } }, { 'events.id': eventId });
  }

  setEventSummary(id: string, eventId: string, summary: string) {
    return this.bump(id, { $set: { 'events.$.summary': summary } }, { 'events.id': eventId });
  }

  async createRun({ id, ...rest }: ResearchRunDto) {
    await this.runs.insertOne({ _id: id, ...rest });
  }

  async updateRun({ id, ...rest }: ResearchRunDto) {
    await this.runs.replaceOne({ _id: id }, rest);
  }

  async getRun(investigationId: string, runId: string) {
    const doc = await this.runs.findOne({ _id: runId, investigationId });
    return doc ? runFromDoc(doc) : null;
  }

  async listRuns(investigationId: string) {
    return (await this.runs.find({ investigationId }).sort({ startedAt: -1 }).toArray()).map(runFromDoc);
  }

  async activeRun(investigationId: string) {
    const doc = await this.runs.findOne({ investigationId, status: { $in: ['queued', 'running'] } });
    return doc ? runFromDoc(doc) : null;
  }

  async failStaleRuns(reason: string) {
    const res = await this.runs.updateMany(
      { status: { $in: ['queued', 'running'] } },
      { $set: { status: 'failed', completedAt: nowIso(), error: { code: 'run_interrupted', message: reason } } },
    );
    return res.modifiedCount;
  }
}

// ---- in memory ----------------------------------------------------------------

export class MemoryInvestigationStore implements InvestigationStore {
  private records = new Map<string, InvestigationRecord>();
  private runs = new Map<string, ResearchRunDto>();
  private messages: ChatMessageDto[] = [];

  async addMessage(message: ChatMessageDto) {
    this.messages.push(structuredClone(message));
  }

  async listMessages(investigationId: string, { limit, cursor }: { limit: number; cursor?: string }) {
    const c = cursor ? decodeCursor(cursor) : null;
    const older = this.messages
      .filter((m) => m.investigationId === investigationId)
      .filter((m) => !c || m.createdAt < c.u || (m.createdAt === c.u && m.id < c.i))
      .sort((a, b) => (a.createdAt === b.createdAt ? b.id.localeCompare(a.id) : b.createdAt.localeCompare(a.createdAt)));
    const page = older.slice(0, limit).map((m) => structuredClone(m));
    const oldest = page.at(-1);
    return { items: page.reverse(), ...(older.length > limit && oldest && { nextCursor: encodeMessageCursor(oldest) }) };
  }

  async create(record: InvestigationRecord) {
    this.records.set(record.id, structuredClone(record));
  }

  async get(id: string) {
    const r = this.records.get(id);
    return r ? structuredClone(r) : null;
  }

  async rename(id: string, title: string) {
    const r = this.records.get(id);
    if (!r) throw new Error(`Investigation "${id}" not found.`);
    r.title = title;
    r.updatedAt = nowIso();
  }

  async listPublic({ limit, cursor }: { limit: number; cursor?: string }): Promise<ListPage> {
    const c = cursor ? decodeCursor(cursor) : null;
    const all = [...this.records.values()]
      .filter((r) => r.visibility === 'public' && r.status === 'active')
      .filter((r) => !c || r.updatedAt < c.u || (r.updatedAt === c.u && r.id < c.i))
      .sort(newer);
    const items = all.slice(0, limit).map((r) => structuredClone({ ...r, events: [] }));
    return { items, ...(all.length > limit && { nextCursor: encodeCursor(items.at(-1)!) }) };
  }

  private mutate(id: string, fn: (r: InvestigationRecord) => void): number {
    const r = this.records.get(id);
    if (!r) throw new Error(`Investigation "${id}" not found.`);
    fn(r);
    r.revision += 1;
    r.updatedAt = nowIso();
    return r.revision;
  }

  private event(r: InvestigationRecord, eventId: string) {
    const e = r.events.find((x) => x.id === eventId);
    if (!e) throw new Error(`Event "${eventId}" not found.`);
    return e;
  }

  async addEvent(id: string, event: InvestigationEventDto) {
    return this.mutate(id, (r) => r.events.push(structuredClone(event)));
  }

  async addEvidence(id: string, eventId: string, evidence: InvestigationEvidenceDto) {
    return this.mutate(id, (r) => this.event(r, eventId).evidence.push(structuredClone(evidence)));
  }

  async setEventSummary(id: string, eventId: string, summary: string) {
    return this.mutate(id, (r) => {
      this.event(r, eventId).summary = summary;
    });
  }

  async createRun(run: ResearchRunDto) {
    this.runs.set(run.id, structuredClone(run));
  }

  async updateRun(run: ResearchRunDto) {
    this.runs.set(run.id, structuredClone(run));
  }

  async getRun(investigationId: string, runId: string) {
    const r = this.runs.get(runId);
    return r && r.investigationId === investigationId ? structuredClone(r) : null;
  }

  async listRuns(investigationId: string) {
    return [...this.runs.values()]
      .filter((r) => r.investigationId === investigationId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .map((r) => structuredClone(r));
  }

  async activeRun(investigationId: string) {
    const r = [...this.runs.values()].find((x) => x.investigationId === investigationId && isActive(x));
    return r ? structuredClone(r) : null;
  }

  async failStaleRuns(reason: string) {
    let n = 0;
    for (const r of this.runs.values()) {
      if (!isActive(r)) continue;
      Object.assign(r, { status: 'failed', completedAt: nowIso(), error: { code: 'run_interrupted', message: reason } });
      n += 1;
    }
    return n;
  }
}
