# Integración de gateways NODO

Cada dispositivo usa un token propio generado una sola vez. El gateway debe guardarlo en almacenamiento seguro y enviarlo únicamente en el encabezado `x-device-token` sobre HTTPS. Nunca debe incluirlo en firmware público, logs o repositorios.

## Enviar telemetría

`POST https://kbhvgbczerfgdmfpugxr.supabase.co/functions/v1/ingest-telemetry`

```json
{
  "readings": [
    {
      "observed_at": "2026-08-29T18:00:00Z",
      "metric": "soil.moisture",
      "value": 31.2,
      "unit": "pct",
      "quality": 98
    }
  ]
}
```

El lote acepta entre 1 y 100 lecturas, conserva idempotencia por dispositivo, fecha y métrica, y rechaza observaciones fuera de la ventana admitida.

## Consultar control y configuración

`POST https://kbhvgbczerfgdmfpugxr.supabase.co/functions/v1/device-control`

```json
{ "action": "poll" }
```

La respuesta contiene como máximo una orden, su vencimiento, la versión del estado deseado y la hora del servidor. Si no llega el acuse, la orden se vuelve a entregar después del lease; el gateway debe ejecutar cada `command.id` una sola vez.

## Confirmar una orden

```json
{
  "action": "ack",
  "command_id": "UUID",
  "status": "succeeded",
  "result": { "message": "applied" }
}
```

Los estados admitidos son `succeeded` y `failed`. La confirmación es obligatoria: una entrega no equivale a una ejecución.

## Reportar el gemelo

```json
{
  "action": "report_state",
  "version": 1,
  "state": {
    "firmware": "1.0.0",
    "battery_pct": 84,
    "connectivity": "lte"
  }
}
```

La versión debe crecer de forma monótona. Las propiedades reportadas representan el último estado conocido; las series de medición continúan enviándose al endpoint de telemetría.

## Política de control

- Se admiten `request_status`, `set_reporting_interval` y `restart_agent`.
- `restart_agent` reinicia el proceso de comunicación NODO, nunca una máquina o actuador.
- No se aceptan comandos arbitrarios, código remoto, movimiento de maquinaria ni activación de riego.
- La actuación física requerirá capacidades declaradas, interlocks locales, límites agronómicos, aprobación humana y un piloto de seguridad específico.
- Un futuro adaptador MQTT 5 conservará los mismos IDs, vencimientos, estados y acuses; el dominio no depende del transporte.
