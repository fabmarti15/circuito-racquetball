// Smoke test del gráfico de puesto: monta index.html en jsdom, sirve data/ desde
// disco y abre varios perfiles para ver el eje y la nota.
const fs = require('fs'), path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
// Uso: npm i jsdom && node probar-grafico-puesto.js
const raiz = process.argv[2] || __dirname;
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');
const vc = new VirtualConsole();
const errores = [];
vc.on('jsdomError', e => errores.push('jsdomError: ' + e.message));
vc.on('error', (...a) => errores.push('console.error: ' + a.join(' ')));
function servir(u) {
  const rel = String(u).split('?')[0].replace(/^https?:\/\/[^/]+\//, '').replace(/^\.?\//, '');
  const f = path.join(raiz, rel);
  if (!fs.existsSync(f)) return Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error('404')), text: () => Promise.resolve('') });
  const t = fs.readFileSync(f, 'utf8');
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(t)), text: () => Promise.resolve(t) });
}
const dom = new JSDOM(html, {
  runScripts: 'dangerously', virtualConsole: vc, url: 'https://x/#/', pretendToBeVisual: true,
  beforeParse(w) { w.fetch = servir; }
});
const w = dom.window;
const espera = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  await espera(1500);
  console.log('jugadores cargados:', w.eval('JUG && JUG.jugadores ? JUG.jugadores.length : -1'));
  for (const n of ['Jaime Mansilla', 'Nicolas Ahumada', 'Juan José Martínez Chavarri', 'Paula Mansilla', 'Rodrigo Salgado Jr.', 'Joaquin Catalán']) {
    const uid = w.eval('(function(){var j=(JUG.jugadores||[]).find(function(x){return x.nombre===' + JSON.stringify(n) + '}); return j?(j.uid||j.id):""})()');
    if (!uid) { console.log('NO ENCONTRADO', n); continue; }
    w.eval('ir({vista:"jugador",uid:' + JSON.stringify(String(uid)) + '})');
    await espera(500);
    const ejes = [...w.document.querySelectorAll('.graf text.ejes')].map(t => t.textContent).filter(t => !/^\+/.test(t));
    const nota = (w.document.querySelector('.graf.puesto .nota') || {}).textContent || '';
    const delta = (w.document.querySelector('.graf.puesto .delta') || {}).textContent || '';
    console.log('\n' + n + ' · ' + delta);
    console.log('  eje:', ejes.join(' ') || '(sin gráfico)');
    if (nota) console.log('  nota:', nota.replace(/\s+/g, ' ').slice(0, 220));
    const viejas = ejes.filter(t => /SCL|TEM|VDM|LSE|RAN|NAC/.test(t));
    if (viejas.length) console.log('  ¡SIGLA VIEJA!', viejas);
  }
  console.log('\n' + (errores.length ? 'ERRORES:\n' + errores.slice(0, 5).join('\n') : 'sin errores de consola'));
  process.exit(0);
})();
