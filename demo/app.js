// Interfaz de la demo. Toda la lógica de dinero vive en ledger-sim.js.
const L = window.LedgerSim;
const $ = (id) => document.getElementById(id);
const mxn = (c) => "$" + (c / 100).toLocaleString("es-MX", { minimumFractionDigits: 2 });
const hora = (ms) => new Date(ms).toLocaleTimeString("es-MX", { timeZone: "America/Mexico_City", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const nuevaLlave = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));

const sesion = window.SesionDemo.crearSesion();
let st, monto, recargaPendiente, carrito, ultimoCobro;

function iniciar() {
  sesion.reiniciar(); // A1: ninguna recarga de la sesión anterior escribe en la nueva
  st = L.crearEstado();
  monto = 5000; recargaPendiente = null; carrito = {}; ultimoCobro = null;
  $("w-chat").innerHTML = "";
  $("t-qr").classList.add("oculto");
  $("t-estado").textContent = "";
  $("p-resultado").classList.add("oculto");
  ["p-repetir", "p-anular"].forEach((b) => $(b).classList.add("oculto"));
  const opts = Object.entries(st.alumnos).map(([id, a]) => `<option value="${id}">${a.iniciales} · ${a.grupo}</option>`).join("");
  $("t-alumno").innerHTML = opts;
  $("p-pulsera").innerHTML = Object.values(st.alumnos).map((a) => `<option value="${a.pulsera}">${a.pulsera} (${a.iniciales})</option>`).join("")
    + `<option value="tag-0000">tag-0000 (no registrada)</option>`;
  pintarMontos(); pintarReglas(); pintarCatalogo(); pintarCarrito(); pintarLedger();
  aviso("Hola 👋 Aquí llegan los avisos de NutriPey. Canal por confirmar: Telegram o WhatsApp.");
}

const alumnoTutor = () => $("t-alumno").value;

function pintarMontos() {
  $("t-montos").innerHTML = [2000, 5000, 10000, 20000]
    .map((c) => `<button data-c="${c}" class="${c === monto ? "sel" : ""}">${mxn(c)}</button>`).join("");
}

function pintarReglas() {
  const a = st.alumnos[alumnoTutor()];
  const alerg = a.alergenos.length ? a.alergenos.map((x) => `<span>Sin ${x}</span>`).join("") : "Sin alérgenos registrados";
  $("t-reglas").innerHTML = `${alerg}<p class="mini">Tope diario: <b>${mxn(a.tope)}</b> · Saldo: <b>${mxn(L.saldo(st, alumnoTutor()))}</b></p>`;
  $("t-bloqueo").checked = a.bloqueada;
}

function pintarCatalogo() {
  $("p-catalogo").innerHTML = L.PRODUCTOS.map((p) => L.publicable(p)
    ? `<button class="prod" data-p="${p.id}">${p.nombre}<small>${mxn(p.precio)}${p.alergenos.length ? " · " + p.alergenos.join(", ") : ""}</small></button>`
    : `<button class="prod no-pub" disabled title="${p.sellos.join(", ")}">${p.nombre}<small>No publicable: tiene sellos</small></button>`).join("");
}

function pintarCarrito() {
  const items = Object.entries(carrito);
  const total = items.reduce((s, [id, q]) => s + L.PRODUCTOS.find((p) => p.id === id).precio * q, 0);
  $("p-items").textContent = items.length ? items.map(([id, q]) => `${q}× ${L.PRODUCTOS.find((p) => p.id === id).nombre}`).join(", ") : "Carrito vacío";
  $("p-total").textContent = mxn(total);
}

function pintarLedger() {
  $("l-saldos").innerHTML = Object.entries(st.alumnos)
    .map(([id, a]) => `<div><span class="mini">Anticipo ${a.iniciales}</span><strong>${mxn(L.saldo(st, id))}</strong></div>`).join("");
  $("l-asientos").innerHTML = st.asientos.slice().reverse().map((a) =>
    `<tr><td>${a.n}</td><td>${hora(a.ahora)}</td><td>${a.tipo}</td><td>${a.cuenta}</td><td class="num">${a.debe ? mxn(a.debe) : ""}</td><td class="num">${a.haber ? mxn(a.haber) : ""}</td></tr>`).join("")
    || `<tr><td colspan="6" class="mini">Sin movimientos todavía.</td></tr>`;
  pintarReglas();
}

function aviso(texto) {
  const b = document.createElement("div");
  b.className = "burbuja";
  b.innerHTML = `${texto}<time>${hora(Date.now())} · aviso simulado</time>`;
  $("w-chat").prepend(b);
}

// QR decorativo: patrón fijo con esquinas de posición. No codifica nada.
function pintarQr(semilla) {
  let s = [...semilla].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7), r = "";
  for (let y = 0; y < 21; y++) for (let x = 0; x < 21; x++) {
    const esquina = (x < 7 && y < 7) || (x > 13 && y < 7) || (x < 7 && y > 13);
    let on;
    if (esquina) { const cx = x > 13 ? x - 14 : x, cy = y > 13 ? y - 14 : y; on = cx === 0 || cx === 6 || cy === 0 || cy === 6 || (cx > 1 && cx < 5 && cy > 1 && cy < 5); }
    else { s = (s * 1103515245 + 12345) >>> 0; on = (s >>> 16) % 2 === 0; }
    if (on) r += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
  }
  $("t-qr-svg").innerHTML = `<g fill="#111">${r}</g>`;
}

