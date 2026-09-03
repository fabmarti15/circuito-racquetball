/*
 * horarios-llaves.js — Saca los horarios desde la página de la llave
 * (drawOut.asp) cuando el reporte oficial de horarios todavía no existe.
 *
 * Por qué: en r2sports los horarios viven en `times/startTimes.asp` y en
 * `tourneyDay/mediaMatchResults.asp?reportType=upcoming`, pero las dos están
 * detrás de un interruptor que activa el director del torneo. Mientras no lo
 * active devuelven "Start Times will be available at the time indicated below"
 * y un redirect. La llave, en cambio, ya trae la hora de cada partido junto a su
 * código. Pasó en la 3ª fecha 2026: llaves y horas publicadas, reporte no.
 *
 * Dos formatos, porque r2sports dibuja distinto:
 *
 *  1. Eliminación (`drawOut.asp`). En orden de documento cada partido es:
 *     celda con borde inferior y <b>nombre</b> → celda con el código → celda con
 *     día y hora → celda con borde inferior y <b>nombre</b>. Si el cruce no está
 *     definido el <b> viene vacío y queda "por definir". En la primera ronda el
 *     día, la hora y el código van juntos en una sola celda.
 *     La ronda sale del número del código, que r2sports numera desde la final:
 *     1 final, 2 tercer lugar, 3-4 semis, 5-8 cuartos, 9-16 octavos, 17-32 16avos.
 *
 *  2. Round robin (`roundRobin.asp`, a donde redirige drawOut). Una tabla limpia
 *     de seis columnas: fecha, cruce, "A vs. B" con nombres completos, día y
 *     hora, marcador y código.
 *
 * Devuelve { status, matches:[{code, round, day, time, p1, p2}] }.
 * `day` va en inglés completo ("Saturday") porque es lo que espera fechaDe().
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.parseBracketTimes = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DIA = {
    su: 'Sunday', mo: 'Monday', tu: 'Tuesday', we: 'Wednesday', th: 'Thursday', fr: 'Friday', sa: 'Saturday',
    sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday'
  };
  var RONDA = ['Final', '3er lugar', 'Semifinales', 'Cuartos', 'Octavos', '16avos', '32avos', '64avos'];

  function texto(s) {
    return String(s || '').replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
      .replace(/\s+/g, ' ').trim();
  }
  function norm(s) {
    var t = String(s || '').toLowerCase();
    try { t = t.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) { }
    return t.replace(/[^a-z0-9 /]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  // r2sports numera los códigos desde la final hacia atrás.
  function rondaDeCodigo(n) {
    if (!n || n < 1) return '';
    var k = 0, tope = 1;
    while (n > tope) { k++; tope *= 2; }
    // n=1 -> k=0 (Final); n=2 -> k=1; n=3,4 -> k=2; n=5..8 -> k=3; ...
    return RONDA[k] || ('ronda ' + k);
  }
  // r2sports pinta el día en verde y la hora en rojo, pegados. Hay que buscar
  // ESE par y no texto libre: la sigla va en mayúsculas y sin ella un apellido
  // como "Suazo" se lee como "Sunday" y "Thompson" como "Thursday".
  function diaHora(htmlCelda) {
    var h = String(htmlCelda || '');
    var m = /(?:16A34A|006600)[^>]*>\s*([A-Z]{2,3})\s*<\/font>\s*<font[^>]*(?:FF0000|ff0000)[^>]*>\s*(\d{1,2}):(\d{2})\s*([AP])\.?M/i.exec(h);
    if (!m) return null;
    var dia = DIA[m[1].toLowerCase()];
    if (!dia) return null;
    return { day: dia, time: m[2] + ':' + m[3] + ' ' + m[4].toUpperCase() + 'M' };
  }

  // r2sports rellena los casilleros que dependen de otro partido con textos como
  // "Loser BJB9" o "BYE or Joaquin Catalán" (típico en las consolaciones). El
  // primero no es un jugador y debe quedar como "por definir"; en el segundo el
  // nombre sí sirve.
  function limpiarCasillero(n) {
    var t = texto(n).replace(/^bye\s+or\s+/i, '');
    if (/^(loser|winner|ganador|perdedor|bye|tbd|group|grupo)\b/i.test(t)) return '';
    return t;
  }

  // Expande "J Martinez" a "Juan Martinez" usando los inscritos de la división.
  function expandir(corto, inscritos) {
    var c = texto(corto);
    if (!c || !inscritos || !inscritos.length) return c;
    for (var i = 0; i < inscritos.length; i++) if (norm(inscritos[i]) === norm(c)) return inscritos[i];
    if (c.indexOf('/') >= 0) {
      return c.split('/').map(function (x) { return expandir(x, inscritos); }).join(' / ');
    }
    var t = norm(c).split(' ');
    if (t.length < 2) return c;
    var ini = t[0], ape = t.slice(1).join(' ');
    var cand = [];
    for (var j = 0; j < inscritos.length; j++) {
      var nt = norm(inscritos[j]).split(' ');
      if (nt.length < 2) continue;
      var apellidoOk = norm(inscritos[j]).indexOf(ape) >= 0;
      var inicialOk = ini.length === 1 ? nt[0].charAt(0) === ini : nt[0] === ini;
      if (apellidoOk && inicialOk) cand.push(inscritos[j]);
    }
    return cand.length === 1 ? cand[0] : c;
  }

  function celdas(html) {
    var out = [], re = /<td\b([^>]*)>([\s\S]*?)<\/td>/gi, m;
    while ((m = re.exec(html)) !== null) out.push({ idx: m.index, attrs: m[1] || '', inner: m[2] || '' });
    return out;
  }

  // ---------- round robin ----------
  function parseRR(html, inscritos) {
    var out = [], re = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi, m;
    while ((m = re.exec(html)) !== null) {
      var fila = m[1];
      var cod = /viewAppMatch\(\d+\)[^>]*>\s*([A-Za-z]{1,8}\s?\d{1,3})\s*<\/a>/i.exec(fila);
      if (!cod) continue;
      var vs = /<font[^>]*color="?#000000"?[^>]*>([\s\S]*?)<\/font>\s*<font[^>]*>\s*vs\.?\s*<\/font>\s*<font[^>]*color="?#000000"?[^>]*>([\s\S]*?)<\/font>/i.exec(fila);
      if (!vs) continue;
      var dh = diaHora(fila);
      var fecha = /<font size="3">\s*<b>\s*(\d{1,2})/i.exec(fila);
      out.push({
        code: texto(cod[1]).replace(/\s+/g, ''),
        round: fecha ? ('fecha ' + fecha[1]) : 'round robin',
        day: dh ? dh.day : '', time: dh ? dh.time : '',
        p1: expandir(limpiarCasillero(vs[1]), inscritos), p2: expandir(limpiarCasillero(vs[2]), inscritos)
      });
    }
    return out;
  }

  // ---------- eliminación ----------
  function parseElim(html, inscritos) {
    var cs = celdas(html), fichas = [];
    for (var i = 0; i < cs.length; i++) {
      var c = cs[i];
      // Casillero del cuadro: celda con borde inferior que trae un <b> (con o sin
      // nombre). Las celdas de borde que solo llevan un spacer no cuentan.
      if (/border-bottom:\s*[0-9.]+pt solid/i.test(c.attrs) && /<b>/i.test(c.inner)) {
        var b = /<b>([\s\S]*?)<\/b>/i.exec(c.inner);
        var nom = texto(b ? b[1] : '');
        if (/^champion$/i.test(nom)) continue;
        fichas.push({ idx: c.idx, tipo: 'slot', nombre: nom });
        continue;
      }
      var t = texto(c.inner);
      var cod = /^([A-Za-z]{1,8}\s?\d{1,3})$/.exec(t) || /([A-Za-z]{1,8}\s?\d{1,3})\s*$/.exec(t);
      var esCodigo = /viewAppMatch\(/.test(c.inner) || (cod && !/[a-z]{3,}/.test(t.replace(/\s?\d+$/, '')) && t.length <= 12);
      if (esCodigo && cod) {
        var dh = diaHora(c.inner);
        // En rondas siguientes la hora va en la celda de al lado.
        if (!dh) { for (var k = i + 1; k <= i + 3 && k < cs.length; k++) { var d2 = diaHora(cs[k].inner); if (d2) { dh = d2; break; } } }
        fichas.push({
          idx: c.idx, tipo: 'match', code: texto(cod[1]).replace(/\s+/g, ''),
          day: dh ? dh.day : '', time: dh ? dh.time : ''
        });
      }
    }
    fichas.sort(function (a, b) { return a.idx - b.idx; });

    var out = [];
    for (var f = 0; f < fichas.length; f++) {
      if (fichas[f].tipo !== 'match') continue;
      var antes = null, despues = null, a, d;
      for (a = f - 1; a >= 0; a--) if (fichas[a].tipo === 'slot') { antes = fichas[a]; break; }
      for (d = f + 1; d < fichas.length; d++) if (fichas[d].tipo === 'slot') { despues = fichas[d]; break; }
      var n1 = antes ? antes.nombre : '', n2 = despues ? despues.nombre : '';
      if (/^bye$/i.test(n1) || /^bye$/i.test(n2)) continue;   // un bye no es partido
      var num = parseInt(String(fichas[f].code).replace(/^[A-Za-z]+/, ''), 10);
      out.push({
        code: fichas[f].code, round: rondaDeCodigo(num),
        day: fichas[f].day, time: fichas[f].time,
        p1: expandir(limpiarCasillero(n1), inscritos), p2: expandir(limpiarCasillero(n2), inscritos)
      });
    }
    return out;
  }

  function parseBracketTimes(html, inscritos) {
    var h = String(html || '');
    if (!h) return { status: 'vacio', matches: [] };
    if (/This IP has been blocked/i.test(h)) return { status: 'bloqueado', matches: [] };
    if (/noDraws\.asp|has not yet been released|Brackets are currently unavailable/i.test(h)) {
      return { status: 'sin_llave', matches: [] };
    }
    var esRR = /Round Robin/i.test(h) && /viewDrawSwitchByPlayer|Participant Schedule|Versus/i.test(h);
    var ms = esRR ? parseRR(h, inscritos) : parseElim(h, inscritos);
    // Solo sirve lo que tiene hora: sin hora no se puede ordenar ni avisar.
    ms = ms.filter(function (m) { return m.day && m.time; });
    // La llave es el único lugar donde el nombre largo de la división aparece
    // junto a su código: "(MAG) Men's Singles - A Gold". listAllDivs solo da el
    // código, así que los cuadros combinados (Oro/Azul/Rojo, consolaciones) se
    // quedaban con la sigla en pantalla.
    var tit = /\(([A-Za-z]{1,8})\)\s*([^<\n]{3,80}?)\s*(?:<|\n)/.exec(h);
    var titulo = tit ? texto(tit[2]) : '';
    if (!/singles|doubles|dobles/i.test(titulo)) titulo = '';
    return { status: ms.length ? 'ok' : 'sin_horarios', matches: ms, fuente: 'llave', titulo: titulo };
  }

  return parseBracketTimes;
});
