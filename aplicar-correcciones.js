/*
 * aplicar-correcciones.js — Pasa las correcciones de `correcciones.js` por todos
 * los archivos de `data/`. No toca la red y se puede correr las veces que sea:
 * si ya está aplicado, no escribe nada.
 *
 * Uso: node aplicar-correcciones.js
 */
const fs = require('fs');
const path = require('path');
const { aplicar } = require('./correcciones');

const DATA = path.join(__dirname, 'data');
const archivos = [];
fs.readdirSync(DATA).forEach(function (f) {
  if (f.endsWith('.json')) archivos.push(path.join(DATA, f));
});
const CARRERAS = path.join(DATA, 'carreras');
if (fs.existsSync(CARRERAS)) {
  fs.readdirSync(CARRERAS).forEach(function (f) {
    if (f.endsWith('.json')) archivos.push(path.join(CARRERAS, f));
  });
}

let tocados = 0, total = 0;
archivos.forEach(function (f) {
  let j;
  try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return; }
  const n = aplicar(j, null);
  if (!n) return;
  fs.writeFileSync(f, JSON.stringify(j));
  tocados++; total += n;
  console.log('  ' + path.relative(__dirname, f) + ': ' + n + (n === 1 ? ' nombre' : ' nombres'));
});
console.log(total ? 'Corregidos ' + total + ' nombres en ' + tocados + ' archivos.' : 'Nada por corregir.');
