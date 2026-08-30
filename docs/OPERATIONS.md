# Operaciones

## Supabase

- Proyecto: `NODO-AGRO`
- Referencia: `kbhvgbczerfgdmfpugxr`
- Región: São Paulo (`sa-east-1`)
- Migraciones remotas: `20260829153000`, `20260829154000`, `20260829170000`, `20260829171000`, `20260829171100`, `20260829171200`, `20260829180000`, `20260829181000`, `20260829181100`, `20260829190000`, `20260829190100`, `20260829190200`, `20260829200000`, `20260829201000`, `20260829202000`, `20260829210000`, `20260829220000`, `20260830090000`, `20260830091000`, `20260830092000`, `20260830100000`, `20260830110000`, `20260830110100`
- Edge Functions con JWT de usuario: `sync-intelligence`, `satellite-analytics`, `agro-intelligence` y `scouting-evidence`. Funciones con token independiente de dispositivo: `ingest-telemetry` y `device-control`.

Comandos reproducibles:

```bash
npx supabase link --project-ref kbhvgbczerfgdmfpugxr
npx supabase migration list --linked
npx supabase db push --linked
npx supabase config push --project-ref kbhvgbczerfgdmfpugxr
npx supabase db lint --linked --level warning
npx supabase test db
```

Activación del proveedor de inteligencia, sin copiar secretos en código ni en el navegador:

```bash
# Crear fuera del repositorio un archivo temporal con permisos restringidos:
# OPENAI_API_KEY=...
# NODO_AI_MODEL=gpt-5.4-mini-2026-03-17
npx supabase secrets set --env-file ./supabase/.env.functions --project-ref kbhvgbczerfgdmfpugxr
npx supabase functions deploy agro-intelligence --project-ref kbhvgbczerfgdmfpugxr
```

`supabase/.env.functions` queda excluido por `.env.*` y debe eliminarse del equipo cuando el secreto haya sido cargado. En la configuración actual la clave se creó como cuenta de servicio dentro del proyecto aislado `NODO Agro` y se transfirió directamente al almacén cifrado de Supabase; no existe una copia en el repositorio. Verificar calidad, latencia y tokens desde un usuario piloto autorizado antes de ampliar cupos.

La contraseña de PostgreSQL, claves secretas, credenciales OAuth y `.env.local` nunca se versionan. La aplicación utiliza exclusivamente la clave pública en el navegador.

## Puertas de producción

- Build sin errores ni advertencias.
- Migraciones locales y remotas alineadas.
- RLS probado para usuario miembro, no miembro y anónimo.
- OAuth Google validado en el dominio definitivo.
- SMTP productivo y entregabilidad validados.
- Monitoreo de errores, uptime e ingestión IoT activo.
- Evaluación de inteligencia con casos reales, tasa de aceptación, groundedness, latencia p95 y costo por establecimiento dentro del presupuesto aprobado.
- Revisión contable/impositiva del modelo económico aprobada por el profesional responsable.

## Evidencia verificada