$("t-montos").addEventListener("click", (e) => { const c = e.target.dataset.c; if (c) { monto = Number(c); pintarMontos(); } });
$("t-alumno").addEventListener("change", pintarReglas);
$("t-bloqueo").addEventListener("change", (e) => {
  const a = st.alumnos[alumnoTutor()];
  a.bloqueada = e.target.checked;
  aviso(a.bloqueada ? `🔒 Pulsera de ${a.iniciales} suspendida. Se aplica desde el siguiente tap.` : `🔓 Pulsera de ${a.iniciales} reactivada.`);
});

$("t-generar").addEventListener("click", () => {
  recargaPendiente = { referencia: "SIM-" + nuevaLlave().slice(0, 8).toUpperCase(), alumnoId: alumnoTutor(), centavos: monto };
  pintarQr(recargaPendiente.referencia);
  $("t-ref").textContent = recargaPendiente.referencia;
  $("t-qr").classList.remove("oculto");
  $("t-pagar").disabled = false;
  $("t-estado").textContent = `Esperando pago simulado de ${mxn(monto)}…`;
});

$("t-pagar").addEventListener("click", () => {
  if (!recargaPendiente) return;
  $("t-pagar").disabled = true;
  $("t-estado").textContent = "Banco procesando… (webhook simulado)";
  const rec = recargaPendiente; recargaPendiente = null;
  sesion.despues(() => {
    L.acreditarRecarga(st, { ...rec, ahora: Date.now() });
    const a = st.alumnos[rec.alumnoId];
    $("t-estado").textContent = `✅ Recarga acreditada: ${mxn(rec.centavos)} (pago simulado)`;
    $("t-qr").classList.add("oculto");
    aviso(`💚 Recarga de ${mxn(rec.centavos)} acreditada para ${a.iniciales}. Saldo: ${mxn(L.saldo(st, rec.alumnoId))}.`);
    pintarLedger();
  }, 1200);
});

$("p-catalogo").addEventListener("click", (e) => {
  const id = e.target.closest("[data-p]")?.dataset.p;
  if (id) { carrito[id] = (carrito[id] || 0) + 1; pintarCarrito(); }
});
$("p-vaciar").addEventListener("click", () => { carrito = {}; pintarCarrito(); });

function mostrarResultado(r) {
  const a = r.alumnoId ? st.alumnos[r.alumnoId] : null;
  const box = $("p-resultado");
  box.className = "resultado " + (r.ok ? "ok" : "bad");
  box.innerHTML = r.ok
    ? `<div class="ini">${a.iniciales}</div>${a.grupo} · Cobro simulado ${mxn(r.total)} · Saldo ${mxn(L.saldo(st, r.alumnoId))}${r.repetido ? "<p><b>Misma llave: se devolvió el resultado original, no se cobró otra vez.</b></p>" : ""}`
    : `<div class="ini">✕</div>${a ? a.iniciales + " · " : ""}${r.motivo}${r.repetido ? "<p><b>Misma llave: resultado original.</b></p>" : ""}`;
}

$("p-cobrar").addEventListener("click", () => {
  const items = Object.entries(carrito).map(([id, qty]) => ({ id, qty }));
  const llave = nuevaLlave();
  const r = L.cobrar(st, { pulsera: $("p-pulsera").value, items, llave, ahora: Date.now() });
  ultimoCobro = { llave, pulsera: $("p-pulsera").value, items };
  mostrarResultado(r);
  $("p-repetir").classList.remove("oculto");
  $("p-anular").classList.toggle("oculto", !r.ok);
  if (r.ok) { carrito = {}; pintarCarrito(); }
  const a = r.alumnoId && st.alumnos[r.alumnoId];
  if (r.regla === "alergeno" || r.regla === "tope") aviso(`⚠️ Compra bloqueada para ${a.iniciales}: ${r.motivo}.`);
  if (r.ok && L.saldo(st, r.alumnoId) < 2000) aviso(`🔔 Saldo bajo de ${a.iniciales}: ${mxn(L.saldo(st, r.alumnoId))}.`);
  pintarLedger();
});

$("p-repetir").addEventListener("click", () => {
  if (!ultimoCobro) return;
  mostrarResultado(L.cobrar(st, { ...ultimoCobro, ahora: Date.now() }));
  pintarLedger();
});

$("p-anular").addEventListener("click", () => {
  const r = L.anular(st, { cobro: ultimoCobro.llave, ahora: Date.now() });
  const box = $("p-resultado");
  box.className = "resultado " + (r.ok ? "ok" : "bad");
  box.innerHTML = r.ok ? `<div class="ini">↺</div>Cobro simulado anulado con reverso. Se devolvieron ${mxn(r.total)} al anticipo.` : r.motivo;
  $("p-anular").classList.add("oculto");
  pintarLedger();
});

$("reset").addEventListener("click", iniciar);
iniciar();
