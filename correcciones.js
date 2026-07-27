/*
 * correcciones.js — Datos que r2sports publicó incompletos y que se corrigieron a
 * mano con quien estuvo en la cancha.
 *
 * Por qué existe: r2sports es la fuente y no se edita a mano nunca, pero a veces
 * publica un partido con el rival sin nombre. Si se parcha el archivo bajado, la
 * próxima bajada lo pisa. Así que la corrección vive acá, en el código, y se
 * vuelve a aplicar cada vez (`aplicar-correcciones.js`, y desde los generadores).
 *
 * Regla: cada entrada dice quién la confirmó. Nada se adivina.
 */

const NOMBRES = [
  {
    tid: '54324',                                  // Nacional Junior, julio 2026
    de: 'Wildcard',
    a: { uid: '626232', name: 'Juan Martinez' },
    // r2sports dejó la semifinal de Singles Juveniles A con un "Wildcard" sin
    // nombre: Rubén Igor ganó 11-2, 11-1, 11-4. Los otros tres del playoff eran
    // los ganadores de los tres grupos; el cupo libre le tocaba al mejor segundo,
    // que fue Juan José (2º del Grupo 2, solo perdió con Benjamín Aguirre).
    // Sin esto, su semifinal no le contaba a nadie y en la llave se leía "Wildcard".
    confirmadoPor: 'Fabián (su papá), julio 2026'
  }
];

// Partidos que están en la llave pero que r2sports no publicó en el listado de
// partidos, que es de donde salen los podios. Sin esto, la semifinal existía en el
// cuadro pero el podio mostraba un solo semifinalista.
const PARTIDOS = [
  {
    tid: '54324',
    division: 'Singles Juveniles A Por puestos',
    divisionRaw: "Boy's Singles: Juniors A Playoff",
    divID: '0', combinedID: '237628', round: 'Semis', day: '', time: '',
    ganador: { uid: '590557', name: 'Ruben Igor', loc: 'Temuco, La Araucanía' },
    perdedor: { uid: '626232', name: 'Juan Martinez', loc: 'Santiago' },
    lado1: [{ uid: '590557', name: 'Ruben Igor' }],
    lado2: [{ uid: '626232', name: 'Juan Martinez' }],
    marcador: '11-2, 11-1, 11-4',
    games: [{ w: 11, l: 2 }, { w: 11, l: 1 }, { w: 11, l: 4 }],
    forfeit: false,
    // Está en la llave (`brackets['0_237628']`) y en la carrera de Rubén Igor, pero
    // no en `matches`, que es lo que arma el podio.
    confirmadoPor: 'llave de r2sports + Fabián'
  }
];

// Recorre cualquier JSON de datos y reemplaza los nombres pendientes. El torneo se
// toma del `tid` más cercano hacia arriba: el archivo de un torneo lo trae en la
// raíz, y el histórico lo trae partido por partido.
function aplicar(raiz, tidPorDefecto) {
  let hechos = 0;
  (function anda(v, tid) {
    if (Array.isArray(v)) { v.forEach(function (x) { anda(x, tid); }); return; }
    if (!v || typeof v !== 'object') return;
    const t = v.tid != null ? String(v.tid) : tid;
    NOMBRES.forEach(function (c) {
      if (String(c.tid) !== String(t)) return;
      if (v.name === c.de) { v.name = c.a.name; if (c.a.uid) v.uid = c.a.uid; hechos++; }
      if (v.nombre === c.de) { v.nombre = c.a.name; if (c.a.uid) v.uid = c.a.uid; hechos++; }
    });
    Object.keys(v).forEach(function (k) { anda(v[k], t); });
  })(raiz, tidPorDefecto != null ? String(tidPorDefecto) : null);
  hechos += agregarPartidos(raiz);
  return hechos;
}

// Solo para el archivo de un torneo: agrega los partidos que faltan, y nunca dos
// veces (si algún día r2sports lo publica, este no se agrega).
function agregarPartidos(t) {
  if (!t || !Array.isArray(t.matches) || t.tid == null) return 0;
  let n = 0;
  PARTIDOS.forEach(function (p) {
    if (String(p.tid) !== String(t.tid)) return;
    const ya = t.matches.some(function (m) {
      return m.division === p.division && String(m.round) === String(p.round) &&
        [(m.ganador || {}).uid, (m.perdedor || {}).uid].sort().join('|') ===
        [p.ganador.uid, p.perdedor.uid].sort().join('|');
    });
    if (ya) return;
    const copia = JSON.parse(JSON.stringify(p));
    delete copia.tid; delete copia.confirmadoPor;
    copia.aMano = true;
    t.matches.push(copia);
    n++;
  });
  return n;
}

module.exports = { NOMBRES: NOMBRES, PARTIDOS: PARTIDOS, aplicar: aplicar };
