const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const HL = require('./horarios-llaves');
const completar = require('./resultados-llaves');
const ventana = require('./ventana-en-vivo');
let pruebas = 0;
function probar(nombre, fn) { fn(); pruebas++; console.log('✓ ' + nombre); }
const celda = s => '<td>' + s + '</td>';
const slot = s => '<td style="border-bottom:1pt solid"><b>' + s + '</b></td>';
const hora = '<font color="#006600">SA</font><font color="#FF0000">9:00 AM</font>';
probar('El panel de navegación no agrega partidos y el playoff numérico conserva su ronda', () => {
  const h = slot('Persona Uno') + celda(hora + 'BJCP11') + slot('Persona Dos') + celda('<a href="javascript:viewBracket(1,0)">MO1</a>');
  const p = HL(h, [], 'BJCP1');
  assert.equal(p.cuadro.niveles.length, 1); assert.equal(p.cuadro.niveles[0].nivel, 0);
  assert.equal(p.cuadro.niveles[0].partidos.length, 1);
});
probar('Un código ajeno a la división se descarta', () => {
  const p = HL(slot('Uno') + celda(hora + 'MOL3') + slot('Dos'), [], 'MO');
  assert.equal(p.cuadro.niveles.length, 0);
});
function filaRR(jugado) {
  return '<tr>' + celda('<font size="3"><b>1</b></font>') + celda('1 vs 2') +
    celda('<font size="2"><font color="' + (jugado ? '#0000FF' : '#000000') + '">Persona Uno' + (jugado ? ' - W' : '') + '</font><font color="#006600">' + (jugado ? '' : 'vs.') + '</font><font color="#000000">Persona Dos</font></font>') +
    celda(hora) + celda(jugado ? '11-8, 9-11, 11-7, 11-2' : '') + celda('<a href="javascript:viewAppMatch(123)">MN 1</a>') + '</tr>';
}
probar('Round robin conserva la fila jugada sin vs. y su ganador y sets', () => {
  const p = HL('Round Robin Participant Schedule' + filaRR(true), [], 'MN');
  assert.equal(p.cuadro.partidos.length, 1); assert.equal(p.cuadro.partidos[0].ganador, 'Persona Uno');
  assert.equal(p.cuadro.partidos[0].marcador, '11-8, 9-11, 11-7, 11-2');
  assert.equal(HL('Round Robin Participant Schedule' + filaRR(false), [], 'MN').matches.length, 1);
});
probar('Doble eliminación usa lista y no inventa un árbol', () => {
  assert.equal(HL('Double Elimination' + slot('Uno') + celda(hora + 'MO1') + slot('Dos'), [], 'MO').cuadro.tipo, 'lista');
});
function torneo(repetido) {
  const m = { code: 'MO3', nivel: 2, pos: 0, p1: 'Persona Uno', p2: 'Persona Dos' };
  return { players: [{ uid: '1', name: 'Persona Uno' }, { uid: '2', name: 'Persona Dos' }],
    cuadros: { '2_0': { divID: '2', combinedID: '0', nombre: 'Open', niveles: [{ partidos: repetido ? [m, { ...m, code: 'MO1' }] : [m] }] } },
    brackets: { '2_0': { rounds: [{ matches: [{ a: { name: 'Persona Uno' }, b: { name: 'Persona Dos' }, winner: 'b', rawScore: '11-3, 11-4, 11-5', games: [{w:11,l:3},{w:11,l:4},{w:11,l:5}] }] }] } },
    matches: [], schedule: [{ code: 'MO3', divID: '2', combinedID: '0' }] };
}
probar('Los sets pertenecen al ganador inferior y el partido terminado sale de la agenda', () => {
  const t = completar(torneo(false)); assert.equal(t.matches[0].ganador.uid, '2');
  assert.equal(t.matches[0].games[0].w, 11); assert.equal(t.schedule.length, 0);
  completar(t); assert.equal(t.matches.length, 1);
});
probar('Un cruce repetido no recibe un marcador ambiguo', () => { assert.equal(completar(torneo(true)).matches.length, 0); });
probar('La ventana de juego respeta el cambio de hora de Chile', () => {
  const ts = [{startDate:'9/4/2026',endDate:'9/6/2026'}];
  assert.equal(ventana(new Date('2026-09-05T12:00:00Z'),ts),true);
  assert.equal(ventana(new Date('2026-09-06T11:00:00Z'),ts),true);
  assert.equal(ventana(new Date('2026-09-06T10:59:00Z'),ts),false);
  assert.equal(ventana(new Date('2026-09-07T12:00:00Z'),ts),false);
});
probar('La página compila y los datos tienen todos los cuadros', () => {
  new vm.Script(fs.readFileSync('index.html','utf8').match(/<script>\s*([\s\S]*?)<\/script>/)[1]);
  const t = completar(JSON.parse(fs.readFileSync('data/54387.json')));
  assert.equal(Object.keys(t.cuadros).length, 13);
  for (const m of t.matches.filter(m=>m.fuente==='llave')) {
    assert(m.ganador.name && m.perdedor.name && m.marcador);
    assert(!t.schedule.some(s=>s.code===m.code && s.divID===m.divID && s.combinedID===m.combinedID));
  }
});
console.log(pruebas + ' comprobaciones correctas');
