/*
 * generar-ranking-oficial.js — El ranking de la Federación, tal cual.
 *
 * Lee `fuentes/ranking-2026-06.md` (transcripción del PDF oficial) y escribe
 * `data/ranking-oficial.json`. La web muestra ESTOS puntos: no se calcula nada.
 * Antes la app usaba una tabla de puntaje inventada y mostraba a Christian Troncoso
 * 2100 como líder de Dobles Open cuando el oficial es Jaime Mansilla con 7200.
 *
 * Decisiones tomadas con Fabián:
 *  - El puesto se RECALCULA desde los puntos: la columna del PDF viene desordenada
 *    en Singles A y Junior Multibote (rank viejo, no recalculado).
 *  - Empate: gana el que jugó menos fechas. Es criterio nuestro, no de la
 *    Federación, y la web lo dice en pantalla.
 *  - "—" en una fecha significa sin dato, distinto de 0.
 *  - Dobles Open es MIXTO: no se le pone género al nombre de la categoría.
 *
 * Uso: node generar-ranking-oficial.js
 */
const fs = require('fs');
const path = require('path');

const FUENTE = path.join(__dirname, 'fuentes', 'ranking-2026-06.md');
const SALIDA = path.join(__dirname, 'data', 'ranking-oficial.json');
const CORTE = { etiqueta: 'junio 2026', archivo: '02__Ranking_Junio_2026.pdf', fuente: 'Federación Chilena de Racquetball' };

// Nombres de fecha legibles: en el PDF son abreviaturas y los rótulos vienen con
// errores (dos "2DA", falta la "4TA", sufijos "24" en fechas de 2026).
const FECHAS = {
  'F1 SCL': { corto: '1ª Santiago', orden: 1 },
  'F2 SCL': { corto: '2ª Santiago', orden: 2 },
  'F2 SCL 25': { corto: '2ª Santiago', orden: 2 },
  'NAC JR': { corto: 'Nacional Junior', orden: 3 },
  'TEM': { corto: '2ª Temuco', orden: 4 },
  'RAN': { corto: '3ª Rancagua', orden: 5 },
  'VDM': { corto: '5ª Viña del Mar', orden: 6 },
  'LSE': { corto: '6ª La Serena', orden: 7 }
};

