export interface OpenNodeCard { eventId: string; evidenceId?: string }
export type OpenNodeCards = Map<string, OpenNodeCard>;

export function nodeCardId(card: OpenNodeCard): string {
  return card.evidenceId ? `evidence:${card.evidenceId}` : `event:${card.eventId}`;
}

export function openNodeCard(cards: OpenNodeCards, card: OpenNodeCard): OpenNodeCards {
  const id = nodeCardId(card);
  const existing = cards.get(id);
  if (existing?.eventId === card.eventId && existing.evidenceId === card.evidenceId) return cards;
  return new Map(cards).set(id, card);
}

export function closeNodeCard(cards: OpenNodeCards, id: string): OpenNodeCards {
  if (!cards.has(id)) return cards;
  const next = new Map(cards);
  next.delete(id);
  return next;
}

export function keepExistingNodeCards(cards: OpenNodeCards, eventIds: ReadonlySet<string>, evidenceIds: ReadonlySet<string>): OpenNodeCards {
  const next = new Map([...cards].filter(([, card]) => eventIds.has(card.eventId) && (!card.evidenceId || evidenceIds.has(card.evidenceId))));
  return next.size === cards.size ? cards : next;
}
