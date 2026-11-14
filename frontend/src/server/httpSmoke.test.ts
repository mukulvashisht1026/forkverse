import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not allocate test port.');
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForServer(child: ChildProcess, baseUrl: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Test server exited with code ${child.exitCode}.`);
    try {
      const response = await fetch(`${baseUrl}/api/status`);
      if (response.ok) return;
    } catch { /* Wait for server startup. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Test server did not become ready.');
}

test('production HTTP routes return JSON and reject invalid requests without scraping', async (t) => {
  const port = await unusedPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: frontendDir,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port) },
    stdio: 'ignore',
  });
  t.after(() => {
    if (child.exitCode === null) child.kill('SIGTERM');
  });
  await waitForServer(child, baseUrl);

  const timeline = await fetch(`${baseUrl}/api/timeline`);
  assert.equal(timeline.status, 200);
  assert.match(timeline.headers.get('content-type') ?? '', /application\/json/);
  assert.ok(Array.isArray((await timeline.json() as { nodes: unknown[] }).nodes));

  const status = await fetch(`${baseUrl}/api/status`);
  assert.equal(status.status, 200);
  assert.match(status.headers.get('content-type') ?? '', /application\/json/);
  assert.equal(typeof (await status.json() as { wsClients: unknown }).wsClients, 'number');

  const invalidScrape = await fetch(`${baseUrl}/api/scrape-event`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: '' }),
  });
  assert.equal(invalidScrape.status, 400);
  assert.equal(typeof (await invalidScrape.json() as { error: unknown }).error, 'string');

  const invalidPrompt = await fetch(`${baseUrl}/api/prompt`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: '' }),
  });
  assert.equal(invalidPrompt.status, 400);
  assert.equal(typeof (await invalidPrompt.json() as { error: unknown }).error, 'string');
});
