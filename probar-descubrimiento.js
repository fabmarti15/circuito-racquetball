const test = require('node:test');
const assert = require('node:assert/strict');
const { parsearBusqueda, incorporar, urlBusqueda } = require('./descubrir-torneos.js');

function pagina(tarjetas = '', country = '114') {
  return `<select name="sportID"><option value="1" selected>Racquetball</option></select>
    <select name="countryID"><option value="${country}" selected>Chile</option></select>
    <select name="eventTypeID"><option value="1" selected>Tournament</option></select>
    <h2>Search Criteria: Racquetball Tournament</h2>${tarjetas}`;
}
function tarjeta(tid, nombre, sede = 'Santiago, Santiago CHI', fecha = '10/2/2026 - 10/4/2026') {
  // Estructura real del listado; el logo y el anuncio también tienen TIDs.
  return `<a href="/tourney/home.asp?TID=99999">anuncio</a>
    <a href="/portfolio/r2-event.asp?TID=${tid}"><img src="logo.jpg"></a>
    <h2><strong><a href="https://www.r2sports.com/portfolio/r2-event.asp?TID=${tid}">${nombre}</a></strong> Racquetball Tournament</h2>
    <table><tr><td><p>${fecha}<br>Parque Deportivo Estadio Nacional<br>${sede}</p></td>
    <td><p>Federación Chilena de Racquetball</p></td></tr></table>`;
}
const codigo = `// conservar cabecera\nconst CIRCUITO = [
  '54387', '54324', '54277', '54093',    // 2026
  '51723', '51161', '49498',              // 2025
  '46544', '46095', '45666', '45351'      // 2024
];\n// conservar código restante\n`;

test('Acepta Open y Junior chilenos; excluye mundial, regionales y anuncios', () => {
  const html = pagina(tarjeta('54436', 'SEGUNDO CIRCUITO NACIONAL JUNIOR 2026') +
    tarjeta('54387', 'TERCERA FECHA 2026 - CIRCUITO NACIONAL OPEN') +
    tarjeta('54434', 'XXIII IRF World Racquetball Championships Temuco 2026') +
    tarjeta('55555', 'Circuito Regional Junior 2026'));
  assert.deepEqual(parsearBusqueda(html).map(t => t.tid), ['54436', '54387']);
});
test('Recupera 54436 omitido e incorpora una sola vez sin perder torneos anteriores', () => {
  const candidatos = parsearBusqueda(pagina(tarjeta('54436', 'SEGUNDO CIRCUITO NACIONAL JUNIOR 2026')));
  const r = incorporar(codigo, candidatos);
  assert.equal(r.nuevos.length, 1);
  assert.match(r.codigo, /'54436', '54387', '54324', '54277', '54093'/);
  for (const id of ['51723', '51161', '49498', '46544', '46095', '45666', '45351']) assert.ok(r.codigo.includes(id));
  assert.ok(r.codigo.endsWith('// conservar código restante\n'));
  assert.ok(r.codigo.startsWith('// conservar cabecera\n'));
  assert.deepEqual(incorporar(r.codigo, candidatos), { codigo: r.codigo, nuevos: [] });
});
test('El cambio de año crea la fila y ordena varios nuevos por fecha', () => {
  const ts = parsearBusqueda(pagina(
    tarjeta('56001', 'PRIMER CIRCUITO NACIONAL JUNIOR 2027', undefined, '1/2/2027 - 1/4/2027') +
    tarjeta('56002', 'CIRCUITO NACIONAL OPEN 2027', undefined, '2/2/2027 - 2/4/2027')));
  const r = incorporar(codigo, ts);
  assert.match(r.codigo, /'56002', '56001',    \/\/ 2027\n  '54387'/);
  assert.equal(incorporar(r.codigo, ts).nuevos.length, 0);
});
test('Una repetición idéntica de la tarjeta no duplica el torneo', () => {
  const c = tarjeta('54436', 'SEGUNDO CIRCUITO NACIONAL JUNIOR 2026');
  assert.equal(parsearBusqueda(pagina(c + c)).length, 1);
});
test('Listado legítimamente vacío conserva exactamente el archivo', () => {
  const ts = parsearBusqueda(pagina('<h2>No Events found</h2>'));
  assert.deepEqual(incorporar(codigo, ts), { codigo, nuevos: [] });
});
test('Filtros incorrectos, bloqueo y cambio de formato detienen la corrida', () => {
  assert.throws(() => parsearBusqueda(pagina('', '1')), /Chile/);
  assert.throws(() => parsearBusqueda('This IP has been blocked'), /bloqueó/);
  assert.throws(() => parsearBusqueda('<html>Access denied</html>'), /bloqueó/);
  assert.throws(() => parsearBusqueda(pagina('<h2>Nueva estructura</h2>')), /Formato/);
  assert.throws(() => parsearBusqueda('<html>Error del servidor</html>'), /buscador/);
});
test('No incorpora otro país, fechas inválidas, enlaces ajenos ni datos contradictorios', () => {
  assert.throws(() => parsearBusqueda(pagina(tarjeta('54436', 'CIRCUITO NACIONAL OPEN', 'Denver, CO USA'))), /chilena/);
  assert.throws(() => parsearBusqueda(pagina(tarjeta('54436', 'CIRCUITO NACIONAL OPEN', undefined, '2/30/2026 - 3/4/2026'))), /inválida/);
  assert.throws(() => parsearBusqueda(pagina(tarjeta('54436', 'CIRCUITO NACIONAL OPEN', undefined, '10/4/2026 - 10/2/2026'))), /invertidas/);
  const c = tarjeta('54436', 'CIRCUITO NACIONAL JUNIOR');
  assert.throws(() => parsearBusqueda(pagina(c.replace('https://www.r2sports.com/portfolio', 'https://otro.cl/portfolio'))), /Enlace/);
  assert.throws(() => parsearBusqueda(pagina(c + tarjeta('54436', 'CIRCUITO NACIONAL OPEN'))), /contradictorios/);
});
test('No reescribe CIRCUITO si su estructura dejó de ser la esperada', () => {
  assert.throws(() => incorporar('const OTRO = [];', []), /arreglo/);
  assert.throws(() => incorporar(codigo.replace("'54387'", 'variable'), []), /Formato/);
  assert.throws(() => incorporar(codigo.replace("'54324'", "'54387'"), []), /repetido/);
});
test('La ventana de búsqueda usa el día de Chile y atraviesa años y cambios de hora', () => {
  const params = iso => new URL(urlBusqueda(new Date(iso))).searchParams;
  assert.equal(params('2027-01-01T01:00:00Z').get('startDate'), '12/24/2026');
  assert.equal(params('2026-10-08T12:00:00Z').get('startDate'), '10/1/2026');
  assert.equal(params('2026-07-09T13:00:00Z').get('startDate'), '7/2/2026');
  assert.equal(params('2026-10-08T12:00:00Z').get('countryID'), '114');
});
