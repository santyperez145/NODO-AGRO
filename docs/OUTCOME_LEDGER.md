# NODO Outcome Ledger

Actualizado: 2026-09-03. Cierra el circuito señal → labor → costo → resultado con referencias verificables. No inventa montos ni publica ROI externo.

## Decisión de producto

Auravant/SIMA venden monitoreo. Kilimo conecta agua con intervención. NODO acumula el historial longitudinal que nadie más posee: qué señal disparó qué acción, qué costó y qué resultado se declaró con evidencia del libro.

## Alcance v1

- Ciclos con snapshot de señal congelado en servidor.
- Señales: métrica satelital, saldo hídrico, recomendación, recorrida o nota manual (≥20 caracteres).
- Labor: recorrida, orden de flota o riego declarado (no reversiones).
- Costo: únicamente un `financial_entries` existente, no revertido.
- Resultado: categoría + método; el monto se copia del asiento enlazado.
- Revisión: otra identidad `owner/admin` distinta de quien abrió → `internally_verified` o `rejected`.
- UI **Resultados** con circuito visual de cinco nodos.

## Alcance v2

- `set_recommendation_status(..., 'accepted')` abre (o reutiliza) un ciclo `signal_kind='recommendation'` en el servidor.
- Si la recomendación tiene `parcel_id`, crea una recorrida Scout (`create_scouting_visit_v2`) y la enlaza con `link_outcome_labor`.
- Sin lote, el ciclo queda en `open` para enlazar labor manualmente.
- Devuelve el `uuid` del ciclo. No inventa montos.
- El Centro de mando navega a Resultados tras aceptar.

## Qué no hace

- No inventa ahorro, rendimiento ni causalidad.
- `internally_verified` no es auditoría contable ni ROI comercial publicable.
- No ejecuta bombas, pulverizaciones ni órdenes físicas.
- No entra a la bóveda offline.
- No spawnea órdenes de flota ni riego automáticamente (sólo Scout cuando hay lote).

## Operación

1. Aceptá una recomendación o abrí un ciclo desde una evidencia persistida.
2. Enlazá labor si aplica.
3. Enlazá un asiento real del libro.
4. Declará el resultado y el método.
5. Otra identidad revisa.

RPCs: `set_recommendation_status` (v2), `open_outcome_cycle`, `link_outcome_labor`, `link_outcome_cost`, `declare_outcome_result`, `review_outcome_cycle`.
