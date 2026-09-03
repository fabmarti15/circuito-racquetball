/*
 * generar-datos.js — Re-scrapea r2sports (directo, sin proxy) y escribe en data/:
 *   data/<TID>.json      un torneo (divisiones, jugadores, resultados, llaves, horarios)
 *   data/index.json      catálogo de torneos del circuito + categorías
 *   data/jugadores.json  índice de jugadores cruzado entre torneos
 *   data.json            torneo destacado (compatibilidad)
 *
 * Uso:
 *   node generar-datos.js            -> regenera TODO el circuito (lista CIRCUITO)
 *   node generar-datos.js 54277 ...  -> solo esos TIDs (igual reescribe catálogo/ranking)
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const R2 = require(path.join(__dirname, 'parser.js'));
const VB = require(path.join(__dirname, 'bracket.js'));
const CORRIGE = require(path.join(__dirname, 'correcciones.js'));
const HL = require(path.join(__dirname, 'horarios-llaves.js'));

const BASE = 'https://www.r2sports.com/tourney';
const UA = 'Mozilla/5.0 (compatible; CircuitoRacquetballChile/2.0; +https://github.com/fabmarti15/circuito-racquetball)';
const DATA = path.join(__dirname, 'data');
// r2sports bloquea por IP si se le pega muy seguido (pasó el 25-07-2026: devolvía
// "This IP has been blocked" y una corrida dejó el torneo sin horarios). Se limita
// el ritmo y se detecta el bloqueo para NUNCA sobrescribir datos buenos con vacío.
const PAUSA_MS = +(process.env.RQ_PAUSA || 900);
const CONCURRENCIA = +(process.env.RQ_CONCURRENCIA || 2);
class FuenteBloqueada extends Error {}
let ultimoGet = 0;
function esperaTurno() {
  const ahora = Date.now(), falta = ultimoGet + PAUSA_MS - ahora;
  ultimoGet = falta > 0 ? ultimoGet + PAUSA_MS : ahora;
  return falta > 0 ? new Promise(function (r) { setTimeout(r, falta); }) : Promise.resolve();
}
function revisarBloqueo(html) {
  if (/IP\s+has\s+been\s+blocked/i.test(html) || (html.length < 400 && /blocked/i.test(html))) {
    throw new FuenteBloqueada('r2sports bloqueó la IP');
  }
  return html;
}

// Fechas del Circuito Nacional de Chile en r2sports (descubiertas vía buscador
// sportID=1&countryID=114). Editar/añadir aquí cuando haya nuevas fechas.
const CIRCUITO = [
  '54387', '54324', '54277', '54093',    // 2026
  '51723', '51161', '49498',              // 2025
  '46544', '46095', '45666', '45351'      // 2024
];

function rawGet(u, redirects) {
  return new Promise(function (resolve, reject) {
    const lib = u.indexOf('http:') === 0 ? http : https;
    const req = lib.get(u, { headers: { 'User-Agent': UA, 'Accept-Language': 'es' } }, function (res) {
      if ([301, 302, 303, 307, 308].indexOf(res.statusCode) >= 0 && res.headers.location && redirects > 0) {
        let loc = res.headers.location;
        if (!/^https?:/i.test(loc)) loc = new URL(loc, u).toString();
        res.resume(); resolve(rawGet(loc, redirects - 1)); return;
      }
      const chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () { resolve(Buffer.concat(chunks)); });
    });
    req.on('error', reject);
    req.setTimeout(30000, function () { req.destroy(new Error('timeout')); });
  });
}
// r2sports mezcla codificaciones: la mayoría de páginas son iso-8859-1, pero los
// reportes de tourneyDay/ declaran charset=UTF-8. Decodificar todo como latin1
// rompía los acentos en horarios ("CatalÃ¡n"). Se decide por header y, si el
// header miente, por sniff del <meta> y de la validez del UTF-8.
function decodeBody(buf, contentType) {
  const ct = String(contentType || '').toLowerCase();
  const head = buf.slice(0, 2048).toString('latin1').toLowerCase();
  const metaUtf8 = /<meta[^>]+charset=["']?utf-8/.test(head);
  const declaraUtf8 = ct.indexOf('utf-8') >= 0 || metaUtf8;
  if (declaraUtf8) {
    const utf8 = buf.toString('utf8');
    if (utf8.indexOf('�') < 0) return utf8; // UTF-8 válido
  }
  return buf.toString('latin1');
}
async function unGet(u) {
  await esperaTurno();
  if (typeof fetch === 'function') {
    const r = await fetch(u, { headers: { 'User-Agent': UA, 'Accept-Language': 'es' }, redirect: 'follow' });
    return revisarBloqueo(decodeBody(Buffer.from(await r.arrayBuffer()), r.headers.get('content-type')));
  }
  return revisarBloqueo(decodeBody(await rawGet(u, 6), ''));
}
// El bloqueo de r2sports es temporal: en vez de abandonar la corrida, se espera y
// se reintenta un par de veces. Con esto una tanda de 10 minutos sobrevive a un
// bloqueo pasajero en lugar de dejar la web sin actualizar.
const ESPERAS_BLOQUEO = [60000, 150000];
async function g(u) {
  for (let intento = 0; ; intento++) {
    try { return await unGet(u); }
    catch (e) {
      const esperar = (e instanceof FuenteBloqueada) ? ESPERAS_BLOQUEO[intento] : null;
      if (!esperar) throw e;
      console.error(`  ⏳ bloqueados; esperando ${Math.round(esperar / 1000)} s antes de reintentar`);
      await new Promise(function (r) { setTimeout(r, esperar); });
    }
  }
}
async function pool(items, n, fn) {
  const res = []; let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length || 1) }, async function () {
    while (i < items.length) { const idx = i++; try { res[idx] = await fn(items[idx], idx); } catch (e) { res[idx] = null; } }
  });
  await Promise.all(workers);
  return res;
}
function parseDate(s) { const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? new Date(+m[3], +m[1] - 1, +m[2]) : null; }
function dateKey(s) { const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? m[3] + String(+m[1]).padStart(2, '0') + String(+m[2]).padStart(2, '0') : '0'; }
function yearOf(t) { const m = String(t.startDate || '').match(/\/(\d{4})/); return m ? m[1] : ''; }
function statusOf(t) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const s = parseDate(t.startDate), e = parseDate(t.endDate);
  if (e && e < today) return 'finished';
  if (s && s > today) return 'upcoming';
  return 'in-progress';
}
function teamKey(a, b) { return [String(a || '').toLowerCase(), String(b || '').toLowerCase()].sort().join('|'); }

// Escribe solo si el contenido cambió (ignorando 'updatedAt') -> no commitea por timestamps.
function stripTs(o) { var c = JSON.parse(JSON.stringify(o)); delete c.updatedAt; return c; }
function writeIfChanged(file, obj) {
  // Los nombres que r2sports dejó en blanco se vuelven a poner en cada bajada, si
  // no, la próxima pisaría la corrección (ver correcciones.js).
  try { CORRIGE.aplicar(obj, obj && obj.tid); } catch (e) { }
  var nextCmp = JSON.stringify(stripTs(obj));
  if (fs.existsSync(file)) {
    try { if (JSON.stringify(stripTs(JSON.parse(fs.readFileSync(file, 'utf8')))) === nextCmp) return false; } catch (e) { }
  }
  fs.writeFileSync(file, JSON.stringify(obj));
  return true;
}
// ¿Hay que volver a bajar este torneo? (los finalizados cacheados con resultados se congelan)
function needsScrape(cached) {
  if (!cached) return true;
  if (cached.status !== 'finished') return true;
  var e = parseDate(cached.tournament && cached.tournament.endDate);
  if (e) {
    var days = (Date.now() - e.getTime()) / 86400000;
    if (days < 21) return true;                                              // recién terminado
    if (days < 60 && !(cached.results && cached.results.available)) return true; // esperando resultados
  }
  return false;
}

// --- resolver nombres (r2sports los abrevia: "R Salgado Jr.") al uid del inscrito ---
// El sufijo (Jr., I., II.) es parte de la identidad, NO ruido: borrarlo hacía que
// "Rodrigo Salgado Jr." (uid 96164) y "Rodrigo Salgado I." (uid 626220), que son
// hijo y padre, colapsaran en la misma clave. Además, ante duda no se adivina:
// se devuelve sin uid y marcado como ambiguo.
var SUFIJO = /^(jr|sr|ii|iii|iv|i|v)$/;
function normName(s) {
  s = String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[´`’]/g, "'");
  return s.replace(/[^a-z0-9/ ]/g, ' ').replace(/\s+/g, ' ').trim();
}
function partesNombre(s) {
  var toks = normName(s).split(' ').filter(Boolean), suf = '';
  while (toks.length > 1 && SUFIJO.test(toks[toks.length - 1])) suf = toks.pop();
  return { toks: toks, suf: suf };
}
function claveFull(s) { var p = partesNombre(s); return p.toks.join(' ') + (p.suf ? '#' + p.suf : ''); }
function claveLI(s) {
  var p = partesNombre(s); if (!p.toks.length) return '';
  return p.toks[p.toks.length - 1] + '|' + p.toks[0][0] + (p.suf ? '#' + p.suf : '');
}
function claveLast(s) {
  var p = partesNombre(s); if (!p.toks.length) return '';
  return p.toks[p.toks.length - 1] + (p.suf ? '#' + p.suf : '');
}
var sinSuf = function (k) { return String(k || '').split('#')[0]; };
function buildNameIndex(players) {
  var byFull = {}, byLI = {}, byLast = {}, baFull = {}, baLI = {}, baLast = {};
  function push(m, k, p) { if (!k) return; (m[k] = m[k] || []).push(p); }
  players.forEach(function (p) {
    push(byFull, claveFull(p.name), p);
    push(byLI, claveLI(p.name), p);
    push(byLast, claveLast(p.name), p);
    // Mismas claves ignorando el sufijo: sirven para detectar que "Rodrigo Salgado"
    // (sin Jr. ni I.) es ambiguo, en vez de darlo por no encontrado.
    push(baFull, sinSuf(claveFull(p.name)), p);
    push(baLI, sinSuf(claveLI(p.name)), p);
    push(baLast, sinSuf(claveLast(p.name)), p);
  });
  return { byFull: byFull, byLI: byLI, byLast: byLast, baFull: baFull, baLI: baLI, baLast: baLast };
}
// permitidos: Set de uids a los que limitar la búsqueda (los inscritos de la división).
function resolvePlayer(name, idx, permitidos) {
  var filtra = function (arr) {
    arr = arr || [];
    if (!permitidos) return arr;
    var dentro = arr.filter(function (p) { return permitidos.has(p.uid); });
    return dentro.length ? dentro : [];
  };
  var intentos = [
    filtra(idx.byFull[claveFull(name)]), filtra(idx.byLI[claveLI(name)]), filtra(idx.byLast[claveLast(name)]),
    filtra(idx.baFull[sinSuf(claveFull(name))]), filtra(idx.baLI[sinSuf(claveLI(name))]), filtra(idx.baLast[sinSuf(claveLast(name))])
  ];
  for (var i = 0; i < intentos.length; i++) {
    if (intentos[i].length === 1) return { uid: intentos[i][0].uid, name: intentos[i][0].name };
    if (intentos[i].length > 1) return { uid: '', name: name, ambiguo: true };
  }
  return { uid: '', name: name };
}
// Deriva resultados/medallas desde las llaves (cuando el resumen viewResults está vacío).
function resultsFromBrackets(brackets, divisions, players) {
  var idx = buildNameIndex(players);
  var divs = [];
  Object.keys(brackets).forEach(function (key) {
    var b = brackets[key];
    if (b.type !== 'elim' || !b.rounds || !b.rounds.length) return;
    // saltar cuadros secundarios (consolación/playoff): el podio real sale del cuadro principal
    if (/Consolation|Consolaci[oó]n|Playoff|Definici[oó]n|Dropdown|Repechaje/i.test((b.title || '') + ' ' + (b.titleEs || ''))) return;
    var rounds = b.rounds.slice().sort(function (a, c) { return a.order - c.order; });
    var final = null, semis = null, quarters = null;
    rounds.forEach(function (r) { if (r.order === 100) final = r; else if (r.order === 90) semis = r; else if (r.order === 80) quarters = r; });
    if (!final || !final.matches.length) return;
    var placements = [];
    function pl(rank, label, names) {
      var ps = [];
      names.forEach(function (nm) { if (!nm) return; String(nm).split(' / ').forEach(function (one) { var rp = resolvePlayer(one.trim(), idx); if (rp.name) ps.push(rp); }); });
      if (ps.length) placements.push({ rank: rank, label: label, players: ps });
    }
    function loser(m) { return m.winner === 'a' ? m.b : m.winner === 'b' ? m.a : null; }
    function winner(m) { return m.winner === 'a' ? m.a : m.winner === 'b' ? m.b : null; }
    var fm = final.matches[0];
    if (winner(fm)) pl(1, 'Campeón', [winner(fm).name]);
    if (loser(fm)) pl(2, 'Finalista', [loser(fm).name]);
    if (semis) semis.matches.forEach(function (m) { var l = loser(m); if (l) pl(3, 'Semifinal', [l.name]); });
    if (quarters) quarters.matches.forEach(function (m) { var l = loser(m); if (l) pl(5, 'Cuartos', [l.name]); });
    if (placements.length) {
      var d = divisions.filter(function (x) { return (x.divID + '_' + x.combinedID) === key; })[0] || {};
      divs.push({ code: d.code || '', type: '', name: b.title, nameEs: b.titleEs, entries: (b.entrants || []).length, drawType: b.drawType, placements: placements });
    }
  });
  var tally = {};
  function add(p, kind) { if (!p) return; var k = p.uid || p.name; if (!tally[k]) tally[k] = { uid: p.uid, name: p.name, gold: 0, silver: 0, bronze: 0 }; tally[k][kind]++; }
  divs.forEach(function (d) { d.placements.forEach(function (plc) { var kind = plc.rank === 1 ? 'gold' : plc.rank === 2 ? 'silver' : plc.rank <= 4 ? 'bronze' : null; if (kind) plc.players.forEach(function (p) { add(p, kind); }); }); });
  var medals = Object.keys(tally).map(function (k) { return tally[k]; }).filter(function (x) { return x.name; })
    .sort(function (a, b) { return (b.gold - a.gold) || (b.silver - a.silver) || (b.bronze - a.bronze) || a.name.localeCompare(b.name); });
  return { available: divs.length > 0, divisions: divs, medals: medals, derived: true };
}

function entrantsFor(div, players) {
  const seen = {}; const list = [];
  players.forEach(function (p) {
    (p.divisions || []).forEach(function (d) {
      if (String(d.divID) === String(div.divID) && String(d.combinedID) === String(div.combinedID)) {
        const name = d.partner ? (p.name + ' / ' + d.partner) : p.name;
        const k = d.partner ? teamKey(p.name, d.partner) : ('u:' + p.uid);
        if (seen[k]) return; seen[k] = true;
        list.push({ uid: p.uid, name: name, partner: d.partner || '', place: p.place || '' });
      }
    });
  });
  return list;
}

async function buildTournament(tid) {
  const [dv, en, rs] = await Promise.all([
    g(`${BASE}/divisions/listAllDivs.asp?TID=${tid}&display=YES`),
    g(`${BASE}/EntryList.asp?TID=${tid}&display=YES`),
    g(`${BASE}/viewResults.asp?TID=${tid}`)
  ]);
  const tournament = R2.parseTournament(dv);
  const divisions = R2.parseDivisions(dv);
  const players = R2.parsePlayers(en);
  const results = R2.parseResults(rs);

  // llaves: árbol completo desde view-bracket.asp (drawOut redirige)
  // De la misma bajada se sacan los horarios: la llave trae la hora de cada
  // partido y es la única fuente cuando el director no ha activado el reporte
  // oficial. No se vuelve a pedir la página: r2sports bloquea por IP.
  let brackets = {}, horariosLlave = {};
  await pool(divisions, CONCURRENCIA, async function (d) {
    const key = d.divID + '_' + d.combinedID;
    let p = { available: false, type: 'elim', rounds: [], entrants: [], standings: [], champion: '' };
    try {
      const htmlLlave = await g(`${BASE}/drawsOut/drawOut.asp?TID=${tid}&divID=${d.divID}&combinedID=${d.combinedID}`);
      p = VB(htmlLlave);
      // Los nombres en las rondas siguientes vienen abreviados: se expanden con
      // los inscritos de la división y, si la división no calza (las llaves
      // combinadas como A Oro/Azul/Rojo tienen otro divID), con todo el torneo.
      let insc = players.filter(function (x) {
        return (x.divisions || []).some(function (dd) { return dd.divID === d.divID && dd.combinedID === d.combinedID; });
      }).map(function (x) { return x.name; });
      if (!insc.length) insc = players.map(function (x) { return x.name; });
      horariosLlave[key] = HL(htmlLlave, insc);
    } catch (e) { }
    brackets[key] = {
      title: d.name, titleEs: d.nameEs, drawType: d.drawType,
      available: !!p.available, type: p.type || 'elim',
      rounds: p.rounds || [], standings: p.standings || [], champion: p.champion || '',
      entrants: (p.entrants && p.entrants.length) ? p.entrants : entrantsFor(d, players)
    };
  });

  // Si viewResults.asp está vacío se pueden derivar podios desde las llaves, PERO
  // sólo con el torneo terminado. Con el torneo en curso la inferencia miente: el
  // parser de llaves toma como "Final" rondas que no lo son y como campeón el
  // nombre proyectado del cabeza de serie (visto en TID 54324: daba campeón de
  // Varones Open antes de jugarse la final). Preferimos no mostrar podio.
  let res = results;

  // Índice de nombres de este torneo: lo usan tanto los horarios como los partidos
  // jugados para resolver los uid.
  const idxN = buildNameIndex(players);
  // El reporte de horarios y las llaves traen SOLO nombres. Se ligan a uid usando
  // como universo los inscritos de esa misma división: así "Rodrigo Salgado Jr."
  // no se confunde con su papá, y si el nombre igual queda dudoso se marca
  // ambiguo en vez de mentir.
  const uidsPorDiv = {};
  players.forEach(function (p) {
    (p.divisions || []).forEach(function (d) {
      const k = d.divID + '_' + d.combinedID;
      (uidsPorDiv[k] = uidsPorDiv[k] || new Set()).add(p.uid);
    });
  });
  const ligar = function (nombre, permitidos) {
    return String(nombre || '').split(' / ').map(function (x) { return x.trim(); }).filter(Boolean)
      .map(function (uno) {
        const r = resolvePlayer(uno, idxN, permitidos);
        return { uid: r.uid || '', name: uno, ambiguo: !!r.ambiguo };
      });
  };
  // horarios: reporte "upcoming" de todo el torneo
  let schedule = [], scheduleStatus = 'ok', startTimesReady = '';
  try {
    const sc = R2.parseMatchReport(await g(`${BASE}/tourneyDay/mediaMatchResults.asp?TID=${tid}&reportType=upcoming&resultsOption=byDiv&matchDate=all&playerSex=`));
    scheduleStatus = sc.status; startTimesReady = sc.startTimesReady || '';
    (sc.divisions || []).forEach(function (d) {
      const permitidos = uidsPorDiv[d.divID + '_' + d.combinedID];
      d.matches.forEach(function (m) {
        const n1 = m.players[0] ? m.players[0].name : '', n2 = m.players[1] ? m.players[1].name : '';
        schedule.push({
          division: d.divisionEs, divisionRaw: d.division, drawType: d.drawType,
          divID: d.divID, combinedID: d.combinedID,
          round: m.round, day: m.day, time: m.time, court: m.court || '',
          p1: n1, p2: n2,
          lado1: ligar(n1, permitidos), lado2: ligar(n2, permitidos)
        });
      });
    });
  } catch (e) { scheduleStatus = 'error'; }

  // Plan B de los horarios: las llaves. El reporte oficial vive detrás de un
  // interruptor que activa el director del torneo ("Start Times will be available
  // at the time indicated below"), y mientras no lo active la web se quedaba sin
  // tablero de "En cancha / Siguiente" aunque r2sports ya publicara la hora de
  // cada partido dentro del cuadro. Pasó en la 3ª fecha 2026. Ver horarios-llaves.js.
  if (!schedule.length) {
    // El nombre lindo de la división ("Singles Juveniles B") solo está en la ficha
    // de los inscritos; parseDivisions devuelve el código ("BJB").
    const nombreDiv = {};
    players.forEach(function (x) {
      (x.divisions || []).forEach(function (dd) {
        const k = dd.divID + '_' + dd.combinedID;
        if (!nombreDiv[k]) nombreDiv[k] = { es: dd.divisionEs, raw: dd.division };
      });
    });
    // Las consolaciones de r2sports son el código del cuadro principal con una
    // "c" delante (cBJB de BJB, cMO de MO). Su nombre se toma prestado del padre
    // en vez del título de la llave: si no, la misma categoría aparecía dos veces
    // con dos nombres ("Singles Juveniles B" y "Singles Niños: Juveniles B").
    const porCodigo = {};
    divisions.forEach(function (d) { porCodigo[d.code] = d.divID + '_' + d.combinedID; });
    const deLlave = [];
    divisions.forEach(function (d) {
      const key = d.divID + '_' + d.combinedID;
      const hl = horariosLlave[key];
      if (!hl || hl.status !== 'ok') return;
      const permitidos = uidsPorDiv[key];
      // Los cuadros combinados (A Oro/Azul/Rojo, consolaciones) tienen un divID
      // que ningún inscrito declara, así que su nombre sale del padre o, si no
      // hay padre, del título de la llave.
      const padre = /^c(.+)$/.test(d.code) ? nombreDiv[porCodigo[d.code.replace(/^c/, '')]] : null;
      const nom = nombreDiv[key] ||
        (padre ? { es: padre.es + ' Por puestos', raw: padre.raw + ' Consolation' } : null) ||
        (hl.titulo ? { es: R2.traducirCategoria(hl.titulo).replace(' - ', ': '), raw: hl.titulo } : { es: d.nameEs || d.name, raw: d.name });
      hl.matches.forEach(function (m) {
        deLlave.push({
          division: nom.es, divisionRaw: nom.raw, drawType: d.drawType,
          divID: d.divID, combinedID: d.combinedID,
          round: m.round, day: m.day, time: m.time, court: '', code: m.code,
          p1: m.p1, p2: m.p2,
          lado1: ligar(m.p1, permitidos), lado2: ligar(m.p2, permitidos)
        });
      });
    });
    if (deLlave.length) { schedule = deLlave; scheduleStatus = 'llave'; }
  }

  // partidos jugados: mismo reporte pero "results". Trae día, hora, UID y marcador,
  // que es justo lo que las llaves no dan de forma cronológica.
  let matches = [];
  try {
    const mr = R2.parseMatchReport(await g(`${BASE}/tourneyDay/mediaMatchResults.asp?TID=${tid}&reportType=results&resultsOption=byDiv&matchDate=all&playerSex=`));
    (mr.divisions || []).forEach(function (d) {
      d.matches.forEach(function (m) {
        const a = m.players[0] || null, b = m.players[1] || null;
        if (!a && !b) return;
        // En dobles r2sports entrega "Fulano / Mengano" como un solo nombre sin uid,
        // así que los partidos y las medallas de dobles quedaban sin dueño. Se
        // parten y se resuelven contra los inscritos.
        const ladoDe = function (x) {
          if (!x) return [];
          return String(x.name || '').split(' / ').map(function (uno) { return uno.trim(); }).filter(Boolean)
            .map(function (uno, i) {
              if (i === 0 && x.uid) return { uid: x.uid, name: uno };
              const r = resolvePlayer(uno, idxN);
              return { uid: r.uid || '', name: uno };
            });
        };
        matches.push({
          division: d.divisionEs, divisionRaw: d.division, divID: d.divID, combinedID: d.combinedID,
          round: m.round, day: m.day, time: m.time,
          ganador: a ? { uid: a.uid || '', name: a.name, loc: a.loc || '' } : null,
          perdedor: b ? { uid: b.uid || '', name: b.name, loc: b.loc || '' } : null,
          lado1: ladoDe(a), lado2: ladoDe(b),
          marcador: m.rawScore || '', games: m.games || [], forfeit: !!m.forfeit
        });
      });
    });
  } catch (e) { matches = []; }

  // Red de seguridad: si esta corrida no trajo horarios o partidos pero el archivo
  // anterior sí los tenía, se conservan los viejos y se avisa desde cuándo son.
  const previo = leerPrevio(tid);
  let desdeCache = '';
  if (previo) {
    if (!schedule.length && (previo.schedule || []).length) {
      schedule = previo.schedule; scheduleStatus = 'cache';
      desdeCache = previo.horariosDesde || previo.updatedAt || '';
    }
    if (!matches.length && (previo.matches || []).length) matches = previo.matches;
    if (!Object.keys(brackets || {}).length && Object.keys(previo.brackets || {}).length) brackets = previo.brackets;
    if (!res.available && (previo.results || {}).available) res = previo.results;
  }

  // Podios: acá abajo porque necesita saber si quedó algo por jugar.
  // Terminado por fecha, o dentro de sus fechas pero sin nada real por jugar: el
  // "Final If" de la doble eliminación queda listado y nunca se juega.
  const yaJugoTodo = schedule.filter(function (m) {
    const reales = R2.strip(m.p1) && R2.strip(m.p2) &&
      !/^(winner|loser|group|grupo|bye|tbd)\b/i.test(m.p1) && !/^(winner|loser|group|grupo|bye|tbd)\b/i.test(m.p2);
    return (m.day && m.time) || reales;
  }).length === 0 && matches.length > 0;
  if (!res.available && (statusOf(tournament) === 'finished' || yaJugoTodo)) {
    const derived = resultsFromBrackets(brackets, divisions, players);
    if (derived.available) res = derived;
  }
  // El resumen oficial de viewResults trae los nombres SIN uid: por eso un tercer
  // lugar de Juan Martinez no se le contaba a nadie. Se resuelven contra la lista
  // de inscritos, que sí tiene uid.
  const idxPodio = buildNameIndex(players);
  res.divisions.forEach(function (d) {
    (d.placements || []).forEach(function (pl) {
      pl.players = (pl.players || []).map(function (x) {
        if (x.uid) return x;
        const r = resolvePlayer(x.name, idxPodio);
        return r.uid ? { uid: r.uid, name: r.name || x.name } : x;
      });
    });
  });

  // inyectar resultados del jugador (para el torneo)
  const fb = {};
  res.divisions.forEach(function (d) {
    d.placements.forEach(function (pl) {
      pl.players.forEach(function (p) {
        if (p.uid) (fb[p.uid] = fb[p.uid] || []).push({ division: d.nameEs || d.name, label: pl.label, rank: pl.rank });
      });
    });
  });
  players.forEach(function (p) { p.results = fb[p.uid] || []; });



  return {
    tid: String(tid),
    tournament: tournament,
    year: yearOf(tournament),
    status: statusOf(tournament),
    divisions: divisions,
    players: players,
    results: res,
    brackets: brackets,
    schedule: schedule,
    scheduleStatus: scheduleStatus,
    startTimesReady: startTimesReady,
    horariosDesde: desdeCache || new Date().toISOString(),
    matches: matches,
    // "scheduled" cuenta todo lo que r2sports lista como por jugar, incluidos los
    // cruces fantasma: el "Final If" de la doble eliminación queda listado aunque
    // no se juegue nunca, y eso dejaba al torneo eternamente "en juego".
    counts: {
      players: players.length, divisions: divisions.length,
      finishedDivisions: res.divisions.length,
      scheduled: schedule.length,
      pendientes: schedule.filter(function (m) {
        const conHora = !!(m.day && m.time);
        const reales = !/^(winner|loser|ganador|perdedor|group|grupo|bye|tbd)\b|^[\s_·.-]*$/i.test(String(m.p1 || '')) &&
          !/^(winner|loser|ganador|perdedor|group|grupo|bye|tbd)\b|^[\s_·.-]*$/i.test(String(m.p2 || ''));
        return conHora || reales;
      }).length,
      matches: matches.length
    },
    updatedAt: new Date().toISOString()
  };
}

function leerPrevio(tid) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, tid + '.json'), 'utf8')); }
  catch (e) { return null; }
}

function aggregatePlayers(allData) {
  const idx = {};
  allData.forEach(function (T) {
    (T.players || []).forEach(function (p) {
      const rec = idx[p.uid] || (idx[p.uid] = { uid: p.uid, name: p.name, place: p.place, club: p.club, country: p.country, medals: { gold: 0, silver: 0, bronze: 0 }, titles: [], tournaments: [] });
      if (p.place && !rec.place) rec.place = p.place;
      rec.tournaments.push({ tid: T.tid, year: T.year, name: T.tournament.name, divisions: (p.divisions || []).map(function (d) { return d.divisionEs || d.division; }) });
    });
    (T.results.divisions || []).forEach(function (d) {
      d.placements.forEach(function (pl) {
        pl.players.forEach(function (p) {
          if (!p.uid || !idx[p.uid]) return;
          if (pl.rank === 1) idx[p.uid].medals.gold++;
          else if (pl.rank === 2) idx[p.uid].medals.silver++;
          else if (pl.rank <= 4) idx[p.uid].medals.bronze++;
          if (pl.rank <= 4) idx[p.uid].titles.push({ tid: T.tid, year: T.year, category: d.nameEs || d.name, label: pl.label, rank: pl.rank });
        });
      });
    });
  });
  return idx;
}

(async function () {
  const argv = process.argv.slice(2);
  const forceAll = argv.indexOf('--all') >= 0;
  const explicit = argv.filter(function (a) { return /^\d+$/.test(a); });
  const targetTids = explicit.length ? explicit : CIRCUITO;
  if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });

  const allTids = Array.from(new Set(CIRCUITO.concat(explicit)));
  console.log(`Revisando ${allTids.length} torneo(s)${forceAll || explicit.length ? ' (forzado)' : ''}...`);

  const byTid = {}; let scraped = 0, reused = 0;
  for (const tid of allTids) {
    const f = path.join(DATA, tid + '.json');
    let cached = null;
    if (fs.existsSync(f)) { try { cached = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { } }
    const mustScrape = (forceAll && targetTids.indexOf(tid) >= 0) || (explicit.length && explicit.indexOf(tid) >= 0) || needsScrape(cached);
    if (mustScrape) {
      try {
        const T = await buildTournament(tid);
        writeIfChanged(f, T);
        byTid[tid] = T; scraped++;
        console.log(`  ↻ ${tid} · ${T.tournament.name} · jug ${T.counts.players} · div ${T.counts.divisions} · podios ${T.counts.finishedDivisions} · horarios ${T.counts.scheduled} (${T.scheduleStatus})`);
      } catch (e) {
        console.error(`  ✗ ${tid}: ${e.message}`);
        if (cached) byTid[tid] = cached;   // se conserva el archivo anterior tal cual
        if (e instanceof FuenteBloqueada) {
          console.error('  ⚠ r2sports bloqueó la IP. Se detiene la corrida y NO se toca ningún dato existente.');
          console.error('    Reintentar más tarde, con menos frecuencia (RQ_PAUSA=2000).');
          break;
        }
      }
    } else { byTid[tid] = cached; reused++; }
  }

  const allData = allTids.map(function (t) { return byTid[t]; }).filter(Boolean)
    .sort(function (a, b) { return dateKey(b.tournament.startDate).localeCompare(dateKey(a.tournament.startDate)); });

  const catalog = {
    updatedAt: new Date().toISOString(),
    tournaments: allData.map(function (T) {
      return {
        tid: T.tid, name: T.tournament.name, year: T.year,
        startDate: T.tournament.startDate, endDate: T.tournament.endDate,
        venue: T.tournament.venue, status: T.status, counts: T.counts,
        dateKey: dateKey(T.tournament.startDate)
      };
    })
  };
  const featured = allData.find(function (T) { return T.status === 'in-progress'; }) || allData[0];
  if (featured) catalog.featured = featured.tid;
  writeIfChanged(path.join(DATA, 'index.json'), catalog);

  // El ranking NO se calcula acá. Los puntos son los del documento oficial de la
  // Federación y los importa generar-ranking-oficial.js. La tabla de puntaje que
  // había antes era inventada: daba a Christian Troncoso 2100 como líder de Dobles
  // Open cuando el oficial es Jaime Mansilla con 7200.

  const jugadores = { updatedAt: new Date().toISOString(), players: aggregatePlayers(allData) };
  writeIfChanged(path.join(DATA, 'jugadores.json'), jugadores);

  if (featured) writeIfChanged(path.join(__dirname, 'data.json'), featured);

  // Latido mensual: mantiene activo el cron de GitHub aunque pasen meses sin torneos, sin commits de ruido.
  const hb = new Date().toISOString().slice(0, 7), hbf = path.join(DATA, '.heartbeat');
  if (!fs.existsSync(hbf) || fs.readFileSync(hbf, 'utf8').trim() !== hb) fs.writeFileSync(hbf, hb);

  console.log(`Scrapeados ${scraped}, reusados ${reused} · Catálogo ${catalog.tournaments.length} torneos · Jugadores ${Object.keys(jugadores.players).length}`);
})().catch(function (e) { console.error('ERROR:', e.stack || e.message); process.exit(1); });
