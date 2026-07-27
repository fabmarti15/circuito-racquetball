/*
 * generar-historico.js — Carrera completa de cada jugador, desde r2sports.
 *
 * Por qué existe: el catálogo de torneos (`CIRCUITO` en generar-datos.js) es una
 * lista escrita a mano, así que solo existe lo que alguien anotó. La página
 * `mem_appPlayerMatchStats.asp?UID=X` devuelve TODOS los partidos de un jugador en
 * cualquier torneo del mundo, con fecha y marcador. Recorriendo jugadores en vez de
 * torneos, el histórico se completa solo y los torneos que faltan se descubren.
 *
 * Salidas:
 *   data/carreras/<uid>.json      caché por jugador (evita repetir descargas)
 *   data/historico.json           todos los partidos, sin duplicados
 *   data/torneos-descubiertos.json  TIDs que aparecen y NO están en el catálogo
 *
 * Uso:
 *   node generar-historico.js                 -> jugadores conocidos, caché de 7 días
 *   node generar-historico.js --limite 20     -> solo 20 jugadores (para probar)
 *   node generar-historico.js 96164 19712     -> solo esos UID
 *   node generar-historico.js --forzar        -> ignora la caché
 *
 * Ritmo: r2sports BLOQUEA POR IP si se le pega muy seguido (pasó el 25-07-2026).
 * Por eso hay una pausa entre pedidos (RQ_PAUSA, 1500 ms por defecto), se detecta
 * el bloqueo y el proceso se puede reanudar sin perder lo ya bajado.
 */
const fs = require('fs');
const path = require('path');
const R2 = require(path.join(__dirname, 'parser.js'));
const CORRIGE = require(path.join(__dirname, 'correcciones.js'));

const BASE = 'https://www.r2sports.com/tourney';
const UA = 'Mozilla/5.0 (compatible; CircuitoRacquetballChile/2.0; +https://github.com/fabmarti15/circuito-racquetball)';
const DATA = path.join(__dirname, 'data');
const CARRERAS = path.join(DATA, 'carreras');
const PAUSA_MS = +(process.env.RQ_PAUSA || 1500);
const DIAS_CACHE = +(process.env.RQ_CACHE_DIAS || 7);

class FuenteBloqueada extends Error {}
let ultimo = 0;
function pausa() {
  const ahora = Date.now(), falta = ultimo + PAUSA_MS - ahora;
  ultimo = falta > 0 ? ultimo + PAUSA_MS : ahora;
  return falta > 0 ? new Promise(function (r) { setTimeout(r, falta); }) : Promise.resolve();
}
function decodeBody(buf, ct) {
  const tipo = String(ct || '').toLowerCase();
  const cabeza = buf.slice(0, 2048).toString('latin1').toLowerCase();
  if (tipo.indexOf('utf-8') >= 0 || /<meta[^>]+charset=["']?utf-8/.test(cabeza)) {
    const u = buf.toString('utf8');
    if (u.indexOf('�') < 0) return u;
  }
  return buf.toString('latin1');
}
async function unaVez(url) {
  await pausa();
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'es' }, redirect: 'follow' });
  const html = decodeBody(Buffer.from(await r.arrayBuffer()), r.headers.get('content-type'));
  if (/IP\s+has\s+been\s+blocked/i.test(html) || (html.length < 400 && /blocked/i.test(html))) {
    throw new FuenteBloqueada('r2sports bloqueó la IP');
  }
  return html;
}
// El bloqueo se levanta solo al rato: se espera y se sigue, en vez de perder la
// corrida completa. Con 139 jugadores por bajar, abandonar al primer bloqueo
// significaba no terminar nunca.
const ESPERAS_BLOQUEO = [60000, 180000, 420000];
async function bajar(url) {
  for (let intento = 0; ; intento++) {
    try { return await unaVez(url); }
    catch (e) {
      const esperar = (e instanceof FuenteBloqueada) ? ESPERAS_BLOQUEO[intento] : null;
      if (!esperar) throw e;
      console.error(`  ⏳ bloqueados; esperando ${Math.round(esperar / 60000)} min antes de seguir`);
      await new Promise(function (r) { setTimeout(r, esperar); });
    }
  }
}

