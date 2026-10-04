// Descubrimiento del Circuito Nacional Open/Junior en el buscador de r2sports.
// Solo edita CIRCUITO; los datos los genera el pipeline existente.
const fs = require('node:fs');
const path = require('node:path');
const R2 = require('./parser.js');
const HORARIO = '0 9,18 * * 4,5';

function fecha(s) {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) throw new Error('Fecha no reconocida: ' + s);
  const d = new Date(Date.UTC(+m[3], +m[1] - 1, +m[2]));
  if (d.getUTCFullYear() !== +m[3] || d.getUTCMonth() !== +m[1] - 1 || d.getUTCDate() !== +m[2]) {
    throw new Error('Fecha inválida: ' + s);
  }
  return d;
}

function urlBusqueda(ahora = new Date()) {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Santiago', year: 'numeric', month: 'numeric', day: 'numeric'
  }).formatToParts(ahora);
  const valores = Object.fromEntries(partes.map(p => [p.type, p.value]));
  const desde = fecha(`${valores.month}/${valores.day}/${valores.year}`);
  // Incluye la última semana para recuperar un torneo recién comenzado.
  desde.setUTCDate(desde.getUTCDate() - 7);
  const u = new URL('https://www.r2sports.com/r2-sports-current-events.asp');
  u.search = new URLSearchParams({ sportID: '1', countryID: '114', eventTypeID: '1',
    startDate: `${desde.getUTCMonth() + 1}/${desde.getUTCDate()}/${desde.getUTCFullYear()}` });
  return u.toString();
}

function parsearBusqueda(html) {
  if (/IP\s+has\s+been\s+blocked|captcha|access denied/i.test(html)) {
    throw new Error('r2sports bloqueó el descubrimiento; no se modifica CIRCUITO');
  }
  function seleccionado(nombre, valor) {
    const sel = html.match(new RegExp(`<select\\b[^>]*name=["']${nombre}["'][^>]*>([\\s\\S]*?)<\\/select>`, 'i'));
    return sel && [...sel[1].matchAll(/<option\b([^>]*)>/gi)].some(m =>
      new RegExp(`\\bvalue=["']${valor}["']`, 'i').test(m[1]) && /\bselected\b/i.test(m[1]));
  }
  if (!/Search Criteria:/i.test(html) || !seleccionado('sportID', '1') ||
      !seleccionado('countryID', '114') || !seleccionado('eventTypeID', '1')) {
    throw new Error('El buscador no confirmó Racquetball / Chile / Tournament');
  }
  const tarjetas = [...html.matchAll(/<h2\b[^>]*>\s*<strong>\s*<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>\s*<\/strong>([\s\S]*?)<\/h2>/gi)];
  if (!tarjetas.length && !/no (?:matching )?(?:events|tournaments|results)|0 events/i.test(R2.strip(html))) {
    throw new Error('Formato del listado no reconocido; revisar r2sports');
  }
  const torneos = new Map();
  for (let i = 0; i < tarjetas.length; i++) {
    const m = tarjetas[i], nombre = R2.strip(m[2]);
    if (!/\bCIRCUITO\s+NACIONAL\b/i.test(nombre) || !/Racquetball Tournament/i.test(R2.strip(m[3]))) continue;
    const u = new URL(R2.decodeEntities(m[1]), 'https://www.r2sports.com');
    const tid = u.searchParams.get('TID');
    if (u.hostname !== 'www.r2sports.com' || u.pathname !== '/portfolio/r2-event.asp' || !/^\d+$/.test(tid || '')) {
      throw new Error('Enlace de torneo no reconocido: ' + nombre);
    }
    const fin = i + 1 < tarjetas.length ? tarjetas[i + 1].index : html.indexOf('id="home-info-right"', m.index);
    const bloque = html.slice(m.index + m[0].length, fin < 0 ? html.length : fin);
    const datos = bloque.match(/<p\b[^>]*>\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*-\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*<br\s*\/?>([\s\S]*?)<\/p>/i);
    if (!datos || !/\bCHI\b/i.test(R2.strip(datos[3]))) {
      throw new Error('No se pudo validar fecha y sede chilena: ' + nombre);
    }
    const inicio = fecha(datos[1]), termino = fecha(datos[2]);
    if (termino < inicio) throw new Error('Fechas invertidas: ' + nombre);
    const torneo = { tid, nombre, year: inicio.getUTCFullYear(), inicio: inicio.toISOString() };
    if (torneos.has(tid) && JSON.stringify(torneos.get(tid)) !== JSON.stringify(torneo)) {
      throw new Error('TID duplicado con datos contradictorios: ' + tid);
    }
    torneos.set(tid, torneo);
  }
  return [...torneos.values()];
}

