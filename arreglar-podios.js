/*
 * arreglar-podios.js — Rellena los uid que faltan en los podios ya guardados.
 *
 * El resumen oficial de r2sports (viewResults) entrega los nombres del podio sin
 * identificador, así que un tercer lugar no se le contaba a nadie: Juan Martinez
 * aparecía 3º en la Segunda Fecha 2026 y su perfil mostraba cero bronces.
 * generar-datos.js ya resuelve esto al bajar, pero los torneos viejos están
 * congelados y volver a bajarlos gasta pedidos contra una fuente que bloquea.
 * Esto arregla los archivos existentes sin tocar la red.
 *
 * Uso: node arreglar-podios.js
 */
const fs = require('fs');
const path = require('path');
const DATA = path.join(__dirname, 'data');

const SUFIJO = /^(jr|sr|ii|iii|iv|i|v)$/;
function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}
function partes(s) {
  const t = norm(s).split(' ').filter(Boolean); let suf = '';
  while (t.length > 1 && SUFIJO.test(t[t.length - 1])) suf = t.pop();
  return { toks: t, suf: suf };
}
const kFull = s => { const p = partes(s); return p.toks.join(' ') + (p.suf ? '#' + p.suf : ''); };
const kLI = s => { const p = partes(s); return p.toks.length ? p.toks[p.toks.length - 1] + '|' + p.toks[0][0] + (p.suf ? '#' + p.suf : '') : ''; };

let tocados = 0, resueltos = 0, sinResolver = [];
fs.readdirSync(DATA).filter(f => /^\d+\.json$/.test(f)).forEach(function (f) {
  const file = path.join(DATA, f);
  const T = JSON.parse(fs.readFileSync(file, 'utf8'));
  const idx = { full: {}, li: {} };
  (T.players || []).forEach(function (p) {
    if (!p.uid) return;
    (idx.full[kFull(p.name)] = idx.full[kFull(p.name)] || []).push(p);
    const l = kLI(p.name); if (l) (idx.li[l] = idx.li[l] || []).push(p);
  });
  let cambio = false;
  ((T.results || {}).divisions || []).forEach(function (d) {
    (d.placements || []).forEach(function (pl) {
      (pl.players || []).forEach(function (x) {
        if (x.uid) return;
        const cand = (idx.full[kFull(x.name)] || []).length === 1 ? idx.full[kFull(x.name)]
          : ((idx.li[kLI(x.name)] || []).length === 1 ? idx.li[kLI(x.name)] : null);
        if (cand) { x.uid = cand[0].uid; cambio = true; resueltos++; }
        else sinResolver.push(T.tid + ' · ' + x.name);
      });
    });
  });
  if (cambio) { fs.writeFileSync(file, JSON.stringify(T)); tocados++; }
});
console.log(`Archivos corregidos: ${tocados} · nombres del podio con uid nuevo: ${resueltos}`);
if (sinResolver.length) {
  console.log(`Sin resolver (${sinResolver.length}), no estaban en la lista de inscritos:`);
  Array.from(new Set(sinResolver)).slice(0, 10).forEach(x => console.log('   ' + x));
}
