# Roadmap de compañía y producto

## Decisión de CEO/PM

NODO será el sistema operativo inteligente del establecimiento, pero no intentará vender toda la visión al mismo tiempo. La entrada comercial será **NODO Flota**, porque una parada de maquinaria tiene urgencia, comprador identificable y retorno medible. La misma cuenta se expande después a cultivos, IoT, rodeo y economía sin migrar datos ni cambiar de plataforma.

La ventaja no será “usar IA”. Será el grafo operativo longitudinal del establecimiento, la integración multimarca, la evidencia física y económica y la capacidad de comprobar qué decisión produjo valor.

## Estado actual verificable

- Identidad real email/contraseña y Google, multiempresa y RLS.
- NODO Earth con color real Sentinel-2, NDVI/NDMI por píxel, estadísticas auditables por lote y recorrido sugerido conservador.
- NODO Earth Time con catálogo de 90 días, calidad SCL por polígono, curva por lote, lluvia diaria persistida y mediana empírica del mismo lote.
- NODO Water con ET0 FAO‑56, lluvia persistida, riego declarado append-only, NDMI/suelo como evidencia y saldo de referencia por lote.
- NODO Scout con planificación desde Earth o manual, responsables configurables, reasignación y estados auditables, autorización por responsable, hallazgos georreferenciados y fotografía privada con hash server-side.
- NODO Scout Field con rechazo de políglotas y hashes conocidos antes de adjuntar; JPEG/PNG/WebP siguen siendo los únicos tipos permitidos.
- NODO Field Offline v3 con shell instalable, paquete Scout mínimo de 24 horas, recuperación tras recarga sin servidor, bóveda AES-GCM por usuario, bloqueo automático, hallazgos y fotografías cifrados, límites de cuota, sincronización idempotente y carga TUS reanudable; APIs, tokens y multimedia privada quedan fuera del caché.
- Clima persistido y reglas agronómicas explicables.
- Red IoT con provisión segura, telemetría idempotente, gemelos, órdenes y acuse.
- Rodeo event-sourced, maquinaria por horómetro y libro económico append-only.
- Órdenes de trabajo NODO Flota con estado, prioridad, vencimiento, responsable, costo y cierre auditable.
- Parte Inteligente transversal con contexto server-side, auditoría, calidad de datos, límites de consumo y aprobación humana.
- NODO Teams con directorio administrativo, invitaciones email-bound, roles, expiración, revocación, baja protegida, auditoría y navegación multiempresa.
- NODO Pilot Control con hipótesis, línea base server-owned, capturas comparables, claims económicos documentados y revisión interna de dos identidades.

Esto es un núcleo técnico de piloto, no product-market fit, validación agronómica, seguridad certificada ni operación comercial escalable.

## Roadmap 0–12 meses

### Fase 1 — Piloto instrumentado, 0–90 días

- Elegir una zona y tres establecimientos con acceso semanal al decisor.
- Levantar inventario real, conectividad, una estación, cuatro sondas, RFID/balanza existente y telemetría básica de dos máquinas.
- Pilotear NODO Flota, NODO Scout, NODO Teams, Scout Field y la bóveda offline v3 ya implementados; medir preparación/expiración del paquete, sesión vencida, cuota/evicción, reanudación y pérdida de frase en dispositivos de campo. Archivos no controlados siguen fuera de alcance.
- Configurar dominio, SMTP transaccional y entregabilidad; ensayar invitación, aceptación, revocación y offboarding con dos cuentas reales antes de incorporar personal del piloto.
- Configurar el proveedor de inteligencia y construir un set de 50 casos evaluados por un agrónomo/encargado: evidencia correcta, utilidad, acción aceptada y daño potencial.
- Medir tiempo de carga, disponibilidad de señal, horas de parada, costo de mantenimiento, adopción de partes y decisiones ejecutadas.
- Iniciar cada piloto desde Pilot Control antes de intervenir, capturar evidencia semanal y registrar valor sólo contra documentación identificable.

**Puerta:** tres cuentas activas semanalmente, dos dispuestas a pagar, menos de diez minutos de carga diaria y al menos dos resultados económicos verificables.

### Fase 2 — Producto repetible, meses 4–6

