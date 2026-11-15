// Pruebas del ledger simulado. Ejecutar con `node demo/pruebas.js` o `gjs demo/pruebas.js`.
let L, S;
if (typeof require !== "undefined") { L = require("./ledger-sim.js"); S = require("./sesion.js"); }
else {
  const GLib = imports.gi.GLib;
  const dir = GLib.path_get_dirname(new Error().stack.split("\n")[0].replace(/^.*@|:\d+:\d+$/g, ""));
  const [, bytes] = GLib.file_get_contents(GLib.build_filenamev([dir, "ledger-sim.js"]));
  (0, eval)(new TextDecoder().decode(bytes));
  L = globalThis.LedgerSim;
  const [, b2] = GLib.file_get_contents(GLib.build_filenamev([dir, "sesion.js"]));
  (0, eval)(new TextDecoder().decode(b2));
  S = globalThis.SesionDemo;
}
const log = typeof console !== "undefined" ? console.log : print;
let fallas = 0, n = 0;
function caso(nombre, fn) {
  n++;
  try { fn(); log("ok   " + nombre); } catch (e) { fallas++; log("FALLA " + nombre + ": " + e.message); }
}
function igual(a, b, msg) { if (a !== b) throw new Error(`${msg || ""} esperaba ${b}, obtuvo ${a}`); }
const T = Date.UTC(2026, 10, 15, 16, 0, 0); // 10:00 en CDMX
const cuadra = (st) => igual(st.asientos.reduce((s, a) => s + a.debe - a.haber, 0), 0, "partida doble");

caso("recarga acredita una sola vez por referencia", () => {
  const st = L.crearEstado();
  L.acreditarRecarga(st, { referencia: "R1", alumnoId: "a2", centavos: 5000, ahora: T });
  const r = L.acreditarRecarga(st, { referencia: "R1", alumnoId: "a2", centavos: 5000, ahora: T });
  igual(r.repetido, true); igual(L.saldo(st, "a2"), 5000); cuadra(st);
});
caso("recarga rechaza montos no enteros", () => {
  const st = L.crearEstado();
  let lanzo = false;
  try { L.acreditarRecarga(st, { referencia: "R", alumnoId: "a2", centavos: 10.5, ahora: T }); } catch { lanzo = true; }
  igual(lanzo, true);
});
caso("cobro descuenta saldo y cuadra", () => {
  const st = L.crearEstado();
  L.acreditarRecarga(st, { referencia: "R1", alumnoId: "a2", centavos: 5000, ahora: T });
  const r = L.cobrar(st, { pulsera: "tag-91C2", items: [{ id: "agua", qty: 2 }], llave: "k1", ahora: T });
  igual(r.ok, true); igual(r.total, 2000); igual(L.saldo(st, "a2"), 3000); cuadra(st);
});
caso("misma llave no cobra dos veces", () => {
  const st = L.crearEstado();
  L.acreditarRecarga(st, { referencia: "R1", alumnoId: "a2", centavos: 5000, ahora: T });
  L.cobrar(st, { pulsera: "tag-91C2", items: [{ id: "agua", qty: 1 }], llave: "k1", ahora: T });
  const r = L.cobrar(st, { pulsera: "tag-91C2", items: [{ id: "agua", qty: 1 }], llave: "k1", ahora: T });
  igual(r.repetido, true); igual(L.saldo(st, "a2"), 4000);
});
caso("bloquea alérgeno del tutor", () => {
  const st = L.crearEstado();
  L.acreditarRecarga(st, { referencia: "R1", alumnoId: "a1", centavos: 5000, ahora: T });
  const r = L.cobrar(st, { pulsera: "tag-7F3A", items: [{ id: "yogur", qty: 1 }], llave: "k1", ahora: T });
  igual(r.ok, false); igual(r.regla, "alergeno"); igual(L.saldo(st, "a1"), 5000);
});
caso("producto con sellos SEP no se vende", () => {
  const st = L.crearEstado();
  L.acreditarRecarga(st, { referencia: "R1", alumnoId: "a2", centavos: 5000, ahora: T });
  igual(L.cobrar(st, { pulsera: "tag-91C2", items: [{ id: "galletas", qty: 1 }], llave: "k1", ahora: T }).ok, false);
});
caso("tope diario y reinicio al día siguiente (CDMX)", () => {
  const st = L.crearEstado(); // a2 tiene tope de $30
  L.acreditarRecarga(st, { referencia: "R1", alumnoId: "a2", centavos: 10000, ahora: T });
  igual(L.cobrar(st, { pulsera: "tag-91C2", items: [{ id: "torta", qty: 1 }], llave: "k1", ahora: T }).ok, true);
  igual(L.cobrar(st, { pulsera: "tag-91C2", items: [{ id: "fruta", qty: 1 }], llave: "k2", ahora: T }).regla, "tope");
  igual(L.cobrar(st, { pulsera: "tag-91C2", items: [{ id: "fruta", qty: 1 }], llave: "k3", ahora: T + 86400000 }).ok, true);
});
caso("saldo insuficiente no deja saldo negativo", () => {
  const st = L.crearEstado();
  L.acreditarRecarga(st, { referencia: "R1", alumnoId: "a2", centavos: 500, ahora: T });
  igual(L.cobrar(st, { pulsera: "tag-91C2", items: [{ id: "agua", qty: 1 }], llave: "k1", ahora: T }).regla, "saldo");
  igual(L.saldo(st, "a2"), 500);
});
caso("pulsera suspendida y no registrada", () => {
  const st = L.crearEstado();
  st.alumnos.a2.bloqueada = true;
  igual(L.cobrar(st, { pulsera: "tag-91C2", items: [{ id: "agua", qty: 1 }], llave: "k1", ahora: T }).ok, false);
  igual(L.cobrar(st, { pulsera: "tag-0000", items: [{ id: "agua", qty: 1 }], llave: "k2", ahora: T }).motivo, "Pulsera no registrada");
});
caso("anulación con reverso dentro de 2 min, una sola vez", () => {
  const st = L.crearEstado();
  L.acreditarRecarga(st, { referencia: "R1", alumnoId: "a2", centavos: 5000, ahora: T });
  L.cobrar(st, { pulsera: "tag-91C2", items: [{ id: "agua", qty: 1 }], llave: "k1", ahora: T });
  const antes = st.asientos.length;
  igual(L.anular(st, { cobro: "k1", ahora: T + 60000 }).ok, true);
  igual(L.anular(st, { cobro: "k1", ahora: T + 60000 }).ok, false);
  igual(L.saldo(st, "a2"), 5000); igual(st.asientos.length, antes + 2, "el cobro original sigue"); cuadra(st);
});
caso("anulación fuera de plazo se rechaza", () => {
  const st = L.crearEstado();
  L.acreditarRecarga(st, { referencia: "R1", alumnoId: "a2", centavos: 5000, ahora: T });
  L.cobrar(st, { pulsera: "tag-91C2", items: [{ id: "agua", qty: 1 }], llave: "k1", ahora: T });
  igual(L.anular(st, { cobro: "k1", ahora: T + 121000 }).ok, false);
});
caso("asientos inmutables", () => {
  const st = L.crearEstado();
  L.acreditarRecarga(st, { referencia: "R1", alumnoId: "a2", centavos: 5000, ahora: T });
  try { st.asientos[0].haber = 1; } catch { /* modo estricto lanza */ }
  igual(st.asientos[0].haber, 0);
});

