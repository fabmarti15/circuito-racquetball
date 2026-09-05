/* Une las dos lecturas de una llave sin volver a consultar r2sports.
 * Un cruce repetido o un nombre ambiguo nunca recibe un marcador por aproximación.
 * Los games de bracket.js están en orden ganador/perdedor, no superior/inferior.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.completarResultados = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function norm(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 /]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function pareja(a, b) { return [norm(a), norm(b)].sort().join('|'); }
  function partidos(cu) { return cu.partidos || (cu.niveles || []).flatMap(function (r) { return r.partidos; }); }
  function completar(t) {
    if (!t) return t;
    var nuevos = [], existentes = t.matches || [];
    Object.keys(t.cuadros || {}).forEach(function (key) {
      var cu = t.cuadros[key], ms = partidos(cu);
      var fuentes = (((t.brackets || {})[key] || {}).rounds || []).flatMap(function (r) { return r.matches || []; });
      ms.forEach(function (m) {
        if (!m.p1 || !m.p2 || m.bye || m.marcador) return;
        var par = pareja(m.p1, m.p2);
        if (ms.filter(function (x) { return pareja(x.p1, x.p2) === par; }).length !== 1) return;
        var candidatos = fuentes.filter(function (x) { return x.a && x.b && pareja(x.a.name, x.b.name) === par; });
        if (candidatos.length !== 1) return;
        var f = candidatos[0], ganador = f.winner === 'a' ? f.a : f.winner === 'b' ? f.b : null;
        if (!ganador || (!f.rawScore && !f.forfeit)) return;
        m.marcador = f.rawScore || 'WBF'; m.games = f.games || []; m.forfeit = !!f.forfeit;
        m.ganador = norm(ganador.name) === norm(m.p1) ? m.p1 : m.p2;
      });
      ms.forEach(function (m) {
        if (!m.marcador || !m.ganador || !m.p1 || !m.p2 || m.bye) return;
        var perdedor = norm(m.ganador) === norm(m.p1) ? m.p2 : m.p1;
        function lado(nombre) {
          return nombre.split(/\s*\/\s*/).map(function (n) {
            var candidatos = (t.players || []).filter(function (p) { return norm(p.name) === norm(n); });
            return { name: n, uid: candidatos.length === 1 ? String(candidatos[0].uid || '') : '' };
          });
        }
        var gana = lado(m.ganador), pierde = lado(perdedor);
        var games = m.games && m.games.length ? m.games : Array.from(m.marcador.matchAll(/(\d+)\s*-\s*(\d+)/g), function (x) { return { w: +x[1], l: +x[2] }; });
        nuevos.push({ division: cu.nombre, divisionRaw: cu.nombreRaw, divID: cu.divID, combinedID: cu.combinedID,
          round: m.round, code: m.code, day: m.day, time: m.time, ganador: { name: m.ganador, uid: gana.length === 1 ? gana[0].uid : '' },
          perdedor: { name: perdedor, uid: pierde.length === 1 ? pierde[0].uid : '' }, lado1: gana, lado2: pierde,
          marcador: m.marcador, games: games, forfeit: !!m.forfeit, fuente: 'llave' });
      });
    });
    nuevos.forEach(function (m) {
      var donde = existentes.findIndex(function (x) {
        return String(x.divID) === String(m.divID) && String(x.combinedID || '0') === String(m.combinedID || '0') &&
          ((x.code && x.code === m.code) || (!x.code && pareja((x.ganador || {}).name, (x.perdedor || {}).name) === pareja(m.ganador.name, m.perdedor.name)));
      });
      if (donde < 0) existentes.push(m);
      else if (existentes[donde].fuente === 'llave') existentes[donde] = m;
    });
    t.matches = existentes;
    t.schedule = (t.schedule || []).filter(function (m) {
      return !existentes.some(function (x) { return x.code && x.code === m.code && String(x.divID) === String(m.divID) && String(x.combinedID || '0') === String(m.combinedID || '0'); });
    });
    if (t.counts) { t.counts.matches = existentes.length; t.counts.scheduled = t.schedule.length; }
    return t;
  }
  return completar;
});
