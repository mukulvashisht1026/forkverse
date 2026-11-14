import type { SpineNode } from '../types/tree';
import { investigationEventsToSpineNodes } from './investigationGraphAdapter';

const API_BASE = import.meta.env?.VITE_API_BASE_URL ?? '';

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `Backend request failed (${response.status})`);
  return data;
}
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

/** Map backend investigation graph into canvas model. */
export function mapInvestigationGraphDto(dto: InvestigationGraphDto): InvestigationGraph {
  return { investigationId: dto.investigationId, nodes: investigationEventsToSpineNodes(dto.events) };
}

export const investigationRepository: InvestigationApi = {
  async listPublicInvestigations(): Promise<Investigation[]> {
    const response = await apiJson<{ nodes: SpineNode[] }>('/api/timeline');
    return response.nodes.map((node) => ({ id: node.id, title: node.name, description: node.info, createdAt: node.timestamp }));
  },
  async getInvestigation(id: string): Promise<Investigation> {
    const response = await apiJson<{ nodes: SpineNode[] }>('/api/timeline');
    const node = response.nodes.find((item) => item.id === id);
    if (!node) throw new Error('Investigation not found.');
    return { id: node.id, title: node.name, description: node.info, createdAt: node.timestamp };
  },
  async getInvestigationGraph(id: string): Promise<InvestigationGraph> {
    const response = await apiJson<{ nodes: SpineNode[] }>('/api/timeline');
    const node = response.nodes.find((item) => item.id === id);
    if (!node) throw new Error('Investigation not found.');
    return { investigationId: id, nodes: [node] };
  },
  async createInvestigation(_input: CreateInvestigationRequestDto): Promise<Investigation> {
    throw new Error('Use live scrape flow to create investigations.');
  },
  async extendInvestigation(_id: string, _input: ExtendInvestigationRequestDto): Promise<InvestigationGraph> {
    throw new Error('Use live research prompt flow to extend investigations.');
  },
};
