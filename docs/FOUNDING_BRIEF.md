# Relevo — Founding brief v0.1

## Decisión fundacional

Construiremos **Relevo**, software B2B, multimarca y offline-first para mantenimiento y continuidad operativa de maquinaria agrícola. El punto de entrada son contratistas rurales y productores argentinos con flotas de 5 a 40 máquinas.

No construiremos inicialmente un ERP, un marketplace generalista, telemetría propia ni un “agrónomo IA”. El dolor elegido es concreto: una máquina detenida en una ventana corta de siembra, pulverización o cosecha cuesta mucho más que una suscripción y hoy su contexto suele quedar repartido entre memoria, WhatsApp, papeles y portales de fabricantes.

## Promesa

> Menos horas paradas. Cada máquina con memoria.

El usuario envía un audio o foto. Relevo identifica máquina y síntoma, propone preguntas de descarte, busca el procedimiento aprobado, crea una orden y registra evidencia. Las recomendaciones sensibles deben citar manual/fuente y requieren confirmación humana.

## Ventaja defendible

1. **Pasaporte técnico multimarca:** historial verificable de servicios, fallas, repuestos y responsables.
2. **Grafo máquina–síntoma–causa–solución:** mejora con cada reparación confirmada sin mezclar datos privados entre clientes.
3. **Interfaz de campo:** audio/foto primero, tolerancia a mala señal y cero carga duplicada.
4. **Red transaccional posterior:** repuestos y servicio se activan desde una necesidad diagnosticada, no desde un catálogo frío.

## Cliente y comprador inicial

- Usuario: encargado de maquinaria, operario o mecánico.
- Comprador: dueño de contratista o administrador de explotación.
- Early adopter: flota multimarca, más de 5 equipos, mantenimiento coordinado por WhatsApp/Excel y al menos una parada costosa por campaña.

## MVP de 8 semanas

### Incluye

- Alta de establecimiento, usuarios y máquinas.
- Pasaporte de máquina: marca, modelo, año, horómetro, manuales y fotos.
- Registro por texto/audio/foto con extracción estructurada revisable.
- Plan preventivo por horas/fecha y agenda priorizada.
- Orden de trabajo con responsable, repuesto, costo, evidencia y cierre.
- Alertas simples y tablero de disponibilidad/costo evitado.
- PWA con captura offline y sincronización segura.

### Excluye

- Diagnóstico autónomo que autorice operar una máquina insegura.
- Compra directa de repuestos, telemetría CAN/ISOBUS y facturación.
- Modelos predictivos: primero necesitamos datos reales y resultados etiquetados.
- Aplicación móvil nativa.

## Modelo de negocio

Piloto de 45 días sin cargo a cambio de acceso al flujo real y entrevista semanal. Luego:

- Base: USD 49/mes, hasta 5 máquinas.
- Operación: USD 129/mes, hasta 20 máquinas y 8 usuarios.
- Flota: desde USD 299/mes, integraciones, sedes y soporte.

Precio final se valida por disposición a pagar; no se descuenta de forma permanente. A futuro: comisión por repuestos/servicio y scoring técnico para garantía, seguro o reventa, sujeto a acuerdos y regulación.

## Economía objetivo (no validada)

- Margen bruto SaaS: >80% antes de soporte de campo.
- CAC recuperado: <6 meses.
- Activación: primera máquina + primer evento cerrado en <24 h.
- Retención: >85% anual de cuentas.
- North Star: **horas de parada evitadas verificadas por flota/mes**.

## Riesgos críticos

1. El usuario no registra el trabajo: resolver con audio, QR en máquina y valor inmediato.
2. Manuales/licencias insuficientes: usar documentos aportados o autorizados; no ingerir material protegido sin derecho.
3. IA alucina una reparación: recuperación con fuentes, niveles de confianza, checklist y aprobación humana.
4. Integración con hardware fragmentada: postergarla; CSV/Bluetooth solo tras validar demanda.
5. Venta estacional y presencial: iniciar con una región y aliados (talleres, concesionarios, grupos de contratistas).

## Experimentos antes de escribir el backend completo

1. Entrevistar 15 contratistas/encargados; obtener 5 historias recientes de parada con costo y flujo real.
2. Concierge pilot con 3 flotas: QR + WhatsApp + tablero manual durante 14 días.
3. Lograr que 2 de 3 cierren al menos 5 órdenes sin que nosotros persigamos la carga.
4. Pedir carta de intención con precio explícito a quienes recuperen valor.

### Criterio go / no-go

Avanzar si 3 flotas usan el flujo semanalmente, 2 aceptan pagar al menos USD 99/mes y podemos demostrar una hora de parada evitada o 30% menos tiempo administrativo. Si no, ajustar usuario/flujo; no maquillar engagement.

## Principios de producto

- Campo primero, oficina después.
- Una acción útil antes de pedir datos exhaustivos.
- La IA explica fuente, confianza y próximo paso.
- La seguridad gana sobre la velocidad.
- “No sé” es una respuesta válida.
- Medimos resultado operativo, no cantidad de pantallas.

## Próximas decisiones

1. Validar que “Relevo” sea registrable como marca y asegurar dominio; es nombre de trabajo, no activo confirmado.
2. Elegir zona piloto por acceso a 3 flotas, no por tamaño teórico de mercado.
3. Diseñar el guion de entrevista y reclutar primeros pilotos.
4. Tras evidencia, construir autenticación, modelo de datos y captura offline.
