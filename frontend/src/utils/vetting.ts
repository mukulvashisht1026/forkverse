/**
 * Propaganda flag rule for the UI. Mirrors backend/src/investigations/types.ts
 * (PROPAGANDA_FLAG_THRESHOLD, isManipulativeVetting); kept here because the frontend Docker build
 * only sees frontend/, so ../contracts may be imported for types only.
 */
export const PROPAGANDA_FLAG_THRESHOLD = 74;

/** A documented influence operation or a verified finding scored above the threshold. */
export function isManipulativeVetting(v?: { verdict: string; propagandaScore?: number }): boolean {
  return v?.verdict === 'manipulative' && (v.propagandaScore === undefined || v.propagandaScore > PROPAGANDA_FLAG_THRESHOLD);
}
