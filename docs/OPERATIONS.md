# Operaciones

## Supabase

- Proyecto: `NODO-AGRO`
- Referencia: `kbhvgbczerfgdmfpugxr`
- Región: São Paulo (`sa-east-1`)
- Migraciones remotas: `20260829153000`, `20260829154000`, `20260829170000`, `20260829171000`, `20260829171100`, `20260829171200`, `20260829180000`, `20260829181000`, `20260829181100`
- Edge Functions: `sync-intelligence` (JWT de usuario), `ingest-telemetry` y `device-control` (token de dispositivo)

Comandos reproducibles:

```bash
npx supabase link --project-ref kbhvgbczerfgdmfpugxr
npx supabase migration list --linked
npx supabase db push --linked
npx supabase config push --project-ref kbhvgbczerfgdmfpugxr
```

La contraseña de PostgreSQL, claves secretas, credenciales OAuth y `.env.local` nunca se versionan. La aplicación utiliza exclusivamente la clave pública en el navegador.

## Puertas de producción

- Build sin errores ni advertencias.
- Migraciones locales y remotas alineadas.
- RLS probado para usuario miembro, no miembro y anónimo.
- OAuth Google validado en el dominio definitivo.
- SMTP productivo y entregabilidad validados.
- Monitoreo de errores, uptime e ingestión IoT activo.

## Evidencia verificada

- `supabase db lint --linked --level warning`: sin errores de esquema.
- RLS anónima sobre datos operativos: HTTP 401.
- `sync-intelligence` sin JWT: HTTP 401.
- `ingest-telemetry` sin token y con token inválido: HTTP 401.
- Red de sensores: alta visual verificada con asignación a los tres lotes reales, intervalo esperado e identificador técnico generado; la prueba se canceló antes de crear hardware ficticio.
- `latest_sensor_readings` se consultó desde una sesión real con RLS, sin lecturas simuladas. La migración remota está alineada y `supabase db lint --linked --level warning` no reporta errores.
- Plano de control: gemelos, cola durable, idempotencia, TTL, lease, reintentos, acuse y auditoría aplicados en PostgreSQL. `device-control` está desplegada sin JWT de usuario porque exige la credencial independiente del hardware.
- Open-Meteo y Sentinel-2 STAC: respuestas reales verificadas desde el entorno de operación.
- Esri World Imagery: teselas satelitales y capa de etiquetas verificadas en el establecimiento real, con atribución visible.
- Editor parcelario: carga diferida, trazado de vértices y cálculo de superficie verificados sin guardar datos de prueba.
- CSS de Leaflet se carga desde el componente satelital compartido. Se verificaron visualmente Centro de mando, Mapa vivo y Cultivos para evitar teselas sin recorte o desbordadas.
- Los límites parcelarios GeoJSON se validan antes de renderizar, se ajusta el encuadre a todos los lotes y se muestran desde la misma fuente persistida tanto en Centro de mando como en Mapa vivo.
- El editor admite polígonos de hasta 500 vértices, exige cierre explícito, permite deshacer y rechaza cruces del perímetro. La superficie se calcula de forma geodésica usando todos los vértices.
- Los lotes existentes pueden reabrirse y redibujarse desde el inventario sin crear duplicados; la actualización se acota por lote, organización y establecimiento y exige una fila afectada.
- Onboarding: validado con sesión real; no se creó un establecimiento ficticio.

La organización Supabase comparte cuota con otros proyectos. NODO-AGRO registraba 0 GB de egress y cached egress al momento de la revisión; la advertencia de cuota era organizacional y no originada por NODO.
