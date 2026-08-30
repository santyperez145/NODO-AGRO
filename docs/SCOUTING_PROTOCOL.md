# Protocolo operativo NODO Scout

Actualizado: 2026-08-30. NODO Scout organiza verificación en campo; no reemplaza diagnóstico agronómico, receta profesional, mensura ni procedimiento de seguridad.

## Flujo verificable

1. **Planificar:** seleccionar lote, objetivo, prioridad y horario. Si nace desde NODO Earth, la recorrida conserva un snapshot de índice, valor, calidad, escena y algoritmo.
2. **Iniciar:** una recorrida debe quedar `in_progress` antes de aceptar observaciones.
3. **Observar:** registrar categoría, severidad, momento, descripción y ubicación opcional con precisión declarada por el dispositivo. Una visita en curso también puede adjuntar fotografías al hallazgo.
4. **Contrastar:** revisar cultivo, fenología, manejo, clima, sensor y antecedentes. Un color o hallazgo aislado no demuestra causalidad.
5. **Cerrar:** documentar resultado, decisión o motivo de cancelación. La bitácora y los hallazgos permanecen inmutables.

## Estados y responsabilidades

- `planned → in_progress → completed`
- `planned → cancelled`
- `in_progress → cancelled`

Propietario, administrador, agrónomo y operador pueden ejecutar el flujo. El rol viewer sólo consulta. Las escrituras directas están revocadas; las RPC derivan organización y rol desde la sesión, validan lote/fuente y usan UUID de idempotencia.

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
- El navegador no escribe directamente en Storage. `scouting-evidence` autentica la sesión y el rol, exige una visita en curso, calcula SHA‑256 en servidor y registra metadatos y auditoría.
- El bucket `scouting-evidence` es privado. La interfaz emite enlaces firmados por cinco minutos solamente para integrantes de la organización.
- Los metadatos son append-only: archivo original, tamaño, tipo, fuente cámara/archivo, captura, descripción, hash, autor y momento.
- Firma y hash permiten detectar sustitución o corrupción; no equivalen a análisis antivirus, autenticidad visual, cadena de custodia pericial ni prueba de presencia física.

## Limitaciones de esta versión

- Requiere conectividad al guardar. La PWA mantiene el shell disponible, pero no persiste fotos, tokens, coordenadas u operaciones en una cola local insegura; el vault offline cifrado y la carga reanudable siguen como gate de campo.
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
