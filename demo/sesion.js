// Temporizadores ligados a la sesión de la demo (A1).
// Al reiniciar se cancelan todos los pendientes y, por si alguno ya estaba en cola,
// cada callback comprueba que su sesión sigue activa antes de ejecutarse.
(function (raiz) {
  function crearSesion(reloj) {
    const programar = reloj ? reloj.setTimeout : (fn, ms) => setTimeout(fn, ms);
    const cancelar = reloj ? reloj.clearTimeout : (id) => clearTimeout(id);
    let generacion = 0;
    const pendientes = new Set();
    return {
      despues(fn, ms) {
        const g = generacion;
        const id = programar(() => {
          pendientes.delete(id);
          if (g === generacion) fn();
        }, ms);
        pendientes.add(id);
        return id;
      },
      reiniciar() {
        generacion++;
        for (const id of pendientes) cancelar(id);
        pendientes.clear();
      },
      get pendientes() { return pendientes.size; },
    };
  }
  if (typeof module !== "undefined" && module.exports) module.exports = { crearSesion };
  else raiz.SesionDemo = { crearSesion };
})(this);
