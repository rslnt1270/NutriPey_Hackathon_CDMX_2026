#!/usr/bin/env bash
# Crea en GitHub las etiquetas de los carriles y los issues iniciales del plan
# descrito en docs/07_estado_y_siguientes_pasos.md.
#
# Requisitos: GitHub CLI autenticado (gh auth login) y permiso de escritura.
# Ejecutar UNA sola vez, desde la raíz del repo:
#
#   bash scripts/crear_etiquetas_e_issues.sh          # muestra lo que haría
#   bash scripts/crear_etiquetas_e_issues.sh --crear  # lo crea en GitHub
#
# Si ya existen issues, el script se detiene para no duplicarlos.

set -euo pipefail

CREAR=false
[[ "${1:-}" == "--crear" ]] && CREAR=true

if $CREAR; then
  gh auth status >/dev/null
  existentes=$(gh issue list --state all --limit 1 --json number --jq 'length')
  if [[ "$existentes" != "0" ]]; then
    echo "El repo ya tiene issues. No se crea nada para evitar duplicados." >&2
    exit 1
  fi
fi

etiqueta() { # nombre color descripcion
  if $CREAR; then
    gh label create "$1" --color "$2" --description "$3" --force
  else
    echo "ETIQUETA  $1"
  fi
}

issue() { # etiqueta titulo cuerpo
  if $CREAR; then
    gh issue create --label "$1" --title "$2" --body "$3" >/dev/null
    echo "creado: $2"
  else
    echo "ISSUE     [$1] $2"
  fi
}

etiqueta "carril:pagos"  "2a78d6" "Ledger, pey, webhook, conciliador, notificaciones"
etiqueta "carril:campus" "eb6834" "POS, NFC, catálogo, reglas del tutor, reportes"
etiqueta "compartido"    "6250d6" "Toca archivos compartidos: PR dedicado"
etiqueta "bloqueado"     "d03b3b" "Espera a otro issue o a una decisión"
etiqueta "tramite"       "eda100" "Gestión fuera del código"

REF="Contexto: docs/07_estado_y_siguientes_pasos.md y AGENTS.md."

# --- Trámites ---------------------------------------------------------------
issue tramite "Registrar la CLABE receptora en pey" \
  "Tarda hasta 5 días hábiles. Mientras se activa, usar la cuenta de prueba de pey con \$0.01. $REF"
issue tramite "Crear API key y webhook en el portal de pey" \
  "Guardar el secreto del webhook: se muestra una sola vez. Una llave para desarrollo y otra para la demo. $REF"
# Retirado: canal de mensajería (D2 reemplazada el 16 nov, docs/05 §9).
issue tramite "Comprar tags NFC y conseguir un Android con NFC" \
  "NTAG213 para la demo y dos o tres NTAG 424 DNA. $REF"
issue tramite "Contactar una cooperativa escolar para el piloto" \
  "Decisión D5. Una prueba de un recreo basta. $REF"

# --- Pasos en serie ---------------------------------------------------------
issue compartido "Decidir carriles, stack (D1) y hospedaje" \
  "Las dos personas. Al cerrar: completar la tabla de docs/06, añadir .github/CODEOWNERS y completar deploy-check. $REF"
issue compartido "Proteger main: PR obligatorio y una aprobación" "$REF"
issue compartido "Aprobar el contrato del ledger (docs/contratos/ledger.md)" \
  "Resolver las preguntas abiertas del borrador. Lo aprueban las dos personas. $REF"
issue compartido "PR de esqueleto del proyecto" \
  "Una persona, un agente. Proyecto, carpetas de los carriles, linter, pruebas, CI y .env.example. Nadie crea archivos de aplicación antes de fusionarlo. Depende de: decidir stack. $REF"

# --- Carril Pagos -----------------------------------------------------------
P="Leer .claude/skills/ledger-change/SKILL.md y .claude/skills/pey-codi/SKILL.md. $REF"
issue carril:pagos "Ledger simulado con las firmas del contrato" \
  "src/server/ledger/index.ts con datos en memoria. Debe poder producir cada MotivoRechazo. Desbloquea al carril Campus. $P"
issue carril:pagos "Migración inicial del esquema" \
  "Tablas, restricciones e índices de docs/02_modelo_de_datos.md. Incluye CHECK de saldo y trigger de partida doble. $P"
issue carril:pagos "acreditarRecarga y saldo reales" \
  "Con pruebas de idempotencia por referenciaPago contra PostgreSQL real. $P"
issue carril:pagos "Cliente de pey: POST /codi/qr y POST /codi/pn" \
  "RF-01 y RF-02. Siempre con bankAccountId. $P"
issue carril:pagos "POST /api/recargas y consulta de estado" "RF-01, RF-02, RF-07. $P"
issue carril:pagos "Webhook de pey" \
  "RF-03 a RF-05. Verificación sobre cuerpo crudo, deduplicación por webhook-id, acreditación. $P"
issue carril:pagos "Conciliador corto y diario" "RF-06. $P"
issue carril:pagos "cobrar y anular reales" \
  "RF-11 a RF-13. Con prueba de concurrencia: 20 cobros simultáneos sobre saldo para 5. $P"
issue carril:pagos "Recarga en efectivo" "RF-08. $P"
# Retirado: cola de notificaciones externas (fuera del MVP, docs/05 §9).
issue carril:pagos "Límite mensual de la cuenta receptora" "RN-02. $P"

# --- Carril Campus ----------------------------------------------------------
C="Solo rutas del carril Campus. El ledger se usa por sus funciones exportadas. $REF"
issue carril:campus "Sesión del cajero y del tutor" "$C"
issue carril:campus "Catálogo con regla de publicación SEP" "RF-16. $C"
issue carril:campus "Alta de alumno con consentimiento" "RF-22. $C"
issue carril:campus "Reglas del tutor: alérgenos, categorías y tope diario" "RF-17. $C"
issue carril:campus "Pantalla de recarga del tutor" "QR, push y estado. RF-01, RF-02, RF-07. $C"
issue carril:campus "POS: carrito, cobro y pantallas de resultado" \
  "Contra el ledger simulado. RF-11, RF-13, RF-14. $C"
issue carril:campus "Lectura Web NFC y alternativas" \
  "RF-09 y RF-10: NDEFReader, URL del tag, QR del carnet, matrícula más PIN. $C"
issue carril:campus "Grabado y alta de credenciales" "RF-15 y ciclo de vida de la credencial. $C"
issue carril:campus "Reporte de cumplimiento SEP" "RF-18. Solo agregados. $C"

if ! $CREAR; then
  echo
  echo "Modo de prueba. Para crear en GitHub: bash scripts/crear_etiquetas_e_issues.sh --crear"
fi
