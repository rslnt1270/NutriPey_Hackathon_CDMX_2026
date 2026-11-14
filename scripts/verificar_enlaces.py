#!/usr/bin/env python3
"""Verifica los enlaces relativos de los archivos Markdown del repositorio.

Comprueba que cada enlace interno apunte a un archivo existente y, si lleva
ancla (#seccion), que el encabezado exista en el archivo destino. Los enlaces
externos (http, https, mailto) no se verifican.

Uso, desde la raíz del repo:
    python3 scripts/verificar_enlaces.py

Sale con código 1 si encuentra enlaces rotos.
"""

import re
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
ENLACE = re.compile(r"(?<!!)\[[^\]]*\]\(([^)\s]+)\)")
BLOQUE_CODIGO = re.compile(r"```.*?```", re.S)
ENCABEZADO = re.compile(r"^#{1,6}\s+(.+?)\s*#*\s*$", re.M)


def slug(texto: str) -> str:
    """Aproxima el identificador que GitHub genera para un encabezado."""
    texto = re.sub(r"`|\*|_(?=\W)|(?<=\W)_", "", texto.strip().lower())
    texto = re.sub(r"[^\w\s-]", "", texto)
    return texto.replace(" ", "-")


def anclas(archivo: Path) -> set[str]:
    contenido = BLOQUE_CODIGO.sub("", archivo.read_text(encoding="utf-8"))
    return {slug(h) for h in ENCABEZADO.findall(contenido)}


def archivos_markdown() -> list[Path]:
    salida = subprocess.check_output(["git", "ls-files", "*.md"], cwd=RAIZ, text=True)
    return [RAIZ / linea for linea in salida.splitlines() if linea]


def main() -> int:
    rotos = []
    for archivo in archivos_markdown():
        contenido = BLOQUE_CODIGO.sub("", archivo.read_text(encoding="utf-8"))
        for destino in ENLACE.findall(contenido):
            if re.match(r"^(https?:|mailto:)", destino):
                continue
            ruta, _, ancla = destino.partition("#")
            objetivo = (archivo.parent / ruta).resolve() if ruta else archivo
            nombre = archivo.relative_to(RAIZ)
            if not objetivo.exists():
                rotos.append(f"{nombre}: no existe '{destino}'")
            elif ancla and objetivo.suffix == ".md" and ancla not in anclas(objetivo):
                rotos.append(f"{nombre}: no existe la sección '#{ancla}' en '{ruta or nombre}'")

    for error in rotos:
        print(error)
    print(f"{len(rotos)} enlaces rotos." if rotos else "Todos los enlaces internos son válidos.")
    return 1 if rotos else 0


if __name__ == "__main__":
    sys.exit(main())
