/**
 * Domain listings: is this source's domain named by public research / government lists of
 * influence operations, state media, unreliable or reliable outlets?
 * Data: backend/data/source-ratings.json, built by scripts/build-source-ratings.mjs from the
 * labelled dataset (provenance + licences in backend/data/SOURCE_RATINGS.md).
 *
 * A listing is an ATTRIBUTED fact ("listed by Meta CIB reports as ..."), never our own judgement
 * of the publisher. Unlisted domains have no rating (no signal either way).
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { SourceRatingDto } from '../investigations/types.js';
import { logger } from '../utils/logger.js';

/** [label, confidence, actor_country, subtypes, sources, lin_pc1, name] */
type Row = [string, string, string, string, string, number | null, string];

let table: Map<string, Row> | null = null;

/** Works from src/ (tsx, vitest) and from dist/src/ (compiled image). */
const CANDIDATES = ['../../data/source-ratings.json', '../../../data/source-ratings.json'];

function load(): Map<string, Row> {
  if (table) return table;
  for (const rel of CANDIDATES) {
    const file = fileURLToPath(new URL(rel, import.meta.url));
    if (!existsSync(file)) continue;
    try {
      const json = JSON.parse(readFileSync(file, 'utf8')) as { domains: Record<string, Row> };
      table = new Map(Object.entries(json.domains));
      return table;
    } catch (err) {
      logger.error({ err, file }, 'source ratings could not be loaded');
    }
  }
  logger.warn('source ratings file not found: domain listings disabled');
  table = new Map();
  return table;
}

/** Replace the table (tests). */
export function setRatingsForTest(rows: Record<string, Row> | null): void {
  table = rows ? new Map(Object.entries(rows)) : null;
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** Human names for list ids (shown in reasons). */
export const LIST_NAMES: Record<string, string> = {
  meta_cib: 'Meta coordinated inauthentic behaviour reports',
  viginum_rrn_doppelganger: 'VIGINUM (RRN / Doppelganger)',
  viginum_portal_kombat: 'VIGINUM (Portal Kombat)',
  checkfirst_pravda: 'Check First (Pravda network)',
  citizenlab_paperwall: 'Citizen Lab (PAPERWALL)',
  mandiant_haienergy: 'Mandiant (HaiEnergy)',
  curated_state_designations: 'official state-media designations / sanctions',
  heppell2023_rrn: 'Heppell et al. 2023',
  heppell2023_waronfakes: 'Heppell et al. 2023',
  iffy_mbfc: 'Iffy+ (MBFC low credibility)',
  opensources: 'OpenSources (2017)',
  lin2023: 'Lin et al. 2023 domain-quality ratings',
};

function kindOf(label: string, subtypes: string[]): SourceRatingDto['kind'] {
  if (label === 'propaganda') return subtypes.includes('state_media_propaganda') && !subtypes.includes('state_influence_op') ? 'state_media' : 'influence_operation';
  if (label === 'unreliable') return 'unreliable';
  if (label === 'satire') return 'satire';
  return 'reliable';
}

/** Listing for the URL's host, or for its closest listed parent domain (news.example.com -> example.com). */
export function lookupRating(url: string): SourceRatingDto | undefined {
  const host = hostOf(url);
  if (!host) return undefined;
  const rows = load();
  const parts = host.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const domain = parts.slice(i).join('.');
    const row = rows.get(domain);
    if (!row) continue;
    const [label, confidence, country, subtypes, sources, pc1, name] = row;
    const subs = subtypes ? subtypes.split('|').filter(Boolean) : [];
    return {
      domain,
      label: label as SourceRatingDto['label'],
      kind: kindOf(label, subs),
      confidence: (['high', 'medium', 'low'].includes(confidence) ? confidence : 'low') as SourceRatingDto['confidence'],
      ...(country && { actorCountry: country }),
      subtypes: subs,
      listedBy: sources ? sources.split('|').filter(Boolean) : [],
      ...(typeof pc1 === 'number' && { qualityScore: pc1 }),
      ...(name && { name }),
    };
  }
  return undefined;
}

export function listNames(rating: SourceRatingDto): string {
  return [...new Set(rating.listedBy.map((s) => LIST_NAMES[s] ?? s))].join('; ');
}
