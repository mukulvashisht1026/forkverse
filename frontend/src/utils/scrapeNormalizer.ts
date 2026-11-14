import type {
  BranchNode,
  BranchSourceType,
  ScrapeEngine,
  SpineNode,
  StockDirection,
  StockImpactItem,
} from '../types/tree';

export interface ScrapeValidationResult {
  valid: boolean;
  error?: string;
  query: string;
  targetUrl?: string;
}

export function validateScrapeRequest(input: {
  query?: string;
  url?: string;
}): ScrapeValidationResult {
  const query = (input.query ?? '').trim();
  const rawUrl = (input.url ?? '').trim();

  if (!query && !rawUrl) {
    return {
      valid: false,
      error: 'Enter a declaration, topic, or URL to scrape live.',
      query: '',
    };
  }

  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return {
          valid: false,
          error: 'Target URL must start with http:// or https://.',
          query,
        };
      }
      return {
        valid: true,
        query: query || parsed.hostname.replace(/^www\./, ''),
        targetUrl: parsed.toString(),
      };
    } catch {
      return {
        valid: false,
        error: 'Enter a valid URL (e.g. https://x.com/... or https://reuters.com/...).',
        query,
      };
    }
  }

  if (query.length < 3) {
    return {
      valid: false,
      error: 'Query must be at least 3 characters.',
      query,
    };
  }

  return { valid: true, query };
}

export function validateManualNodeInput(input: {
  name?: string;
  info?: string;
}): { valid: boolean; error?: string; name: string; info: string } {
  const name = (input.name ?? '').trim();
  const info = (input.info ?? '').trim();
  if (!name) {
    return {
      valid: false,
      error: 'Please provide a node title.',
      name: '',
      info,
    };
  }
  return { valid: true, name, info };
}

export function validatePromptInput(rawPrompt?: string): {
  valid: boolean;
  error?: string;
  prompt: string;
  extractedUrl?: string;
} {
  const prompt = (rawPrompt ?? '').trim();
  if (prompt.length < 3) {
    return {
      valid: false,
      error: 'Enter at least 3 characters to send a prompt to the backend.',
      prompt,
    };
  }
  const urlMatch = prompt.match(/https?:\/\/[^\s)>\]"']+/i);
  let extractedUrl: string | undefined;
  if (urlMatch) {
    try {
      extractedUrl = new URL(urlMatch[0]).toString();
    } catch {
      extractedUrl = undefined;
    }
  }
  return { valid: true, prompt, extractedUrl };
}

export function buildContextSearchQueries(topic: string): {
  socialAndNewsQuery: string;
  marketImpactQuery: string;
  publicAppealQuery: string;
} {
  const clean = topic.trim();
  return {
    socialAndNewsQuery: `${clean} X post twitter declaration news reaction`,
    marketImpactQuery: `${clean} stock market impact S&P 500 stocks shares reaction`,
    publicAppealQuery: `${clean} public reaction polling approval sentiment opinion`,
  };
}

export function classifySourceType(url?: string, title?: string): BranchSourceType {
  const text = `${url ?? ''} ${title ?? ''}`.toLowerCase();
  if (
    text.includes('x.com') ||
    text.includes('twitter.com') ||
    text.includes('reddit.com') ||
    text.includes('truthsocial') ||
    text.includes('threads.net')
  ) {
    return 'social';
  }
  if (
    text.includes('bloomberg') ||
    text.includes('wsj.com') ||
    text.includes('cnbc') ||
    text.includes('marketwatch') ||
    text.includes('yahoo') ||
    text.includes('finance') ||
    text.includes('stock') ||
    text.includes('nasdaq') ||
    text.includes('barrons')
  ) {
    return 'market';
  }
  if (
    text.includes('.gov') ||
    text.includes('whitehouse') ||
    text.includes('congress') ||
    text.includes('federalreserve') ||
    text.includes('sec.gov') ||
    text.includes('tariff') ||
    text.includes('policy')
  ) {
    return 'policy';
  }
  return 'news';
}

export function extractDomain(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

export function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 2147483647 || 1337;
}

export function normalizePercentages(
  pos: number,
  neu: number,
  neg: number
): { positivePct: number; neutralPct: number; negativePct: number } {
  const p = Math.max(0, Number.isFinite(pos) ? pos : 0);
  const u = Math.max(0, Number.isFinite(neu) ? neu : 0);
  const n = Math.max(0, Number.isFinite(neg) ? neg : 0);
  const sum = p + u + n;
  if (sum <= 0) {
    return { positivePct: 34, neutralPct: 33, negativePct: 33 };
  }
  const positivePct = Math.round((p / sum) * 100);
  const neutralPct = Math.round((u / sum) * 100);
  const negativePct = Math.max(0, 100 - positivePct - neutralPct);
  return { positivePct, neutralPct, negativePct };
}

