"""Ejecuta un comando y todos sus hijos en como máximo dos CPU (Linux)."""
import os
import sys

if len(sys.argv) < 2:
    raise SystemExit('Uso: python3 scripts/con_dos_cpu.py <comando> [argumentos]')
if not hasattr(os, 'sched_setaffinity'):
    raise SystemExit('Se requiere Linux para garantizar afinidad de CPU.')
os.sched_setaffinity(0, sorted(os.sched_getaffinity(0))[:2])
os.execvp(sys.argv[1], sys.argv[1:])
