# Arquitectura de NODO

## Decisiones

- **Cliente:** React, TypeScript y Vite. TanStack Query controla caché, reintentos y estados de red; Zod valida contratos externos.
- **Identidad y datos:** Supabase Auth y PostgreSQL. El navegador solo recibe la clave publicable. Los datos se aíslan por organización con grants y Row Level Security.
- **Ingesta IoT:** Edge Function `ingest-telemetry` con secreto independiente por dispositivo, SHA-256 en reposo, máximo 100 lecturas por lote e idempotencia por dispositivo, fecha y métrica. Los sensores nunca usan credenciales del navegador.
- **Red operativa:** cada dispositivo conserva nombre, identificador físico, tipo, lote opcional e intervalo esperado. `latest_sensor_readings` usa seguridad del invocador y RLS para devolver solamente la observación más reciente por dispositivo y métrica. El estado en línea se deriva de la última señal y del intervalo configurado, no de una etiqueta estática.
- **Plano de control:** cada identidad posee un gemelo con estado deseado/reportado y versiones monótonas. Las órdenes usan allowlist, UUID de idempotencia, TTL, lease de entrega, reintentos, acuse explícito y eventos de auditoría. `device-control` autentica el mismo token del hardware; una orden entregada nunca se presenta como ejecutada hasta recibir `succeeded`.
- **Transporte neutral:** HTTPS es el canal inicial por compatibilidad con gateways rurales y conectividad intermitente. Un adaptador MQTT 5 podrá mapear expiración, respuesta y correlación sin modificar el dominio, siguiendo el estándar OASIS. OPC UA queda como adaptador industrial para maquinaria que lo soporte y LoRaWAN/FUOTA para redes de campo y actualizaciones compatibles.
- **Clima:** `sync-intelligence` consulta Open-Meteo, valida el contrato y persiste la observación. El cliente usa Open-Meteo solamente como degradación visible si aún no existe una captura persistida.
- **Satélite:** `sync-intelligence` descubre escenas Sentinel-2 L2A en el catálogo STAC público de Microsoft Planetary Computer. NODO conserva fecha, nubosidad y vínculo a evidencia; no inventa NDVI sin procesar las bandas del lote.
- **Decisiones:** reglas transparentes para lluvia, viento y helada. Cada recomendación conserva evidencia, confianza, vigencia, estado y usuario que decide.
- **Ubicación:** el onboarding permite buscar una localidad, usar geolocalización del dispositivo o seleccionar el punto en un mapa. Las coordenadas WGS84 siguen disponibles como control técnico, pero no son la interacción principal.
- **Mapa y lotes:** Esri World Imagery es la base visual satelital, con atribución en pantalla y fallback a OpenStreetMap ante fallos de teselas. El productor delimita el lote por vértices; NODO calcula una superficie aproximada y persiste GeoJSON WGS84. La mensura declarada continúa siendo la referencia legal.
- **Observabilidad:** errores estructurados y trazabilidad desde señal hasta recomendación.
- **Seguridad física:** el MVP solo permite solicitar estado, cambiar el intervalo de reporte y reiniciar el agente de comunicación. Actuadores, bombas o movimiento de maquinaria requieren capacidades declaradas, interlocks locales, límites, aprobación humana y validación específica antes de habilitarse.
- **Rodeo event-sourced:** `livestock_groups` conserva el estado materializado y `livestock_events` la historia inmutable. Las RPC bloquean la fila, validan dirección de cada movimiento, impiden stock negativo y son idempotentes.
- **Maquinaria:** `machine_assets` mantiene el gemelo administrativo del activo. Uso, service, reparación e inspección se registran como eventos; el vencimiento se deriva del horómetro, último service e intervalo configurado.
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
3. Dibujar o importar polígonos parcelarios para calcular índices espectrales por lote.
4. Validar hardware y calibración física en el establecimiento piloto.
5. Definir el criterio contable, impositivo y centros de costo con el profesional responsable antes de usar el libro operativo como contabilidad formal.

## Contrato de telemetría

`POST /functions/v1/ingest-telemetry` requiere `x-device-token` y un cuerpo `{"readings":[{"observed_at":"ISO-8601","metric":"soil.moisture","value":31.2,"unit":"pct","quality":98}]}`. Devuelve `202` y acepta de 1 a 100 observaciones. El token se entrega una sola vez mediante `provision_device`; la interfaz lo elimina de memoria al cerrar el alta y debe almacenarse en el gateway, nunca en código fuente o almacenamiento general del navegador.
