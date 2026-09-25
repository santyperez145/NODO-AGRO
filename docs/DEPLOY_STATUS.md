# DEPLOY STATUS — NODO (gate real)

Estado: **No completado por gate P1 (proyecto Vercel)**
Fecha: 2026-09-25

- `npm run build` → OK (2.87s, PWA 1.3.0, 1153 KB precache)
- `git status`: limpio, `main` actualizado
- `vercel --prod` bloqueado: `project name` no configurado, token no provisto, `vercel.json` corregido (`version` `2`)
- No hay proyecto/equipo Vercel asignado; no hay `VERCEL_PROJECT_ID` ni `VERCEL_ORG_ID`

Regla activa (AGENTS.md): sin AWS pago ni retainer Coelsa/sponsor sin autorización expresa. No se inventó tracción ni deploy "exitoso".

Siguientes pasos (humano):
1. Confirmar proyecto Vercel (equipo/organización)
2. Configurar `vercel --prod` con cuenta con permisos
3. Resolver dominio canónico (`VITE_PUBLIC_APP_URL` = URL real)
4. Configurar SMTP/SPF/DKIM/DMARC (`docs/COMMERCIAL_PILOT.md` gate P1)
5. Reintentar `vercel --prod` con build verificado

Build disponible localmente (`dist/`): sí.
