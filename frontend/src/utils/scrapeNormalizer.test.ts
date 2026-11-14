import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildContextSearchQueries,
  classifySourceType,
  normalizePercentages,
  normalizeScrapedNode,
  validateManualNodeInput,
  validatePromptInput,
  validateScrapeRequest,
} from './scrapeNormalizer';

test('validateScrapeRequest rejects empty input and invalid URLs', () => {
  assert.equal(validateScrapeRequest({ query: '   ', url: '' }).valid, false);
  assert.equal(validateScrapeRequest({ query: 'ab' }).valid, false);
  assert.equal(
    validateScrapeRequest({ url: 'ftp://example.com/post' }).valid,
    false
  );
  assert.equal(validateScrapeRequest({ url: 'not-a-url' }).valid, false);

  const validQuery = validateScrapeRequest({ query: 'Trump tariffs X post' });
  assert.equal(validQuery.valid, true);
  assert.equal(validQuery.query, 'Trump tariffs X post');

  const validUrl = validateScrapeRequest({ url: 'https://x.com/example/status/1' });
  assert.equal(validUrl.valid, true);
  assert.equal(validUrl.targetUrl, 'https://x.com/example/status/1');
});

test('validateManualNodeInput requires non-empty title', () => {
  assert.equal(validateManualNodeInput({ name: '   ' }).valid, false);
  const ok = validateManualNodeInput({
    name: 'Treasury Yields',
    info: '10Y jumped 8bps',
  });
  assert.equal(ok.valid, true);
  assert.equal(ok.name, 'Treasury Yields');
  assert.equal(ok.info, '10Y jumped 8bps');
});

test('buildContextSearchQueries creates social, market, and public appeal queries', () => {
  const queries = buildContextSearchQueries('Trump 25% auto tariffs');
  assert.ok(queries.socialAndNewsQuery.includes('X post'));
  assert.ok(queries.marketImpactQuery.includes('stock market'));
  assert.ok(queries.publicAppealQuery.includes('public reaction'));
});

test('classifySourceType distinguishes social, market, policy, and news', () => {
  assert.equal(classifySourceType('https://x.com/user/status/123'), 'social');
  assert.equal(classifySourceType('https://www.bloomberg.com/news'), 'market');
  assert.equal(classifySourceType('https://www.whitehouse.gov/briefing'), 'policy');
  assert.equal(classifySourceType('https://www.reuters.com/world/'), 'news');
});

test('normalizePercentages always sums to 100', () => {
  const split = normalizePercentages(50, 25, 25);
  assert.equal(split.positivePct + split.neutralPct + split.negativePct, 100);

  const fallback = normalizePercentages(0, 0, 0);
  assert.equal(
    fallback.positivePct + fallback.neutralPct + fallback.negativePct,
    100
  );
});

test('normalizeScrapedNode produces valid SpineNode with branches and deterministic seeds', () => {
  const node = normalizeScrapedNode({
    name: 'Trump X · Chip Tariff Warning',
    declaration: 'Post warning of semiconductor import duties.',
    info: 'Chipmakers dipped while domestic foundries rallied.',
    stockSummary: 'SOXX slipped 2.1% intraday.',
    tickers: [
      { ticker: 'nvda', company: 'NVIDIA', change: '-2.4%', direction: 'down', note: 'Export pressure' },
      { ticker: 'intc', company: 'Intel', change: '+3.0%', direction: 'up', note: 'US fab tailwind' },
    ],
    positivePct: 40,
    neutralPct: 20,
    negativePct: 40,
    scrapeEngine: 'context.dev',
    branches: [
      {
        name: 'Reuters · Semiconductor Impact',
        info: 'Chip equipment makers fell in afternoon trading.',
        url: 'https://www.reuters.com/technology/',
      },
      {
        name: 'X · Trader Reactions',
        info: 'High volume debate across semiconductor analysts.',
        url: 'https://x.com/search?q=semiconductors',
      },
    ],
  });

  assert.equal(node.scrapeEngine, 'context.dev');
  assert.equal(node.stockImpact.tickers[0].ticker, 'NVDA');
  assert.equal(node.branches.length, 2);
  assert.equal(node.branches[0].sourceType, 'news');
  assert.equal(node.branches[1].sourceType, 'social');
  assert.equal(node.branches[0]._prog, 0);

  const longTitled = normalizeScrapedNode({
    name: 'NVIDIA Export Curbs & Leadership Crisis Response',
    declaration: 'Test',
    info: 'Test',
    scrapeEngine: 'context.dev',
    branches: [],
  });
  assert.ok(longTitled.name.length <= 38);
  assert.ok(!longTitled.name.endsWith('Crisi'));
});

test('validatePromptInput validates prompt length and extracts inline URLs', () => {
  assert.equal(validatePromptInput('  ').valid, false);
  assert.equal(validatePromptInput('hi').valid, false);

  const plain = validatePromptInput('Track Trump X tariff post market reaction');
  assert.equal(plain.valid, true);
  assert.equal(plain.extractedUrl, undefined);

  const withUrl = validatePromptInput(
    'Analyze this post https://x.com/example/status/123 for stock impact'
  );
  assert.equal(withUrl.valid, true);
  assert.equal(withUrl.extractedUrl, 'https://x.com/example/status/123');
});
