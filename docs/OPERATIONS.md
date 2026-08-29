# Operaciones

## Supabase

- Proyecto: `NODO-AGRO`
- Referencia: `kbhvgbczerfgdmfpugxr`
- Región: São Paulo (`sa-east-1`)
- Migraciones remotas: `20260829153000`, `20260829154000`, `20260829170000`, `20260829171000`, `20260829171100`, `20260829171200`
- Edge Functions: `sync-intelligence` (JWT de usuario) e `ingest-telemetry` (token de dispositivo)

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
- Open-Meteo y Sentinel-2 STAC: respuestas reales verificadas desde el entorno de operación.
- Esri World Imagery: teselas satelitales y capa de etiquetas verificadas en el establecimiento real, con atribución visible.
- Editor parcelario: carga diferida, trazado de vértices y cálculo de superficie verificados sin guardar datos de prueba.
- CSS de Leaflet se carga desde el componente satelital compartido. Se verificaron visualmente Centro de mando, Mapa vivo y Cultivos para evitar teselas sin recorte o desbordadas.
- Onboarding: validado con sesión real; no se creó un establecimiento ficticio.

La organización Supabase comparte cuota con otros proyectos. NODO-AGRO registraba 0 GB de egress y cached egress al momento de la revisión; la advertencia de cuota era organizacional y no originada por NODO.
