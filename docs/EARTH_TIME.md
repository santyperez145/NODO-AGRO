# NODO Earth Time

Actualizado: 2026-09-03. Esta capacidad construye una serie Sentinel‑2 por lote con calidad SCL y una mediana empírica del mismo polígono. No certifica fenología, rendimiento ni un diagnóstico agronómico.

## Decisión de producto

Auravant y SIMA venden monitoreo, no una foto. El Crop Status de Auravant muestra la curva de índices, oculta fechas nubladas cuando al menos 5% de los píxeles del lote están clasificados como nube, y permite contrastar con lluvia. NODO replica ese contrato verificable y lo ata al resto del gemelo: Scout, Pilot Control y el Parte Inteligente.

No se copian pantallas ni se afirman resultados comerciales ajenos. Se implementa el mismo circuito: escena fechada → calidad por polígono → observación aceptada o rechazada → mediana del lote → recorrida.

## Alcance (90 y 180 días)

- Descubre hasta **12** escenas Sentinel‑2 L2A en **90** días, o hasta **24** escenas en **180** días, con nubosidad de escena menor a 80% mediante el STAC público de Microsoft Planetary Computer.
- La UI elige la ventana; el default de construcción es **180** días.
- Para cada lote y fecha pide al Data API el índice y el histograma SCL en una sola consulta.
- SCL 3, 8, 9 y 10 cuentan como nube, sombra o cirros. SCL 4 a 7 cuentan como claros.
- Una observación es `usable` sólo si el polígono tiene menos de 5% de píxeles nublados, al menos 50% de píxeles claros y 4 o más píxeles interiores.
- La media del índice se persiste siempre para auditoría, pero la serie, la mediana y el Parte Inteligente usan únicamente observaciones `usable`.
- Open‑Meteo Archive aporta lluvia diaria de la misma ventana. No sustituye una estación calibrada.
- La línea base es la mediana, p25 y p75 del mismo lote. El delta exige tres fechas despejadas. No es un calendario fenológico.
- **Comparación de campañas:** media de observaciones `usable` agrupadas por campaña julio–junio (hemisferio sur). No afirma rendimiento ni causa.

## Qué no hace

- No reescribe cada píxel nublado del índice. Si el lote no está despejado, la fecha se marca `cloud_limited` y no entra a la mediana.
- No detecta enfermedades, estrés hídrico, dosis de riego ni rendimiento.
- No procesa más de 48 (90d) o 96 (180d) observaciones nuevas por invocación; el resto se retoma en la siguiente ejecución.
- No usa GNDVI, MSAVI2 ni NDRE hasta evaluar utilidad sobre NDVI/NDMI ya operativos.

## Operación

1. Sincronizar fuentes o abrir Mapa vivo.
2. Elegir NDVI o NDMI y la ventana 90/180.
3. Ejecutar `Construir serie SCL`.
4. Revisar el mapa en una fecha, el filtro “Ocultar nubladas”, la curva y las campañas.
5. Si un lote queda por debajo de su mediana o es el menor relativo de una escena usable, planificar Scout.

El microservicio `satellite-timeseries` autentica JWT, deriva el rol en servidor, escribe sólo con `service_role` y deja el catálogo, las métricas, la lluvia y las líneas base listos para lectura RLS.
