// Comprueba el hero del inicio: que exista, que el buscador de dentro encuentre
// gente y que al elegir a alguien navegue a su perfil.
const fs = require('fs'), path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const raiz = process.argv[2] || __dirname;
const vc = new VirtualConsole();
const errores = [];
vc.on('jsdomError', e => { if (!/scrollTo/.test(e.message)) errores.push(e.message); });
vc.on('error', (...a) => errores.push('console.error: ' + a.join(' ')));
function servir(u) {
  const rel = String(u).split('?')[0].replace(/^https?:\/\/[^/]+\//, '').replace(/^\.?\//, '');
  const f = path.join(raiz, rel);
  if (!fs.existsSync(f)) return Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error('404')), text: () => Promise.resolve('') });
  const t = fs.readFileSync(f, 'utf8');
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(t)), text: () => Promise.resolve(t) });
}
const dom = new JSDOM(fs.readFileSync(path.join(raiz, 'index.html'), 'utf8'), {
  runScripts: 'dangerously', virtualConsole: vc, url: 'https://x/#/', pretendToBeVisual: true,
  beforeParse(w) { w.fetch = servir; }
});
const w = dom.window, d = w.document;
const espera = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  await espera(1500);
  const hero = d.querySelector('#app .hero');
  console.log('hero:', hero ? 'sí' : 'NO');
  if (hero) console.log(hero.textContent.replace(/\s+/g, ' ').trim());
  console.log('orden en el inicio:', [...d.querySelectorAll('#app > *')].slice(0, 3).map(n => n.className || n.tagName).join(' | '));
  const inp = hero && hero.querySelector('input[type=search]');
  inp.value = 'mansil';
  inp.dispatchEvent(new w.Event('input'));
  await espera(200);
  const sug = [...hero.querySelectorAll('.sug button')].map(b => b.textContent.replace(/\s+/g, ' '));
  console.log('sugerencias para "mansil":', sug.length, '→', sug.slice(0, 3).join(' / '));
  if (sug.length) {
    hero.querySelectorAll('.sug button')[0].click();
    await espera(500);
    console.log('al hacer clic →', w.location.hash, '·', (d.querySelector('#app h1, #app .ph-nom') || d.querySelector('#app')).textContent.replace(/\s+/g, ' ').slice(0, 60));
  }
  // El hero es solo del inicio.
  w.eval("ir({vista:'ranking'})"); await espera(300);
  console.log('hero en Ranking:', d.querySelector('#app .hero') ? 'NO DEBERÍA ESTAR' : 'no (bien)');
  console.log(errores.length ? 'ERRORES:\n' + errores.slice(0, 4).join('\n') : 'sin errores de consola');
  process.exit(0);
})();
