# Ink Charts

Sitio personal de gráficos estilo O'Neil con datos de cierre de Yahoo Finance (yfinance). Incluye:

- **Screener** de tu watchlist con RS Rating propio (1–99), rank del grupo de industria, EPS y ventas del último trimestre, distancia al máximo, volumen, ratio de volumen arriba/abajo y la base detectada con su pivot y estado (Breakout, In buy zone, Near pivot, Extended…).
- **Market pulse** del S&P 500 y el Nasdaq: posición contra las medias de 21, 50 y 200 días y conteo de días de distribución.
- **All stocks**: las ~1.500 acciones del S&P 500, MidCap 400, SmallCap 600 y Nasdaq-100 con las mismas columnas, filtros y gráfico. Se pueden buscar por ticker arriba a la derecha.
- **Gráfico por ticker**: S&P 500 arriba, línea RS con el rating, medias, pivots, base con pivot y zona de compra, marcas "E" de balance, volumen etiquetado, tira trimestral y recuadro de datos. Podés dibujar líneas y notas; quedan guardadas en tu navegador.

Se actualiza solo de lunes a viernes después del cierre de EE.UU. y se publica gratis en GitHub Pages.

## Puesta en marcha (una sola vez, ~10 minutos)

1. **Creá el repositorio.** En GitHub: *New repository* → nombre `fundamental-technical-charts` → *Public* → *Create repository*.
2. **Subí los archivos.** En la página del repo vacío: *uploading an existing file* → arrastrá **todo el contenido** de esta carpeta (incluida `.github`) → *Commit changes*.
   - En Mac, Finder oculta las carpetas que empiezan con punto: apretá `Cmd + Shift + .` para verlas antes de arrastrar.
3. **Activá Pages.** *Settings → Pages → Build and deployment → Source: **GitHub Actions***.
4. **Corré la primera actualización.** *Actions → Update data → Run workflow*. Tarda 15 a 30 minutos (baja ~1.500 acciones).
5. **Abrí el sitio:** https://gslachowicz.github.io/fundamental-technical-charts/.

## Uso diario

- **Agregar o sacar tickers:** editá `watchlist.txt` desde GitHub (ícono del lápiz) y guardá. El sitio se reconstruye solo en unos minutos. Usá los símbolos de Yahoo (`BRK-B`, `GGAL`, `YPF`; para acciones de Buenos Aires: `GGAL.BA`).
- **Actualización forzada:** *Actions → Update data → Run workflow*.
- **Si Yahoo falla un día**, el sitio muestra los últimos datos buenos y un aviso arriba con los tickers afectados.

## Cómo se calcula

- **RS Rating:** rendimiento de 12 meses con el último trimestre ponderado doble (40/20/20/20), rankeado en percentiles contra las acciones del S&P 1500 (500 + MidCap 400 + SmallCap 600) y el Nasdaq-100 (listas tomadas de Wikipedia). Es una aproximación al de IBD, no el mismo número.
- **Grupo:** sub-industria GICS; el rank ordena los grupos por RS promedio de sus miembros. Solo aparece para acciones que están en el universo (por ejemplo, TSM o GGAL no tienen rank de grupo).
- **Base y pivot:** desde el máximo de las últimas ~65 semanas, con mínimo 5 semanas. Flat base hasta 15% de profundidad; cup hasta 50%; con manija si el lado derecho recupera el 85% y hace un retroceso de 2–15% en la mitad superior. Pivot = máximo de la manija (o del lado izquierdo) + 0,10. Es una detección automática: tomala como punto de partida para leer el gráfico.
- **EPS y ventas de "All stocks":** la watchlist se actualiza todos los días; para el resto se actualizan ~150 acciones por día en rotación (cada una se refresca como mucho cada 7 días). La primera vez tardan unas dos semanas en completarse todas. Si querés una acción con datos ya, agregala a `watchlist.txt`.
- **Días de distribución:** índice baja 0,2% o más con más volumen que el día anterior, últimas 25 ruedas.
- **EPS trimestral:** EPS reportado (ajustado) de Yahoo comparado contra el mismo trimestre del año anterior. Yahoo da ventas de ~5 trimestres, así que el % de ventas suele estar solo en el último.

## Probar en tu computadora (opcional)

```bash
pip install -r requirements.txt
python scripts/build_data.py          # datos reales
python scripts/build_data.py --demo   # datos inventados, sin internet
cd site && python -m http.server 8000 # abrir http://localhost:8000
```

## Nota

GitHub pausa las tareas programadas de un repo público si pasan 60 días sin cambios en el repo. Si un día el sitio deja de actualizarse, entrá a *Actions*, habilitá el workflow de nuevo y listo (cualquier edición de `watchlist.txt` también lo reactiva).