- Flujo completo de orden preventiva/correctiva, repuestos, responsables, costo y cierre.
- Gateway offline-first con cola local, OTA firmada y observabilidad de conectividad.
- Extender Earth Time ya operativo: más de 90 días, comparación entre campañas, evaluación con agrónomo y sincronización offline supervisada de recorridas completas.
- Incorporar NODO Terrain 3D sólo con DEM licenciado, resolución y precisión vertical declaradas; luego evaluar escurrimiento y transitabilidad con evidencia de campo.
- Importadores CSV y conectores iniciales para sistemas de balanza/RFID y maquinaria autorizados.
- Experimentos A/B de recomendaciones y registro de resultado para aprender qué funciona por contexto, sin mezclar datos privados.
- Transferencia de propiedad con step-up MFA, permisos por capacidad y facturación SaaS; organizaciones, invitaciones, roles y baja básica ya están implementados.

**Puerta:** diez cuentas pagas, activación en menos de siete días, retención de cohorte a 90 días mayor a 80% y margen bruto de software positivo antes del soporte de campo.

### Fase 3 — Escala nacional, meses 7–12

- Plantillas por sistema productivo y red certificada de instaladores/partners.
- API pública y SDK de gateway versionados; conectores ISOBUS/CAN sólo con documentación y permisos del fabricante.
- Modelos predictivos limitados a problemas con suficientes etiquetas y baseline superior a reglas simples.
- Benchmark anonimizado únicamente con consentimiento explícito y umbrales de privacidad.
- SRE, backups ensayados, respuesta a incidentes, residencia de datos y contratos empresariales.
- Localización por país, moneda, zona horaria y sistema de unidades; español neutro primero, portugués después de validar canal en Brasil.

**Puerta:** 50 cuentas pagas, expansión dentro de cuentas, payback de CAC menor a 12 meses, churn anualizado controlado y dos canales de adquisición repetibles.

## Métricas que gobiernan el producto

- **North Star:** valor económico verificado por establecimiento/mes, separado en ahorro, pérdida evitada e ingreso incremental.
- Activación: establecimiento + primer activo/lote + primera fuente + primera decisión cerrada.
- Uso: días por semana con una decisión revisada; no cantidad de sesiones.
- Calidad de datos: cobertura, frescura, calibración y porcentaje de señales críticas recibidas.
- Inteligencia: groundedness, utilidad, tasa de aceptación, tasa de corrección, incidentes, latencia p95 y costo por parte.
- Flota: horas de parada, cumplimiento preventivo, tiempo a cierre y recurrencia de falla.
- Negocio: MRR, margen bruto por segmento, CAC, payback, retención, expansión y costo de soporte de campo.

## Estrategia de inversión

### Pre-seed

Buscar capital sólo después de demostrar tres pilotos activos, dos cartas de intención con precio y dos casos de ROI documentados. Uso de fondos: producto offline, instrumentación, seguridad, evaluación de inteligencia y operación del piloto. La narrativa es “control operativo verificable”, no “IA para el agro”.

### Seed

Requiere repetibilidad: 15–30 cuentas pagas, cohortes, canal de adquisición, instalación estandarizada y margen de contribución conocido. Uso de fondos: equipo comercial/técnico regional, conectores y expansión de NODO Flota al resto del gemelo.

### Serie A

Sólo tiene sentido con retención, expansión y un playbook replicable en más de un país o sistema productivo. El activo defendible debe ser una red de integraciones y resultados longitudinales, no dependencia de un proveedor de modelos.

Las rondas no son hitos de producto ni están garantizadas. Son consecuencia de evidencia de mercado, gobierno y economía saludable.

## Cadencia operativa

- Semanal: entrevista de campo, revisión de incidentes, decisiones aceptadas y métrica North Star.
- Quincenal: demo al piloto y priorización basada en evidencia, no pedidos aislados.
- Mensual: cohorte, costos por establecimiento, seguridad, calidad de datos y runway.
- Trimestral: mantener/cambiar segmento, pricing, canal y presupuesto según las puertas definidas.

## No negociables

- Sin respuestas simuladas ni datos inventados para aparentar integraciones.
- Sin control autónomo de bombas, maquinaria o aplicaciones hasta validar interlocks, responsabilidad y seguridad en hardware.
- Sin prescripciones veterinarias o fitosanitarias automatizadas.
- Sin entrenar con datos privados de un cliente para beneficiar a otro sin consentimiento explícito.
- Sin afirmar ahorro, rendimiento o precisión antes de medirlo en campo.
- Sin afirmar homologación, certificación, compatibilidad oficial o protección registral sin expediente y evidencia vigente; la matriz de salida está en `docs/LAUNCH_READINESS.md`.
