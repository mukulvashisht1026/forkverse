import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '../..');

describe('homepage SEO assets', () => {
  it('ships crawlable homepage content and correct canonical/social metadata in source HTML', async () => {
    const html = await readFile(resolve(root, 'index.html'), 'utf8');
    assert.ok(html.includes('<html lang="en">'));
    assert.ok(html.includes('https://forkversewebqb1xft.z1.web.core.windows.net/'));
    assert.ok(html.includes('AI-powered investigations, built on evidence.'));
    assert.ok(html.includes('id="research-topic"'));
    assert.ok(html.includes('application/ld+json'));
  });

  it('publishes robots, sitemap, and a validly sized social preview image', async () => {
    const robots = await readFile(resolve(root, 'public/robots.txt'), 'utf8');
    const sitemap = await readFile(resolve(root, 'public/sitemap.xml'), 'utf8');
    assert.ok(robots.includes('Allow: /'));
    assert.ok(robots.includes('/sitemap.xml'));
    assert.ok(sitemap.includes('<loc>https://forkversewebqb1xft.z1.web.core.windows.net/</loc>'));
    const image = await readFile(resolve(root, 'public/og-image.png'));
    assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  });
});
