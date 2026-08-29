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
- Open-Meteo: clima real validado con Zod.
- Copernicus Data Space: previsto detrás de un worker seguro.

La configuración necesaria y las dependencias externas están en [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). La aplicación no utiliza credenciales, usuarios ni sesiones simuladas.