function incorporar(codigo, torneos) {
  const m = codigo.match(/const CIRCUITO = \[([\s\S]*?)\n\];/);
  if (!m) throw new Error('No se encontró el arreglo CIRCUITO');
  const filas = m[1].split('\n').filter(s => s.trim());
  const porYear = new Map(), existentes = new Set();
  for (const fila of filas) {
    const f = fila.match(/^\s*((?:'\d+'\s*,?\s*)+)\/\/\s*(\d{4})\s*$/);
    if (!f || porYear.has(+f[2])) throw new Error('Formato inesperado en CIRCUITO');
    const ids = [...f[1].matchAll(/'(\d+)'/g)].map(x => x[1]);
    for (const tid of ids) {
      if (existentes.has(tid)) throw new Error('TID repetido en CIRCUITO: ' + tid);
      existentes.add(tid);
    }
    porYear.set(+f[2], ids);
  }
  const nuevos = torneos.filter(t => !existentes.has(t.tid))
    .sort((a, b) => b.inicio.localeCompare(a.inicio) || +b.tid - +a.tid);
  if (!nuevos.length) return { codigo, nuevos };
  const agregados = new Set();
  for (const t of [...nuevos].reverse()) {
    if (agregados.has(t.tid)) continue;
    if (!/^\d+$/.test(t.tid) || !Number.isInteger(t.year)) throw new Error('Torneo inválido');
    porYear.set(t.year, [t.tid, ...(porYear.get(t.year) || [])]);
    agregados.add(t.tid);
  }
  const years = [...porYear.keys()].sort((a, b) => b - a);
  const lista = years.map((y, i) => `  ${porYear.get(y).map(id => `'${id}'`).join(', ')}${i < years.length - 1 ? ',' : ''}    // ${y}`).join('\n');
  return { codigo: codigo.replace(m[0], `const CIRCUITO = [\n${lista}\n];`), nuevos };
}

async function main() {
  const args = process.argv.slice(2), fixture = args.indexOf('--html');
  const seco = args.includes('--dry-run');
  let html;
  if (fixture >= 0) {
    if (!args[fixture + 1]) throw new Error('Falta ruta de --html');
    html = fs.readFileSync(args[fixture + 1], 'latin1');
  } else {
    const res = await fetch(urlBusqueda(), { signal: AbortSignal.timeout(30000), headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; CircuitoRacquetballChile/2.0; +https://github.com/fabmarti15/circuito-racquetball)'
    } });
    if (!res.ok) throw new Error('Buscador r2sports HTTP ' + res.status);
    html = new TextDecoder('windows-1252').decode(await res.arrayBuffer());
  }
  const torneos = parsearBusqueda(html);
  const archivo = path.join(__dirname, 'generar-datos.js');
  const resultado = incorporar(fs.readFileSync(archivo, 'utf8'), torneos);
  if (!seco && resultado.nuevos.length) fs.writeFileSync(archivo, resultado.codigo);
  if (!seco && process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `added=${resultado.nuevos.length}\n`);
  if (resultado.nuevos.length) {
    console.log(`${seco ? 'Detectados (sin escribir)' : 'Agregados'}: ` + resultado.nuevos.map(t => `${t.tid} ${t.nombre}`).join('; '));
    if (!seco && process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      'Torneos nuevos: ' + resultado.nuevos.map(t => t.tid).join(', ') + '\n');
  } else console.log('Sin torneos nuevos del Circuito Nacional');
}

module.exports = { parsearBusqueda, incorporar, urlBusqueda, HORARIO };
if (require.main === module) main().catch(e => { console.error('ERROR: ' + e.message); process.exitCode = 1; });