// A1: reiniciar la demo con recargas pendientes no debe acreditar nada en el estado nuevo.
function relojFalso({ ignorarCancelacion = false } = {}) {
  const cola = new Map(); let sig = 0;
  return {
    setTimeout: (fn) => { cola.set(++sig, fn); return sig; },
    clearTimeout: (id) => { if (!ignorarCancelacion) cola.delete(id); },
    vencerTodo: () => { const fns = [...cola.values()]; cola.clear(); fns.forEach((f) => f()); },
    get enCola() { return cola.size; },
  };
}
function simularApp(reloj) {
  // Mismo patrón que app.js: estado global reemplazado por iniciar(), recarga con temporizador.
  const sesion = S.crearSesion(reloj);
  const app = { st: null, avisos: 0 };
  app.iniciar = () => { sesion.reiniciar(); app.st = L.crearEstado(); app.avisos = 0; };
  app.pagar = (ref, alumnoId, centavos) => sesion.despues(() => {
    L.acreditarRecarga(app.st, { referencia: ref, alumnoId, centavos, ahora: T });
    app.avisos++;
  }, 1200);
  app.iniciar();
  return app;
}
caso("A1: reinicio con dos recargas pendientes no acredita en el estado nuevo", () => {
  const reloj = relojFalso(), app = simularApp(reloj);
  app.pagar("R1", "a1", 5000); app.pagar("R2", "a2", 5000);
  app.iniciar();
  igual(reloj.enCola, 0, "temporizadores cancelados");
  reloj.vencerTodo();
  igual(L.saldo(app.st, "a1"), 0); igual(L.saldo(app.st, "a2"), 0);
  igual(app.st.asientos.length, 0, "sin asientos tardíos"); igual(app.avisos, 0, "sin avisos tardíos");
});
caso("A1: aunque un temporizador viejo se dispare, la generación lo descarta", () => {
  const reloj = relojFalso({ ignorarCancelacion: true }), app = simularApp(reloj);
  app.pagar("R1", "a1", 5000); app.pagar("R2", "a1", 5000);
  app.iniciar();
  reloj.vencerTodo();
  igual(L.saldo(app.st, "a1"), 0); igual(app.st.asientos.length, 0); igual(app.avisos, 0);
});
caso("A1: una recarga después del reinicio sí se acredita", () => {
  const reloj = relojFalso(), app = simularApp(reloj);
  app.pagar("R1", "a1", 5000);
  app.iniciar();
  app.pagar("R2", "a1", 2000);
  reloj.vencerTodo();
  igual(L.saldo(app.st, "a1"), 2000); igual(app.avisos, 1);
});

log(`\n${n - fallas}/${n} pruebas pasaron`);
if (fallas) { if (typeof process !== "undefined") process.exit(1); else imports.system.exit(1); }
