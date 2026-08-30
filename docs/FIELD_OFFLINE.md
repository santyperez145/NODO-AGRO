# NODO Field Offline

Actualizado: 2026-08-30. Esta capacidad permite continuar una recorrida rural sin convertir el navegador en una base de datos insegura. No sustituye la política de dispositivos ni garantiza disponibilidad ante pérdida, daño, falta de espacio o evicción del almacenamiento local.

## Alcance v2

- Guarda borradores de hallazgos estructurados de NODO Scout: recorrida, categoría, severidad, momento, notas, punto y precisión opcionales.
- Guarda JPEG, PNG o WebP cifrados de hasta 8 MB asociados a un hallazgo remoto o a un borrador local. Limita la cola a 12 fotos y 64 MB por usuario y rechaza una captura si llevaría el origen por encima de 90% de la cuota estimada.
- No guarda tokens de sesión, respuestas de Supabase, teselas, partes de inteligencia ni órdenes IoT. Ningún dato privado entra al caché del service worker.
- El usuario decide cuándo sincronizar. No existe ejecución silenciosa en segundo plano.
- Supabase sigue siendo la autoridad final. Un borrador local no es un registro operativo hasta que la RPC lo acepta.

## Modelo criptográfico

1. El usuario crea una frase local independiente de su contraseña de NODO. No se transmite ni se persiste.
2. PBKDF2-SHA-256, 310.000 iteraciones y un salt aleatorio de 24 bytes derivan una clave AES-GCM de 256 bits no extraíble.
3. Cada registro usa un IV aleatorio de 12 bytes. El AAD vincula usuario, organización, establecimiento, tipo, versión y UUID; para una foto separa metadatos y bytes. Mover o intercambiar ciphertext rompe su autenticación.
4. IndexedDB sólo conserva salt, verificador cifrado, IV, ciphertext y metadatos operativos mínimos. Nombre original, descripción, hash y URL de reanudación TUS están dentro del contenido cifrado. La clave vive en memoria y se descarta al bloquear, tras 15 minutos sin actividad, al cerrar sesión o cambiar de identidad.
5. Al activar una bóveda, un self-test ejecuta round-trip y rechazo de manipulación para JSON y bytes aleatorios antes de guardar el perfil.
6. No hay recuperación de frase. Restablecer elimina el perfil, hallazgos y fotografías locales del usuario después de una segunda confirmación.

AES-GCM protege confidencialidad e integridad en reposo. No protege contra XSS activo, extensiones maliciosas, malware, captura de pantalla ni acceso al dispositivo mientras la bóveda está desbloqueada. Los pilotos deben usar cifrado de disco, bloqueo de pantalla, parches, navegador administrado y mínimo privilegio.

## Contrato de sincronización

- El UUID se genera al crear cada borrador o foto y viaja dentro del contenido cifrado. Cada intento reutiliza ese UUID.
- Se sincronizan primero los hallazgos. Al confirmarlos, la bóveda vuelve a cifrar la referencia de sus fotos con el UUID remoto; recién entonces procesa los binarios.
- `record_scouting_finding` revalida la sesión, membresía, rol, asignación y estado `in_progress`; trabajar offline nunca conserva permisos revocados.
- Para una foto, el cliente vuelve a verificar tamaño, firma binaria y SHA‑256 después de descifrarla. `scouting-evidence` prepara una URL TUS firmada y el archivo se transfiere en chunks de 6 MB con reintentos acotados.
- La URL TUS de reanudación se guarda cifrada en IndexedDB. La persistencia automática de fingerprints de la librería está desactivada para no filtrar esa URL a `localStorage`.
- Al finalizar, el servidor descarga el objeto y vuelve a validar ruta determinista, tamaño, firma y SHA‑256. Sólo entonces la RPC `service_role` registra metadatos y auditoría; si falla, elimina el objeto.
- El cliente borra cada pendiente sólo después de una confirmación válida. Un error incrementa el contador, conserva el registro y muestra el motivo. La unicidad server-side evita duplicados ante una respuesta perdida.
- Los pendientes se listan y sincronizan únicamente dentro del usuario, organización y establecimiento activos.

## Procedimiento de campo

Antes de salir:

1. Ingresar con la identidad individual y abrir Recorridas.
2. Activar la bóveda con una frase larga que el usuario pueda recordar; no reutilizar la contraseña de NODO.
3. Verificar que la recorrida esté asignada e iniciada y que el shell PWA abra en el dispositivo.
4. Revisar la cuota visible y solicitar persistencia del origen si la política del dispositivo lo permite; el navegador puede negarla.
5. Confirmar batería, reloj, geolocalización y bloqueo seguro del equipo.

Durante el corte:

1. Registrar el hallazgo y elegir `Guardar cifrado`.
2. Confirmar el aviso de guardado. No cerrar o borrar datos del navegador.
3. Adjuntar la fotografía desde cámara o archivo al hallazgo local. Confirmar que el contador de fotos y MB aumentó; todavía no se presenta como evidencia remota.

Al recuperar red:

1. Desbloquear la bóveda, revisar pendientes y elegir `Sincronizar`.
2. Resolver individualmente los rechazados; no descartarlos para ocultar un error.
3. Si la red cae durante una foto, conservar el pendiente y reintentar: NODO reutiliza la URL cifrada mientras siga vigente o prepara una nueva de forma segura.
4. Confirmar que los contadores volvieron a cero y que hallazgo y fotografía aparecen en la recorrida remota.

## Gate previo a piloto externo

- Ensayo en los modelos reales de teléfono/tablet y navegadores aprobados.
- Corte de red, cierre/reapertura, bloqueo, frase incorrecta, cuota baja, evicción, cambio de organización y cierre de sesión.
- Sincronización de un hallazgo y una foto reales de prueba controlada, corte a mitad de carga, reanudación TUS, reintento con respuesta perdida y verificación de una sola fila/objeto remotos.
- Rechazo seguro cuando la recorrida se cerró o el responsable perdió autorización.
- Rechazo de archivo adulterado, MIME/firma discordantes, hash incorrecto, exceso de 8 MB, cola llena y cuota insuficiente; confirmar limpieza de objetos huérfanos.
- Política firmada de custodia, borrado remoto/MDM cuando aplique y respuesta ante pérdida de dispositivo o frase.
- Definir análisis antimalware antes de aceptar archivos no controlados a escala. Firma y hash detectan corrupción o sustitución, no malware ni autenticidad visual.
- Métricas: borradores y bytes creados, edad hasta sincronización, reanudaciones, fallos, descartes confirmados y pérdida de datos. Nunca capturar frase, URL firmada ni contenido en telemetría.
