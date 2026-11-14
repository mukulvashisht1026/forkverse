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

/** Decorate only IDs absent from a prior accepted snapshot; an initial load is always static. */
export function animateGraphAdditions(previous: SpineNode[] | null, current: SpineNode[]): SpineNode[] {
  const additions = previous ? findGraphAdditions(previous, current) : { events: [], evidence: [] };
  const newEventIds = new Set(additions.events.map((item) => item.id));
  const newEvidenceIds = new Set(additions.evidence.map((item) => item.id));
  const oldEvents = new Map((previous ?? []).map((event) => [event.id, event]));

  return current.map((event) => {
    const oldEvent = oldEvents.get(event.id);
    const oldEvidence = new Map((oldEvent?.branches ?? []).map((branch) => [branch.id, branch]));
    return {
      ...event,
      _animateGrowth: oldEvent ? Boolean(oldEvent._animateGrowth) : newEventIds.has(event.id),
      branches: event.branches.map((branch) => {
        const existing = oldEvidence.get(branch.id);
        const isNew = existing ? Boolean(existing._animateGrowth) : newEvidenceIds.has(branch.id);
        return { ...branch, _animateGrowth: isNew, _prog: isNew ? existing?._prog ?? 0 : 1 };
      }),
    };
  });
}
