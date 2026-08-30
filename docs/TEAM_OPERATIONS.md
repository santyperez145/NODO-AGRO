# Operación de identidad y acceso

## Estado actual

NODO Teams administra miembros por organización con cinco roles: `owner`, `admin`, `agronomist`, `operator` y `viewer`. La sesión y la cuenta son globales; el acceso a datos depende de una membresía por empresa. Esto permite que una persona trabaje en más de una organización y cambie de contexto sin duplicar identidad.

La implementación es real y server-owned:

- `team-admin` autentica el JWT y usa la API administrativa de Supabase únicamente con `service_role` en Edge Functions.
- Cada invitación conserva correo normalizado, rol, estado de entrega, vencimiento de 3, 7 o 14 días, aceptación y revocación.
- La aceptación exige que el correo de `auth.users` coincida exactamente. El UUID del enlace por sí solo no concede acceso.
- Las cuentas ya existentes reciben un enlace manual; no se intenta reinvitarlas mediante el proveedor.
- El navegador no tiene permisos de escritura directa sobre invitaciones ni auditoría.
- La baja elimina sólo la membresía de la empresa. Todas las consultas RLS dejan de autorizarla de inmediato, aunque el token Auth siga vigente y la cuenta conserve acceso a otra organización.

## Matriz de roles

| Capacidad | Owner | Admin | Agronomist | Operator | Viewer |
|---|---:|---:|---:|---:|---:|
| Ver operación | Sí | Sí | Sí | Sí | Sí |
| Gestionar miembros no administrativos | Sí | Sí | No | No | No |
| Crear o modificar administradores | Sí | No | No | No | No |
| Gestionar propietario | No | No | No | No | No |
| Supervisar recorridas | Sí | Sí | Sí | Sólo asignadas | Consulta |
| Leer auditoría de acceso | Sí | Sí | No | No | No |

El propietario no puede autoexpulsarse, ser degradado ni ser eliminado. Antes de ofrecer transferencia de propiedad se implementará un flujo dedicado con reautenticación MFA, aceptación del nuevo propietario y doble auditoría; no se resolverá con una edición manual desde la interfaz.

## Configuración obligatoria para producción

1. Publicar la aplicación en un dominio HTTPS definitivo.
2. Añadir el callback exacto a Supabase Auth Redirect URLs.
3. Definir el secreto Edge `TEAM_ALLOWED_REDIRECT_ORIGINS=https://app.dominio.tld`. Puede aceptar varios orígenes separados por coma. Sólo `localhost` y `127.0.0.1` se permiten por defecto para desarrollo.
4. Configurar SMTP transaccional propio en Supabase Auth. El servicio SMTP incluido sirve para pruebas limitadas, no para invitar libremente a pilotos externos.
5. Usar un subdominio de autenticación separado y publicar SPF, DKIM y DMARC. Monitorear rebotes, quejas y reputación antes de ampliar volumen.
6. Personalizar las plantillas de invitación y confirmación sin incluir datos agronómicos sensibles.

Supabase documenta que `inviteUserByEmail` es una API administrativa y que el SMTP incluido restringe destinatarios, aplica un límite bajo y no ofrece garantía de entrega. Referencias: [Admin invite](https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail) y [Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

## Playbook de alta

1. El propietario o administrador confirma el correo, rol mínimo y vencimiento.
2. NODO crea primero la invitación auditable y después llama al proveedor; nunca sostiene una transacción SQL durante la operación de red.
3. Si la entrega falla, se conserva `failed` con un código acotado y la UI lo muestra. No se informa “enviado”.
4. Si la cuenta ya existe, el administrador comparte el enlace seguro por un canal acordado. El enlace sigue ligado al correo y vence.
5. El invitado inicia sesión con email/contraseña o Google usando ese mismo correo. NODO acepta la invitación y agrega la membresía atómicamente.
6. El administrador verifica miembro, rol y evento de auditoría antes de asignar recorridas o dispositivos.

Compartir un enlace es una comunicación representacional. Durante soporte o QA se requiere confirmación humana inmediatamente antes de enviarlo; las pruebas automáticas deben limitarse a contratos, errores y destinatarios controlados.

## Playbook de baja

1. Reasignar recorridas `planned` o `in_progress`. La base bloquea la baja si queda trabajo abierto.
2. Revisar dispositivos, órdenes, responsabilidades y exportaciones pendientes.
3. Ejecutar la baja desde Equipo y confirmar la identidad exacta.
4. Verificar que desapareció de la organización, que el evento `member_removed` existe y que no puede leer datos del tenant.
5. No borrar el usuario Auth salvo que exista una solicitud global válida y se haya revisado su pertenencia a todas las empresas, retención legal y obligaciones contractuales.

## Pruebas de liberación

- Cuenta nueva: entrega, definición de contraseña, aceptación y acceso al tenant correcto.
- Cuenta existente: enlace manual, rechazo con correo distinto y aceptación con correo correcto.
- Google: callback conserva la invitación y elimina códigos o tokens sensibles.
- Vencimiento y revocación: ambos impiden aceptar.
- Roles: un admin no gestiona owners/admins; un viewer no accede al directorio.
- Baja: bloqueada con recorridas abiertas y efectiva después de reasignar.
- Multiempresa: el selector cambia contexto y RLS impide mezclar datos.
- Seguridad: anónimo 401, tablas sin escrituras de navegador, secretos ausentes del bundle, eventos inmutables.

El archivo pgTAP contiene 95 aserciones y GitHub Actions debe ejecutarlas en PostgreSQL local antes de integrar. La verificación manual nunca debe crear usuarios ficticios en producción ni enviar correos no solicitados.
