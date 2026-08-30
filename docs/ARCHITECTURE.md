# Arquitectura de NODO

## Decisiones

- **Cliente:** React, TypeScript y Vite. TanStack Query controla caché, reintentos y estados de red; Zod valida contratos externos.
- **Identidad y datos:** Supabase Auth y PostgreSQL. El navegador solo recibe la clave publicable. Los datos se aíslan por organización con grants y Row Level Security.
- **Ingesta IoT:** Edge Function `ingest-telemetry` con secreto independiente por dispositivo, SHA-256 en reposo, máximo 100 lecturas por lote e idempotencia por dispositivo, fecha y métrica. Los sensores nunca usan credenciales del navegador.
- **Red operativa:** cada dispositivo conserva nombre, identificador físico, tipo, lote opcional e intervalo esperado. `latest_sensor_readings` usa seguridad del invocador y RLS para devolver solamente la observación más reciente por dispositivo y métrica. El estado en línea se deriva de la última señal y del intervalo configurado, no de una etiqueta estática.
- **Plano de control:** cada identidad posee un gemelo con estado deseado/reportado y versiones monótonas. Las órdenes usan allowlist, UUID de idempotencia, TTL, lease de entrega, reintentos, acuse explícito y eventos de auditoría. `device-control` autentica el mismo token del hardware; una orden entregada nunca se presenta como ejecutada hasta recibir `succeeded`.
- **Transporte neutral:** HTTPS es el canal inicial por compatibilidad con gateways rurales y conectividad intermitente. Un adaptador MQTT 5 podrá mapear expiración, respuesta y correlación sin modificar el dominio, siguiendo el estándar OASIS. OPC UA queda como adaptador industrial para maquinaria que lo soporte y LoRaWAN/FUOTA para redes de campo y actualizaciones compatibles.
- **Clima:** `sync-intelligence` consulta Open-Meteo, valida el contrato y persiste la observación. El cliente usa Open-Meteo solamente como degradación visible si aún no existe una captura persistida.
- **Satélite:** `sync-intelligence` descubre escenas Sentinel-2 L2A en el catálogo STAC público de Microsoft Planetary Computer. La unicidad de escena incluye establecimiento para impedir reasignación entre tenants. NODO conserva fecha, nubosidad y vínculo a evidencia.
- **NODO Earth:** `satellite-analytics` autentica usuario y rol, selecciona la escena y los polígonos server-side, aplica expresiones allowlisted y consulta estadísticas reales del Data API. NDVI usa `(B08-B04)/(B08+B04)` a resolución nominal de 10 m; NDMI usa `(B8A-B11)/(B8A+B11)` a 20 m. Procesa como máximo 100 lotes, con concurrencia acotada y timeout por proveedor.
- **Gobierno satelital:** `satellite_analysis_runs` registra ejecución, usuario, escena, índice, parciales y fallos. `parcel_satellite_metrics` guarda media, extremos, desviación, percentiles, píxeles, calidad, algoritmo y fuente. RLS permite lectura por miembros, pero el navegador no puede escribir resultados. Triggers verifican organización, establecimiento, escena, lote y ejecución.
- **Límite espectral:** `unmasked-v1` usa nubosidad global y suficiencia de píxeles; todavía no aplica máscara SCL por píxel ni normalización fenológica. Las capas son proxies para orientar inspección y no diagnostican estrés, enfermedad, riego o rendimiento.
- **NODO Scout:** `scouting_visits` enlaza lote, responsable, prioridad, horario y una fuente opcional. Si nace desde Earth, el servidor deriva y congela el snapshot espectral; el navegador no puede fabricar esa evidencia. `scouting_visit_events` conserva la máquina de estados e idempotencia y `scouting_findings` agrega observaciones append-only con punto y precisión opcionales.
- **Integridad de campo:** tres triggers validan organización, establecimiento, lote, métrica, visita y responsable. Las RPC `create_scouting_visit`, `transition_scouting_visit` y `record_scouting_finding` derivan el rol desde la sesión. Sólo una visita en curso acepta hallazgos y todo cierre requiere resumen.
- **Inteligencia con campo:** `agro-intelligence` incorpora índices, recorridas y hallazgos al snapshot server-side, pero elimina coordenadas exactas y conserva únicamente si el hallazgo fue geolocalizado. Texto de campo continúa tratándose como dato no confiable y evidencia, nunca como instrucción o diagnóstico.
- **Decisiones:** reglas transparentes para lluvia, viento y helada. Cada recomendación conserva evidencia, confianza, vigencia, estado y usuario que decide.
- **Inteligencia transversal:** `agro-intelligence` autentica al usuario, deriva organización y rol en servidor y arma un snapshot acotado desde las fuentes operativas. El navegador sólo envía el establecimiento y una pregunta opcional; no puede fabricar el contexto del modelo. Identificadores de dispositivos se reemplazan por alias efímeros y el detalle libre del libro económico no sale del servidor.
- **Contrato de análisis:** el motor usa una salida JSON estricta, validación secundaria en servidor, límite de tokens, identificador de seguridad no personal, `store: false`, caché de 15 minutos y límites de 6 análisis por usuario/hora y 30 por organización/día. El modelo se configura mediante `NODO_AI_MODEL` para permitir evaluación, migración de proveedor y control de costos sin cambiar el dominio.
- **Gobierno de inteligencia:** `ai_analysis_runs` conserva versión de prompt, hash, evidencia exacta, resultado, consumo y fallo técnico. RLS permite lectura a miembros, pero ninguna sesión del navegador puede insertar o alterar resultados. `latest_ai_analysis` usa seguridad del invocador, oculta partes vencidos después de 24 horas y el feedback pasa por una RPC. Las claves y el proveedor nunca se exponen en la interfaz.
- **Límite de autonomía:** el análisis trata todo texto operativo como datos no confiables, declara faltantes y no prescribe fitosanitarios, dosis, tratamientos veterinarios ni maniobras físicas. Las propuestas críticas requieren aprobación humana y no se envían al plano de control IoT.
- **Ubicación:** el onboarding permite buscar una localidad, usar geolocalización del dispositivo o seleccionar el punto en un mapa. Las coordenadas WGS84 siguen disponibles como control técnico, pero no son la interacción principal.
- **Mapa y lotes:** Esri World Imagery es la base visual satelital, con atribución en pantalla y fallback a OpenStreetMap ante fallos de teselas. El productor delimita el lote por vértices; NODO calcula una superficie aproximada y persiste GeoJSON WGS84. La mensura declarada continúa siendo la referencia legal.
- **Observabilidad:** errores estructurados y trazabilidad desde señal hasta recomendación.
- **Seguridad física:** el MVP solo permite solicitar estado, cambiar el intervalo de reporte y reiniciar el agente de comunicación. Actuadores, bombas o movimiento de maquinaria requieren capacidades declaradas, interlocks locales, límites, aprobación humana y validación específica antes de habilitarse.
- **Rodeo event-sourced:** `livestock_groups` conserva el estado materializado y `livestock_events` la historia inmutable. Las RPC bloquean la fila, validan dirección de cada movimiento, impiden stock negativo y son idempotentes.
- **Maquinaria:** `machine_assets` mantiene el gemelo administrativo del activo. Uso, service, reparación e inspección se registran como eventos; el vencimiento se deriva del horómetro, último service e intervalo configurado.
- **NODO Flota:** `maintenance_work_orders` aplica una máquina de estados explícita e idempotente. La interfaz no puede insertar ni actualizar órdenes o eventos directamente; las RPC derivan organización y moneda, validan transiciones, conservan costo estimado/final y generan el evento técnico recién al completar el trabajo.
- **Libro operativo:** `financial_entries` es append-only. No se conceden INSERT, UPDATE ni DELETE al navegador; las RPC autorizadas crean asientos y una corrección genera la contrapartida opuesta enlazada. Los KPI usan una moneda base ISO por establecimiento para no sumar divisas incompatibles.
- **Auditoría:** `operational_audit_events` solo puede escribirse desde funciones `security definer`; propietario y administrador pueden leerla, pero ningún rol del navegador puede alterarla.
- **API transaccional:** las mutaciones críticas derivan organización y rol desde la sesión, validan referencias cruzadas al establecimiento y usan UUID de idempotencia. Las vistas de consulta declaran `security_invoker` para conservar RLS.
- **Calidad continua:** GitHub Actions recompila el cliente, audita dependencias, levanta Supabase local, ejecuta lint SQL y pruebas pgTAP sobre RLS, privilegios, vistas y contrato append-only.

