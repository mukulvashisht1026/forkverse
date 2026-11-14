import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type {
  BranchNode,
  ScrapeEngine,
  ScrapeProviderPreference,
  SpineNode,
} from '../types/tree.ts';
import {
  buildContextSearchQueries,
  classifySourceType,
  extractDomain,
  hashSeed,
  normalizeScrapedNode,
  type RawScrapedBranchInput,
} from '../utils/scrapeNormalizer.ts';

const CONTEXT_API_BASE = 'https://api.context.dev/v1';
const EXA_API_BASE = 'https://api.exa.ai';

export class ScrapeServiceError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}

interface ContextSearchResult {
  title?: string;
  url?: string;
  snippet?: string;
  description?: string;
  content?: string;
  markdown?: string;
  publishedDate?: string;
}

interface ContextAnswersResponse {
  json_content?: Record<string, unknown>;
  answer?: string;
  sources?: Array<{ title?: string; url?: string; snippet?: string }>;
  citations?: Array<{ title?: string; url?: string }>;
}

interface ExaSearchItem {
  id?: string;
  title?: string;
  url?: string;
  publishedDate?: string;
  author?: string;
  text?: string;
  highlights?: string[];
  summary?: string;
}

interface ExaSearchResponse {
  results?: ExaSearchItem[];
}

interface ExaAnswerResponse {
  answer?: string;
  citations?: Array<{ title?: string; url?: string; text?: string }>;
}

async function jsonPost<T>(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  label: string
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 22000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let parsed: unknown = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text };
    }
    if (!res.ok) {
      const errObj = parsed as { message?: string; error?: string };
      throw new ScrapeServiceError(
        errObj.message || errObj.error || `${label} API error (${res.status})`,
        res.status
      );
    }
    return parsed as T;
  } finally {
    clearTimeout(timer);
  }
}

async function contextPost<T>(
  path: string,
  body: Record<string, unknown>,
  apiKey: string
): Promise<T> {
  return jsonPost<T>(
    `${CONTEXT_API_BASE}${path}`,
    { Authorization: `Bearer ${apiKey}` },
    body,
    'Context.dev'
  );
}

async function exaPost<T>(
  path: string,
  body: Record<string, unknown>,
  apiKey: string
): Promise<T> {
  return jsonPost<T>(
    `${EXA_API_BASE}${path}`,
    { 'x-api-key': apiKey },
    body,
    'Exa'
  );
}

