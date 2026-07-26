/*
 * generar-jugadores.js — Un solo registro de jugadores para toda la web.
 *
 * Junta dos mundos que no se conocen entre sí:
 *   - El ranking oficial (data/ranking-oficial.json): nombres escritos a mano en un
 *     PDF, con ciudad y puntos, SIN identificador.
 *   - r2sports (data/jugadores.json y data/<tid>.json): tiene UID único por persona,
 *     que es la única identidad confiable, pero escribe los nombres distinto.
 *
 * Problemas reales que resuelve:
 *   - "Ruben Igor" y "Ruben Igor Rencoret" son la misma persona; "Rodrigo Salgado Jr."
 *     y "Rodrigo Salgado I." NO lo son (hijo y papá).
 *   - Variantes de tipeo: Martinez/Martines, Escoda/Escoca, McCarthy/Mc Carthy,
 *     Nicolas/Nicola, acentos puestos o no.
 *   - La ciudad cambia según la categoría (Nineth Rodriguez aparece en tres);
 *     acá la ciudad pasa a ser del jugador, con las variantes guardadas.
 *
 * Regla de oro: ante duda NO se une. Los casos dudosos quedan listados en
 * data/dudosos.json para que Fabián decida, y mientras tanto van sin enlace.
 *
 * Salidas:
 *   data/jugadores-circuito.json   registro unificado
 *   data/dudosos.json              casos para revisión humana
 *
 * Uso: node generar-jugadores.js
 */
const fs = require('fs');
const path = require('path');
const DATA = path.join(__dirname, 'data');

// Uniones confirmadas a mano: nombre del ranking -> nombre en r2sports.
// Editar acá cuando se confirme un caso dudoso.
const ALIAS = {
  'ruben igor rencoret': 'Ruben Igor',
  'nicola ahumada': 'Nicolas Ahumada',
  'joaquin catalan': 'Joaquin Catalán',
  'agustin quilodran': 'Agustin Quilodran',
  'miguel quilodran': 'Miguel Quilodran',
  'emilio manan': 'Emilio Manan',
  'benjamin aguirre': 'Benjamin Andre Aguirre Fuentes',
  'patricio gatica': 'Patricio Gatica Tagle',
  'ignacio gutierrez': 'Ignacio Andrés Gutierrez Orellana',
  'allan mccarthy': 'Allan Mc Carthy',
  'catalina escoca': 'Catalina Escoda',
  'juan jose martinez': 'Juan Martinez',
  'francisca fuentes': 'Francica Fuentes',
  'bruno gonzales': 'Bruno Gonzalez'
};
// Uniones confirmadas por Fabián que necesitan distinguir el sufijo: la clave
// incluye la inicial. "El que le va mejor es el hijo": Q. va 3º en Open y 2º en
// Dobles, I. va 25º y 16º, así que Q. es Jr. (uid 96164) e I. es el papá. El
// "Rodrigo Salgado" sin inicial de Singles A es el papá: el hijo juega Open.
const ALIAS_EXACTO = {
  'rodrigo salgado#q': 'Rodrigo Salgado Jr.',
  'rodrigo salgado#i': 'Rodrigo Salgado I.',
  'rodrigo salgado': 'Rodrigo Salgado I.'
};
// Dos cuentas de r2sports que son la misma persona (se inscribió dos veces).
// La segunda se absorbe en la primera, incluidos sus partidos.
const FUSIONAR_UID = { '642666': '636100' };
// Personas distintas que un algoritmo uniría: nunca fusionar estos pares.
const NO_UNIR = [
  ['rodrigo salgado jr', 'rodrigo salgado i'],
  ['rodrigo salgado q', 'rodrigo salgado i']
];