function slug(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
function celdas(linea) {
  return linea.replace(/^\||\|$/g, '').split('|').map(function (c) { return c.trim(); });
}
function esSeparador(l) { return /^\|[\s:|-]+\|$/.test(l); }
function num(v) {
  if (v == null) return null;
  const t = String(v).trim();
  if (t === '' || t === '—' || t === '-' || t === '–') return null;
  const n = parseInt(t.replace(/[^\d-]/g, ''), 10);
  return isFinite(n) ? n : null;
}

const texto = fs.readFileSync(FUENTE, 'utf8').split(/\r?\n/);
const categorias = [];
let actual = null, cab = null;

texto.forEach(function (linea) {
  const tit = linea.match(/^##\s+(\d+)\.\s+(.+?)\s*(?:\(([^)]*)\))?\s*$/);
  if (tit) {
    actual = { n: +tit[1], label: tit[2].trim(), nota: tit[3] || '', jugadores: [] };
    actual.key = slug(actual.label);
    categorias.push(actual);
    cab = null;
    return;
  }
  if (/^##\s+[A-G]\./.test(linea)) { actual = null; return; }  // empiezan las notas de auditoría
  if (!actual || linea.indexOf('|') !== 0) return;
  if (esSeparador(linea)) return;

  const c = celdas(linea);
  const esCabecera = /jugador/i.test(c.join(' ')) && /ciudad|pts|#/i.test(c.join(' '));
  if (esCabecera) {
    cab = c.map(function (x) { return x.replace(/\*\*/g, '').trim(); });
    return;
  }
  if (!cab) return;

  const idx = function (re) { return cab.findIndex(function (x) { return re.test(x); }); };
  const iNom = idx(/^Jugador(a)?$/i);
  const iCiu = idx(/^Ciudad$/i);
  const iPts = idx(/^PTS$/i);
  const iDef = idx(/^DEF$/i);
  const iPdf = idx(/^#( PDF)?$/i);
  if (iNom < 0) return;
  const nombre = c[iNom];
  if (!nombre || /^—$/.test(nombre)) return;   // fila fantasma del PDF: no se importa

  const fechas = [];
  cab.forEach(function (h, i) {
    if (i === iNom || i === iCiu || i === iPts || i === iDef || i === iPdf) return;
    if (/orden real/i.test(h)) return;
    const meta = FECHAS[h] || { corto: h, orden: 90 };
    fechas.push({ col: h, nombre: meta.corto, orden: meta.orden, pts: num(c[i]) });
  });
  fechas.sort(function (a, b) { return a.orden - b.orden; });

  const pts = iPts >= 0 ? (num(c[iPts]) || 0) : fechas.reduce(function (s, f) { return s + (f.pts || 0); }, 0);
  actual.jugadores.push({
    nombre: nombre,
    ciudad: iCiu >= 0 ? (c[iCiu] || '') : '',
    fechas: fechas,
    jugadas: fechas.filter(function (f) { return (f.pts || 0) > 0; }).length,
    pts: pts,
    def: iDef >= 0 ? (num(c[iDef]) || 0) : null,
    puestoPdf: iPdf >= 0 ? num(c[iPdf]) : null
  });
});

// Puesto recalculado. Empate: menos fechas jugadas primero (criterio nuestro).
categorias.forEach(function (cat) {
  cat.jugadores.sort(function (a, b) {
    return (b.pts - a.pts) || (a.jugadas - b.jugadas) || a.nombre.localeCompare(b.nombre, 'es');
  });
  let puesto = 0, antPts = null, antJug = null, mismos = 0;
  cat.jugadores.forEach(function (p, i) {
    const empata = antPts === p.pts && antJug === p.jugadas;
    if (empata) { mismos++; p.puesto = puesto; p.empatado = true; }
    else { puesto = i + 1; mismos = 0; p.puesto = puesto; p.empatado = false; antPts = p.pts; antJug = p.jugadas; }
  });
  // marcar también al primero de cada empate
  cat.jugadores.forEach(function (p, i) {
    const sig = cat.jugadores[i + 1];
    if (sig && sig.puesto === p.puesto) p.empatado = true;
  });
  // Filas repetidas dentro de la misma categoría (el PDF trae a Emilio Mañan dos
  // veces en Junior B, con 700 y con 0). Se conserva la de más puntos y se anota.
  const porNombre = {};
  cat.duplicados = [];
  cat.jugadores = cat.jugadores.filter(function (p) {
    const k = p.nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (porNombre[k]) {
      cat.duplicados.push({ nombre: p.nombre, ptsDescartados: p.pts, ptsUsados: porNombre[k].pts });
      return false;
    }
    porNombre[k] = p;
    return true;
  });
  cat.total = cat.jugadores.length;
  cat.conPuntos = cat.jugadores.filter(function (p) { return p.pts > 0; }).length;
  cat.lider = cat.jugadores[0] ? { nombre: cat.jugadores[0].nombre, pts: cat.jugadores[0].pts } : null;
  cat.fechas = (cat.jugadores[0] ? cat.jugadores[0].fechas : []).map(function (f) { return { col: f.col, nombre: f.nombre }; });
  // ¿El PDF venía realmente desordenado? Se mira si, siguiendo SU propio orden,
  // los puntos bajan de forma monótona. Comparar puesto contra puesto marcaría
  // como error cualquier empate reordenado por nuestro criterio, y no lo es.
  const enOrdenPdf = cat.jugadores.filter(function (p) { return p.puestoPdf != null; })
    .sort(function (a, b) { return a.puestoPdf - b.puestoPdf; });
  cat.desordenEnPdf = enOrdenPdf.some(function (p, i) {
    return i > 0 && p.pts > enOrdenPdf[i - 1].pts;
  });
});

const salida = {
  updatedAt: new Date().toISOString(),
  corte: CORTE,
  desempate: 'Con los mismos puntos, primero el que jugó menos fechas (criterio de esta web, no de la Federación).',
  categorias: categorias.map(function (c) {
    return {
      key: c.key, label: c.label, n: c.n, total: c.total, conPuntos: c.conPuntos,
      lider: c.lider, fechas: c.fechas, desordenEnPdf: c.desordenEnPdf,
      filasPdf: c.total + c.duplicados.length, duplicados: c.duplicados,
      jugadores: c.jugadores
    };
  })
};
fs.mkdirSync(path.dirname(SALIDA), { recursive: true });
fs.writeFileSync(SALIDA, JSON.stringify(salida));

console.log(`Ranking oficial · corte ${CORTE.etiqueta} · ${salida.categorias.length} categorías`);
salida.categorias.forEach(function (c) {
  console.log(`  ${String(c.n).padStart(2)} ${c.label.padEnd(22)} ${String(c.total).padStart(3)} jug (${c.conPuntos} con puntos) · líder ${c.lider ? c.lider.nombre + ' ' + c.lider.pts : '—'}${c.desordenEnPdf ? '  [el PDF venía desordenado]' : ''}`);
});