function getGeminiClient(): GoogleGenAI | null {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key || key === 'MY_GEMINI_API_KEY') return null;
  return new GoogleGenAI({
    apiKey: key,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function getContextApiKey(): string | null {
  const key = (
    process.env.CONTEXT_DEV_API_KEY ||
    process.env.CONTEXT_API_KEY ||
    ''
  ).trim();
  if (!key || key === 'MY_CONTEXT_DEV_API_KEY') return null;
  return key;
}

function getExaApiKey(): string | null {
  const key = (process.env.EXA_API_KEY || '').trim();
  if (!key || key === 'MY_EXA_API_KEY') return null;
  return key;
}

function extractSearchItems(payload: unknown): ContextSearchResult[] {
  if (!payload || typeof payload !== 'object') return [];
  const obj = payload as Record<string, unknown>;
  const candidates = obj.results ?? obj.data ?? obj.items ?? obj.web;
  if (Array.isArray(candidates)) {
    return candidates as ContextSearchResult[];
  }
  return [];
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new ScrapeServiceError(
            `${label} timed out after ${Math.round(ms / 1000)}s.`,
            504
          )
        ),
      ms
    );
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

async function structureImpactWithGemini(
  topic: string,
  evidenceText: string
): Promise<Record<string, unknown> | null> {
  const ai = getGeminiClient();
  if (!ai) return null;

  const response = await withTimeout(
    ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Analyze this live scraped web and social media evidence about "${topic}".
Return structured impact intelligence summarizing the declaration/event, stock & market impacts (specific real tickers mentioned or directly affected sectors), and public appeal / sentiment split.

Evidence:
${evidenceText.slice(0, 14000)}`,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            shortTitle: { type: Type.STRING },
            declaration: { type: Type.STRING },
            summary: { type: Type.STRING },
            platform: { type: Type.STRING },
            stockSummary: { type: Type.STRING },
            tickers: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  ticker: { type: Type.STRING },
                  company: { type: Type.STRING },
                  change: { type: Type.STRING },
                  direction: { type: Type.STRING },
                  note: { type: Type.STRING },
                },
              },
            },
            sentimentLabel: { type: Type.STRING },
            positivePct: { type: Type.NUMBER },
            neutralPct: { type: Type.NUMBER },
            negativePct: { type: Type.NUMBER },
            publicNarrative: { type: Type.STRING },
          },
        },
      },
    }),
    20000,
    'Impact structuring'
  );

  try {
    return JSON.parse((response.text ?? '{}').trim()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function scrapeEventWithExa(input: {
  query: string;
  targetUrl?: string;
  apiKey: string;
}): Promise<{ node: SpineNode; engine: ScrapeEngine }> {
  const queries = buildContextSearchQueries(input.query);

  const tasks: Array<Promise<unknown>> = [
    exaPost<ExaSearchResponse>(
      '/search',
      {
        query: queries.socialAndNewsQuery,
        type: 'auto',
        numResults: 5,
        contents: {
          highlights: { numSentences: 2 },
          text: { maxCharacters: 1200 },
        },
      },
      input.apiKey
    ),
    exaPost<ExaSearchResponse>(
      '/search',
      {
        query: queries.marketImpactQuery,
        type: 'auto',
        numResults: 4,
        contents: {
          highlights: { numSentences: 2 },
          text: { maxCharacters: 1200 },
        },
      },
      input.apiKey
    ),
    exaPost<ExaAnswerResponse>(
      '/answer',
      {
        query: `Analyze "${input.query}". What was the core declaration/event, what specific stocks and sectors moved, and what is the public appeal and sentiment reaction?`,
        text: true,
      },
      input.apiKey
    ).catch(() => null),
  ];

  if (input.targetUrl) {
    tasks.push(
      exaPost<ExaSearchResponse>(
        '/contents',
        {
          urls: [input.targetUrl],
          text: { maxCharacters: 2400 },
          highlights: { numSentences: 3 },
        },
        input.apiKey
      ).catch(() => null)
    );
  }

  const [socialRes, marketRes, answerRes, contentsRes] = await Promise.all(tasks);

  const branches: RawScrapedBranchInput[] = [];
  const seen = new Set<string>();

  if (contentsRes && typeof contentsRes === 'object' && input.targetUrl) {
    const items = (contentsRes as ExaSearchResponse).results ?? [];
    for (const item of items) {
      const url = item.url || input.targetUrl;
      const body = (item.highlights?.join(' ') || item.text || '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!body) continue;
      seen.add(url);
      branches.push({
        name:
          item.title?.slice(0, 32) ||
          `${extractDomain(url) ?? 'Target'} · Direct`,
        info: body.slice(0, 260),
        url,
        sourceType: classifySourceType(url, item.title),
        impactAngle: 'Exa Primary Contents',
      });
    }
  }

  const combinedResults = [
    ...((socialRes as ExaSearchResponse | null)?.results ?? []),
    ...((marketRes as ExaSearchResponse | null)?.results ?? []),
  ];

  for (const item of combinedResults) {
    const url = item.url?.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const domain = extractDomain(url);
    const body = (
      item.highlights?.join(' ') ||
      item.summary ||
      item.text ||
      ''
    )
      .replace(/\s+/g, ' ')
      .trim();
    const sType = classifySourceType(url, item.title);
    branches.push({
      name: item.title
        ? `${domain ? domain.split('.')[0] + ' · ' : ''}${item.title}`
        : domain || 'Exa Source',
      info: body.slice(0, 260) || `Neural search result from ${domain || url}.`,
      url,
      sourceType: sType,
      publishedAt: item.publishedDate,
      impactAngle:
        sType === 'market'
          ? 'Stock & Market Impact'
          : sType === 'social'
            ? 'Social & Public Pulse'
            : sType === 'policy'
              ? 'Policy Ripple'
              : 'News Corroboration',
    });
    if (branches.length >= 6) break;
  }

  const exaAnswerText = (answerRes as ExaAnswerResponse | null)?.answer ?? '';
  const combinedEvidence = [
    exaAnswerText ? `Exa Synthesis:\n${exaAnswerText}` : '',
    ...branches.map((b) => `[${b.name}] (${b.url ?? ''}): ${b.info}`),
  ]
    .filter(Boolean)
    .join('\n\n');

  const structured = await structureImpactWithGemini(
    input.query,
    combinedEvidence || input.query
  );

  const node = normalizeScrapedNode({
    name: String(structured?.shortTitle || input.query),
    declaration: String(
      structured?.declaration || exaAnswerText.slice(0, 240) || input.query
    ),
    info: String(
      structured?.summary ||
        branches[0]?.info ||
        `Live Exa neural search for "${input.query}".`
    ),
    platform: String(
      structured?.platform ||
        (input.targetUrl ? extractDomain(input.targetUrl) : 'Exa Web & Social')
    ),
    sourceUrl: input.targetUrl || branches[0]?.url,
    stockSummary: String(
      structured?.stockSummary ||
        'Market reaction synthesized from Exa financial and news search.'
    ),
    tickers: Array.isArray(structured?.tickers)
      ? (structured.tickers as Array<Record<string, string>>)
      : [],
    sentimentLabel: String(structured?.sentimentLabel || 'Live Exa Pulse'),
    positivePct: Number(structured?.positivePct ?? 36),
    neutralPct: Number(structured?.neutralPct ?? 28),
    negativePct: Number(structured?.negativePct ?? 36),
    publicNarrative: String(
      structured?.publicNarrative ||
        'Public reaction gathered across Exa web and social results.'
    ),
    scrapeEngine: 'exa',
    branches,
  });

  return { node, engine: 'exa' };
}

async function scrapeEventWithContextDev(input: {
  query: string;
  targetUrl?: string;
  apiKey: string;
}): Promise<{ node: SpineNode; engine: ScrapeEngine }> {
  const queries = buildContextSearchQueries(input.query);
  const tasks: Array<Promise<unknown>> = [
    contextPost<unknown>(
      '/web/search',
      {
        query: queries.socialAndNewsQuery,
        numResults: 5,
        includePageContent: true,
      },
      input.apiKey
    ),
    contextPost<unknown>(
      '/web/search',
      {
        query: queries.marketImpactQuery,
        numResults: 4,
        includePageContent: true,
      },
      input.apiKey
    ),
    contextPost<ContextAnswersResponse>(
      '/web/answers',
      {
        mode: 'fast',
        task: `Analyze "${input.query}"${input.targetUrl ? ` (focus URL: ${input.targetUrl})` : ''}. Summarize the main declaration/event, its impact on specific stocks/sectors, and public appeal/sentiment.`,
        json_format: {
          shortTitle: '',
          declaration: '',
          summary: '',
          platform: '',
          stockSummary: '',
          tickers: [
            {
              ticker: '',
              company: '',
              change: '',
              direction: 'mixed',
              note: '',
            },
          ],
          sentimentLabel: '',
          positivePct: 0,
          neutralPct: 0,
          negativePct: 0,
          publicNarrative: '',
        },
      },
      input.apiKey
    ).catch(() => null),
  ];

  if (input.targetUrl) {
    tasks.push(
      contextPost<{
        markdown?: string;
        title?: string;
        metadata?: Record<string, string>;
      }>(
        '/web/scrape',
        {
          url: input.targetUrl,
          formats: { markdown: true },
          mainContentOnly: true,
        },
        input.apiKey
      ).catch(() => null)
    );
  }

  const [socialRes, marketRes, answersRes, directScrapeRes] =
    await Promise.all(tasks);

  const socialItems = extractSearchItems(socialRes);
  const marketItems = extractSearchItems(marketRes);
  const allItems = [...socialItems, ...marketItems];

  const branches: RawScrapedBranchInput[] = [];
  const seen = new Set<string>();

  if (directScrapeRes && typeof directScrapeRes === 'object' && input.targetUrl) {
    const scraped = directScrapeRes as {
      markdown?: string;
      title?: string;
    };
    const text = (scraped.markdown ?? '').replace(/\s+/g, ' ').trim();
    if (text) {
      seen.add(input.targetUrl);
      branches.push({
        name:
          scraped.title?.slice(0, 32) ||
          `${extractDomain(input.targetUrl) ?? 'Target'} · Direct`,
        info: text.slice(0, 260),
        url: input.targetUrl,
        sourceType: classifySourceType(input.targetUrl, scraped.title),
        impactAngle: 'Primary Source Scrape',
      });
    }
  }

  for (const item of allItems) {
    const url = item.url?.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const domain = extractDomain(url);
    const body = (
      item.snippet ||
      item.description ||
      item.content ||
      item.markdown ||
      ''
    )
      .replace(/\s+/g, ' ')
      .trim();
    const sType = classifySourceType(url, item.title);
    branches.push({
      name: item.title
        ? `${domain ? domain.split('.')[0] + ' · ' : ''}${item.title}`
        : domain || 'Web Evidence',
      info: body.slice(0, 260) || `Live scraped content from ${domain || url}.`,
      url,
      sourceType: sType,
      publishedAt: item.publishedDate,
      impactAngle:
        sType === 'market'
          ? 'Stock & Market Impact'
          : sType === 'social'
            ? 'Social & Public Pulse'
            : sType === 'policy'
              ? 'Policy Ripple'
              : 'News Corroboration',
    });
    if (branches.length >= 6) break;
  }

  const answersObj =
    (answersRes as ContextAnswersResponse | null)?.json_content ?? null;
  let structured = answersObj;

  if (!structured || !structured.stockSummary) {
    const combinedEvidence = branches
      .map((b) => `[${b.name}] (${b.url ?? ''}): ${b.info}`)
      .join('\n');
    const geminiFallback = await structureImpactWithGemini(
      input.query,
      combinedEvidence || input.query
    );
    if (geminiFallback) {
      structured = { ...geminiFallback, ...(structured ?? {}) };
    }
  }

  const node = normalizeScrapedNode({
    name: String(structured?.shortTitle || input.query),
    declaration: String(structured?.declaration || input.query),
    info: String(
      structured?.summary ||
        branches[0]?.info ||
        `Live Context.dev scrape for "${input.query}".`
    ),
    platform: String(
      structured?.platform ||
        (input.targetUrl ? extractDomain(input.targetUrl) : 'Web & Social (X)')
    ),
    sourceUrl: input.targetUrl || branches[0]?.url,
    stockSummary: String(
      structured?.stockSummary ||
        'Market reaction extracted from live Context.dev financial search results.'
    ),
    tickers: Array.isArray(structured?.tickers)
      ? (structured.tickers as Array<Record<string, string>>)
      : [],
    sentimentLabel: String(structured?.sentimentLabel || 'Live Public Pulse'),
    positivePct: Number(structured?.positivePct ?? 36),
    neutralPct: Number(structured?.neutralPct ?? 28),
    negativePct: Number(structured?.negativePct ?? 36),
    publicNarrative: String(
      structured?.publicNarrative ||
        'Public reception compiled from scraped news and social threads.'
    ),
    scrapeEngine: 'context.dev',
    branches,
  });

  return { node, engine: 'context.dev' };
}

async function fallbackLiveSearchWithGemini(
  topic: string,
  targetUrl?: string
): Promise<{ node: SpineNode; notice: string }> {
  const ai = getGeminiClient();
  if (!ai) {
    throw new ScrapeServiceError(
      'Neither EXA_API_KEY nor CONTEXT_DEV_API_KEY is configured in Secrets. Add your API key to scrape live.',
      503
    );
  }

  const prompt = targetUrl
    ? `Research the event or page at ${targetUrl} (topic: ${topic}). Search recent news, X/social discussions, stock market reactions, and public appeal.`
    : `Research "${topic}" across recent news, X/social media declarations, stock market reaction, and public sentiment.`;

  const grounded = await withTimeout(
    ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `${prompt}
Provide a thorough, factual summary covering:
1. The core declaration or event and platform.
2. Specific stock tickers, sectors, and market reactions.
3. Public appeal, approval/sentiment reaction, and social debate.`,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        tools: [{ googleSearch: {} }],
      },
    }),
    22000,
    'Live search grounding'
  );

  const summaryText = grounded.text ?? topic;
  const chunks =
    grounded.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];

  const branches: RawScrapedBranchInput[] = [];
  const seenUrls = new Set<string>();
  for (const chunk of chunks) {
    const uri = chunk.web?.uri;
    const title = chunk.web?.title;
    if (!uri || seenUrls.has(uri)) continue;
    seenUrls.add(uri);
    branches.push({
      name: title || extractDomain(uri) || 'Web Source',
      info: `Live grounded source supporting "${topic}" impact analysis.`,
      url: uri,
      sourceType: classifySourceType(uri, title),
      impactAngle:
        classifySourceType(uri, title) === 'market'
          ? 'Market Reaction'
          : classifySourceType(uri, title) === 'social'
            ? 'Social Discourse'
            : 'Web Coverage',
    });
    if (branches.length >= 6) break;
  }

  const structured = await structureImpactWithGemini(topic, summaryText);

  const node = normalizeScrapedNode({
    name: String(structured?.shortTitle || topic),
    declaration: String(structured?.declaration || topic),
    info: String(structured?.summary || summaryText.slice(0, 260)),
    platform: String(structured?.platform || 'Live Web Search'),
    sourceUrl: targetUrl || branches[0]?.url,
    stockSummary: String(
      structured?.stockSummary ||
        'Market impact synthesized from live search coverage.'
    ),
    tickers: Array.isArray(structured?.tickers)
      ? (structured.tickers as Array<Record<string, string>>)
      : [],
    sentimentLabel: String(structured?.sentimentLabel || 'Mixed Sentiment'),
    positivePct: Number(structured?.positivePct ?? 38),
    neutralPct: Number(structured?.neutralPct ?? 24),
    negativePct: Number(structured?.negativePct ?? 38),
    publicNarrative: String(
      structured?.publicNarrative ||
        'Public sentiment gathered across news and social commentary.'
    ),
    scrapeEngine: 'gemini-search',
    branches:
      branches.length > 0
        ? branches
        : [
            {
              name: `${topic.slice(0, 22)} · Overview`,
              info: summaryText.slice(0, 240),
              sourceType: 'news',
            },
          ],
  });

  return {
    node,
    notice:
      'EXA_API_KEY and CONTEXT_DEV_API_KEY are not set in Secrets yet — mapped via live Google Search grounding. Add EXA_API_KEY or CONTEXT_DEV_API_KEY in Secrets to route directly.',
  };
}

export async function scrapeEventLive(input: {
  query: string;
  targetUrl?: string;
  provider?: ScrapeProviderPreference;
}): Promise<{ node: SpineNode; engine: ScrapeEngine; notice?: string }> {
  const exaKey = getExaApiKey();
  const contextKey = getContextApiKey();
  const pref = input.provider ?? 'auto';

  if (pref === 'exa') {
    if (!exaKey) {
      throw new ScrapeServiceError(
        'EXA_API_KEY is not configured in Secrets. Add EXA_API_KEY or switch provider to Auto.',
        503
      );
    }
    return scrapeEventWithExa({
      query: input.query,
      targetUrl: input.targetUrl,
      apiKey: exaKey,
    });
  }

  if (pref === 'context.dev') {
    if (!contextKey) {
      throw new ScrapeServiceError(
        'CONTEXT_DEV_API_KEY is not configured in Secrets. Add CONTEXT_DEV_API_KEY or switch provider to Auto.',
        503
      );
    }
    return scrapeEventWithContextDev({
      query: input.query,
      targetUrl: input.targetUrl,
      apiKey: contextKey,
    });
  }

  if (exaKey) {
    return scrapeEventWithExa({
      query: input.query,
      targetUrl: input.targetUrl,
      apiKey: exaKey,
    });
  }

  if (contextKey) {
    return scrapeEventWithContextDev({
      query: input.query,
      targetUrl: input.targetUrl,
      apiKey: contextKey,
    });
  }

  const fallback = await fallbackLiveSearchWithGemini(
    input.query,
    input.targetUrl
  );
  return {
    node: fallback.node,
    engine: 'gemini-search',
    notice: fallback.notice,
  };
}

export async function scrapeSupportBranches(input: {
  topic: string;
  query: string;
  existingCount: number;
  provider?: ScrapeProviderPreference;
}): Promise<{ branches: BranchNode[]; engine: ScrapeEngine; notice?: string }> {
  const exaKey = getExaApiKey();
  const contextKey = getContextApiKey();
  const pref = input.provider ?? 'auto';

  const useExa = pref === 'exa' || (pref === 'auto' && Boolean(exaKey));
  const useContext =
    pref === 'context.dev' || (pref === 'auto' && !useExa && Boolean(contextKey));

  if (pref === 'exa' && !exaKey) {
    throw new ScrapeServiceError(
      'EXA_API_KEY is not configured in Secrets. Add EXA_API_KEY or switch provider to Auto.',
      503
    );
  }
  if (pref === 'context.dev' && !contextKey) {
    throw new ScrapeServiceError(
      'CONTEXT_DEV_API_KEY is not configured in Secrets. Add CONTEXT_DEV_API_KEY or switch provider to Auto.',
      503
    );
  }

  if (useExa && exaKey) {
    const res = await exaPost<ExaSearchResponse>(
      '/search',
      {
        query: `${input.topic} ${input.query}`,
        type: 'auto',
        numResults: 4,
        contents: {
          highlights: { numSentences: 2 },
          text: { maxCharacters: 1000 },
        },
      },
      exaKey
    );
    const items = res.results ?? [];
    const branches: BranchNode[] = items.slice(0, 4).map((item, idx) => {
      const url = item.url?.trim();
      const domain = extractDomain(url);
      const body = (item.highlights?.join(' ') || item.text || '')
        .replace(/\s+/g, ' ')
        .trim();
      const rawName = item.title || domain || `Exa Support ${idx + 1}`;
      const sourceType = classifySourceType(url, item.title);
      return {
        id: `br-exa-${hashSeed(`${input.query}-${url ?? rawName}-${idx}`)}`,
        name: rawName.length > 34 ? `${rawName.slice(0, 32)}…` : rawName,
        info: body.slice(0, 260) || `Scraped via Exa from ${domain || url}`,
        sourceType,
        growthSide:
          sourceType === 'social' || idx % 2 === 1 ? 'bottom' : 'top',
        sourceDomain: domain,
        sourceUrl: url,
        publishedAt: item.publishedDate,
        impactAngle: 'Exa Agent Search',
        seed: hashSeed(
          `${input.topic}-${url ?? rawName}-${input.existingCount + idx}`
        ),
        _prog: 0,
      };
    });
    return { branches, engine: 'exa' };
  }

  if (useContext && contextKey) {
    const res = await contextPost<unknown>(
      '/web/search',
      {
        query: `${input.topic} ${input.query}`,
        numResults: 4,
        includePageContent: true,
      },
      contextKey
    );

    const items = extractSearchItems(res);
    const branches: BranchNode[] = items.slice(0, 4).map((item, idx) => {
      const url = item.url?.trim();
      const domain = extractDomain(url);
      const body = (
        item.snippet ||
        item.description ||
        item.content ||
        item.markdown ||
        ''
      )
        .replace(/\s+/g, ' ')
        .trim();
      const rawName = item.title || domain || `Support ${idx + 1}`;
      const sourceType = classifySourceType(url, item.title);
      return {
        id: `br-live-${hashSeed(`${input.query}-${url ?? rawName}-${idx}`)}`,
        name: rawName.length > 34 ? `${rawName.slice(0, 32)}…` : rawName,
        info: body.slice(0, 260) || `Scraped from ${domain || url}`,
        sourceType,
        growthSide:
          sourceType === 'social' || idx % 2 === 1 ? 'bottom' : 'top',
        sourceDomain: domain,
        sourceUrl: url,
        publishedAt: item.publishedDate,
        impactAngle: 'Context.dev Live Scrape',
        seed: hashSeed(
          `${input.topic}-${url ?? rawName}-${input.existingCount + idx}`
        ),
        _prog: 0,
      };
    });

    return { branches, engine: 'context.dev' };
  }

  const fallback = await fallbackLiveSearchWithGemini(
    `${input.topic} ${input.query}`
  );
  return {
    branches: fallback.node.branches.slice(0, 4).map((b, idx) => ({
      ...b,
      growthSide:
        b.sourceType === 'social' || idx % 2 === 1 ? 'bottom' : 'top',
      seed: hashSeed(
        `${input.topic}-${input.query}-${input.existingCount + idx}`
      ),
      _prog: 0,
    })),
    engine: 'gemini-search',
    notice: fallback.notice,
  };
}

export function getScrapeStatus(): {
  exaConfigured: boolean;
  contextDevConfigured: boolean;
  geminiFallbackAvailable: boolean;
} {
  return {
    exaConfigured: Boolean(getExaApiKey()),
    contextDevConfigured: Boolean(getContextApiKey()),
    geminiFallbackAvailable: Boolean(getGeminiClient()),
  };
}
