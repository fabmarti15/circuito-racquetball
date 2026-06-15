/*
 * ranking.js — Puntaje y ranking del Circuito Nacional según FECHIRA.
 * Cuadro Olímpico: los puntos dependen del cuadro (Oro/Plata/Bronce/Blanco)
 * y de la posición final. El ranking se agrupa por categoría base.
 * Funciona en Node y en el navegador.
 */
(function (root, factory) {
  const api = factory(typeof require === 'function' ? require('./parser.js') : (typeof self !== 'undefined' ? self.R2 : this.R2));
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.R2Rank = api;
})(typeof self !== 'undefined' ? self : this, function (R2) {
  'use strict';

  // Tabla oficial FECHIRA (Reglamento Técnico / Bases Circuito Nacional).
  // Bandas de posición: [1°, 2°, 3°/4°, 5°-8°, 9°-16°]
  const PUNTOS = {
    oro: [1400, 1100, 1000, 800, 700],
    plata: [600, 400, 375, 300, 275],
    bronce: [250, 225, 200, 150, 125],
    blanco: [100, 75, 50, 25, 15]
  };
  function banda(rank) {
    if (rank === 1) return 0;
    if (rank === 2) return 1;
    if (rank <= 4) return 2;
    if (rank <= 8) return 3;
    return 4;
  }
  function puntos(nivel, rank) {
    const t = PUNTOS[nivel] || PUNTOS.oro;
    return t[banda(rank)] || 0;
  }
  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
  function byPts(a, b) { return (b.points - a.points) || a.name.localeCompare(b.name); }

  // tournaments: [{ tid, year, dateKey, results:{divisions:[{name,nameEs,placements:[{rank,players:[{uid,name}]}]}]} }]
  function computeRankings(tournaments) {
    const sorted = tournaments.slice().sort(function (a, b) { return String(b.dateKey || '').localeCompare(String(a.dateKey || '')); });
    const last4 = sorted.slice(0, 4).map(function (t) { return String(t.tid); });
    const cats = {};
    tournaments.forEach(function (t) {
      const divs = (t.results && t.results.divisions) || [];
      divs.forEach(function (d) {
        const nivel = R2.nivelCuadro(d.name);
        const label = R2.categoriaBase(d.nameEs || R2.traducirCategoria(d.name));
        const key = norm(label);
        if (!key) return;
        (d.placements || []).forEach(function (pl) {
          const pts = puntos(nivel, pl.rank);
          if (!pts) return;
          (pl.players || []).forEach(function (p) {
            const id = p.uid || ('n:' + norm(p.name));
            const C = cats[key] || (cats[key] = { key: key, label: label, players: {} });
            const rec = C.players[id] || (C.players[id] = { uid: p.uid || '', name: p.name, perYear: {}, perTid: {}, total: 0, tids: {} });
            if (!rec.name) rec.name = p.name;
            rec.total += pts;
            rec.perYear[t.year] = (rec.perYear[t.year] || 0) + pts;
            rec.perTid[t.tid] = (rec.perTid[t.tid] || 0) + pts;
            rec.tids[t.tid] = true;
          });
        });
      });
    });
    const years = Array.from(new Set(tournaments.map(function (t) { return String(t.year); }))).sort().reverse();
    const out = { updatedAt: new Date().toISOString(), years: years, officialTids: last4, categories: [] };
    Object.keys(cats).forEach(function (k) {
      const C = cats[k];
      const players = Object.keys(C.players).map(function (id) { return C.players[id]; });
      const cat = { key: C.key, label: C.label, years: {}, all: [], official: [] };
      cat.all = players.map(function (p) { return { uid: p.uid, name: p.name, points: p.total, played: Object.keys(p.tids).length }; })
        .filter(function (e) { return e.points > 0; }).sort(byPts);
      years.forEach(function (y) {
        cat.years[y] = players.map(function (p) { return { uid: p.uid, name: p.name, points: p.perYear[y] || 0, played: 0 }; })
          .filter(function (e) { return e.points > 0; }).sort(byPts);
      });
      cat.official = players.map(function (p) {
        let pts = 0; last4.forEach(function (tid) { pts += p.perTid[tid] || 0; });
        return { uid: p.uid, name: p.name, points: pts, played: 0 };
      }).filter(function (e) { return e.points > 0; }).sort(byPts);
      if (cat.all.length >= 2) out.categories.push(cat);
    });
    out.categories.sort(function (a, b) { return a.label.localeCompare(b.label); });
    return out;
  }

  return { PUNTOS: PUNTOS, puntos: puntos, computeRankings: computeRankings, norm: norm };
});