function leerJSON(f, porDefecto) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return porDefecto; }
}
function escribir(f, obj) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  // Igual que en generar-datos.js: las correcciones a mano se reaplican en cada
  // bajada, porque esto pisa el archivo anterior (ver correcciones.js).
  try { CORRIGE.aplicar(obj, null); } catch (e) { }
  fs.writeFileSync(f, JSON.stringify(obj));
}
function diasDesde(iso) {
  const t = Date.parse(iso || '');
  return isFinite(t) ? (Date.now() - t) / 86400000 : 1e9;
}

// UID semilla: los del índice histórico + los inscritos de cada torneo bajado.
function uidsConocidos() {
  const set = new Set();
  const idx = leerJSON(path.join(DATA, 'jugadores.json'), { players: {} });
  Object.keys(idx.players || {}).forEach(function (u) { if (/^\d+$/.test(u)) set.add(u); });
  fs.readdirSync(DATA).filter(function (f) { return /^\d+\.json$/.test(f); }).forEach(function (f) {
    (leerJSON(path.join(DATA, f), { players: [] }).players || []).forEach(function (p) { if (p.uid) set.add(String(p.uid)); });
  });
  return Array.from(set);
}
function tidsDelCatalogo() {
  const c = leerJSON(path.join(DATA, 'index.json'), { tournaments: [] });
  return new Set((c.tournaments || []).map(function (t) { return String(t.tid); }));
}

function clavePartido(m) {
  const lado = function (arr) { return (arr || []).map(function (x) { return x.uid || x.name; }).sort().join('+'); };
  return [m.tid, m.divID, m.combinedID, m.date, lado(m.ganador), lado(m.perdedor), m.marcador].join('|');
}