function sanitizeDirection(dir: unknown): StockDirection {
  if (dir === 'up' || dir === 'down' || dir === 'mixed') return dir;
  return 'mixed';
}

export interface RawScrapedBranchInput {
  name?: string;
  info?: string;
  url?: string;
  sourceType?: BranchSourceType;
  publishedAt?: string;
  impactAngle?: string;
}

export interface RawScrapedNodePayload {
  name: string;
  declaration: string;
  info: string;
  platform?: string;
  timestamp?: string;
  sourceUrl?: string;
  stockSummary?: string;
  tickers?: Array<{
    ticker?: string;
    company?: string;
    change?: string;
    direction?: string;
    note?: string;
  }>;
  sentimentLabel?: string;
  positivePct?: number;
  neutralPct?: number;
  negativePct?: number;
  publicNarrative?: string;
  scrapeEngine: ScrapeEngine;
  branches: RawScrapedBranchInput[];
}

function truncateAtWord(text: string, maxLen: number): string {
  const clean = text.trim();
  if (clean.length <= maxLen) return clean;
  const sliced = clean.slice(0, maxLen);
  const lastSpace = sliced.lastIndexOf(' ');
  if (lastSpace > Math.floor(maxLen * 0.5)) {
    return sliced.slice(0, lastSpace).trim();
  }
  return sliced.trim();
}

export function normalizeScrapedNode(raw: RawScrapedNodePayload): SpineNode {
  const cleanTitle = truncateAtWord(raw.name, 38) || 'Live Signal';
  const split = normalizePercentages(
    raw.positivePct ?? 35,
    raw.neutralPct ?? 25,
    raw.negativePct ?? 40
  );

  const tickers: StockImpactItem[] = (raw.tickers ?? [])
    .slice(0, 4)
    .map((t) => ({
      ticker: (t.ticker ?? 'SPY').toUpperCase().slice(0, 10),
      company: (t.company ?? 'Broad Market').slice(0, 40),
      change: (t.change ?? 'Volatile').slice(0, 18),
      direction: sanitizeDirection(t.direction),
      note: (t.note ?? '').slice(0, 90),
    }));

  const branches: BranchNode[] = raw.branches.slice(0, 7).map((b, idx) => {
    const domain = extractDomain(b.url);
    const labelBase = (b.name ?? domain ?? `Source ${idx + 1}`).trim();
    const shortName =
      labelBase.length > 34 ? `${labelBase.slice(0, 32)}…` : labelBase;
    const sourceType = b.sourceType ?? classifySourceType(b.url, b.name);
    const growthSide =
      sourceType === 'social' || sourceType === 'manual'
        ? 'bottom'
        : idx % 2 === 1
          ? 'bottom'
          : 'top';
    return {
      id: `br-${hashSeed(`${cleanTitle}-${idx}-${b.url ?? labelBase}`)}`,
      name: shortName,
      info: (b.info ?? 'Scraped supporting evidence.').trim().slice(0, 320),
      sourceType,
      growthSide,
      sourceDomain: domain,
      sourceUrl: b.url,
      publishedAt: b.publishedAt,
      impactAngle: b.impactAngle,
      seed: hashSeed(`${cleanTitle}-${b.url ?? labelBase}-${idx}`),
      _prog: 0,
    };
  });

  return {
    id: `node-${hashSeed(`${cleanTitle}-${Date.now()}`)}`,
    name: cleanTitle,
    declaration: raw.declaration.trim() || cleanTitle,
    info: raw.info.trim() || 'Live scraped web and social impact summary.',
    platform: raw.platform?.trim() || 'Live Web & X',
    timestamp: raw.timestamp?.trim() || 'Live scrape',
    sourceUrl: raw.sourceUrl,
    stockImpact: {
      summary:
        raw.stockSummary?.trim() ||
        'Equity sector rotation and volatility tracked across scraped financial coverage.',
      tickers,
    },
    publicAppeal: {
      sentimentLabel: raw.sentimentLabel?.trim() || 'Polarized Response',
      ...split,
      narrative:
        raw.publicNarrative?.trim() ||
        'Public reaction splits along economic and policy alignment across social threads.',
    },
    scrapeEngine: raw.scrapeEngine,
    branches,
  };
}