const SUFIJO = /^(jr|sr|ii|iii|iv|i|v|q|b|f|h)$/;   // Q. y F. aparecen como inicial de apellido materno
function leer(f, def) { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch (e) { return def; } }
function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}
function partes(s) {
  const t = norm(s).split(' ').filter(Boolean), sufs = [];
  while (t.length > 1 && SUFIJO.test(t[t.length - 1])) sufs.unshift(t.pop());
  return { toks: t, suf: sufs.join(' ') };
}
function claveExacta(s) { const p = partes(s); return p.toks.join(' ') + (p.suf ? '#' + p.suf : ''); }
function claveBase(s) { return partes(s).toks.join(' '); }
// Solo el apellido: la comparación del nombre de pila se hace aparte, porque
// juntar por la inicial unía a personas distintas (Camilo y Carlos Salinas,
// Cristian y Claudio Torres, Gonzalo y Gabriel Vergara).
function claveApellido(s) {
  const p = partes(s);
  if (p.toks.length < 2) return '';
  return p.toks[p.toks.length - 1];
}
function distancia(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, function (_, i) { return [i].concat(new Array(n).fill(0)); });
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[m][n];
}
// ¿Los nombres de pila pueden ser la misma persona?
function pilaCompatible(a, b) {
  const pa = partes(a).toks, pb = partes(b).toks;
  if (!pa.length || !pb.length) return false;
  const na = pa.slice(0, -1).join(' '), nb = pb.slice(0, -1).join(' ');
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.indexOf(nb) === 0 || nb.indexOf(na) === 0) return true;      // "Juan" vs "Juan José"
  const p1 = na.split(' ')[0], p2 = nb.split(' ')[0];
  if (p1 === p2) return true;
  return Math.min(p1.length, p2.length) >= 5 && distancia(p1, p2) <= 2; // Cristian/Christian, Erwin/Edwin
}
// Sufijos distintos = personas distintas hasta que un humano diga lo contrario
// (Rodrigo Salgado Jr. no es Rodrigo Salgado I.).
function sufijoChoca(a, b) {
  const sa = partes(a).suf, sb = partes(b).suf;
  return !!sa && !!sb && sa !== sb;
}
function ciudadChoca(nombreCiudad, reg) {
  if (!nombreCiudad || !reg.ciudades.length) return false;
  const c = norm(nombreCiudad).split(',')[0].trim();
  return !reg.ciudades.some(function (x) {
    const y = norm(x).split(',')[0].trim();
    return y === c || y.indexOf(c) >= 0 || c.indexOf(y) >= 0;
  });
}
// Variantes de tipeo frecuentes en estas listas: z/s, c/z, doble consonante, y/i.
function claveFonetica(s) {
  return claveBase(s).replace(/mc\s+/g, 'mc').replace(/z/g, 's').replace(/c([ei])/g, 's$1')
    .replace(/([a-z])\1/g, '$1').replace(/y/g, 'i').replace(/v/g, 'b').replace(/h/g, '');
}
function noUnir(a, b) {
  const ka = claveExacta(a).replace('#', ' ').trim(), kb = claveExacta(b).replace('#', ' ').trim();
  return NO_UNIR.some(function (par) {
    return (par.indexOf(ka) >= 0 && par.indexOf(kb) >= 0) ||
      (ka.indexOf(par[0]) >= 0 && kb.indexOf(par[1]) >= 0) || (ka.indexOf(par[1]) >= 0 && kb.indexOf(par[0]) >= 0);
  });
}

