/**
 * Source vetting: combine the two independent signals into one verdict (principle 3: abstain).
 *
 *   domain listing  (ratings.ts)  — free, instant, attributed to the listing organisations
 *   content rhetoric (rhetoric.ts) — page text screened by the LLM with verified quotes
 *
 * Rules:
 * - manipulative: the domain is a DOCUMENTED covert influence operation (e.g. Meta CIB,
 *   VIGINUM, Citizen Lab lists), or the page's own text shows grounded propaganda rhetoric.
 * - credible: at least one positive signal (reliable listing and/or no clear propaganda
 *   evidence in the text) AND no caution signal.
 * - uncertain: everything else, including caution-only listings (state-affiliated media,
 *   low-credibility ratings, satire), failed scrapes and inconclusive analyses.
 * Missing or failed checks only lower `coverage`; they never count as risky or safe.
 */
import type { RhetoricAnalysisDto, SourceRatingDto, SourceVettingDto } from '../investigations/types.js';
import type { JsonLlm } from '../proof/agents.js';
import { type Scraper, toPlainText } from '../proof/articles.js';
import { analyzeRhetoric } from './rhetoric.js';
import { listNames, lookupRating } from './ratings.js';

const TECHNIQUE_LABEL: Record<string, string> = {
  loaded_language: 'loaded language',
  fear_or_prejudice: 'appeals to fear or prejudice',
  name_calling: 'name calling',
  false_dilemma: 'false dilemma',
  causal_oversimplification: 'causal oversimplification',
  whataboutism: 'whataboutism',
  straw_man: 'straw man',
  repetition: 'repetition',
  exaggeration_or_minimisation: 'exaggeration or minimisation',
  appeal_to_popularity: 'appeal to popularity',
  appeal_to_authority: 'appeal to authority',
  flag_waving: 'flag waving',
  slogans: 'slogans',
  doubt: 'casting doubt without evidence',
  dehumanization: 'dehumanising language',
  smears: 'smears',
  other: 'other techniques',
};

function ratingReason(r: SourceRatingDto): string {
  const lists = listNames(r);
  switch (r.kind) {
    case 'influence_operation':
      return `Domain ${r.domain} is listed as part of a documented influence operation${r.actorCountry ? ` (attributed to ${r.actorCountry})` : ''} by ${lists}.`;
    case 'state_media':
      return `Domain ${r.domain} is listed as state-affiliated media${r.actorCountry ? ` (${r.actorCountry})` : ''} by ${lists}; treat its claims as that state's position.`;
    case 'unreliable':
      return `Domain ${r.domain} is rated low credibility by ${lists}${r.subtypes.length ? ` (${r.subtypes.join(', ').replace(/_/g, ' ')})` : ''}. Such ratings are contested; check claims independently.`;
    case 'satire':
      return `Domain ${r.domain} is listed as satire by ${lists}.`;
    case 'reliable':
      return `Domain ${r.domain} is rated reliable by ${lists}${r.qualityScore !== undefined ? ` (quality score ${r.qualityScore.toFixed(2)})` : ''}.`;
  }
}

function rhetoricReason(a: RhetoricAnalysisDto): string {
  if (a.verdict === 'likely_propaganda') {
    const kinds = [...new Set(a.techniques.filter((t) => t.voice === 'author').map((t) => TECHNIQUE_LABEL[t.technique] ?? t.technique))];
    return `The page's own text uses propaganda techniques (${kinds.slice(0, 4).join(', ')}) in ${a.techniques.filter((t) => t.voice === 'author').length} verified passages.`;
  }
  if (a.verdict === 'no_clear_evidence') return 'No clear propaganda pattern was found in the page text (this does not certify accuracy).';
  return `Content screening was inconclusive${a.warnings.length ? `: ${a.warnings[0]}` : '.'}`;
}

export function combineVetting(url: string, rating: SourceRatingDto | undefined, rhetoric: RhetoricAnalysisDto | undefined, error?: string, now = new Date()): SourceVettingDto {
  const reasons: string[] = [];
  if (rating) reasons.push(ratingReason(rating));
  if (rhetoric) reasons.push(rhetoricReason(rhetoric));
  if (error) reasons.push(`Page text could not be analysed: ${error}`);
  if (!rating && !rhetoric && !error) reasons.push('Domain is not on any list used here; page text not analysed yet.');

  const caution = rating && ['state_media', 'unreliable', 'satire'].includes(rating.kind);
  const manipulative = rating?.kind === 'influence_operation' || rhetoric?.verdict === 'likely_propaganda';
  const positive = rating?.kind === 'reliable' || rhetoric?.verdict === 'no_clear_evidence';
  const verdict: SourceVettingDto['verdict'] = manipulative ? 'manipulative' : positive && !caution ? 'credible' : 'uncertain';
  // Two checks: domain listing (counts when the domain is listed) and content (counts when it produced a verdict).
  const coverage = ((rating ? 1 : 0) + (rhetoric && rhetoric.verdict !== 'uncertain' ? 1 : 0)) / 2;

  return {
    url,
    verdict,
    coverage,
    reasons,
    ...(rating && { rating }),
    ...(rhetoric && { rhetoric }),
    depth: rhetoric || error ? 'content' : 'domain',
    checkedAt: now.toISOString(),
    ...(error && { error }),
  };
}

/** Free, instant vetting from the domain listing only (undefined when the domain is not listed). */
export function domainVetting(url: string): SourceVettingDto | undefined {
  const rating = lookupRating(url);
  return rating ? combineVetting(url, rating, undefined) : undefined;
}

export interface VetDeps {
  scrape: Scraper;
  json: JsonLlm;
}

/** Full vetting: domain listing + scraped page text screened for propaganda rhetoric. */
export async function vetUrl(url: string, deps: VetDeps, title = ''): Promise<SourceVettingDto> {
  const rating = lookupRating(url);
  const page = await deps.scrape(url).catch((err) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }));
  if (!page.ok) return combineVetting(url, rating, undefined, page.error);
  try {
    const rhetoric = await analyzeRhetoric(toPlainText(page.markdown), title, deps.json);
    return combineVetting(url, rating, rhetoric);
  } catch (err) {
    return combineVetting(url, rating, undefined, err instanceof Error ? err.message.slice(0, 200) : 'Analysis failed.');
  }
}
