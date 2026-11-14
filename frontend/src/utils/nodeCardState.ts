export interface OpenNodeCard { eventId: string; evidenceId?: string }
export type ActiveNodeCard = OpenNodeCard | null;

export function nodeCardId(card: OpenNodeCard): string {
  return card.evidenceId ? `evidence:${card.evidenceId}` : `event:${card.eventId}`;
}

/** Preserve graph-item clicks so the click handler can replace the card without an outside-close race. */
export function shouldDismissNodeCardPointer(isInsideCard: boolean, isGraphItem: boolean): boolean {
  return !isInsideCard && !isGraphItem;
}

export function openNodeCard(active: ActiveNodeCard, card: OpenNodeCard): ActiveNodeCard {
  if (active && nodeCardId(active) === nodeCardId(card) && active.eventId === card.eventId) return active;
  return card;
}

export function closeNodeCard(active: ActiveNodeCard, id: string): ActiveNodeCard {
  return active && nodeCardId(active) === id ? null : active;
}

export function keepExistingNodeCard(active: ActiveNodeCard, eventIds: ReadonlySet<string>, evidenceIds: ReadonlySet<string>): ActiveNodeCard {
  return active && (!eventIds.has(active.eventId) || (active.evidenceId && !evidenceIds.has(active.evidenceId))) ? null : active;
}
