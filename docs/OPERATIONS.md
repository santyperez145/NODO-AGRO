# Operaciones

## Supabase

- Proyecto: `NODO-AGRO`
- Referencia: `kbhvgbczerfgdmfpugxr`
- Región: São Paulo (`sa-east-1`)
- Migraciones remotas: `20260829153000`, `20260829154000`

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
