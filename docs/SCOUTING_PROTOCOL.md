# Protocolo operativo NODO Scout

Actualizado: 2026-08-30. NODO Scout organiza verificación en campo; no reemplaza diagnóstico agronómico, receta profesional, mensura ni procedimiento de seguridad.

## Flujo verificable

1. **Planificar y asignar:** seleccionar lote, responsable, objetivo, prioridad y horario. Si nace desde NODO Earth, la recorrida conserva un snapshot de índice, valor, calidad, escena y algoritmo.
2. **Iniciar:** una recorrida debe quedar `in_progress` antes de aceptar observaciones.
3. **Observar:** registrar categoría, severidad, momento, descripción y ubicación opcional con precisión declarada por el dispositivo. Una visita en curso también puede adjuntar fotografías al hallazgo.
   - Con conexión, se persiste inmediatamente mediante una RPC autorizada.
   - Sin conexión, el hallazgo estructurado y sus fotografías pueden guardarse únicamente si la bóveda local fue activada y está desbloqueada. Se sincronizan de forma explícita al recuperar red.
4. **Contrastar:** revisar cultivo, fenología, manejo, clima, sensor y antecedentes. Un color o hallazgo aislado no demuestra causalidad.
5. **Cerrar:** documentar resultado, decisión o motivo de cancelación. La bitácora y los hallazgos permanecen inmutables.

## Estados y responsabilidades

- `planned → in_progress → completed`
- `planned → cancelled`
- `in_progress → cancelled`

Propietario, administrador y agrónomo pueden supervisar cualquier recorrida y reasignar las que estén abiertas. Un operador puede crear una recorrida para sí mismo y sólo iniciar, observar, fotografiar o cerrar aquellas asignadas a su usuario. El rol viewer sólo consulta. Estas reglas se aplican en PostgreSQL y al cargar evidencia, no sólo en la interfaz.

El directorio Scout contiene únicamente integrantes operativos del mismo tenant y no expone correos. Cada reasignación conserva responsable anterior, nuevo responsable, actor y momento. Las vistas `Todas`, `Mías` y `Sin responsable` distinguen carga personal, carga del equipo y registros históricos incompletos.

## Severidad

- **Informativa:** contexto sin riesgo observado.
- **Baja:** diferencia menor para seguimiento.
- **Media:** requiere revisión dentro de la ventana planificada.
- **Alta:** puede afectar operación o producción; escalar a responsable.
- **Crítica:** riesgo inmediato potencial; aplicar el protocolo humano de seguridad correspondiente. NODO no prescribe una maniobra.

La severidad expresa prioridad operativa declarada por el usuario, no probabilidad ni diagnóstico automático.

## Geolocalización y privacidad

La ubicación es opcional. Cuando se captura, NODO almacena latitud, longitud y precisión reportada; nunca presenta la coordenada del establecimiento como si fuera el punto observado. La autorización del navegador no prueba identidad, presencia o exactitud. Antes de pilotos con personal se deben definir finalidad, acceso, retención y transparencia para datos de ubicación.

## Evidencia fotográfica privada

- La carga acepta JPEG, PNG o WebP de hasta 8 MB y verifica tanto MIME como firma binaria.
- El navegador no registra metadatos directamente en Storage. `scouting-evidence` autentica sesión, rol y visita, prepara una carga TUS firmada y al finalizar vuelve a descargar el objeto para verificar tamaño, firma binaria y SHA‑256 antes de registrar metadatos y auditoría.
- El bucket `scouting-evidence` es privado. La interfaz emite enlaces firmados por cinco minutos solamente para integrantes de la organización.
- Los metadatos son append-only: archivo original, tamaño, tipo, fuente cámara/archivo, captura, descripción, hash, autor y momento.
- Firma y hash permiten detectar sustitución o corrupción; no equivalen a análisis antivirus, autenticidad visual, cadena de custodia pericial ni prueba de presencia física.

## Limitaciones de esta versión

- NODO Field Offline v3 prepara por 24 horas un paquete cifrado mínimo con recorridas abiertas y su evidencia relacionada. Tras una recarga sin servidor sólo habilita Scout, y únicamente captura sobre visitas que ya estaban en curso. Hallazgos, fotografías, notas, coordenadas, visita, metadatos y bytes quedan autenticados y cifrados; la clave derivada permanece sólo en memoria y se bloquea tras 15 minutos de inactividad o al cerrar sesión.
- La sincronización es manual y ordenada: primero hallazgos, luego fotos. El servidor vuelve a comprobar organización, rol, asignación y que la visita continúe en curso. Un rechazo queda visible y el pendiente no se elimina. El mismo UUID evita duplicados ante respuestas perdidas.
- Las fotografías cifradas se reanudan por TUS en chunks de 6 MB. La URL de reanudación se conserva cifrada, nunca en `localStorage`; antes de transferir y al finalizar se vuelve a comprobar SHA‑256, firma y tamaño. Ningún binario privado entra al caché del service worker.
- Perder la frase de protección hace irrecuperables los borradores locales. Restablecer la bóveda los elimina sólo después de confirmación explícita. El cifrado no compensa un dispositivo comprometido mientras está desbloqueado.
- La versión actual valida firma binaria y tamaño, pero todavía no ejecuta análisis antimalware ni moderación visual.
- No verifica que el punto esté dentro del polígono ni sustituye instrumentos calibrados.
- Una recorrida satelital usa el snapshot histórico aunque el índice se recalcule después, preservando reproducibilidad.

## Métricas de producto

- Tiempo señal → recorrida planificada.
- Porcentaje de recorridas iniciadas y cerradas dentro de la ventana.
- Hallazgos útiles por recorrida y porcentaje georreferenciado.
- Evidencias fotográficas válidas, fallos de carga, peso transferido y tiempo de señal a confirmación en campo.
- Señales satelitales confirmadas, descartadas o inconclusas en campo.
- Decisiones cerradas con costo y resultado posterior; sin afirmar ROI hasta medirlo.
