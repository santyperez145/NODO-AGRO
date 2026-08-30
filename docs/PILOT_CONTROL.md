# NODO Pilot Control

## Propósito

Pilot Control convierte un piloto comercial en un experimento operativo auditable. Su objetivo es responder con evidencia: qué problema se intentó resolver, cuál era la línea base, qué cambió, qué datos faltaron y qué valor fue declarado o revisado.

No demuestra causalidad por sí solo. Tampoco convierte una estimación, ahorro evitado o revisión interna en ROI auditado, validación agronómica o prueba contable externa.

## Ciclo del piloto

1. `owner` o `admin` define nombre, hipótesis, criterio observable, final objetivo y ventana base de 7 a 90 días.
2. PostgreSQL crea un único piloto activo por establecimiento y congela la línea base en la misma transacción.
3. `owner`, `admin` o `agronomist` captura evidencia actual. Sólo existe una captura `current` por programa y día, evitando duplicados por reintentos.
4. Los acumulados de ventanas distintas se visualizan como tasa diaria. Cobertura, inventario y promedios conservan su unidad original.
5. El cierre `completed` crea una captura `final` inmutable. `cancelled` exige motivo y bloquea nuevos claims.
6. Todo cambio queda en `pilot_audit_events`.

## Fuentes automáticas v1

| Métrica | Fuente persistida | Interpretación |
|---|---|---|
| Hectáreas y lotes | `land_parcels` | Cobertura actual; no reconstrucción histórica |
| Dispositivos y lecturas | `sensor_readings` + `devices` | Actividad observada dentro de la ventana |
| Recorridas y ciclo | `scouting_visits` | Creaciones, cierres y promedio entre creación/cierre |
| Hallazgos y fotos | `scouting_findings` + `scouting_finding_media` | Evidencia de campo registrada |
| Órdenes y preventivos | `maintenance_work_orders` | Aperturas/cierres dentro de la ventana |
| Costo de mantenimiento | `maintenance_work_orders.actual_cost` | Sólo cierres en moneda base |
| Ingresos y egresos | `financial_entries` | Sólo libro operativo y moneda base |

Cada snapshot conserva ventana, timestamp, `pilot-metrics-v1`, fuentes por métrica y limitaciones. Un cero puede ser correcto o indicar que la fuente todavía no está instrumentada.

## Claims de valor

Un claim exige categoría, monto positivo en moneda base, método de cálculo de al menos 20 caracteres y referencia de evidencia. Estados:

- `declared`: afirmación del responsable, aún no revisada.
- `internally_verified`: otra identidad `owner/admin` revisó método y evidencia.
- `rejected`: revisión negativa conservada en auditoría.

La misma persona no puede declarar y validar internamente. La verificación interna habilita discusión de gestión, no comunicación pública como ROI validado. Para un caso comercial se necesita revisión del productor y del profesional contable/operativo apropiado, acceso al documento original y aprobación expresa del texto publicable.

## Protocolo semanal

- Revisar cobertura/frescura antes de interpretar cambios.
- Capturar el snapshot el mismo día y horario operativo cuando sea posible.
- Registrar incidentes, cambios de proceso y factores externos que afecten comparabilidad.
- No cambiar hipótesis o éxito en mitad del piloto; cerrar/cancelar y crear uno nuevo si cambia el experimento.
- No sumar monedas, ventanas o establecimientos incompatibles.
- Vincular facturas, órdenes, partes o informes mediante una referencia estable; no copiar secretos ni datos personales innecesarios.

## Criterio para publicar un caso

- Línea base anterior a la intervención.
- Captura final y limitaciones visibles.
- Calidad suficiente en las fuentes relevantes.
- Claim revisado por una segunda identidad interna.
- Evidencia primaria accesible y conciliada.
- Revisión externa pertinente y autorización contractual del cliente.
- Texto acotado al establecimiento, período y versión exactos; sin extrapolar ahorro o precisión.

Hasta cumplir todos los puntos, el resultado permanece como evidencia interna del piloto.
