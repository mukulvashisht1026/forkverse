/**
 * Newspaper edition: the investigation's claim timeline written up as a front page.
 *
 * Selection is deterministic (claims/evidence in the graph); the editor model only WRITES:
 * kicker, headline, standfirst and lead paragraphs, each paragraph citing the claim labels it is
 * written from (C1..). Uncited or unknown-label paragraphs are dropped; if the model fails or
 * returns nothing usable, a fallback edition is composed straight from the claim statements.
 *
 * Principles: neutral wording ("followed", "was later contradicted by"; "caused" only when a
 * source states it), unverified claims are labelled as such, manipulative (red-flagged) sources
 * never appear as stories, images or sources: they are listed only in the propaganda watch box.
 */
import { z } from 'zod';
import type {
  ClaimDto,
  InvestigationEvidenceDto,
  InvestigationRecord,
  NewspaperEditionDto,
  NewspaperSourceDto,
  NewspaperStoryDto,
} from '../investigations/types.js';
import type { JsonLlm } from '../proof/agents.js';
import { logger } from '../utils/logger.js';

const STORIES = 3;
const BRIEFS = 3;
const TIMELINE = 8;

export interface EditionDeps {
  json: JsonLlm;
  /** Lead image of a page (og:image), for evidence without an image from the search result. */
  pageImage?: (url: string) => Promise<string | undefined>;
  now?: () => Date;
}

const isManipulative = (e?: InvestigationEvidenceDto) => e?.vetting?.verdict === 'manipulative';
const isFlagged = (e: InvestigationEvidenceDto) => (e.vetting?.propagandaScore !== undefined ? e.vetting.propagandaScore > 60 : isManipulative(e));

/** Changes whenever the edition's inputs change (claims rebuilt, sources added, screening). */
export function editionStateKey(r: InvestigationRecord): string {
  const evidence = r.events.flatMap((e) => e.evidence);
  return [r.claimsUpdatedAt ?? 'none', r.claims?.length ?? 0, evidence.length, evidence.filter(isFlagged).length].join('|');
}

