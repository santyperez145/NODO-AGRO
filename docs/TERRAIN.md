# NODO Terrain

Actualizado: 2026-09-02. Esta capacidad construye un relieve verificable con Copernicus DEM GLO-30. No es un modelo 3D interactivo, no certifica cotas de obra y no simula escurrimiento ni inundación.

## Decisión de producto

Auravant y otras plataformas muestran relieve para orientar el campo. NODO sólo lo hace con un DEM licenciado, resolución y precisión vertical visibles en la misma pantalla, y estadísticas por polígono persistidas.

## Alcance v1

- Fuente: colección pública `cop-dem-glo-30` en Microsoft Planetary Computer (Copernicus DEM GLO-30).
- Producto: DSM radar TanDEM-X. Incluye vegetación y construcciones; no es un DTM de suelo desnudo.
- Resolución horizontal nominal: 30 m (`gsd` de la colección).
- Datum horizontal WGS84; datum vertical EGM2008.
- Precisión vertical publicada: LE90ABS media ≈ 1,92 m excluyendo Antártida y Groenlandia según el [Product Handbook v2.1](https://object.cloud.sdsc.edu/v1/AUTH_opentopography/www/metadata/Copernicus_metadata.pdf). Hay desviaciones locales.
- Licencia: [CSCDA ESA Mission-specific Annex](https://spacedata.copernicus.eu/documents/20126/0/CSCDA_ESA_Mission-specific+Annex.pdf).
- Por lote: min / media / mediana / máx / σ / relieve (máx−min) vía Data API `item/statistics`.
- Mapa: sombreado hillshade del mosaico registrado (`azimuth` 315°, `angle_altitude` 45°).
- Algoritmo: `cop-dem-glo-30-relief-v1`.

## Qué no hace

- No renderiza una malla 3D navegable.
- No calcula cuencas, flujo de escorrentía, lámina ni tránsito de maquinaria.
- No afirma precisión centimétrica ni homologación topográfica.
- No sustituye un relevamiento de campo calibrado.
- No entra a la bóveda offline: requiere catálogo y tiler remotos.

## Operación

1. Abrir Mapa vivo con lotes polígono válidos.
2. Ejecutar **Construir relieve DEM**.
3. Activar la capa **Relieve**.
4. Revisar metadatos (producto, 30 m, LE90ABS, licencia) y la tabla de elevación por lote.
5. Usar el sombreado sólo para orientar dónde cae el terreno relativo antes de una recorrida.

El microservicio `terrain-relief` autentica JWT, deriva el rol en servidor, escribe sólo con `service_role` y deja el mosaico y las métricas listos para lectura RLS.