// ---------- 1. jugadores de r2sports (los que tienen UID) ----------
const r2 = leer('jugadores.json', { players: {} }).players || {};
const porUid = {};
const uidReal = function (u) { return FUSIONAR_UID[String(u)] || String(u); };
Object.keys(r2).forEach(function (uidBruto) {
  const uid = uidReal(uidBruto);
  const p = r2[uidBruto];
  if (porUid[uid]) {
    if (p.name && porUid[uid].alias.indexOf(p.name) < 0) porUid[uid].alias.push(p.name);
    if (p.place && porUid[uid].ciudades.indexOf(p.place) < 0) porUid[uid].ciudades.push(p.place);
    porUid[uid].uidFusionados = (porUid[uid].uidFusionados || []).concat(uidBruto);
    return;
  }
  porUid[uid] = {
    id: 'r2:' + uid, uid: uid, nombre: p.name, ciudades: p.place ? [p.place] : [],
    alias: [p.name], enR2: true, ranking: [], medallas: p.medals || null,
    torneos: (p.tournaments || []).length
  };
});
// nombres de los inscritos por torneo (traen ciudad más fresca)
fs.readdirSync(DATA).filter(function (f) { return /^\d+\.json$/.test(f); }).forEach(function (f) {
  (leer(f, { players: [] }).players || []).forEach(function (p) {
    if (!p.uid) return;
    const u = uidReal(p.uid);
    const r = porUid[u] || (porUid[u] = { id: 'r2:' + u, uid: u, nombre: p.name, ciudades: [], alias: [p.name], enR2: true, ranking: [], torneos: 0 });
    if (p.place && r.ciudades.indexOf(p.place) < 0) r.ciudades.push(p.place);
    if (r.alias.indexOf(p.name) < 0) r.alias.push(p.name);
  });
});

// índices para buscar por nombre
const idx = { exacta: {}, base: {}, ape: {}, fon: {} };
function indexar(reg) {
  reg.alias.forEach(function (n) {
    [['exacta', claveExacta(n)], ['base', claveBase(n)], ['ape', claveApellido(n)], ['fon', claveFonetica(n)]]
      .forEach(function (par) {
        const k = par[1]; if (!k) return;
        (idx[par[0]][k] = idx[par[0]][k] || []).push(reg);
      });
  });
}
Object.keys(porUid).forEach(function (u) { indexar(porUid[u]); });

function candidatos(nombre, ciudad) {
  const exacto = ALIAS_EXACTO[claveExacta(nombre)];
  const alias = exacto || ALIAS[claveBase(nombre)];
  const buscar = alias || nombre;
  // Con una unión confirmada a mano no corren los guardas automáticos.
  if (alias) {
    const directo = Array.from(new Set(idx.exacta[claveExacta(alias)] || []));
    if (directo.length === 1) return { reg: directo[0], via: 'confirmado a mano' };
  }
  const capas = [
    { via: 'nombre igual', lista: idx.exacta[claveExacta(buscar)], exige: false },
    { via: 'nombre sin sufijo', lista: idx.base[claveBase(buscar)], exige: false },
    { via: 'mismo apellido y nombre compatible', lista: idx.ape[claveApellido(buscar)], exige: true },
    { via: 'variante de tipeo', lista: idx.fon[claveFonetica(buscar)], exige: true }
  ];
  for (const capa of capas) {
    let l = (capa.lista || []).filter(function (r) {
      if (noUnir(nombre, r.nombre)) return false;
      if (sufijoChoca(buscar, r.nombre)) return false;
      if (capa.exige && !pilaCompatible(buscar, r.nombre)) return false;
      return true;
    });
    // Si además la ciudad no calza, se prefiere no unir: puede ser un tocayo.
    const conCiudad = l.filter(function (r) { return !ciudadChoca(ciudad, r); });
    if (l.length > 1 && conCiudad.length === 1) l = conCiudad;
    const unicos = Array.from(new Set(l));
    if (unicos.length === 1) {
      const r = unicos[0];
      if (capa.exige && ciudadChoca(ciudad, r)) return { ambiguo: unicos, via: capa.via + ', pero la ciudad no calza' };
      return { reg: r, via: capa.via + (alias ? ' (alias)' : '') };
    }
    if (unicos.length > 1) return { ambiguo: unicos, via: capa.via };
  }
  return {};
}

