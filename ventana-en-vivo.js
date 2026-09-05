// Salida 0 únicamente dentro de un campeonato y del horario chileno de juego.
const fs = require('node:fs');
function ventana(now, torneos) {
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23'
  }).formatToParts(now).map(p => [p.type, p.value]));
  const hoy = partes.year + partes.month + partes.day;
  const fecha = s => { const m = String(s || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? m[3] + m[1].padStart(2, '0') + m[2].padStart(2, '0') : ''; };
  return +partes.hour >= 8 && +partes.hour < 23 && torneos.some(t => fecha(t.startDate) && fecha(t.startDate) <= hoy && fecha(t.endDate) >= hoy);
}
module.exports = ventana;
if (require.main === module) {
  const cat = JSON.parse(fs.readFileSync(require('node:path').join(__dirname, 'data/index.json'), 'utf8'));
  process.exit(ventana(new Date(), cat.tournaments) ? 0 : 1);
}
