import { normalizeForMatch } from './text.js';

/**
 * Principle 1: a quote is valid only if it is a substring of the fetched source text
 * after whitespace and case normalization. Empty quotes never verify.
 */
export function verifyQuote(quote: string | null | undefined, sourceText: string | null | undefined): boolean {
  if (!quote || !sourceText) return false;
  const q = normalizeForMatch(quote);
  if (q.length === 0) return false;
  return normalizeForMatch(sourceText).includes(q);
}

/** Keep only items whose quote verifies; returns kept and discarded for logging. */
export function filterVerified<T extends { quote: string }>(
  items: T[],
  sourceText: string,
): { kept: T[]; discarded: T[] } {
  const kept: T[] = [];
  const discarded: T[] = [];
  for (const item of items) (verifyQuote(item.quote, sourceText) ? kept : discarded).push(item);
  return { kept, discarded };
}
