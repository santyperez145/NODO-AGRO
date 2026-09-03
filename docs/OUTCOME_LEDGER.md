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

## Qué no hace

- No inventa ahorro, rendimiento ni causalidad.
- `internally_verified` no es auditoría contable ni ROI comercial publicable.
- No ejecuta bombas, pulverizaciones ni órdenes físicas.
- No entra a la bóveda offline.

## Operación

1. Abrí un ciclo desde una evidencia persistida.
2. Enlazá labor si aplica.
3. Enlazá un asiento real del libro.
4. Declará el resultado y el método.
5. Otra identidad revisa.

RPCs: `open_outcome_cycle`, `link_outcome_labor`, `link_outcome_cost`, `declare_outcome_result`, `review_outcome_cycle`.