// ---------- 2. cruzar el ranking oficial ----------
const RK = leer('ranking-oficial.json', { categorias: [] });
const sinUid = {}, dudosos = [];
RK.categorias.forEach(function (cat) {
  cat.jugadores.forEach(function (p) {
    const c = candidatos(p.nombre, p.ciudad);
    let reg;
    if (c.reg) {
      reg = c.reg;
      if (reg.alias.indexOf(p.nombre) < 0) reg.alias.push(p.nombre);
      if (c.via !== 'nombre igual' && !reg.viaCruce) reg.viaCruce = c.via;
    } else {
      // Clave CON sufijo: "Rodrigo Salgado Q." y "Rodrigo Salgado I." son dos
      // personas distintas en el ranking (padre e hijo) y no pueden colapsar.
      const k = claveExacta(p.nombre);
      reg = sinUid[k] || (sinUid[k] = { id: 'rk:' + k.replace(/ /g, '-'), uid: '', nombre: p.nombre, ciudades: [], alias: [p.nombre], enR2: false, ranking: [], torneos: 0 });
      // Sufijo distinto: existe alguien con el mismo nombre base en r2sports pero
      // con otra inicial. No se une, y se deja anotado para revisión.
      const mismoBase = (idx.base[claveBase(p.nombre)] || []).filter(function (r) { return sufijoChoca(p.nombre, r.nombre); });
      if (!c.ambiguo && mismoBase.length) {
        dudosos.push({
          nombreRanking: p.nombre, categoria: cat.label, motivo: 'mismo nombre pero con otra inicial o sufijo en r2sports',
          candidatos: mismoBase.map(function (r) { return { uid: r.uid, nombre: r.nombre, ciudad: r.ciudades[0] || '' }; })
        });
      }
      if (c.ambiguo) {
        dudosos.push({
          nombreRanking: p.nombre, categoria: cat.label, motivo: 'más de un jugador de r2sports calza por ' + c.via,
          candidatos: c.ambiguo.map(function (r) { return { uid: r.uid, nombre: r.nombre, ciudad: r.ciudades[0] || '' }; })
        });
      }
    }
    if (p.ciudad && reg.ciudades.indexOf(p.ciudad) < 0) reg.ciudades.push(p.ciudad);
    reg.ranking.push({ categoria: cat.label, key: cat.key, puesto: p.puesto, pts: p.pts, empatado: !!p.empatado, def: p.def, jugadas: p.jugadas, fechas: p.fechas });
  });
});

const registro = Object.keys(porUid).map(function (u) { return porUid[u]; })
  .concat(Object.keys(sinUid).map(function (k) { return sinUid[k]; }));
registro.forEach(function (r) {
  r.ciudad = r.ciudades[0] || '';
  r.alias = Array.from(new Set(r.alias));
});
registro.sort(function (a, b) { return a.nombre.localeCompare(b.nombre, 'es'); });

fs.writeFileSync(path.join(DATA, 'jugadores-circuito.json'), JSON.stringify({
  updatedAt: new Date().toISOString(),
  corteRanking: RK.corte || null,
  jugadores: registro
}));
fs.writeFileSync(path.join(DATA, 'dudosos.json'), JSON.stringify({ updatedAt: new Date().toISOString(), casos: dudosos }, null, 2));

const conRk = registro.filter(function (r) { return r.ranking.length; });
const cruzados = conRk.filter(function (r) { return r.uid; });
const varias = registro.filter(function (r) { return r.ciudades.length > 1; });
console.log(`Registro: ${registro.length} jugadores (${Object.keys(porUid).length} de r2sports, ${Object.keys(sinUid).length} solo en el ranking)`);
console.log(`Del ranking oficial: ${conRk.length} · con perfil de r2sports: ${cruzados.length} · sin perfil: ${conRk.length - cruzados.length}`);
console.log(`Ciudad inconsistente entre fuentes: ${varias.length}`);
if (varias.length) varias.slice(0, 6).forEach(function (r) { console.log(`   ${r.nombre}: ${r.ciudades.join(' / ')}`); });
console.log(`Casos dudosos para revisar: ${dudosos.length}`);
dudosos.slice(0, 10).forEach(function (d) {
  console.log(`   "${d.nombreRanking}" (${d.categoria}) -> ${d.candidatos.map(function (c) { return c.nombre + ' [' + c.uid + ']'; }).join(' | ')}`);
});
