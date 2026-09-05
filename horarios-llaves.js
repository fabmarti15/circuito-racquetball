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
      var nombres = [], ganador = '';
      var fonts = /<font\b([^>]*)>([^<]*)<\/font>/gi, font;
      while ((font = fonts.exec(fila))) {
        if (!/color=["']?#(?:000000|0000FF|0000CC|000099)\b/i.test(font[1])) continue;
        var nombre = texto(font[2]);
        if (!nombre || /^(vs\.?|\d[\d :.,-]*|[A-Z]{2,3})$/.test(nombre)) continue;
        var gano = /\s*-\s*W\s*$/i.test(nombre);
        nombre = expandir(limpiarCasillero(nombre.replace(/\s*-\s*W\s*$/i, '')), inscritos);
        if (!nombre) continue;
        nombres.push(nombre);
        if (gano) ganador = nombre;
      }
      if (nombres.length !== 2) continue;
      var score = texto(fila).match(/\b\d{1,2}\s*-\s*\d{1,2}(?:\s*,\s*\d{1,2}\s*-\s*\d{1,2})+/);
      var dh = diaHora(fila);
      var fecha = /<font size="3">\s*<b>\s*(\d{1,2})/i.exec(fila);
      out.push({
        code: texto(cod[1]).replace(/\s+/g, ''),
        round: fecha ? ('Ronda ' + fecha[1]) : 'round robin',
        day: dh ? dh.day : '', time: dh ? dh.time : '',
        p1: nombres[0], p2: nombres[1], ganador: ganador, marcador: ganador && score ? score[0] : ''
      });
    }
    return out;
  }

  // ---------- eliminación ----------
  // Además de los horarios se arma el árbol. La posición sale del propio orden
  // del documento: r2sports dibuja la llave columna por columna (los 32avos
  // completos, después los 16avos, después cuartos...) y dentro de cada columna
  // de arriba hacia abajo. Con eso el partido `pos` de una columna alimenta al
  // `floor(pos/2)` de la siguiente, que es lo que hace que el cuadro se vea como
  // cuadro y no como una lista. El nivel se saca del número del código, que
  // r2sports numera desde la final.
  function nivelDeCodigo(n) {
    if (!n || n < 1) return 0;
    var k = 0, tope = 1;
    while (n > tope) { k++; tope *= 2; }
    return k;   // 0 final, 2 semis, 3 cuartos, 4 octavos...
  }
  function parseElim(html, inscritos, codigo) {
    var cs = celdas(html), fichas = [];
    for (var i = 0; i < cs.length; i++) {
      var c = cs[i];
      if (/viewBracket\(/i.test(c.inner)) continue;
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
      // Una celda es "el partido" si trae el enlace del partido, o si su texto es
      // solo el código, o si trae el código junto al día y la hora ("SA 6:20 PM
      // MAB4"): en las rondas que todavía no se pueden jugar r2sports no pone
      // enlace, y por el largo del texto se perdían columnas enteras (los cuartos
      // de A Rojo y las semis de A Azul no aparecían).
      var esCodigo = /viewAppMatch\(/.test(c.inner) ||
        (cod && (/^[A-Za-z]{1,8}\s?\d{1,3}$/.test(t) || !!diaHora(c.inner)));
      if (esCodigo && cod) {
        var dh = diaHora(c.inner);
        // En rondas siguientes la hora va en la celda de al lado.
        if (!dh) { for (var k = i + 1; k <= i + 3 && k < cs.length; k++) { var d2 = diaHora(cs[k].inner); if (d2) { dh = d2; break; } } }
        var mk = ''; // Los marcadores se unen por cruce en resultados-llaves.js.
        fichas.push({
          idx: c.idx, tipo: 'match', code: texto(cod[1]).replace(/\s+/g, ''),
          day: dh ? dh.day : '', time: dh ? dh.time : '', marcador: mk
        });
      }
    }
    fichas.sort(function (a, b) { return a.idx - b.idx; });

    var todos = [], porNivel = {};
    for (var f = 0; f < fichas.length; f++) {
      if (fichas[f].tipo !== 'match') continue;
      var antes = null, despues = null, a, d;
      for (a = f - 1; a >= 0; a--) if (fichas[a].tipo === 'slot') { antes = fichas[a]; break; }
      for (d = f + 1; d < fichas.length; d++) if (fichas[d].tipo === 'slot') { despues = fichas[d]; break; }
      var n1 = antes ? antes.nombre : '', n2 = despues ? despues.nombre : '';
      var bye = /^bye$/i.test(n1) || /^bye$/i.test(n2);
      var resto = codigo ? String(fichas[f].code).slice(codigo.length) : String(fichas[f].code).replace(/^[A-Za-z]+/, '');
      if ((codigo && String(fichas[f].code).indexOf(codigo) !== 0) || !/^\d+$/.test(resto)) continue;
      var num = Number(resto);
      var niv = nivelDeCodigo(num);
      var pos = (porNivel[niv] = (porNivel[niv] || 0)); porNivel[niv]++;
      todos.push({
        code: fichas[f].code, round: rondaDeCodigo(num), nivel: niv, pos: pos, bye: bye,
        day: fichas[f].day, time: fichas[f].time, marcador: fichas[f].marcador || '',
        p1: expandir(limpiarCasillero(n1), inscritos), p2: expandir(limpiarCasillero(n2), inscritos)
      });
    }
    return todos;
  }

  // Agrupa los partidos por columna del cuadro, de la primera ronda a la final.
  // Los byes se quedan: ocupan su lugar en el árbol y el jugador que pasa sin
  // jugar tiene que verse en la columna siguiente igual.
  function nivelesDe(todos, inscritos) {
    var map = {};
    todos.forEach(function (m) { (map[m.nivel] = map[m.nivel] || []).push(m); });
    var niv = Object.keys(map).map(Number).sort(function (a, b) { return b - a; })
      .map(function (n) {
        return {
          nivel: n, nombre: RONDA[n] || ('ronda ' + n),
          partidos: map[n].sort(function (a, b) { return a.pos - b.pos; })
        };
      });
    // Los nombres de las rondas siguientes vienen abreviados y a veces son
    // ambiguos: "C Escoda" son dos personas (Catalina y Cristina). El árbol lo
    // resuelve sin adivinar: quien aparece en un casillero tuvo que salir del
    // partido de abajo, así que se busca solo entre esos dos.
    for (var i = 0; i + 1 < niv.length; i++) {
      var hijos = niv[i].partidos, padres = niv[i + 1].partidos;
      if (hijos.length !== padres.length * 2) continue;   // columna incompleta: no arriesgar
      padres.forEach(function (pa, j) {
        [['p1', hijos[2 * j]], ['p2', hijos[2 * j + 1]]].forEach(function (par) {
          var campo = par[0], hijo = par[1];
          if (!hijo || !pa[campo]) return;
          var cand = [hijo.p1, hijo.p2].filter(Boolean);
          if (!cand.length) return;
          pa[campo] = expandir(pa[campo], cand);
          if (cand.length === 1 && norm(pa[campo]) !== norm(cand[0])) {
            // Con un solo candidato posible (el otro lado era un bye) el nombre
            // completo es ese, aunque la abreviatura no calce letra por letra.
            var t = norm(pa[campo]).split(' ');
            if (t.length > 1 && norm(cand[0]).indexOf(t[t.length - 1]) >= 0) pa[campo] = cand[0];
          }
        });
      });
    }
    return niv;
  }

  function parseBracketTimes(html, inscritos, codigo) {
    var h = String(html || '');
    if (!h) return { status: 'vacio', matches: [] };
    if (/This IP has been blocked/i.test(h)) return { status: 'bloqueado', matches: [] };
    if (/noDraws\.asp|has not yet been released|Brackets are currently unavailable/i.test(h)) {
      return { status: 'sin_llave', matches: [] };
    }
    var esRR = /Round Robin/i.test(h) && /viewDrawSwitchByPlayer|Participant Schedule|Versus/i.test(h);
    var todos = esRR ? parseRR(h, inscritos) : parseElim(h, inscritos, codigo);
    // El cuadro se queda con todo (para dibujar el árbol); la agenda, solo con
    // lo que tiene hora, porque sin hora no se puede ordenar ni avisar.
    var esDoble = /Double Elimination|Double Elim|Losers Bracket/i.test(h);
    var cuadro = esDoble ? { tipo: 'lista', partidos: todos } : esRR
      ? { tipo: 'rr', partidos: todos }
      : { tipo: 'elim', niveles: nivelesDe(todos, inscritos) };
    var ms = todos.filter(function (m) { return m.day && m.time && !m.bye; });
    // La llave es el único lugar donde el nombre largo de la división aparece
    // junto a su código: "(MAG) Men's Singles - A Gold". listAllDivs solo da el
    // código, así que los cuadros combinados (Oro/Azul/Rojo, consolaciones) se
    // quedaban con la sigla en pantalla.
    var tit = /\(([A-Za-z0-9]{1,12})\)\s*([^<\n]{3,80}?)\s*(?:<|\n)/.exec(h);
    var titulo = tit ? texto(tit[2]) : '';
    if (!/singles|doubles|dobles/i.test(titulo)) titulo = '';
    return { status: ms.length ? 'ok' : 'sin_horarios', matches: ms, cuadro: cuadro, fuente: 'llave', titulo: titulo };
  }

  return parseBracketTimes;
});
