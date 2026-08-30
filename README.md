# NODO

**El sistema nervioso del campo.** NODO fusiona satélites, sensores, RFID, cámaras y telemetría para construir un gemelo digital vivo del establecimiento y convertir señales físicas en decisiones productivas y económicas.

## Ejecutar

```bash
npm install
npm run dev
```

La visión y el MVP están documentados en [`docs/NODO_VISION.md`](docs/NODO_VISION.md).

## Integraciones reales

- Supabase Auth: email/contraseña, confirmación y Google OAuth con PKCE y saneamiento automático del callback.
- NODO Teams: invitaciones ligadas al correo, roles de mínimo privilegio, expiración, revocación, baja segura, auditoría de seguridad y selector multiempresa.
- NODO Pilot Control: línea base automática, capturas operativas inmutables y claims económicos con evidencia y revisión interna de dos personas.
- PostgreSQL multiempresa con grants y RLS.
- Open-Meteo: clima actual y pronóstico de siete días, validados y persistidos.
- NODO Earth: descubrimiento de escenas Sentinel-2 L2A mediante STAC, color real fechado, mapas NDVI/NDMI y estadísticas reales por polígono desde Microsoft Planetary Computer.
- NODO Scout: agenda multiusuario con responsables reales, reasignación auditada, recorridas por lote enlazadas a evidencia satelital o manual, hallazgos georreferenciados, fotografías privadas con hash SHA‑256 y cierre auditable.
- NODO Field Offline v3: PWA con paquete operativo mínimo de Scout, hallazgos y fotografías cifrados en IndexedDB; recupera una recarga sin servidor durante 24 horas, restringe acciones a captura preparada, sincroniza en orden, reanuda binarios por TUS y mantiene APIs, tokens e imágenes privadas fuera del caché del service worker.
- Red IoT operativa: alta de dispositivos por lote, credencial de un solo uso, endpoint con token hasheado, lotes idempotentes, calidad y frescura de lectura.
- Motor de decisiones: reglas trazables con fuente, confianza, vigencia y aprobación humana.
- Inteligencia transversal: un parte operativo server-side cruza clima, satélite, IoT, cultivos, rodeo, maquinaria y economía; conserva el snapshot de evidencia, aplica límites de consumo y exige salida estructurada validada.
- Selección geográfica: búsqueda de localidad con Open-Meteo Geocoding y ajuste visual en mapa Leaflet/OpenStreetMap.
- Cartografía operativa: escena Sentinel-2 fechada sobre una referencia Esri con etiquetas, fallback cartográfico, capas térmicas/espectrales, opacidad y límites persistidos.
- Rodeo: stock por grupos derivado de eventos inmutables de nacimiento, compra, venta, mortandad, traslados, ajustes y pesajes.
- Maquinaria: inventario técnico, horómetros, utilización, reparaciones, inspecciones y vencimiento de service calculado en PostgreSQL.
- NODO Flota: órdenes preventivas, correctivas y de inspección con máquina, prioridad, responsable, vencimiento, costo, máquina de estados y cierre auditable.
- Economía: libro operativo append-only en la moneda base del establecimiento, referencias a lote/maquinaria y correcciones mediante contrapartidas trazables.
- Gobierno de datos: mutaciones críticas encapsuladas en RPC transaccionales, RLS multiempresa, idempotencia y auditoría server-owned.

La configuración necesaria y las dependencias externas están en [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). La aplicación no utiliza credenciales, usuarios, establecimientos, métricas ni sesiones simuladas. Una cuenta nueva inicia un onboarding real antes de mostrar el tablero.

El contrato para integrar hardware está en [`docs/IOT_GATEWAY.md`](docs/IOT_GATEWAY.md), el trabajo cifrado sin señal en [`docs/FIELD_OFFLINE.md`](docs/FIELD_OFFLINE.md), el uso de recorridas en [`docs/SCOUTING_PROTOCOL.md`](docs/SCOUTING_PROTOCOL.md), la administración de acceso en [`docs/TEAM_OPERATIONS.md`](docs/TEAM_OPERATIONS.md), la medición comercial en [`docs/PILOT_CONTROL.md`](docs/PILOT_CONTROL.md), el plan de compañía en [`docs/PRODUCT_ROADMAP.md`](docs/PRODUCT_ROADMAP.md), la diferenciación en [`docs/COMPETITIVE_STRATEGY.md`](docs/COMPETITIVE_STRATEGY.md) y los gates regulatorios y de protección en [`docs/LAUNCH_READINESS.md`](docs/LAUNCH_READINESS.md).
