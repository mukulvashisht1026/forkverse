#!/usr/bin/env node
/**
 * Build backend/data/source-ratings.json from the labelled domain dataset
 * (todo/propaganda-detection/propaganda-dataset/data/domains.csv, see backend/data/SOURCE_RATINGS.md).
 *
 *   node scripts/build-source-ratings.mjs [path/to/domains.csv]
 *
 * Keeps only rows that carry a signal: propaganda, unreliable, satire, reliable. "mixed" rows
 * (low confidence, "everything else") are dropped: an unlisted domain simply has no rating.
 * Row format (compact): [label, confidence, actor_country, subtypes, sources, lin_pc1, name]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const input = process.argv[2] ?? path.join(here, '../../todo/propaganda-detection/propaganda-dataset/data/domains.csv');
const output = path.join(here, '../data/source-ratings.json');

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, newlines in quotes). */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1);
}

const [header, ...rows] = parseCsv(readFileSync(input, 'utf8'));
const col = Object.fromEntries(header.map((h, i) => [h, i]));
const KEEP = new Set(['propaganda', 'unreliable', 'satire', 'reliable']);
const domains = {};
const counts = {};
for (const r of rows) {
  const label = r[col.label];
  if (!KEEP.has(label)) continue;
  const domain = r[col.domain].trim().toLowerCase().replace(/^www\./, '');
  if (!domain || !domain.includes('.')) continue;
  const pc1 = r[col.lin_pc1] ? Number(Number(r[col.lin_pc1]).toFixed(3)) : null;
  domains[domain] = [label, r[col.confidence] || 'low', r[col.actor_country] || '', r[col.subtypes] || '', r[col.sources] || '', pc1, r[col.name] || ''];
  counts[label] = (counts[label] ?? 0) + 1;
}
writeFileSync(output, JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), source: 'domains.csv (see SOURCE_RATINGS.md)', counts, domains }));
console.log(`wrote ${Object.keys(domains).length} domains to ${output}`, counts);