## Autenticación

El cliente implementa sesiones reales con Supabase: email/contraseña, alta con confirmación, Google OAuth, persistencia, renovación y cierre de sesión. No existen usuarios demo ni bypass. Sin configuración válida se bloquea el envío y se explica la dependencia pendiente.

## Estado de infraestructura

El proyecto remoto `NODO-AGRO` (`kbhvgbczerfgdmfpugxr`, São Paulo) está vinculado y sus migraciones están aplicadas. Email/contraseña, confirmación de correo, política fuerte de contraseña, cambio seguro y TOTP están activos.

Google OAuth está configurado y validado con un inicio de sesión real. El cliente anterior fue eliminado tras migrar a `NODO Web v2`.

Antes de declarar producción comercial completa todavía se requiere:

1. Sustituir las URLs locales de Auth por el dominio definitivo cuando exista hosting.
2. Configurar SMTP transaccional propio; el correo incluido por Supabase es únicamente de prueba y tiene límites estrictos.
3. Implementar máscara SCL por píxel, serie temporal y evaluación agronómica antes de convertir índices en alertas automatizadas.
4. Validar hardware y calibración física en el establecimiento piloto.
5. Definir el criterio contable, impositivo y centros de costo con el profesional responsable antes de usar el libro operativo como contabilidad formal.
6. Agregar créditos y método de pago al proyecto aislado `NODO Agro` del proveedor antes de habilitar el Parte Inteligente. La cuenta de servicio y `OPENAI_API_KEY` ya están configuradas como secreto de Edge Functions, pero la organización tiene saldo API `USD 0,00`; no se realizan inferencias ni se simulan respuestas mientras persista ese estado.

## Contrato de telemetría

`POST /functions/v1/ingest-telemetry` requiere `x-device-token` y un cuerpo `{"readings":[{"observed_at":"ISO-8601","metric":"soil.moisture","value":31.2,"unit":"pct","quality":98}]}`. Devuelve `202` y acepta de 1 a 100 observaciones. El token se entrega una sola vez mediante `provision_device`; la interfaz lo elimina de memoria al cerrar el alta y debe almacenarse en el gateway, nunca en código fuente o almacenamiento general del navegador.
