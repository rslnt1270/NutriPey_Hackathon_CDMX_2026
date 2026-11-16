#!/usr/bin/env python3
"""Prueba destructiva solo sobre un proyecto Compose nuevo y desechable."""
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import time
import urllib.request

os.chdir(Path(__file__).resolve().parents[1])
cpus = sorted(os.sched_getaffinity(0))[:2]
os.sched_setaffinity(0, cpus)
engine = sys.argv[1] if len(sys.argv) == 2 else "docker"
project = "nutripey19test" + secrets.token_hex(4)
env = dict(os.environ, POSTGRES_PASSWORD=secrets.token_hex(24), APP_PORT="0",
           BUILD_CPUSET=",".join(map(str, cpus)))
compose = [engine, "compose", "-p", project, "-f", "compose.yaml"]


def run(args, capture=False):
    return subprocess.run(args, env=env, check=True, text=True,
                          stdout=subprocess.PIPE if capture else None).stdout


def dc(*args, capture=False):
    return run(compose + list(args), capture)


def healthy(service):
    container = dc("ps", "-q", service, capture=True).strip()
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        state = json.loads(run([engine, "inspect", container], True))[0]["State"]
        if state.get("Health", state.get("Healthcheck", {})).get("Status") == "healthy":
            return container
        if not state.get("Running"):
            raise AssertionError(f"{service} terminó antes de estar sano")
        time.sleep(1)
    raise AssertionError(f"{service} no estuvo sano en 90 segundos")


def sql(statement):
    return dc("exec", "-T", "db", "psql", "-U", "nutripey", "-d", "nutripey",
              "-v", "ON_ERROR_STOP=1", "-Atc", statement, capture=True).strip()


try:
    dc("config", "--quiet")
    dc("build")
    dc("up", "-d")
    app = healthy("app")
    db = healthy("db")
    address = dc("port", "app", "3000", capture=True).strip()
    assert address.startswith("127.0.0.1:"), address
    with urllib.request.urlopen(f"http://{address}/api/health", timeout=5) as response:
        assert json.load(response) == {"status": "ok"}
    with urllib.request.urlopen(f"http://{address}/", timeout=5) as response:
        assert response.status == 200
    dc("exec", "-T", "app", "node", "-e", """
const assert = require('node:assert/strict');
const fs = require('node:fs');
assert.notEqual(process.getuid(), 0);
for (const p of ['.env', '.env.local', '.git', 'node_modules/eslint',
                 'node_modules/typescript', 'node_modules/pg']) {
  assert.equal(fs.existsSync(p), false, p);
}
require('node:net').connect(5432, 'db').on('connect', function () {
  this.end();
}).on('error', () => process.exit(1)).setTimeout(3000, () => process.exit(1));
""")
    info = json.loads(run([engine, "inspect", db], True))[0]
    assert not any(info["NetworkSettings"].get("Ports", {}).values()), "DB publicada"
    assert sql("SHOW server_version").startswith("18.6")
    sql("CREATE TABLE smoke19 (id integer PRIMARY KEY); INSERT INTO smoke19 VALUES (19)")
    dc("restart", "db")
    healthy("db")
    assert sql("SELECT id FROM smoke19") == "19", "Reinicio perdió datos"
    dc("down")  # Conserva el volumen de este proyecto.
    dc("build")
    dc("up", "-d")
    healthy("app")
    healthy("db")
    assert sql("SELECT id FROM smoke19") == "19", "Recreación perdió datos"
    print("PASS: build/rebuild, salud, HTTP, UID, dependencias, red y persistencia")
except Exception:
    dc("logs", "--tail", "60")
    raise
finally:
    # Solo elimina el volumen del proyecto aleatorio creado por esta prueba.
    dc("down", "--volumes", "--remove-orphans")
