# NODO Field Offline

Actualizado: 2026-08-30. Esta capacidad permite continuar una recorrida rural sin convertir el navegador en una base de datos insegura. No sustituye la política de dispositivos ni garantiza disponibilidad ante pérdida, daño, falta de espacio o evicción del almacenamiento local.

## Alcance v1

- Guarda borradores de hallazgos estructurados de NODO Scout: recorrida, categoría, severidad, momento, notas, punto y precisión opcionales.
- No guarda fotos, tokens de sesión, respuestas de Supabase, teselas, partes de inteligencia ni órdenes IoT.
- El usuario decide cuándo sincronizar. No existe ejecución silenciosa en segundo plano.
- Supabase sigue siendo la autoridad final. Un borrador local no es un registro operativo hasta que la RPC lo acepta.

## Modelo criptográfico

1. El usuario crea una frase local independiente de su contraseña de NODO. No se transmite ni se persiste.
2. PBKDF2-SHA-256, 310.000 iteraciones y un salt aleatorio de 24 bytes derivan una clave AES-GCM de 256 bits no extraíble.
3. Cada registro usa un IV aleatorio de 12 bytes. El AAD vincula usuario, organización, establecimiento, tipo, versión y UUID; mover el ciphertext rompe su autenticación.
4. IndexedDB sólo conserva salt, verificador cifrado, IV, ciphertext y metadatos operativos mínimos. La clave vive en memoria y se descarta al bloquear, tras 15 minutos sin actividad, al cerrar sesión o cambiar de identidad.
5. No hay recuperación de frase. Restablecer elimina el perfil y todos los borradores locales del usuario después de una segunda confirmación.

AES-GCM protege confidencialidad e integridad en reposo. No protege contra XSS activo, extensiones maliciosas, malware, captura de pantalla ni acceso al dispositivo mientras la bóveda está desbloqueada. Los pilotos deben usar cifrado de disco, bloqueo de pantalla, parches, navegador administrado y mínimo privilegio.

## Contrato de sincronización

- El UUID se genera al crear el borrador y viaja dentro del contenido cifrado.
- Cada intento usa el mismo UUID. La unicidad server-side evita crear dos hallazgos si se perdió una respuesta.
- `record_scouting_finding` revalida la sesión, membresía, rol, asignación y estado `in_progress`; trabajar offline nunca conserva permisos revocados.
- El cliente borra el borrador sólo después de una confirmación válida. Un error incrementa el contador, conserva el registro y muestra el motivo.
- Los borradores se listan y sincronizan únicamente dentro del usuario, organización y establecimiento activos.

## Procedimiento de campo

Antes de salir:

1. Ingresar con la identidad individual y abrir Recorridas.
2. Activar la bóveda con una frase larga que el usuario pueda recordar; no reutilizar la contraseña de NODO.
3. Verificar que la recorrida esté asignada e iniciada y que el shell PWA abra en el dispositivo.
4. Confirmar batería, reloj, geolocalización y bloqueo seguro del equipo.

Durante el corte:

1. Registrar el hallazgo y elegir `Guardar cifrado`.
2. Confirmar el aviso de guardado. No cerrar o borrar datos del navegador.
3. Las fotos esperan conexión; no se presentan como cargadas.

Al recuperar red:

1. Desbloquear la bóveda, revisar pendientes y elegir `Sincronizar`.
2. Resolver individualmente los rechazados; no descartarlos para ocultar un error.
3. Confirmar que el contador volvió a cero y que el hallazgo aparece en la recorrida remota.

## Gate previo a piloto externo

- Ensayo en los modelos reales de teléfono/tablet y navegadores aprobados.
- Corte de red, cierre/reapertura, bloqueo, frase incorrecta, cuota baja, evicción, cambio de organización y cierre de sesión.
- Sincronización de un hallazgo real de prueba controlada, reintento con respuesta perdida y verificación de una sola fila remota.
- Rechazo seguro cuando la recorrida se cerró o el responsable perdió autorización.
- Política firmada de custodia, borrado remoto/MDM cuando aplique y respuesta ante pérdida de dispositivo o frase.
- Métricas: borradores creados, edad hasta sincronización, fallos, descartes confirmados y pérdida de datos. Nunca capturar la frase ni el contenido en telemetría.
