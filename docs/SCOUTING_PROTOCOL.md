# Protocolo operativo NODO Scout

Actualizado: 2026-08-30. NODO Scout organiza verificación en campo; no reemplaza diagnóstico agronómico, receta profesional, mensura ni procedimiento de seguridad.

## Flujo verificable

1. **Planificar:** seleccionar lote, objetivo, prioridad y horario. Si nace desde NODO Earth, la recorrida conserva un snapshot de índice, valor, calidad, escena y algoritmo.
2. **Iniciar:** una recorrida debe quedar `in_progress` antes de aceptar observaciones.
3. **Observar:** registrar categoría, severidad, momento, descripción y ubicación opcional con precisión declarada por el dispositivo.
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

## Limitaciones de esta versión

- Requiere conectividad al guardar; la cola offline cifrada es el siguiente gate de campo.
- No adjunta fotografías todavía. La evidencia multimedia se habilitará mediante almacenamiento privado, carga reanudable, metadatos mínimos, antivirus y URL firmada de corta duración.
- No verifica que el punto esté dentro del polígono ni sustituye instrumentos calibrados.
- Una recorrida satelital usa el snapshot histórico aunque el índice se recalcule después, preservando reproducibilidad.

## Métricas de producto

- Tiempo señal → recorrida planificada.
- Porcentaje de recorridas iniciadas y cerradas dentro de la ventana.
- Hallazgos útiles por recorrida y porcentaje georreferenciado.
- Señales satelitales confirmadas, descartadas o inconclusas en campo.
- Decisiones cerradas con costo y resultado posterior; sin afirmar ROI hasta medirlo.
