/*
 * parser.js — Convierte el HTML de r2sports.com en JSON limpio.
 * Puro JavaScript: funciona en Node (build) y en el navegador.
 * Sin dependencias. r2sports entrega HTML en iso-8859-1 (latin1):
 * el fetch debe decodificar latin1 ANTES de pasar el string aquí.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.R2 = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- helpers ----------
  function decodeEntities(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#0?39;/gi, "'")
      .replace(/&apos;/gi, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(parseInt(n, 10)); });
  }
  function strip(s) {
    return decodeEntities(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  }
  function num(s) { const m = String(s || '').replace(/<[^>]+>/g, ' ').match(/\d+/); return m ? parseInt(m[0], 10) : 0; }
  function clean(name) { return strip(name).replace(/\s*:\s*$/, '').trim(); }

  // ---------- TRADUCCIÓN DE CATEGORÍAS ----------
  const FRASES = [
    [/Men's Singles/gi, 'Singles Varones'], [/Women's Singles/gi, 'Singles Damas'],
    [/Boy's Singles/gi, 'Singles Niños'], [/Girl's Singles/gi, 'Singles Niñas'],
    [/Men's Doubles/gi, 'Dobles Varones'], [/Women's Doubles/gi, 'Dobles Damas'],
    [/Mixed Doubles/gi, 'Dobles Mixto'], [/Junior Singles/gi, 'Singles Juvenil']
  ];
  const TOKENS = [
    [/\bMen's\b/gi, 'Varones'], [/\bWomen's\b/gi, 'Damas'], [/\bBoy's\b/gi, 'Niños'],
    [/\bGirl's\b/gi, 'Niñas'], [/\bMixed\b/gi, 'Mixto'], [/\bDoubles\b/gi, 'Dobles'],
    [/\bSingles\b/gi, 'Singles'], [/\bNovice\b/gi, 'Novicios'], [/\bJuniors\b/gi, 'Juveniles'],
    [/\bJunior\b/gi, 'Juvenil'], [/\bMultibounce\b/gi, 'Multibote'],
    [/\bConsolation\b/gi, 'Consolación'], [/\bPlayoff\b/gi, 'Definición'],
    [/\bDropdown\b/gi, 'Repechaje'], [/\band Under\b/gi, 'y menores']
  ];
  function traducirCategoria(name) {
    let s = String(name || '').replace(/[´`’]/g, "'").replace(/\s+/g, ' ').trim();
    for (const [re, r] of FRASES) s = s.replace(re, r);
    for (const [re, r] of TOKENS) s = s.replace(re, r);
    return s.replace(/\s+/g, ' ').trim();
  }
  // Categoría "base" para agrupar el ranking: quita sufijos de cuadro/consolación.
  function categoriaBase(name) {
    let s = String(name || '').replace(/\s+/g, ' ').trim();
    s = s.replace(/\s+(Consolation|Playoff|Dropdown|Consolación|Definición|Repechaje)\b.*$/i, '');
    s = s.replace(/\s+(ORO|PLATA|BRONCE|NO JUGAR|BLANCO)\b.*$/i, '');
    s = s.replace(/\s+Group:?\s*\d+.*$/i, '');
    return s.trim();
  }
  // Nivel de cuadro olímpico (para el puntaje FECHIRA).
  function nivelCuadro(name) {
    const s = String(name || '').toUpperCase();
    if (/\bORO\b|GOLD/.test(s)) return 'oro';
    if (/\bPLATA\b|SILVER|BLUE/.test(s)) return 'plata';
    if (/\bBRONCE\b|BRONZE/.test(s)) return 'bronce';
    if (/NO JUGAR|BLANCO|WHITE/.test(s)) return 'blanco';
    return 'oro';
  }

  // ---------- TOURNAMENT META ----------
  function parseTournament(html) {
    const titleM = html.match(/<title>([^<]*)<\/title>/i);
    let name = titleM ? strip(titleM[1]) : '';
    name = name
      .replace(/^\s*(Racquetball Divisions|Results|Entry List|Divisions|Brackets|Schedule|Times|Participants)\s*[:\-]\s*/i, '')
      .replace(/\s*-\s*Racquetball.*$/i, '')
      .trim();
    const datesM = html.match(/(\d{1,2}\/\d{1,2}\/\d{4})\s*(?:-|&nbsp;-&nbsp;|to)\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
    let venue = '';
    if (datesM) {
      const start = html.indexOf(datesM[0]) + datesM[0].length;
      let after = html.slice(start, start + 700).split(/<a\b|<script|<table|<\/td|<\/table/i)[0];
      let txt = strip(after).replace(/^\s*[-–|]\s*/, '').trim();
      if (name && txt.toLowerCase().indexOf(name.toLowerCase()) === 0) {
        txt = txt.slice(name.length).replace(/^\s*[-–|]\s*/, '').trim();
      }
      venue = txt.slice(0, 140).trim();
    }
    return { name: name, startDate: datesM ? datesM[1] : '', endDate: datesM ? datesM[2] : '', venue: venue };
  }

  // ---------- DIVISIONS (listAllDivs.asp) ----------
  function parseDivisions(html) {
    const out = [];
    const rows = html.split(/<TR\s+valign="top">/i).slice(1);
    let order = 0;
    for (const row of rows) {
      const vb = row.match(/viewBracket\(\s*(\d+)\s*,\s*(\d+)\s*\)/i);
      if (!vb) continue;
      const divID = vb[1], combinedID = vb[2];
      const nameM = row.match(/<B>([^<]*)<\/B>/i);
      const name = nameM ? clean(nameM[1]) : '';
      if (!name) continue;
      const codeM = row.match(/<font size="2"[^>]*>\s*<b>([^<]+)<\/b>/i);
      const entM = row.match(/(\d+)\s*<br>/i);
      const dtM = row.match(/courtGrid\/images\/[\w]+\.gif">\s*&nbsp;\s*([^<]+?)\s*<\/FONT>/i);
      const dlr = row.match(/divMediaReport\(\s*(\d+)\s*\)/i);
      out.push({
        order: ++order,
        name: name,
        nameEs: traducirCategoria(name),
        drawType: dtM ? clean(dtM[1]) : '',
        entries: entM ? parseInt(entM[1], 10) : 0,
        team: /Doubles/i.test(name),
        divID: divID,
        combinedID: combinedID,
        divListID: dlr ? dlr[1] : '',
        code: codeM ? strip(codeM[1]) : ''
      });
    }
    return out;
  }

  // ---------- PLAYERS (EntryList.asp) ----------
  function parsePlayers(html) {
    const out = [];
    const rows = html.split(/<tr\b[^>]*>/i);
    for (const row of rows) {
      const uidM = row.match(/r2-profile-event\.asp\?UID=(\d+)/i);
      if (!uidM) continue;
      const uid = uidM[1];
      // name: text of the profile anchor that has a non-empty label (the <h1> one)
      let name = '';
      const reN = /r2-profile-event\.asp\?UID=\d+[^>]*>\s*([^<]+?)\s*<\/a>/gi;
      let nm;
      while ((nm = reN.exec(row)) !== null) { const t = clean(nm[1]); if (t) { name = t; break; } }
      if (!name) continue;
      // location: a <p> or text holding "Ciudad XXX" (XXX = 3-letter country)
      let place = '', country = '', club = '';
      const locM = row.match(/<p>\s*([^<]*?\b[A-Z]{3}\b[^<]*?)\s*<\/p>/);
      const locText = locM ? clean(locM[1]) : '';
      const cM = locText.match(/\b([A-Z]{3})\b/);
      if (cM) {
        country = cM[1];
        place = locText.slice(0, cM.index).replace(/[,\s]+$/, '').trim();
        club = locText.slice(cM.index + 3).replace(/^[,\s]+/, '').trim();
      } else { place = locText; }
      // divisions + partner
      const divs = [];
      const reDiv = /viewBracket\(\s*(\d+)\s*,\s*(\d+)\s*\)\s*>\s*([^<]*?)\s*<\/a>([^<]*)/gi;
      let dm;
      while ((dm = reDiv.exec(row)) !== null) {
        const partnerM = (dm[4] || '').match(/Partner:\s*([^\n<]+)/i);
        const dn = clean(dm[3]);
        divs.push({
          divID: dm[1], combinedID: dm[2],
          division: dn, divisionEs: traducirCategoria(dn),
          partner: partnerM ? clean(partnerM[1]) : ''
        });
      }
      out.push({ uid: uid, name: name, place: place, country: country, club: club, divisions: divs, results: [] });
    }
    out.sort(function (a, b) { return a.name.localeCompare(b.name); });
    return out;
  }

  // ---------- RESULTS / MEDALS (viewResults.asp) ----------
  function tdCells(rowHtml) {
    return rowHtml.split(/<td\b/i).slice(1).map(function (c) { return c.replace(/^[^>]*>/, '').split(/<\/td>/i)[0]; });
  }
  function splitPlayers(cellHtml) {
    const players = [];
    const re = /UID=(\d+)[^>]*>\s*([^<]+?)\s*<\/a>/gi;
    let m, found = false;
    while ((m = re.exec(cellHtml)) !== null) { players.push({ uid: m[1], name: clean(m[2]) }); found = true; }
    if (!found) {
      const t = strip(cellHtml);
      if (t && t !== '-' && !/^&nbsp;$/.test(t)) {
        t.split(/\s*\/\s*/).forEach(function (n) { if (n.trim()) players.push({ uid: '', name: clean(n) }); });
      }
    }
    return players;
  }
  function parseResults(html) {
    const i = html.search(/Runner-?Up/i);
    if (i < 0) return { available: false, divisions: [], medals: [] };
    const ts = html.lastIndexOf('<table', i);
    let te = html.indexOf('</table>', i);
    if (te < 0) te = html.length;
    const tbl = html.slice(ts, te + 8);
    const rows = tbl.split(/<tr\b/i).slice(1);
    const PLACE_LABELS = ['Campeón', 'Finalista', 'Semifinal', 'Semifinal', 'Cuartos', 'Cuartos', 'Cuartos', 'Cuartos'];
    const divisions = [];
    for (const r of rows) {
      const cells = tdCells(r);
      if (cells.length < 6) continue;
      const code = strip(cells[0]);
      if (!code || /Division\s*Code/i.test(strip(cells[0])) || /RACQUETBALL EVENT/i.test(strip(cells[0]))) continue;
      const type = strip(cells[1]);
      const name = strip(cells[2]);
      const entries = num(cells[3]);
      const drawType = strip(cells[4]);
      if (!type && !name) continue;
      const placements = [];
      for (let c = 5; c < cells.length; c++) {
        const players = splitPlayers(cells[c]);
        if (players.length) placements.push({ rank: c - 4, label: PLACE_LABELS[c - 5] || ('Puesto ' + (c - 4)), players: players });
      }
      if (placements.length) divisions.push({ code: code, type: type, name: name, nameEs: traducirCategoria(name), entries: entries, drawType: drawType, placements: placements });
    }
    const tally = {};
    function add(p, kind) {
      if (!p) return;
      const key = p.uid || p.name;
      if (!tally[key]) tally[key] = { uid: p.uid, name: p.name, gold: 0, silver: 0, bronze: 0 };
      tally[key][kind]++;
    }
    divisions.forEach(function (d) {
      d.placements.forEach(function (pl) {
        const kind = pl.rank === 1 ? 'gold' : pl.rank === 2 ? 'silver' : pl.rank <= 4 ? 'bronze' : null;
        if (kind) pl.players.forEach(function (p) { add(p, kind); });
      });
    });
    const medals = Object.keys(tally).map(function (k) { return tally[k]; })
      .filter(function (x) { return x.name; })
      .sort(function (a, b) { return (b.gold - a.gold) || (b.silver - a.silver) || (b.bronze - a.bronze) || a.name.localeCompare(b.name); });
    return { available: divisions.length > 0, divisions: divisions, medals: medals };
  }

  // ---------- MATCH REPORTS (mediaMatchResults.asp) ----------
  // Maneja tanto "upcoming" (día/hora) como "results" (ganador/score) por división.
  function detectStatus(html) {
    if (/noDraws\.asp|Object Moved|has not yet been released|Brackets are currently unavailable|No Draws/i.test(html)) {
      const r = html.match(/Start Times ready:\s*([^<]+?)\s*<\//i);
      return { blocked: true, code: 'sin_horarios', ready: r ? clean(r[1]) : '' };
    }
    return { blocked: false };
  }
  function parseScoreText(slice) {
    if (/WBF|No Show|Forfeit|Default|Withdr/i.test(slice)) return { raw: 'WBF', games: [], forfeit: true };
    const txt = slice.replace(/<[^>]+>/g, ' ');
    const m = txt.match(/\b(\d{1,2}-\d{1,2}(?:\s*,\s*\d{1,2}-\d{1,2}){0,6})\b/);
    if (!m) return { raw: '', games: [], forfeit: false };
    const games = m[1].split(',').map(function (g) { const p = g.trim().split('-'); return { w: parseInt(p[0], 10), l: parseInt(p[1], 10) }; });
    return { raw: m[1].replace(/\s+/g, ' ').trim(), games: games, forfeit: false };
  }
  function extractPlayers(slice) {
    const players = [];
    let m;
    const reA = /UID=(\d+)[^>]*>\s*<b>\s*([^<]+?)\s*<\/b>\s*<\/a>(?:\s*&nbsp;)?\s*(?:\(([^)]*)\))?/gi;
    while ((m = reA.exec(slice)) !== null) players.push({ uid: m[1], name: clean(m[2]), loc: clean(m[3] || '') });
    if (players.length) return players;
    const reB = /<b>\s*([^<(][^<]*?)\s*<\/b>/gi;
    while ((m = reB.exec(slice)) !== null) { const nm = clean(m[1]); if (nm && !/^\(/.test(nm)) players.push({ uid: '', name: nm, loc: '' }); }
    return players;
  }
  function parseMatchReport(html) {
    const st = detectStatus(html);
    if (st.blocked) return { status: st.code, startTimesReady: st.ready, divisions: [] };
    const heads = [];
    const reH = /drawOut\.asp\?TID=\d+&(?:amp;)?divID=(\d+)&(?:amp;)?combinedID=(\d+)"[^>]*>\s*([^<]+?)\s*<\/a>/gi;
    let h;
    while ((h = reH.exec(html)) !== null) {
      const tail = html.slice(h.index, h.index + 400);
      const dt = tail.match(/-\s*<font[^>]*>\s*<b>\s*([^<]+?)\s*<\/b>/i);
      const dn = clean(h[3]);
      heads.push({ idx: h.index, divID: h[1], combinedID: h[2], division: dn, divisionEs: traducirCategoria(dn), drawType: dt ? clean(dt[1]) : '', matches: [] });
    }
    const labels = [];
    const reL = /\(([^)]{1,24})\)\s*<\/font>\s*<\/b>/gi;
    let l;
    while ((l = reL.exec(html)) !== null) labels.push({ idx: l.index, round: clean(l[1]), end: reL.lastIndex });
    for (let i = 0; i < labels.length; i++) {
      const start = labels[i].end;
      const end = labels[i + 1] ? labels[i + 1].idx : html.length;
      const slice = html.slice(start, Math.min(end, start + 1600));
      const players = extractPlayers(slice);
      if (!players.length) continue;
      const dt = slice.match(/([A-Za-z]{3,9})\s+(\d{1,2}:\d{2}:\d{2}\s*[AP]M)/);
      const sc = parseScoreText(slice);
      const isResult = /\bdef\b/i.test(slice) || sc.games.length > 0 || sc.forfeit;
      let owner = null;
      for (const hd of heads) { if (hd.idx < labels[i].idx) owner = hd; else break; }
      const mt = {
        round: labels[i].round,
        day: dt ? dt[1] : '', time: dt ? dt[2].replace(/\s+/g, ' ') : '',
        players: players.slice(0, 2),
        winner: isResult ? 0 : null,
        rawScore: sc.raw, games: sc.games, forfeit: sc.forfeit
      };
      if (owner) owner.matches.push(mt);
    }
    return { status: 'ok', divisions: heads.filter(function (d) { return d.matches.length; }) };
  }

  // Construye rondas a partir de los partidos de UNA división (reporte byDiv).
  const ROUND_ORDER = [
    [/final/i, 'Final', 100], [/3rd|third|tercer/i, '3er lugar', 95],
    [/semi/i, 'Semifinales', 90], [/qtr|quarter|cuarto/i, 'Cuartos', 80]
  ];
  function canonicalRound(label) {
    const t = String(label || '').toLowerCase();
    if (/final/.test(t) && !/semi|quarter|qtr/.test(t)) return { name: 'Final', order: 100 };
    if (/3rd|third|tercer/.test(t)) return { name: '3er lugar', order: 95 };
    if (/semi/.test(t)) return { name: 'Semifinales', order: 90 };
    if (/qtr|quarter|cuarto/.test(t)) return { name: 'Cuartos', order: 80 };
    let m = t.match(/(\d+)\s*'?s/) || t.match(/round of (\d+)/);
    if (m) { const n = +m[1]; const NM = { 16: 'Octavos', 32: '16avos', 64: '32avos', 8: 'Cuartos' }; return { name: NM[n] || ('Ronda de ' + n), order: n }; }
    m = t.match(/rnd\s*(\d+)/) || t.match(/round\s*(\d+)/);
    if (m) return { name: 'Fecha ' + m[1], order: 40 + (+m[1]) };
    return { name: clean(label), order: 50 };
  }
  function buildRounds(matches) {
    const map = {};
    (matches || []).forEach(function (mt) {
      const cr = canonicalRound(mt.round);
      if (!map[cr.name]) map[cr.name] = { name: cr.name, order: cr.order, matches: [] };
      map[cr.name].matches.push({
        a: mt.players[0] ? { uid: mt.players[0].uid, name: mt.players[0].name, loc: mt.players[0].loc } : null,
        b: mt.players[1] ? { uid: mt.players[1].uid, name: mt.players[1].name, loc: mt.players[1].loc } : null,
        winner: mt.winner === 0 ? 'a' : null,
        rawScore: mt.rawScore, games: mt.games, forfeit: mt.forfeit
      });
    });
    return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) { return a.order - b.order; });
  }

  return {
    decodeEntities: decodeEntities,
    strip: strip,
    traducirCategoria: traducirCategoria,
    categoriaBase: categoriaBase,
    nivelCuadro: nivelCuadro,
    parseTournament: parseTournament,
    parseDivisions: parseDivisions,
    parsePlayers: parsePlayers,
    parseResults: parseResults,
    parseMatchReport: parseMatchReport,
    buildRounds: buildRounds,
    canonicalRound: canonicalRound
  };
});