const host = (url?: string) => {
  try {
    return new URL(url ?? '').hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

const statusOf = (c: ClaimDto): NewspaperStoryDto['status'] => (c.disputed ? 'disputed' : c.status);
const outlets = (c: ClaimDto) => new Set(c.evidence.map((e) => (e.publisher ?? host(e.url)).toLowerCase())).size;
const time = (iso?: string) => (iso ? Date.parse(iso) || 0 : 0);

/** Lead = newest established claim with the widest sourcing; then stories, then briefs. */
export function pickClaims(claims: ClaimDto[]): { lead?: ClaimDto; stories: ClaimDto[]; briefs: ClaimDto[] } {
  const ranked = [...claims].sort(
    (a, b) =>
      Number(b.status === 'established') - Number(a.status === 'established') ||
      time(b.occurredAt) - time(a.occurredAt) ||
      outlets(b) - outlets(a),
  );
  const [lead, ...rest] = ranked;
  const stories = rest.filter((c) => c.status === 'established').slice(0, STORIES);
  const remaining = rest.filter((c) => !stories.includes(c));
  // Fill story slots with the best remaining claims if there are few established ones.
  while (stories.length < STORIES && remaining.length) stories.push(remaining.shift()!);
  const briefs = remaining.sort((a, b) => time(b.occurredAt) - time(a.occurredAt)).slice(0, BRIEFS);
  return { ...(lead && { lead }), stories, briefs };
}

function sourcesOf(c: ClaimDto, byId: Map<string, InvestigationEvidenceDto>): NewspaperSourceDto[] {
  const seen = new Set<string>();
  return c.evidence
    .filter((e) => e.url && !isManipulative(byId.get(e.evidenceId)) && !seen.has(e.url) && seen.add(e.url))
    .slice(0, 4)
    .map((e) => ({ title: e.title, url: e.url!, ...(e.publisher && { publisher: e.publisher }), ...(e.publishedAt && { publishedAt: e.publishedAt }) }));
}

// ---- editor model -------------------------------------------------------------------------------

/** A paragraph object, or a plain string citing labels inline ("... [C1][C3]"). */
const Para = z.union([
  z.object({ text: z.string(), claims: z.array(z.string()).default([]) }),
  z.string().transform((text) => ({ text: text.replace(/\s*\[(C\d+)\]/g, '').trim(), claims: [...text.matchAll(/\b(C\d+)\b/g)].map((m) => m[1]!) })),
]);
const Item = z.object({ ref: z.string(), kicker: z.string().default(''), headline: z.string(), dek: z.string().default('') });
export const EditorOutput = z.object({
  crux: z.string().default(''),
  lead: z.object({ kicker: z.string().default(''), headline: z.string(), dek: z.string().default(''), paragraphs: z.array(Para).default([]) }),
  stories: z.array(Item).default([]),
  briefs: z.array(Item).default([]),
});
export type EditorOutputT = z.infer<typeof EditorOutput>;

export const EDITOR_PROMPT = `You are the front-page editor of a neutral, evidence-first newspaper. You write ONLY from the claims supplied (C1..),
which come from a verified claim graph. Never add facts, numbers, names, quotes or context that are not in the supplied text.
Rules:
- Neutral, factual tone. No opinion, no intent or motive, no predictions, no advice.
- Never say one development caused another unless a claim says so; use "followed", "came after", "was later contradicted by".
- Claims with status "pending" are UNVERIFIED: say "reportedly" / "according to <outlet>" and never present them as fact.
- Disputed claims: say that sources disagree.
- Headlines: max 80 characters, newspaper style, no clickbait, no question marks. Kicker: 2-4 words (topic / section).
- "crux": ONE sentence (max 30 words) summarising the story so far.
- Lead story: kicker, headline, dek (one sentence, max 160 characters) and "paragraphs": REQUIRED, 2-4 short paragraphs
  (2-3 sentences each) telling the story from the lead claim and related claims. Every paragraph lists the claim labels it
  is written from in "claims", e.g. {"text":"Envoys met again on Tuesday, according to two outlets.","claims":["C1"]}.
- stories / briefs: one item per supplied ref with kicker, headline and a one-sentence dek.
Return JSON only:
{"crux":"...","lead":{"kicker":"...","headline":"...","dek":"...","paragraphs":[{"text":"...","claims":["C1"]}]},
 "stories":[{"ref":"C2","kicker":"...","headline":"...","dek":"..."}],"briefs":[{"ref":"C5","kicker":"...","headline":"...","dek":"..."}]}`;

function describeClaim(label: string, c: ClaimDto): string {
  const ev = c.evidence
    .slice(0, 3)
    .map((e) => `   - ${e.publisher ?? host(e.url)}${e.publishedAt ? ` (${e.publishedAt.slice(0, 10)})` : ''}: ${e.summary ? `${e.summary} ` : ''}"${e.quote}"`)
    .join('\n');
  return `${label} | status: ${c.status}${c.disputed ? ', disputed' : ''} | ${c.occurredAt?.slice(0, 10) ?? 'undated'} | ${outlets(c)} outlet(s)\n   Claim: ${c.statement}\n${ev}`;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const sentence = (s: string) => s.replace(/\s+/g, ' ').trim();

// ---- build ----------------------------------------------------------------------------------------

export async function buildEdition(record: InvestigationRecord, deps: EditionDeps): Promise<NewspaperEditionDto> {
  const now = deps.now?.() ?? new Date();
  const evidence = record.events.flatMap((e) => e.evidence);
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const claims = record.claims ?? [];
  const picked = pickClaims(claims);
  const flagged = evidence.filter(isFlagged);
  const usedImages = new Set<string>();

  /** First usable image among a claim's (or article's) non-manipulative sources. */
  const imageFor = async (ids: string[]): Promise<{ imageUrl: string; imageCredit: string } | undefined> => {
    const candidates = ids.map((id) => byId.get(id)).filter((e): e is InvestigationEvidenceDto => Boolean(e?.sourceUrl) && !isManipulative(e));
    for (const e of candidates) {
      if (e.imageUrl && !usedImages.has(e.imageUrl)) {
        usedImages.add(e.imageUrl);
        return { imageUrl: e.imageUrl, imageCredit: e.sourceName ?? host(e.sourceUrl) };
      }
    }
    for (const e of candidates.slice(0, 2)) {
      const img = await deps.pageImage?.(e.sourceUrl!).catch(() => undefined);
      if (img && !usedImages.has(img)) {
        usedImages.add(img);
        return { imageUrl: img, imageCredit: e.sourceName ?? host(e.sourceUrl) };
      }
    }
    return undefined;
  };

  const base = {
    investigationId: record.id,
    stateKey: editionStateKey(record),
    title: record.title,
    ...(record.entity && { entity: record.entity }),
    editionDate: now.toISOString(),
    editionNumber: Math.max(1, record.events.length),
    timeline: [...claims]
      .filter((c) => c.occurredAt)
      .sort((a, b) => time(a.occurredAt) - time(b.occurredAt))
      .slice(-TIMELINE)
      .map((c) => ({ ...(c.occurredAt && { date: c.occurredAt }), text: c.statement, status: statusOf(c)! })),
    stats: {
      sources: evidence.filter((e) => e.sourceUrl).length,
      established: claims.filter((c) => c.status === 'established').length,
      unverified: claims.filter((c) => c.status !== 'established').length,
      flagged: flagged.length,
    },
    propagandaWatch: flagged.slice(0, 5).map((e) => ({ title: e.title, ...(e.sourceName && { publisher: e.sourceName }), ...(e.vetting?.propagandaScore !== undefined && { score: e.vetting.propagandaScore }) })),
    generatedAt: now.toISOString(),
  };

  // No claims yet: an edition from the newest (non-manipulative) articles.
  if (!picked.lead) {
    const articles = evidence.filter((e) => e.sourceUrl && !isManipulative(e)).sort((a, b) => time(b.publishedAt) - time(a.publishedAt));
    const toStory = async (e: InvestigationEvidenceDto, kicker: string): Promise<NewspaperStoryDto> => ({
      kicker,
      headline: clip(e.title, 110),
      dek: clip(sentence(e.excerpt ?? ''), 220),
      paragraphs: e.excerpt ? [sentence(e.excerpt)] : [],
      ...((await imageFor([e.id])) ?? {}),
      sources: [{ title: e.title, url: e.sourceUrl!, ...(e.sourceName && { publisher: e.sourceName }), ...(e.publishedAt && { publishedAt: e.publishedAt }) }],
      ...(e.publishedAt && { date: e.publishedAt }),
    });
    const [first, ...rest] = articles;
    return {
      ...base,
      crux: first ? `Coverage of ${record.title} is still being collected; claims will appear once they are verified.` : `No coverage of ${record.title} has been collected yet.`,
      lead: first ? await toStory(first, 'Latest coverage') : { kicker: 'Awaiting coverage', headline: record.title, dek: 'Research is in progress.', paragraphs: [], sources: [] },
      stories: await Promise.all(rest.slice(0, STORIES).map((e) => toStory(e, e.sourceName ?? host(e.sourceUrl)))),
      briefs: await Promise.all(rest.slice(STORIES, STORIES + BRIEFS).map((e) => toStory(e, 'In brief'))),
      writer: 'fallback',
    };
  }

  // Labels for the model: C1 = lead, then stories, then briefs.
  const ordered = [picked.lead, ...picked.stories, ...picked.briefs];
  const label = new Map(ordered.map((c, i) => [c.id, `C${i + 1}`]));
  const byLabel = new Map(ordered.map((c, i) => [`C${i + 1}`, c]));

  let out: EditorOutputT | null = null;
  try {
    out = await deps.json(EditorOutput, [
      { role: 'system', content: EDITOR_PROMPT },
      {
        role: 'user',
        content:
          `Topic: ${record.title}${record.entity ? ` (entity: ${record.entity})` : ''}\n` +
          `Lead: C1. Stories: ${picked.stories.map((c) => label.get(c.id)).join(', ') || 'none'}. Briefs: ${picked.briefs.map((c) => label.get(c.id)).join(', ') || 'none'}.\n\n` +
          ordered.map((c) => describeClaim(label.get(c.id)!, c)).join('\n\n'),
      },
    ]);
  } catch (err) {
    logger.warn({ err, investigationId: record.id }, 'newspaper editor failed; using fallback edition');
  }

  const kickerFor = (c: ClaimDto, k?: string) => {
    const base = clip(sentence(k || (c.kind === 'statement' ? 'Statement' : c.kind === 'position' ? 'Position' : 'Development')), 40);
    return c.status === 'established' ? (c.disputed ? `${base} · Disputed` : base) : `Unverified · ${base}`;
  };
  const story = async (c: ClaimDto, written?: { kicker?: string; headline?: string; dek?: string }, paragraphs: string[] = []): Promise<NewspaperStoryDto> => ({
    claimId: c.id,
    kicker: kickerFor(c, written?.kicker),
    headline: clip(sentence(written?.headline || c.statement), 110),
    dek: clip(sentence(written?.dek || c.evidence.find((e) => e.summary)?.summary || c.statusReason), 240),
    paragraphs,
    ...(statusOf(c) && { status: statusOf(c) }),
    ...((await imageFor(c.evidence.map((e) => e.evidenceId))) ?? {}),
    sources: sourcesOf(c, byId),
    ...(c.occurredAt && { date: c.occurredAt }),
  });

  // Lead paragraphs: only those citing known claim labels.
  const leadParagraphs = (out?.lead.paragraphs ?? [])
    .filter((p) => p.text.trim() && p.claims.length && p.claims.every((l) => byLabel.has(l.trim())))
    .map((p) => sentence(p.text))
    .slice(0, 4);
  const fallbackParagraphs = [
    picked.lead.statement,
    ...picked.lead.evidence.filter((e) => e.summary).slice(0, 2).map((e) => `${e.publisher ?? host(e.url)} reports: ${e.summary}`),
    picked.lead.statusReason,
  ].map(sentence);
  const itemFor = (list: EditorOutputT['stories'], c: ClaimDto) => list.find((x) => x.ref.trim() === label.get(c.id));

  return {
    ...base,
    crux: clip(sentence(out?.crux || `${picked.lead.statement}`), 260),
    lead: await story(picked.lead, out?.lead, leadParagraphs.length ? leadParagraphs : fallbackParagraphs),
    stories: await Promise.all(picked.stories.map((c) => story(c, itemFor(out?.stories ?? [], c)))),
    briefs: await Promise.all(picked.briefs.map((c) => story(c, itemFor(out?.briefs ?? [], c)))),
    writer: out ? 'llm' : 'fallback',
  };
}
