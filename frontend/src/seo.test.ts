import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const origin = 'https://forkversewebqb1xft.z1.web.core.windows.net/';

test('homepage ships crawlable, canonical content and complete share metadata', () => {
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<title>TRACEWIRE \| AI-Powered Research &amp; Evidence Tracking<\/title>/);
  assert.match(html, new RegExp(`<link rel="canonical" href="${origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}">`));
  assert.match(html, /<meta name="robots" content="index, follow, max-image-preview:large"\s*\/>/);
  assert.match(html, /property="og:url" content="https:\/\/forkversewebqb1xft\.z1\.web\.core\.windows\.net\/"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(html, /<h1 id="tracewire-headline">AI-powered research for stories that keep changing\.<\/h1>/);
  assert.ok((html.match(/<h1\b/g) ?? []).length === 1, 'initial HTML should contain one primary heading');
  assert.match(html, /connects events, claims, and original sources/);
});

test('JSON-LD is valid and the linked social image is a real 1200x630 PNG', () => {
  const raw = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(raw, 'JSON-LD block exists');
  const schema = JSON.parse(raw) as { '@type': string; name: string; url: string };
  assert.equal(schema['@type'], 'WebApplication');
  assert.equal(schema.name, 'TRACEWIRE');
  assert.equal(schema.url, origin);

  const image = readFileSync(resolve(root, 'public/social/tracewire-og.png'));
  assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(image.readUInt32BE(16), 1200);
  assert.equal(image.readUInt32BE(20), 630);
});

test('robots and sitemap expose only the canonical public homepage', () => {
  const robots = readFileSync(resolve(root, 'public/robots.txt'), 'utf8');
  const sitemap = readFileSync(resolve(root, 'public/sitemap.xml'), 'utf8');
  assert.match(robots, /Allow: \/\s/);
  assert.match(robots, new RegExp(`Sitemap: ${origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}sitemap\.xml`));
  assert.match(sitemap, new RegExp(`<loc>${origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</loc>`));
  assert.equal((sitemap.match(/<loc>/g) ?? []).length, 1);
  assert.doesNotMatch(sitemap, /\/api\/|investigation/i);
});
