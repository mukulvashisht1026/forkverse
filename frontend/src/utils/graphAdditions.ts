import type { SpineNode } from '../types/tree';

export interface GraphAdditions { events: { id: string; title: string }[]; evidence: { id: string; title: string; eventId: string }[] }

export function isNewerGraphRevision(previous: number, next: number): boolean { return next > previous; }

/** Detects only stable event/evidence IDs absent from the previously accepted graph snapshot. */
export function findGraphAdditions(previous: SpineNode[], current: SpineNode[]): GraphAdditions {
  const knownEvents = new Set(previous.map((event) => event.id));
  const knownEvidence = new Set(previous.flatMap((event) => event.branches.map((item) => item.id)));
  return {
    events: current.filter((event) => !knownEvents.has(event.id)).map(({ id, name }) => ({ id, title: name })),
    evidence: current.flatMap((event) => event.branches
      .filter((item) => !knownEvidence.has(item.id))
      .map(({ id, name }) => ({ id, title: name, eventId: event.id }))),
  };
}