- `supabase db lint --linked --level warning`: sin errores de esquema.
- RLS anónima sobre datos operativos: HTTP 401.
- `sync-intelligence` sin JWT: HTTP 401.
- `ingest-telemetry` sin token y con token inválido: HTTP 401.
- Red de sensores: alta visual verificada con asignación a los tres lotes reales, intervalo esperado e identificador técnico generado; la prueba se canceló antes de crear hardware ficticio.
- `latest_sensor_readings` se consultó desde una sesión real con RLS, sin lecturas simuladas. La migración remota está alineada y `supabase db lint --linked --level warning` no reporta errores.
- Plano de control: gemelos, cola durable, idempotencia, TTL, lease, reintentos, acuse y auditoría aplicados en PostgreSQL. `device-control` está desplegada sin JWT de usuario porque exige la credencial independiente del hardware.
- Open-Meteo y Sentinel-2 STAC: respuestas reales verificadas desde el entorno de operación.
- NODO Earth: `satellite-analytics` desplegada con autorización por rol, geometrías validadas, expresiones allowlisted, timeout, concurrencia acotada, ejecución auditable y métricas server-owned. La misma escena puede pertenecer a múltiples establecimientos sin romper aislamiento.
- Análisis satelital real: la escena `S2C_MSIL2A_20260827T142711_R053_T19JFJ_20260827T192955`, capturada el 2026-08-27 con 8,7% de nubosidad global, produjo NDVI y NDMI persistidos para los tres polígonos existentes. Los resultados se mostraron con media, rango, dispersión, píxeles, resolución y límites; no se crearon lotes ni señales ficticias.
- Validación visual de NODO Earth: color real, NDVI, NDMI, opacidad, leyendas, límites y etiquetas se verificaron en la sesión `owner`. El motor propuso revisar primero el lote con menor valor relativo sólo después de confirmar dos o más métricas comparables. Consola: cero errores y cero advertencias.
- NODO Scout: tablas de recorridas, bitácora y hallazgos desplegadas con RLS y escrituras sólo por RPC. La máquina de estados, idempotencia, snapshot satelital server-owned, ubicación opcional y precisión están activas. La restricción de auditoría central se corrigió para incluir tanto órdenes de flota como recorridas y hallazgos.
- Validación visual de Scout: una sesión `owner` abrió la vista vacía real, el formulario manual y el flujo Earth → Scout. NDVI `0,100` del lote Bajo precompletó lote, evidencia, objetivo y prioridad sin insertar una recorrida de prueba. La consola permaneció sin errores ni advertencias.
- Scout Field: bucket privado, metadata append-only, hash server-side, enlaces firmados y función `scouting-evidence` desplegados. `OPTIONS` respondió 200 y una carga sin sesión fue rechazada con 401. La sesión owner mostró `0 observaciones · 0 fotos` sin insertar evidencia ficticia.
- Scout Team: directorio tenant-scoped, creación con responsable, reasignación auditable y autorización por responsable desplegados. La sesión `owner` recibió desde la RPC al miembro real `Santy Perez · Propietario`; las agendas `Todas`, `Mías` y `Sin responsable` y el formulario responsive se validaron sin insertar recorridas ficticias. Una recarga posterior no reprodujo avisos ni errores de consola.
- OAuth y PWA: Google usa PKCE y el callback se sanea después de recuperar la sesión. El build genera manifest, registro y service worker con 23 recursos estáticos; no existe runtime cache para Supabase ni imágenes privadas.
- Estabilidad cartográfica: se desactivó la transición de zoom al encuadrar o desmontar mapas. La navegación rápida Centro de mando → Recorridas se reprodujo con cero errores y cero advertencias de consola.
- Esri World Imagery: teselas satelitales y capa de etiquetas verificadas en el establecimiento real, con atribución visible.
- Editor parcelario: carga diferida, trazado de vértices y cálculo de superficie verificados sin guardar datos de prueba.
- CSS de Leaflet se carga desde el componente satelital compartido. Se verificaron visualmente Centro de mando, Mapa vivo y Cultivos para evitar teselas sin recorte o desbordadas.
- Los límites parcelarios GeoJSON se validan antes de renderizar, se ajusta el encuadre a todos los lotes y se muestran desde la misma fuente persistida tanto en Centro de mando como en Mapa vivo.
- El editor admite polígonos de hasta 500 vértices, exige cierre explícito, permite deshacer y rechaza cruces del perímetro. La superficie se calcula de forma geodésica usando todos los vértices.
- Los lotes existentes pueden reabrirse y redibujarse desde el inventario sin crear duplicados; la actualización se acota por lote, organización y establecimiento y exige una fila afectada.
- Onboarding: validado con sesión real; no se creó un establecimiento ficticio.
- Núcleo operativo: rodeo event-sourced, activos/horómetros, mantenimiento y libro económico append-only desplegados. Las seis tablas nuevas tienen RLS y sus escrituras críticas pasan por RPC idempotentes y auditadas.
- NODO Flota: migración `20260829210000_fleet_work_orders.sql` desplegada. Las órdenes y su bitácora tienen RLS; el navegador sólo lee y las RPC controlan creación, transiciones, cierre, costo y evento técnico. El lint remoto no encontró errores de esquema.
- Sesión real: Centro de mando, Rodeo, Maquinaria y Economía consultaron el proyecto remoto sin errores; los formularios mostraron los tres lotes persistidos y se verificaron sin crear stock, activos o movimientos ficticios.
- Validación visual de Flota: una sesión `owner` cargó las tablas remotas, mostró cero órdenes y bloqueó correctamente `Nueva orden` porque no existe maquinaria real. No se insertaron activos ni órdenes ficticias y la consola permaneció sin errores.
- Capa transversal: tablas, RLS, vista segura, integridad multiempresa y función `agro-intelligence` desplegadas. La llamada sin JWT devuelve 401. Una cuenta de servicio exclusiva y los secretos `OPENAI_API_KEY`/`NODO_AI_MODEL` están configurados; una sesión `owner` recorrió autorización, snapshot, proveedor y auditoría. La primera inferencia fue rechazada porque la organización API tiene saldo `USD 0,00`, dependencia que la interfaz muestra sin generar contenido ficticio.
- UI real: el Parte Inteligente detectó 3/7 dominios con información en el establecimiento actual, renderizó correctamente junto al mapa y no produjo errores de consola. La compilación de producción terminó correctamente.

La organización Supabase comparte cuota con otros proyectos. NODO-AGRO registraba 0 GB de egress y cached egress al momento de la revisión; la advertencia de cuota era organizacional y no originada por NODO.

La preparación para vender hardware o SaaS se gestiona en `docs/LAUNCH_READINESS.md`. Ese documento registra gates y evidencias; no reemplaza la evaluación de abogados, ingenieros, certificadores, aseguradoras ni organismos públicos.
