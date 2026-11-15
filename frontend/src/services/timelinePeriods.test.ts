import test from 'node:test';
import assert from 'node:assert/strict';
import type { ClaimDto } from '../../../contracts/investigations';
import { claimToBranch, fallbackPeriods, periodsToSpineNodes } from './investigationGraphAdapter';

const ev = (id: string, publisher: string) => ({ evidenceId: id, stance: 'supports' as const, quote: `q ${id}`, title: `T ${id}`, publisher, url: `https://${publisher}/${id}` });
const claim = (id: string, happenedAt: string | undefined, status: ClaimDto['status'], evidence = [ev(`${id}1`, 'a.example')]): ClaimDto => ({
  id, statement: `Statement ${id}.`, kind: 'development', status, statusReason: `why ${id}`, disputed: false, ...(happenedAt && { happenedAt }), evidence,
});

test('fallback periods bucket claims by year for multi-year stories, undated last', () => {
  const claims = [claim('c', '2016-02', 'established'), claim('a', '2010', 'pending'), claim('b', '2012-05-01', 'established'), claim('x', undefined, 'pending')];
  const periods = fallbackPeriods(claims);
  assert.deepEqual(periods.map((p) => [p.label, p.claimIds]), [['2010', ['a']], ['2012', ['b']], ['2016', ['c']], ['Undated', ['x']]]);
  assert.equal(periods[0]!.summary, 'Unverified so far: Statement a.');
});

test('a claim branch carries its merged sources; more outlets = bigger, established colour', () => {
  const merged = claim('m', '2010', 'established', [ev('m1', 'a.example'), ev('m2', 'b.example'), ev('m3', 'b.example')]);
  const b = claimToBranch(merged);
  assert.equal(b.relation, 'Established · 2 sources');
  assert.equal(b.stance, 'supports');
  assert.equal(b.claimSources?.length, 3);
  assert.deepEqual(b.claimEvidenceIds, ['m1', 'm2', 'm3']);
  assert.equal(claimToBranch(claim('p', '2010', 'pending')).stance, 'context');
});

test('periods become spine nodes with the summary as info and claims as branches', () => {
  const claims = [claim('a', '2010', 'established'), claim('b', '2010', 'pending')];
  const [node] = periodsToSpineNodes([{ id: 'period-2010', label: '2010', granularity: 'year', start: '2010-01-01', headline: 'Head', summary: 'Sum.', claimIds: ['a', 'b', 'gone'], sources: [], established: 1, unverified: 1, writer: 'llm' }], claims);
  assert.equal(node!.name, '2010 · Head');
  assert.equal(node!.info, 'Sum.');
  assert.deepEqual(node!.branches.map((b) => [b.id, b.claimStatus]), [['a', 'established'], ['b', 'pending']]);
});

test('fallback: claims first reported by a live update get a "Live · <day>" period at the end; span picks the granularity', () => {
  const live = { evidenceId: 'mon-chg_x', stance: 'supports' as const, quote: 'q', title: 'Live', publisher: 'live.example', url: 'https://live.example/x', publishedAt: '2026-11-15T02:05:45Z' };
  const claims = [claim('old', '2016-07', 'established'), claim('now', undefined, 'pending', [live]), claim('mid', '2026-11-02', 'established')];
  claims[1]!.occurredAt = '2026-11-15T02:05:45Z';
  const periods = fallbackPeriods(claims);
  assert.deepEqual(periods.map((p) => [p.label, p.claimIds, p.live ?? false]), [['2016', ['old'], false], ['2026', ['mid'], false], ['Live · 15 Nov 2026', ['now'], true]]);
});
