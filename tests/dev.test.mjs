import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';

test('next dev sirve la portada sin modificar AGENTS.md', { timeout: 60000 }, async () => {
  const original = await readFile('AGENTS.md', 'utf8');
  const socket = createServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', String(port)], {
    stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
  });
  let stderr = '';
  server.stderr.setEncoding('utf8');
  server.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-16384); });
  const diagnostic = () => `\nnext dev stderr (últimos 16 KiB):\n${stderr || '(vacío)'}`;
  const stopped = new Promise((resolve) => server.once('exit', resolve));
  try {
    let response;
    const deadline = performance.now() + 30000;
    while (performance.now() < deadline) {
      assert.equal(server.exitCode, null, 'next dev debe permanecer activo');
      try { response = await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(Math.max(1, Math.ceil(Math.min(1500, deadline - performance.now())))) }); break; }
      catch { await delay(100); }
    }
    assert.ok(response, 'next dev debe arrancar dentro de 30 segundos');
    assert.equal(response.status, 200);
    assert.match(await response.text(), /NutriPey/);
  } catch (error) {
    error.message += diagnostic();
    throw error;
  } finally {
    server.kill('SIGTERM');
    const force = setTimeout(() => server.kill('SIGKILL'), 5000);
    await stopped;
    clearTimeout(force);
  }
  assert.equal(await readFile('AGENTS.md', 'utf8'), original, 'next dev no debe reescribir instrucciones compartidas' + diagnostic());
});