(async function () {
  const argv = process.argv.slice(2);
  const forzar = argv.indexOf('--forzar') >= 0;
  const iLim = argv.indexOf('--limite');
  const limite = iLim >= 0 ? +argv[iLim + 1] : 0;
  const explicitos = argv.filter(function (a) { return /^\d+$/.test(a); })
    .filter(function (a) { return !(iLim >= 0 && a === argv[iLim + 1]); });

  fs.mkdirSync(CARRERAS, { recursive: true });
  let objetivo = explicitos.length ? explicitos : uidsConocidos();

  // Primero los que no tenemos o están más viejos: así una corrida cortada avanza igual.
  objetivo = objetivo.map(function (uid) {
    const prev = leerJSON(path.join(CARRERAS, uid + '.json'), null);
    return { uid: uid, edad: prev ? diasDesde(prev.updatedAt) : 1e9 };
  }).sort(function (a, b) { return b.edad - a.edad; }).map(function (x) { return x.uid; });

  const pendientes = objetivo.filter(function (uid) {
    if (forzar || explicitos.length) return true;
    const prev = leerJSON(path.join(CARRERAS, uid + '.json'), null);
    return !prev || diasDesde(prev.updatedAt) > DIAS_CACHE;
  });
  const lista = limite ? pendientes.slice(0, limite) : pendientes;

  console.log(`Jugadores conocidos: ${objetivo.length} · por bajar: ${pendientes.length}` +
    (limite ? ` · en esta corrida: ${lista.length}` : '') + ` · pausa ${PAUSA_MS} ms`);

  let bajados = 0, bloqueado = false;
  for (const uid of lista) {
    try {
      const html = await bajar(`${BASE}/mem_appPlayerMatchStats.asp?UID=${uid}`);
      const matches = R2.parseCareer(html);
      escribir(path.join(CARRERAS, uid + '.json'), { uid: uid, updatedAt: new Date().toISOString(), matches: matches });
      bajados++;
      if (bajados % 10 === 0 || bajados === lista.length) {
        console.log(`  ${bajados}/${lista.length} · uid ${uid} · ${matches.length} partidos`);
      }
    } catch (e) {
      if (e instanceof FuenteBloqueada) {
        console.error(`  ⚠ ${e.message}. Se detiene acá; lo bajado queda guardado.`);
        console.error('    Reintentar más tarde: node generar-historico.js (retoma donde quedó).');
        bloqueado = true;
        break;
      }
      console.error(`  ✗ uid ${uid}: ${e.message}`);
    }
  }

  // ---- consolidar todo lo que haya en caché (aunque esta corrida se haya cortado) ----
  const vistos = {}, porTid = {};
  let archivos = 0;
  fs.readdirSync(CARRERAS).filter(function (f) { return /\.json$/.test(f); }).forEach(function (f) {
    const c = leerJSON(path.join(CARRERAS, f), null);
    if (!c || !c.matches) return;
    archivos++;
    c.matches.forEach(function (m) {
      const k = clavePartido(m);
      if (!vistos[k]) vistos[k] = m;
      const t = porTid[m.tid] || (porTid[m.tid] = { tid: m.tid, partidos: 0, desde: m.date, hasta: m.date });
      t.partidos++;
      if (m.date) {
        const d = Date.parse(m.date);
        if (!t.desde || d < Date.parse(t.desde)) t.desde = m.date;
        if (!t.hasta || d > Date.parse(t.hasta)) t.hasta = m.date;
      }
    });
  });
  const partidos = Object.keys(vistos).map(function (k) { return vistos[k]; })
    .sort(function (a, b) { return (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0); });
  // Quiénes tienen su carrera bajada de verdad. Sin esta lista, la web no puede
  // distinguir un récord completo de uno armado con los partidos que aparecieron
  // de rebote en la carrera de otro, que sale sesgado.
  const uidsLeidos = fs.readdirSync(CARRERAS).filter(function (f) { return /^\d+\.json$/.test(f); })
    .map(function (f) { return f.replace('.json', ''); });
  escribir(path.join(DATA, 'historico.json'), {
    updatedAt: new Date().toISOString(),
    jugadoresLeidos: archivos,
    uids: uidsLeidos,
    partidos: partidos
  });

  const enCatalogo = tidsDelCatalogo();
  const nuevos = Object.keys(porTid).filter(function (t) { return !enCatalogo.has(t); })
    .map(function (t) { return porTid[t]; })
    .sort(function (a, b) { return (Date.parse(b.hasta) || 0) - (Date.parse(a.hasta) || 0); });

  // El nombre del torneo NO viene en la página de carrera (la rellena JavaScript),
  // así que se busca una vez por TID y se guarda. Sin esto la ficha del jugador
  // mostraría "TID 46434" en vez de "Panamericano".
  const nombres = leerJSON(path.join(DATA, 'torneos-nombres.json'), { torneos: {} });
  if (!bloqueado) {
    for (const t of nuevos) {
      if (nombres.torneos[t.tid]) continue;
      try {
        const info = R2.parseTournament(await bajar(`${BASE}/home.asp?TID=${t.tid}`));
        nombres.torneos[t.tid] = { name: info.name || ('Torneo ' + t.tid), startDate: info.startDate || '', endDate: info.endDate || '', venue: info.venue || '' };
        console.log(`  + TID ${t.tid}: ${nombres.torneos[t.tid].name}`);
      } catch (e) {
        if (e instanceof FuenteBloqueada) { console.error('  ⚠ bloqueado buscando nombres; se guarda lo que hay.'); bloqueado = true; break; }
      }
    }
    nombres.updatedAt = new Date().toISOString();
    escribir(path.join(DATA, 'torneos-nombres.json'), nombres);
  }
  nuevos.forEach(function (t) { const n = nombres.torneos[t.tid]; if (n) { t.name = n.name; t.venue = n.venue; t.startDate = n.startDate; t.endDate = n.endDate; } });
  escribir(path.join(DATA, 'torneos-descubiertos.json'), { updatedAt: new Date().toISOString(), torneos: nuevos });

  console.log(`Histórico: ${partidos.length} partidos únicos de ${archivos} jugadores en caché.`);
  if (nuevos.length) {
    console.log(`Torneos que NO están en el catálogo (${nuevos.length}):`);
    nuevos.slice(0, 20).forEach(function (t) { console.log(`  TID ${t.tid} · ${t.partidos} partidos · ${t.desde} a ${t.hasta}`); });
    console.log('  Para sumarlos: agregarlos a CIRCUITO en generar-datos.js y correrlo.');
  }
  if (bloqueado) process.exitCode = 2;
})().catch(function (e) { console.error('ERROR:', e.stack || e.message); process.exit(1); });
