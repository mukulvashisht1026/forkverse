import type { SpineNode } from '../types/tree';
import type {
  CreateInvestigationRequestDto,
  ExtendInvestigationRequestDto,
  InvestigationDto,
  InvestigationGraphDto,
} from '../../../contracts/investigations';

/** View model consumed by Home and Workspace; isolated from wire DTOs. */
export interface Investigation {
  id: string;
  title: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface InvestigationGraph {
  investigationId: string;
  nodes: SpineNode[];
}

export type CreateInvestigationInput = CreateInvestigationRequestDto;
export type InvestigationRepository = Pick<InvestigationApi,
  'listPublicInvestigations' | 'getInvestigation' | 'getInvestigationGraph' | 'createInvestigation' | 'extendInvestigation'>;

/** Decoupled frontend data boundary. No endpoint paths assumed here. */
export interface InvestigationApi {
  listPublicInvestigations(): Promise<Investigation[]>;
  getInvestigation(id: string): Promise<Investigation>;
  getInvestigationGraph(id: string): Promise<InvestigationGraph>;
  createInvestigation(input: CreateInvestigationInput): Promise<Investigation>;
  extendInvestigation(id: string, input: CreateInvestigationInput): Promise<InvestigationGraph>;
}

export class CapabilityUnavailableError extends Error {
  constructor(capability: string) {
    super(`${capability} is not available from the current backend.`);
    this.name = 'CapabilityUnavailableError';
  }
}

export function mapInvestigationDto(dto: InvestigationDto): Investigation {
  return { id: dto.id, title: dto.title, description: dto.description, createdAt: dto.createdAt, updatedAt: dto.updatedAt };
}

/** Deliberately not mapped yet: transport event/evidence model needs agreed graph adapter. */
export function mapInvestigationGraphDto(dto: InvestigationGraphDto): InvestigationGraph {
  void dto;
  throw new CapabilityUnavailableError('Investigation event/evidence to Canvas graph mapping');
}

/** Stub adapter: current service exposes global in-memory timeline only, never investigations. */
export const investigationRepository: InvestigationApi = {
  async listPublicInvestigations(): Promise<Investigation[]> {
    throw new CapabilityUnavailableError('Public investigation library');
  },
  async getInvestigation(id: string): Promise<Investigation> {
    void id;
    throw new CapabilityUnavailableError('Investigation retrieval by ID');
  },
  async getInvestigationGraph(id: string): Promise<InvestigationGraph> {
    void id;
    throw new CapabilityUnavailableError('Investigation-scoped graph retrieval');
  },
  async createInvestigation(input: CreateInvestigationRequestDto): Promise<Investigation> {
    void input;
    throw new CapabilityUnavailableError('Persistent investigation creation');
  },
  async extendInvestigation(id: string, input: ExtendInvestigationRequestDto): Promise<InvestigationGraph> {
    void id;
    void input;
    throw new CapabilityUnavailableError('Investigation-scoped research extension');
  },
};
