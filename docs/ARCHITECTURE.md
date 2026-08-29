# Arquitectura de NODO

## Decisiones

- **Cliente:** React, TypeScript y Vite. TanStack Query controla caché, reintentos y estados de red; Zod valida contratos externos.
- **Identidad y datos:** Supabase Auth y PostgreSQL. El navegador solo recibe la clave publicable. Los datos se aíslan por organización con grants y Row Level Security.
- **Ingesta IoT:** servicio backend con credenciales por dispositivo, idempotencia y cola. Los sensores nunca insertarán usando credenciales del navegador.
- **Clima:** Open-Meteo desde el cliente durante el piloto. La respuesta se valida y los fallos permanecen visibles.
- **Satélite:** Copernicus Data Space desde un worker backend. Los tokens, procesamiento y caché no pertenecen al navegador.
- **Observabilidad:** errores estructurados y trazabilidad desde señal hasta recomendación.

## Autenticación

El cliente implementa sesiones reales con Supabase: email/contraseña, alta con confirmación, Google OAuth, persistencia, renovación y cierre de sesión. No existen usuarios demo ni bypass. Sin configuración válida se bloquea el envío y se explica la dependencia pendiente.

## Configuración externa pendiente

El proyecto remoto `NODO-AGRO` (`kbhvgbczerfgdmfpugxr`, São Paulo) está vinculado y sus migraciones están aplicadas. Email/contraseña, confirmación de correo, política fuerte de contraseña, cambio seguro y TOTP están activos.

Antes de declarar producción completa todavía se requiere:

1. Crear el cliente OAuth Web en Google, registrar `https://kbhvgbczerfgdmfpugxr.supabase.co/auth/v1/callback` y cargar Client ID/Secret en Supabase.
2. Sustituir las URLs locales de Auth por el dominio definitivo cuando exista hosting.
3. Configurar SMTP transaccional propio; el correo incluido por Supabase es únicamente de prueba y tiene límites estrictos.
