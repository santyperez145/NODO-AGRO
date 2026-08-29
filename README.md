# NODO

**El sistema nervioso del campo.** NODO fusiona satélites, sensores, RFID, cámaras y telemetría para construir un gemelo digital vivo del establecimiento y convertir señales físicas en decisiones productivas y económicas.

## Ejecutar

```bash
npm install
npm run dev
```

La visión y el MVP están documentados en [`docs/NODO_VISION.md`](docs/NODO_VISION.md).

## Integraciones reales

- Supabase Auth: email/contraseña, confirmación y Google OAuth.
- PostgreSQL multiempresa con grants y RLS.
- Open-Meteo: clima actual y pronóstico de siete días, validados y persistidos.
- Sentinel-2 L2A: descubrimiento de escenas mediante Microsoft Planetary Computer STAC.
- Red IoT operativa: alta de dispositivos por lote, credencial de un solo uso, endpoint con token hasheado, lotes idempotentes, calidad y frescura de lectura.
- Motor de decisiones: reglas trazables con fuente, confianza, vigencia y aprobación humana.
- Selección geográfica: búsqueda de localidad con Open-Meteo Geocoding y ajuste visual en mapa Leaflet/OpenStreetMap.
- Cartografía operativa: imagen satelital Esri World Imagery con etiquetas, fallback cartográfico y delimitación de lotes sobre el terreno.

La configuración necesaria y las dependencias externas están en [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). La aplicación no utiliza credenciales, usuarios, establecimientos, métricas ni sesiones simuladas. Una cuenta nueva inicia un onboarding real antes de mostrar el tablero.
