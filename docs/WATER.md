# NODO Water

Actualizado: 2026-09-02. Esta capacidad arma un saldo hídrico de referencia por lote. No prescribe una lámina, no controla bombas y no afirma ahorro de agua.

## Decisión de producto

Kilimo conecta señal, intervención y resultado en agua. IrriSAT y FAO‑56 publican ET0 de referencia. NODO replica el circuito verificable: lluvia persistida + riego **declarado** − ET0 FAO‑56, con NDMI usable y humedad de suelo como evidencia. No se copia una UI comercial ni se afirma ETc, Kc o un déficit de cultivo.

Un lote de secano sin riego declarado no se presenta como faltante.

## Alcance v1

- Open‑Meteo Archive aporta lluvia y `et0_fao_evapotranspiration` de los últimos 30 días observados.
- Open‑Meteo Forecast aporta 7 días de pronóstico para la curva; el saldo de lote usa sólo días observados.
- `irrigation_events` es append-only. Owner, admin, agrónomo y operador pueden declarar. La reversión exige owner/admin/agronomist y genera la contrapartida.
- El microservicio `water-balance` autentica JWT, deriva el rol en servidor y escribe sólo con `service_role`.
- NDMI entra únicamente si es `usable` con algoritmo `sentinel2-l2a-ndmi-scl-v1`.
- Humedad de suelo entra si la lectura más reciente del lote está en `%`.
- `review_status=verify` exige NDMI por debajo de la mediana del mismo lote, saldo negativo y ningún riego declarado en 7 días.
- Algoritmo: `reference-et0-v1`.

## Qué no hace

- No calcula ETc ni aplica coeficientes de cultivo.
- No estima escorrentía, percolación ni capacidad de campo.
- No reescribe NDMI nublado ni fabrica un ID de métrica para Scout.
- No enciende bombas, pivotes ni válvulas.
- No afirma “optimiza riego” ni “ahorra X%”.
- El paquete offline no incluye Water.

## Operación

1. Persistir lotes y, si hay, construir la serie NDMI SCL.
2. Declarar riegos reales o dejar el lote como secano.
3. Ejecutar `Calcular saldo` en Agua.
4. Revisar la curva, las limitaciones por lote y los estados Observar / Verificar / Insuficiente.
5. Si un lote queda en Verificar y existe NDMI usable, planificar Scout.

El navegador no inserta riegos, corridas ni balances; sólo llama RPC y la Edge Function.
