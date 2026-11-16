import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';

test('servidor construido: inicio, disponibilidad y ruta inexistente', { timeout: 30000 }, async () => {
  const socket = createServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], {
    stdio: 'ignore', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
  });
  const stopped = new Promise((resolve) => server.once('exit', resolve));
  const base = `http://127.0.0.1:${port}`;
  try {
    let response;
    for (let attempt = 0; attempt < 100; attempt++) {
      assert.equal(server.exitCode, null, 'Next debe permanecer activo; ejecutar npm run build antes');
      try { response = await fetch(base, { signal: AbortSignal.timeout(1000) }); break; } catch { await delay(100); }
    }
    assert.ok(response, 'el servidor debe arrancar');
    assert.equal(response.status, 200);
    assert.match(await response.text(), /NutriPey/);
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200, 'GET /api/health debe estar disponible');
    assert.deepEqual(await health.json(), { status: 'ok' });
    assert.match(health.headers.get('cache-control'), /no-store/);
    assert.equal((await fetch(`${base}/ruta-inexistente`)).status, 404);
  } finally {
    server.kill('SIGTERM');
    const force = setTimeout(() => server.kill('SIGKILL'), 5000);
    await stopped;
    clearTimeout(force);
  }
});
