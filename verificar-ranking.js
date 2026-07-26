/*
 * verificar-ranking.js — Comprueba que el ranking importado calce con el PDF.
 *
 * Los valores esperados son el checklist que Fabián sacó del PDF oficial. Si algo
 * no calza, esto falla y NO se publica un ranking equivocado.
 *
 * Uso: node verificar-ranking.js
 */
const fs = require('fs');
const path = require('path');
const R = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'ranking-oficial.json'), 'utf8'));

const ESPERADO = [
  { label: 'Singles Open', total: 97, conPuntos: 60, lider: 'Jaime Mansilla', pts: 6100 },
  { label: 'Singles A', total: 51, lider: 'Alvaro Yañez', pts: 2200, empateCon: 'Joaquín Otero' },
  { label: 'Singles Inicial', total: 9, lider: 'Agustín Huilin', pts: 1400 },
  { label: 'Singles Damas', total: 16, lider: 'Paula Mansilla', pts: 4200 },
  { label: 'Dobles Open', total: 82, lider: 'Jaime Mansilla', pts: 7200 },
  { label: 'Junior A', total: 15, lider: 'Ruben Igor', pts: 1400 },
  { label: 'Junior B', total: 30, lider: 'Joaquin Catalan', pts: 5400 },
  { label: 'Junior C', total: 16, pts: 3500, empateEntre: ['Agustín Quilodran', 'Emilio Mañan'] },
  { label: 'Junior Damas', total: 7, lider: 'Catalina Guzman', pts: 1400 },
  { label: 'Junior Multibote', total: 25, lider: 'Emilio Mañan', pts: 3900 }
];

let fallas = 0;
function mal(msg) { console.error('  ✗ ' + msg); fallas++; }
function bien(msg) { console.log('  ✓ ' + msg); }

if (R.categorias.length !== 10) mal(`categorías: ${R.categorias.length}, se esperaban 10`);
else bien('10 categorías');

ESPERADO.forEach(function (e) {
  const c = R.categorias.find(function (x) { return x.label === e.label; });
  if (!c) return mal(`falta la categoría ${e.label}`);
  const errs = [];
  // El checklist cuenta las filas del PDF, incluidas las repetidas. La web muestra
  // los jugadores sin repetir, así que se compara filas contra filas.
  const filas = c.filasPdf != null ? c.filasPdf : c.total;
  if (filas !== e.total) errs.push(`filas ${filas} ≠ ${e.total}`);
  if (e.conPuntos != null && c.conPuntos !== e.conPuntos) errs.push(`con puntos ${c.conPuntos} ≠ ${e.conPuntos}`);
  const top = c.jugadores[0];
  if (!top) errs.push('sin jugadores');
  else {
    if (top.pts !== e.pts) errs.push(`puntos del líder ${top.pts} ≠ ${e.pts}`);
    if (e.lider && top.nombre !== e.lider) errs.push(`líder "${top.nombre}" ≠ "${e.lider}"`);
    if (e.empateEntre) {
      const dos = c.jugadores.slice(0, 2).map(function (p) { return p.nombre; });
      const calza = e.empateEntre.every(function (n) { return dos.indexOf(n) >= 0; });
      if (!calza) errs.push(`el empate arriba es ${dos.join(' y ')}, se esperaba ${e.empateEntre.join(' y ')}`);
    }
    if (e.empateCon) {
      const seg = c.jugadores[1];
      if (!seg || seg.pts !== e.pts) errs.push('no hay empate en el primer puesto');
    }
  }
  if (errs.length) mal(`${e.label}: ${errs.join(' · ')}`);
  else bien(`${e.label}: ${c.total} jugadores${c.duplicados && c.duplicados.length ? ' (+' + c.duplicados.length + ' fila repetida en el PDF)' : ''} · líder ${top.nombre} ${top.pts}`);
});

// Nadie con puntos negativos ni con más puntos que la suma de sus fechas.
R.categorias.forEach(function (c) {
  c.jugadores.forEach(function (p) {
    const suma = (p.fechas || []).reduce(function (s, f) { return s + (f.pts || 0); }, 0);
    if (p.pts < 0) mal(`${c.label} · ${p.nombre}: puntos negativos`);
    if (suma && p.pts !== suma) mal(`${c.label} · ${p.nombre}: PTS ${p.pts} ≠ suma de fechas ${suma}`);
  });
});

const unicos = new Set();
R.categorias.forEach(function (c) { c.jugadores.forEach(function (p) { unicos.add(p.nombre.toLowerCase()); }); });
console.log(`\nJugadores únicos por nombre: ${unicos.size}`);

if (fallas) { console.error(`\n${fallas} problema(s). El ranking NO está listo para publicar.`); process.exit(1); }
console.log('\nTodo calza con el PDF.');
