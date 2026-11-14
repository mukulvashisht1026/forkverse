import test from 'node:test';
import assert from 'node:assert/strict';
import { mockInvestigationRepository } from './mockInvestigations';

test('mock AI regulation investigation previews runs and a deterministic claim timeline', async () => {
  const graph = await mockInvestigationRepository.getInvestigationGraph('demo-ai-regulation');
  assert.equal(graph.nodes.length, 3);
  assert.equal(graph.entity, 'European Union');
  assert.equal(graph.mode, 'news');
  assert.deepEqual(graph.claimNodes?.map(({ name, claimStatus }) => [name, claimStatus]), [
    ['EU adopts a risk-based AI Act', 'established'],
    ['High-risk systems face new obligations', 'established'],
    ['Implementation deadlines may be delayed', 'pending'],
  ]);
  assert.equal(graph.claimNodes?.[0].branches.length, 2);
  assert.equal(graph.claimLinks?.[0].type, 'evolution');
});

test('mock graph snapshots clone claim fixture data for isolated UI runs', async () => {
  const first = await mockInvestigationRepository.getInvestigationGraph('demo-ai-regulation');
  first.claimNodes![0].name = 'mutated';
  const second = await mockInvestigationRepository.getInvestigationGraph('demo-ai-regulation');
  assert.equal(second.claimNodes?.[0].name, 'EU adopts a risk-based AI Act');
});
