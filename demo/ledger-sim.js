// Ledger simulado en memoria para la demo. NO es el ledger real (ver docs/contratos/ledger.md).
// Imita las reglas de dominio: centavos enteros, asientos inmutables, reversos, idempotencia.
(function (raiz) {
  const PRODUCTOS = [
    { id: "agua", nombre: "Agua natural 600 ml", precio: 1000, categoria: "bebidas", alergenos: [], sellos: [] },
    { id: "fruta", nombre: "Fruta picada", precio: 1500, categoria: "frutas", alergenos: [], sellos: [] },
    { id: "torta", nombre: "Torta de frijol", precio: 2000, categoria: "comida", alergenos: ["gluten"], sellos: [] },
    { id: "yogur", nombre: "Yogur natural", precio: 1200, categoria: "lácteos", alergenos: ["leche"], sellos: [] },
    { id: "palomitas", nombre: "Palomitas naturales", precio: 800, categoria: "botanas", alergenos: [], sellos: [] },
    { id: "galletas", nombre: "Galletas rellenas", precio: 1400, categoria: "botanas", alergenos: ["gluten", "leche"], sellos: ["EXCESO AZÚCARES", "EXCESO GRASAS SATURADAS"] },
  ];
  const ANULACION_MS = 2 * 60 * 1000;

  // RF-16: un producto con sellos o leyendas no puede publicarse.
  const publicable = (p) => p.sellos.length === 0;

  function crearEstado() {
    return {
      alumnos: {
        // Alumnos ficticios. Sin nombres reales, fotos ni alergias reales.
        a1: { iniciales: "L. R.", grupo: "3°B", pulsera: "tag-7F3A", alergenos: ["leche"], tope: 4000, bloqueada: false },
        a2: { iniciales: "M. T.", grupo: "5°A", pulsera: "tag-91C2", alergenos: [], tope: 3000, bloqueada: false },
      },
      asientos: [], idem: {}, recargas: {}, cobros: {}, sec: 0,
    };
  }

  const dia = (ms) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });

  function asentar(st, tipo, ref, partidas, ahora) {
    const debe = partidas.reduce((s, p) => s + (p.debe || 0), 0);
    const haber = partidas.reduce((s, p) => s + (p.haber || 0), 0);
    if (debe !== haber) throw new Error("Asiento descuadrado");
    const n = ++st.sec;
    for (const p of partidas) st.asientos.push(Object.freeze({ n, ahora, tipo, ref, cuenta: p.cuenta, debe: p.debe || 0, haber: p.haber || 0 }));
    return n;
  }

  function saldo(st, alumnoId) {
    const cta = "ANTICIPO:" + alumnoId;
    return st.asientos.filter((a) => a.cuenta === cta).reduce((s, a) => s + a.haber - a.debe, 0);
  }

  function acreditarRecarga(st, { referencia, alumnoId, centavos, ahora }) {
    if (!Number.isInteger(centavos) || centavos <= 0) throw new Error("Monto inválido");
    const previa = st.recargas[referencia];
    if (previa) return { ...previa, repetido: true }; // una sola acreditación por transacción
    const n = asentar(st, "RECARGA_CODI", referencia, [
      { cuenta: "BANCO_COOPERATIVA", debe: centavos },
      { cuenta: "ANTICIPO:" + alumnoId, haber: centavos },
    ], ahora);
    return (st.recargas[referencia] = { ok: true, asiento: n, alumnoId, centavos });
  }

  function gastadoHoy(st, alumnoId, ahora) {
    const cta = "ANTICIPO:" + alumnoId, hoy = dia(ahora);
    return st.asientos.filter((a) => a.cuenta === cta && (a.tipo === "COBRO" || a.tipo === "REVERSO") && dia(a.ahora) === hoy)
      .reduce((s, a) => s + a.debe - a.haber, 0);
  }

  // RF-11/RF-12: validación completa y débito en un solo paso, con llave de idempotencia.
  function cobrar(st, { pulsera, items, llave, ahora }) {
    if (st.idem[llave]) return { ...st.idem[llave], repetido: true };
    const r = validarYCobrar(st, pulsera, items, llave, ahora);
    st.idem[llave] = r;
    return r;
  }

  function validarYCobrar(st, pulsera, items, llave, ahora) {
    const id = Object.keys(st.alumnos).find((k) => st.alumnos[k].pulsera === pulsera);
    if (!id) return { ok: false, motivo: "Pulsera no registrada" };
    const al = st.alumnos[id];
    if (al.bloqueada) return { ok: false, alumnoId: id, motivo: "Pulsera suspendida por el tutor" };
    if (!items.length) return { ok: false, alumnoId: id, motivo: "Carrito vacío" };
    let total = 0;
    for (const it of items) {
      const p = PRODUCTOS.find((x) => x.id === it.id);
      if (!p || !publicable(p)) return { ok: false, alumnoId: id, motivo: `${p ? p.nombre : it.id} no está a la venta (sellos SEP)` };
      const choque = p.alergenos.find((a) => al.alergenos.includes(a));
      if (choque) return { ok: false, alumnoId: id, motivo: `${p.nombre} contiene ${choque}, bloqueado por el tutor`, regla: "alergeno" };
      total += p.precio * it.qty; // el precio lo pone el servidor, no la caja
    }
    if (gastadoHoy(st, id, ahora) + total > al.tope) return { ok: false, alumnoId: id, motivo: "Supera el tope diario del tutor", regla: "tope" };
    if (saldo(st, id) < total) return { ok: false, alumnoId: id, motivo: "Saldo insuficiente", regla: "saldo" };
    const n = asentar(st, "COBRO", llave, [
      { cuenta: "ANTICIPO:" + id, debe: total },
      { cuenta: "VENTAS_COOPERATIVA", haber: total },
    ], ahora);
    st.cobros[llave] = { alumnoId: id, total, ahora, anulado: false };
    return { ok: true, alumnoId: id, total, asiento: n, cobro: llave };
  }

  // RF-13: anulación dentro de 2 minutos mediante reverso; el cobro original no se toca.
  function anular(st, { cobro, ahora }) {
    const c = st.cobros[cobro];
    if (!c) return { ok: false, motivo: "Cobro inexistente" };
    if (c.anulado) return { ok: false, motivo: "Ya estaba anulado" };
    if (ahora - c.ahora > ANULACION_MS) return { ok: false, motivo: "Pasaron más de 2 minutos" };
    const n = asentar(st, "REVERSO", cobro, [
      { cuenta: "VENTAS_COOPERATIVA", debe: c.total },
      { cuenta: "ANTICIPO:" + c.alumnoId, haber: c.total },
    ], ahora);
    c.anulado = true;
    return { ok: true, asiento: n, alumnoId: c.alumnoId, total: c.total };
  }

  const api = { PRODUCTOS, publicable, crearEstado, saldo, acreditarRecarga, cobrar, anular, gastadoHoy };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else raiz.LedgerSim = api;
})(this);
