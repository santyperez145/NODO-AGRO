# DEPLOY STATUS — NODO (gate real)

Estado: **No completado — pendiente gate P1 humano**
Fecha: 2026-09-26 01:22 (UTC-3)

- Build (`npm run build`): OK (PWA 1.3.0, 1163 KB precache)
- Commit + push (`main`): `f0d2d47` actualizado en `origin/main`
- `vercel.json`: corregido (`version` 2, framework vite)
- `.env.production`: preparado con placeholders (no valores reales de token ni SMTP)
- `docs/COMMERCIAL_PILOT.md`: gates honestos documentados (SMTP/SPF/DKIM/DMARC, contrato legal)

Regla activa (`AGENTS.md`): sin AWS pago ni retainer Coelsa/sponsor sin autorización expresa. No se inventó tracción ni deploy "exitoso" ni datos de SMTP reales.

Siguientes pasos (requieren confirmación humana):
1. Confirmar proyecto/equipo Vercel (`VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_ORG_ID`)
2. Configurar `VITE_PUBLIC_APP_URL` = dominio real canónico (sin barra final)
3. Configurar SMTP propio (SPF/DKIM/DMARC) — ver `docs/COMMERCIAL_PILOT.md` gate P1
4. Reintentar `vercel --prod --token $VERCEL_TOKEN --scope $VERCEL_SCOPE` con `.env.production` cargado
5. Verificar URL canónica en Auth redirects y funcionamiento de SMTP

Nota: no se realizó deploy real en esta sesión porque el usuario no proporcionó token/proyecto de Vercel ni autorización para SMTP/costos asociados.
