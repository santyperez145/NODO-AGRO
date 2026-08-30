# NODO — Visión fundacional v0.1

## Compañía

NODO es una plataforma de inteligencia operativa agropecuaria. Construye un gemelo digital vivo combinando satélites, sensores terrestres, RFID, cámaras y telemetría de maquinaria.

La promesa no es “más datos”, sino cinco decisiones diarias ordenadas por impacto, con evidencia, confianza y resultado económico esperado.

> El campo físico convertido en un sistema medible, explicable y predecible.

## Cliente inicial

Empresas mixtas agrícolas-ganaderas de 300 a 3.000 hectáreas, con rodeo, múltiples lotes y al menos tres máquinas. Tienen complejidad suficiente para obtener valor cruzado y escala para financiar el kit.

## Plataforma

- **NODO Base:** gateway LoRaWAN, almacenamiento offline, 4G, energía solar y conectividad satelital opcional.
- **NODO Earth:** Sentinel-1, Sentinel-2, clima y relieve; imágenes comerciales solo cuando el retorno lo justifique.
- **NODO Tags:** RFID, BLE, GPS o LoRa según valor del activo y frecuencia necesaria.
- **NODO Vision:** cámaras en manga, corrales y puntos operativos.
- **NODO Brain:** capa de inteligencia transversal sobre el grafo temporal de lotes, cultivos, animales, máquinas, clima, labores, costos y resultados. Empieza con partes explicables y avanza a predicción sólo cuando exista evidencia etiquetada suficiente.

NODO no fabricará silicio propio. Integrará hardware industrial y concentrará su propiedad intelectual en interoperabilidad, fusión de señales y decisiones verificables.

## MVP de 90 días

- Un establecimiento mixto.
- Series satelitales de todos sus lotes.
- Una estación meteorológica y cuatro sondas de suelo.
- Un lector RFID y una balanza ya existentes.
- GPS básico en dos máquinas.
- Registro por audio y fotografía.
- Gemelo digital de lotes, rodeo y maquinaria.
- Cinco decisiones priorizadas y tablero económico.

No incluye drones propios, collares para todo el rodeo, control autónomo de maquinaria, diagnóstico veterinario ni seguros.

## Validación

Avanzamos si durante el piloto se cumplen al menos tres condiciones:

1. El usuario consulta o ejecuta decisiones tres días por semana.
2. Se verifican dos decisiones con ahorro o producción incremental.
3. La carga manual ocupa menos de diez minutos diarios.
4. El comprador acepta un precio anual explícito.
5. Al menos 90% de las señales críticas llegan pese a la mala conectividad.

## Modelo inicial

- Instalación: USD 1.500–4.000 según infraestructura.
- Suscripción: USD 250–900 mensuales según superficie, animales, máquinas e integraciones.
- Hardware en comodato cuando reduzca la barrera de entrada.

Son hipótesis a validar, no precios publicados.

## Principios

- Interoperabilidad antes que encierro de proveedor.
- Offline-first y energía autónoma.
- Los datos identificables pertenecen al productor.
- Recomendaciones críticas con fuente, confianza y aprobación humana.
- No vender datos privados ni entrenar modelos cruzados sin autorización.
- IA como infraestructura del producto, no como chat aislado: contexto server-side, evidencia, evaluación continua, costos medidos y proveedor intercambiable.
- Medir resultados económicos y productivos, no cantidad de sensores.

## Próximas acciones

1. Validar marca y dominio; NODO es nombre de trabajo.
2. Seleccionar un establecimiento piloto por acceso y colaboración.
3. Relevar conectividad, máquinas, balanza, RFID y datos disponibles.
4. Diseñar la lista de materiales sin comprar hardware antes del relevamiento.
5. Completar el onboarding del establecimiento real y sincronizar la primera evidencia climática y Sentinel-2.
6. Probar manualmente el flujo de decisiones antes de entrenar modelos.

## Estado del producto

El núcleo técnico del piloto ya cuenta con identidad real, aislamiento multiempresa, onboarding sin datos simulados, clima persistido, NODO Earth con escenas Sentinel‑2 e índices reales por lote, NODO Scout para verificaciones de campo, ingestión segura, plano de control IoT con gemelos, órdenes de trabajo de flota y una capa de inteligencia auditable desplegada. La cuenta de servicio de inteligencia está configurada, pero todavía necesita crédito API y evaluación sistemática. La teledetección orienta recorridas y no equivale a diagnóstico agronómico. El producto no equivale a validación comercial ni regulatoria: requiere dispositivos físicos calibrados, resultados del establecimiento piloto, pruebas de seguridad y los gates de `docs/LAUNCH_READINESS.md` antes de vender o actuar sobre el campo.
