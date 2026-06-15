# Circuito Nacional de Racquetball · Chile

Web pública, mobile-first, para ver **resultados, llaves, horarios, ranking y perfiles**
de las fechas del Circuito Nacional de Racquetball de Chile (Federación Chilena de Racquetball).

Los datos vienen de **r2sports.com** (que no tiene API): se scrapea su HTML y se hornea en
archivos JSON dentro de `data/`. La web es 100% estática y se actualiza sola con GitHub Actions.

## Cómo funciona

```
r2sports.com  ──(scrape latin1)──>  parser.js / bracket.js  ──>  generar-datos.js  ──>  data/*.json
                                                                                          │
GitHub Actions (cron)  ─── corre generar-datos.js y commitea data/ ──────────────────────┘
                                                                                          │
GitHub Pages sirve index.html + data/  ───────────────────────────────────────>  el sitio
```

- **`index.html`** — la app (vanilla JS, sin build). Lee `data/`.
- **`parser.js`** — parsea divisiones, jugadores, categorías (traducidas al español).
- **`bracket.js`** — reconstruye el árbol de cada llave desde `view-bracket.asp`.
- **`ranking.js`** — puntaje oficial FECHIRA (cuadro olímpico) y ranking por categoría.
- **`generar-datos.js`** — orquesta el scrape y escribe `data/<TID>.json`, `index.json`,
  `ranking.json`, `jugadores.json`. Solo re-baja el torneo activo y solo cambia archivos si hay datos nuevos.

## Datos (`data/`)

- `index.json` — catálogo de torneos + cuál es el destacado.
- `<TID>.json` — un torneo (divisiones, jugadores, resultados, llaves, horarios).
- `ranking.json` — ranking por categoría (por año, histórico y oficial = últimas 4 fechas).
- `jugadores.json` — perfil de cada jugador cruzado entre torneos.

## Actualización automática

`.github/workflows/update-data.yml` corre:
- **Fin de semana (vie/sáb/dom): cada 3 h** — para torneos en curso.
- **Miércoles en la noche (Chile)** — por si aparecen inscritos o una fecha nueva.
- **Manual:** pestaña *Actions → Actualizar datos del circuito → Run workflow*.

Solo commitea cuando hay cambios reales.

## Agregar una fecha nueva del circuito

1. Busca el torneo en r2sports y toma su `TID` (número en la URL).
2. Agrégalo al arreglo `CIRCUITO` en [`generar-datos.js`](generar-datos.js).
3. Corre `node generar-datos.js <TID>` (o espera al cron). Listo.

## Correr local

```bash
node generar-datos.js --all     # regenera todo el circuito (Node >= 18)
python3 -m http.server 8099     # y abre http://localhost:8099
```
