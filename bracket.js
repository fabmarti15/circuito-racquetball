/*
 * bracket.js — Reconstruye el árbol completo de una llave desde view-bracket.asp
 * (la página visual de r2sports). Es la única fuente donde la Federación Chilena
 * publica resultados. El caller debe seguir el redirect de drawOut.asp y decodificar
 * iso-8859-1 antes de pasar el HTML. Devuelve:
 *   { available, type:'elim'|'rr', rounds:[{name,order,matches:[{a,b,winner,rawScore,games,forfeit}]}],
 *     entrants:[{seed,name,loc}], standings:[...], champion }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.parseVisualBracket = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function stripTags(s) {
    return String(s).replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
      .replace(/\s+/g, ' ').trim();
  }
  function parseGames(raw) {
    var out = [];
    if (!raw) return out;
    var parts = raw.split(',');
    for (var i = 0; i < parts.length; i++) {
      var mm = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(parts[i]);
      if (mm) out.push({ w: parseInt(mm[1], 10), l: parseInt(mm[2], 10) });
    }
    return out;
  }
  function isForfeit(raw) { return /WBF|No\s*Show|Default|Forfeit|Bye/i.test(raw); }
  function norm(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }

  var BY_DEPTH = ['Final', 'Semifinales', 'Cuartos', 'Ronda de 16', 'Ronda de 32', 'Ronda de 64', 'Ronda de 128', 'Ronda de 256'];
  var ORDER_BY_DEPTH = [100, 90, 80, 70, 60, 50, 40, 30];

  function cellInner(html, start) {
    var rest = html.slice(start);
    var gt = rest.indexOf('>');
    if (gt < 0) return '';
    var after = rest.slice(gt + 1);
    var cut = after.search(/<\/?(td|tr|table)\b/i);
    return cut >= 0 ? after.slice(0, cut) : after;
  }
  function boldName(inner) {
    var b = /<b>([\s\S]*?)<\/b>/.exec(inner);
    if (!b) return null;
    var t = stripTags(b[1]);
    return t || null;
  }
  function cityOf(inner) {
    var em = /:\s*<em>([\s\S]*?)<\/em>/.exec(inner);
    return em ? stripTags(em[1]) : null;
  }

  function parseVisualBracket(html) {
    if (typeof html !== 'string' || !html) return notAvail();

    var hasTree = /border-bottom:3\.0pt solid/i.test(html) || /CHAMPION/.test(html);
    if (!hasTree && /(round\s*robin|pool\s*play|Matches\s*W-?L|Games\s*W-?L|Place)/i.test(html)) {
      return parseRoundRobin(html);
    }

    var tdRe = /<td\b([^>]*)>/gi, m;
    var tds = [];
    while ((m = tdRe.exec(html))) {
      tds.push({ start: m.index, attrs: m[1] || '', inner: cellInner(html, m.index) });
    }

    var col0 = [];
    var entrants = [];
    for (var i = 0; i < tds.length; i++) {
      var c = tds[i];
      if (!/border-bottom:[0-9.]+pt solid/i.test(c.attrs)) continue;
      if (!/align="?left/i.test(c.inner)) continue;
      var nm = boldName(c.inner);
      if (!nm) continue;
      if (nm.toUpperCase() === 'BYE') { col0.push(null); continue; }
      var slot = { name: nm, seed: seedBefore(tds, i), loc: cityOf(c.inner) };
      col0.push(slot);
      entrants.push({ seed: slot.seed, name: slot.name, loc: slot.loc });
    }
    if (!col0.length) return notAvail();

    var nameSeq = [], scoreSeq = [];
    var scRe = /<font size="1">([^<]*(?:\d+\s*-\s*\d+|WBF|No\s*Show|Default|Forfeit)[^<]*)<\/font>/gi;
    for (var j = 0; j < tds.length; j++) {
      var t = tds[j];
      var center = /align="?center/i.test(t.inner);
      var bordered = /border-bottom:[0-9.]+pt solid/i.test(t.attrs);
      if (center && bordered) {
        var n2 = boldName(t.inner);
        if (n2 && n2.toUpperCase() !== 'CHAMPION' && n2.toUpperCase() !== 'BYE') {
          nameSeq.push({ start: t.start, name: n2 });
        }
      }
      var sm = scRe.exec(t.inner); scRe.lastIndex = 0;
      if (sm) {
        var raw = stripTags(sm[1]);
        if (raw) scoreSeq.push({ start: t.start, raw: raw, forfeit: isForfeit(raw) });
      }
    }

    var nMatches = col0.length / 2;
    var columns = [col0];
    var idx = 0, size = nMatches;
    while (size >= 1 && idx < nameSeq.length) {
      var block = nameSeq.slice(idx, idx + size);
      columns.push(block.map(function (b) { return { name: b.name, start: b.start }; }));
      idx += size;
      if (size === 1) break;
      size = size / 2;
    }

    function scoreForRender(renderStart, nextStart) {
      for (var s = 0; s < scoreSeq.length; s++) {
        var sc = scoreSeq[s];
        if (sc.start > renderStart && (nextStart == null || sc.start < nextStart)) return sc;
      }
      return null;
    }
    function matchSide(a, b, winnerName) {
      if (!winnerName) return null;
      if (a && nameMatch(a.name, winnerName)) return 'a';
      if (b && nameMatch(b.name, winnerName)) return 'b';
      if (a && !b) return 'a';
      if (b && !a) return 'b';
      return null;
    }

    var enriched = [];
    enriched.push(col0.map(function (s) { return s; }));
    for (var ci = 1; ci < columns.length; ci++) {
      var arr = [];
      var parent = enriched[ci - 1];
      for (var k = 0; k < columns[ci].length; k++) {
        var rnd = columns[ci][k];
        var nextStart = (k + 1 < columns[ci].length) ? columns[ci][k + 1].start
          : (ci + 1 < columns.length && columns[ci + 1].length ? columns[ci + 1][0].start : null);
        var sc = scoreForRender(rnd.start, nextStart);
        var pa = parent[2 * k] || null, pb = parent[2 * k + 1] || null;
        var resolved = null;
        if (pa && nameMatch(pa.name, rnd.name)) resolved = pa;
        else if (pb && nameMatch(pb.name, rnd.name)) resolved = pb;
        else if (pa && !pb) resolved = pa;
        else if (pb && !pa) resolved = pb;
        arr.push({
          name: resolved ? resolved.name : rnd.name,
          shortName: rnd.name,
          seed: resolved && resolved.seed != null ? resolved.seed : null,
          loc: resolved && resolved.loc ? resolved.loc : null,
          score: sc
        });
      }
      enriched.push(arr);
    }

    var nRounds = columns.length - 1;
    var rounds = [];
    for (var r = 0; r < nRounds; r++) {
      var prev = enriched[r], next = enriched[r + 1], matches = [];
      for (var mi = 0; mi < next.length; mi++) {
        var A = prev[2 * mi] || null, B = prev[2 * mi + 1] || null, W = next[mi];
        var side = matchSide(A, B, W ? W.name : null);
        var isBye = (!A || !B);
        var sc = (W && W.score && !isBye) ? W.score : null;
        matches.push({
          a: A ? { name: A.name, seed: A.seed != null ? A.seed : null, loc: A.loc || null } : null,
          b: B ? { name: B.name, seed: B.seed != null ? B.seed : null, loc: B.loc || null } : null,
          winner: side,
          rawScore: sc ? sc.raw : '',
          games: sc ? parseGames(sc.raw) : [],
          forfeit: sc ? !!sc.forfeit : false
        });
      }
      var depthFromFinal = nRounds - 1 - r;
      rounds.push({
        name: BY_DEPTH[depthFromFinal] || ('R' + (r + 1)),
        order: ORDER_BY_DEPTH[depthFromFinal] != null ? ORDER_BY_DEPTH[depthFromFinal] : (10 + r),
        matches: matches
      });
    }
    rounds.sort(function (x, y) { return x.order - y.order; });

    var champion = null;
    if (enriched.length && enriched[enriched.length - 1].length === 1) champion = enriched[enriched.length - 1][0].name;
    if (!champion) champion = championName(html);

    return { available: true, type: 'elim', rounds: rounds, entrants: entrants, standings: [], champion: champion };
  }

  function nameMatch(a, b) {
    a = norm(a); b = norm(b);
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.indexOf('/') >= 0 || b.indexOf('/') >= 0) {
      var pa = a.split('/').map(function (x) { return x.trim(); });
      var pb = b.split('/').map(function (x) { return x.trim(); });
      if (pa.length === pb.length) {
        var allok = true;
        for (var i = 0; i < pa.length; i++) if (!tokenMatch(pa[i], pb[i])) { allok = false; break; }
        if (allok) return true;
      }
      return false;
    }
    return tokenMatch(a, b);
  }
  function tokenMatch(a, b) {
    a = norm(a); b = norm(b);
    if (a === b) return true;
    var A = a.split(' '), B = b.split(' ');
    if (!A.length || !B.length) return false;
    var lastA = A[A.length - 1], lastB = B[B.length - 1];
    if (lastA !== lastB) return false;
    if (A.length === 1 || B.length === 1) return true;
    return A[0].charAt(0) === B[0].charAt(0);
  }

  function seedBefore(tds, idx) {
    for (var k = idx - 1; k >= 0 && k >= idx - 3; k--) {
      var mm = /<font color="#006600" size="1">\s*(\d+)\s*<\/font>/i.exec(tds[k].inner);
      if (mm) return parseInt(mm[1], 10);
      if (/<b>/.test(tds[k].inner) && /border-bottom/.test(tds[k].attrs)) break;
    }
    return null;
  }
  function championName(html) {
    var idx = html.search(/CHAMPION/);
    if (idx < 0) return null;
    var before = html.slice(Math.max(0, idx - 900), idx);
    var all = before.match(/<b>(?:<font[^>]*>)?[\s\S]*?(?:<\/font>)?<\/b>/g);
    if (!all || !all.length) return null;
    for (var i = all.length - 1; i >= 0; i--) {
      var t = stripTags(all[i]);
      if (t && t.toUpperCase() !== 'BYE') return t;
    }
    return null;
  }

  function parseRoundRobin(html) {
    var standings = [];
    var seedRe = /<font size="4" color="#006600">\s*(\d+)\s*<\/font>/gi;
    var marks = [], m;
    while ((m = seedRe.exec(html))) marks.push({ seed: parseInt(m[1], 10), pos: m.index, end: seedRe.lastIndex });
    if (!marks.length) return fallbackRR(html);

    for (var i = 0; i < marks.length; i++) {
      var segEnd = (i + 1 < marks.length) ? marks[i + 1].pos : html.length;
      var seg = html.slice(marks[i].end, segEnd);
      var nameM = /<strong>(?:<font[^>]*>)?([\s\S]*?)(?:<\/font>)?<\/strong>/i.exec(seg);
      var name = nameM ? cleanName(nameM[1]) : null;
      if (!name) continue;
      var loc = null;
      var cityM = /<br\s*\/?>\s*([^<]+?)\s*<\/font>/i.exec(seg);
      if (cityM) loc = stripTags(cityM[1]) || null;
      var stats = [];
      var statRe = /<div align="center">\s*<font size="2">\s*<strong>([\s\S]*?)<\/strong>/gi, sm;
      while ((sm = statRe.exec(seg))) {
        var v = stripTags(sm[1]);
        stats.push(v === '' ? 0 : (/^\d+$/.test(v) ? parseInt(v, 10) : null));
      }
      var place = null;
      var pm = /(\d+)(?:st|nd|rd|th)\b/i.exec(seg);
      if (pm) place = parseInt(pm[1], 10);
      standings.push({
        seed: marks[i].seed, name: name, loc: loc, place: place,
        matchesW: stats[0] != null ? stats[0] : null, matchesL: stats[1] != null ? stats[1] : null,
        gamesW: stats[2] != null ? stats[2] : null, gamesL: stats[3] != null ? stats[3] : null,
        pointsFor: stats[4] != null ? stats[4] : null, pointsAgainst: stats[5] != null ? stats[5] : null
      });
    }
    standings.sort(function (a, b) { return (a.place || 99) - (b.place || 99); });
    return {
      available: standings.length > 0, type: 'rr', rounds: [], standings: standings,
      entrants: standings.map(function (s) { return { seed: s.seed, name: s.name, loc: s.loc }; }), champion: (standings[0] && standings[0].name) || null
    };
  }
  function cleanName(raw) {
    return stripTags(String(raw).replace(/<font color=?["']?#?f{3,6}["']?>_<\/font>/gi, ' ')).trim();
  }
  function fallbackRR(html) {
    var standings = [];
    var rows = html.match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var nm = /<(?:b|strong)>([\s\S]*?)<\/(?:b|strong)>/i.exec(row);
      if (!nm) continue;
      var name = cleanName(nm[1]);
      if (!name || /^(seed|name|place|won|lost|matches|games|points)$/i.test(name)) continue;
      var nums = (row.match(/>\s*(\d+)\s*</g) || []).map(function (x) { return parseInt(x.replace(/\D/g, ''), 10); });
      standings.push({ seed: nums[0] != null ? nums[0] : null, name: name, loc: null, place: null });
    }
    return { available: standings.length > 0, type: 'rr', rounds: [], standings: standings, entrants: standings.map(function (s) { return { seed: s.seed, name: s.name, loc: s.loc }; }), champion: null };
  }

  function notAvail() { return { available: false, type: 'elim', rounds: [], entrants: [], standings: [], champion: null }; }

  return parseVisualBracket;
});
