# Estrategia competitiva de NODO Earth

Actualizado: 2026-08-29. Este análisis usa capacidades declaradas en sitios oficiales; no supone acceso a productos internos, precios privados ni validación independiente de resultados comerciales.

## Qué aprendemos del mercado

- [Auravant](https://www.auravant.com/) valida la demanda por centralizar información agrícola, trabajar con imágenes satelitales, colaborar y extender la plataforma con integraciones.
- [SIMA](https://sima.ag/es/) valida el flujo de planificar, ejecutar y analizar campañas, con GIS, monitoreo, clima, órdenes de trabajo y recorridas orientadas por índices como NDVI.
- [Kilimo](https://kilimo.com/) demuestra que la señal tecnológica gana valor cuando se conecta a una intervención operativa y a un resultado medible, especialmente en gestión de agua.

Copiar un tablero de colores no crea una compañía defendible. La decisión es construir un circuito cerrado entre evidencia, acción y economía.

## Posicionamiento

**NODO es el sistema operativo verificable del establecimiento:** conecta satélite, clima, IoT, maquinaria, cultivos, rodeo y libro operativo para convertir una anomalía en una recorrida, una orden, evidencia de campo y un resultado económico trazable.

La cuña comercial sigue siendo NODO Flota por urgencia y retorno medible. NODO Earth reduce el tiempo hasta el primer valor, amplía la cuenta agrícola y alimenta el grafo que diferencia a la plataforma.

## Circuito defendible

1. Una escena fechada produce una capa y estadísticas por polígono.
2. NODO compara solamente lotes compatibles y propone verificar, no diagnosticar.
3. La recorrida incorpora fotos, observaciones, sensores y contexto fenológico.
4. Una decisión aprobada genera una tarea u orden y conserva responsable, costo y estado.
5. El resultado vuelve al historial para medir pérdida evitada, ahorro o ingreso incremental.

El activo acumulativo es ese historial longitudinal de señal → decisión → ejecución → resultado, con permisos del productor; no el acceso exclusivo a una imagen pública ni la dependencia de un modelo externo.

## Arquitectura de producto

| Capa | Construir en NODO | Integrar como proveedor |
|---|---|---|
| Evidencia | Identidad de escena, métricas por lote, calidad, auditoría y series temporales | Sentinel/Copernicus, proveedores comerciales cuando el ROI lo justifique, clima y DEM licenciados |
| Operación | Recorridas, órdenes, IoT, gemelos, mantenimiento y libro económico | Gateways, sensores, RFID y maquinaria homologados/autorizados |
| Inteligencia | Contexto server-side, reglas, evaluación, aprobación y aprendizaje de resultados | Modelos intercambiables y algoritmos especializados evaluados |
| Experiencia | Un mapa operativo, estados claros, offline-first y explicación de límites | Motores cartográficos/render 3D con licencias compatibles |

## NODO Earth implementado

- Color real Sentinel-2 L2A fechado.
- NDVI a resolución nominal de 10 m y NDMI a 20 m, calculados desde bandas oficiales.
- Estadísticas reales por cada polígono persistido: media, rango, desviación, percentiles y píxeles.
- Ejecuciones auditables, aislamiento multiempresa, roles y escrituras únicamente server-side.
- Calidad conservadora por nubosidad global y suficiencia de píxeles.
- Recorrida dirigida por diferencia relativa dentro de la misma escena, sin afirmar causa ni prescribir intervención.

Limitación actual: la versión `unmasked-v1` no aplica máscara de nubes por píxel ni serie temporal. Es útil como inspección relativa y piloto, no como diagnóstico o certificación de rendimiento.

## Próximos productos priorizados

1. **Earth Time:** serie temporal por lote, máscara SCL, percentiles robustos y cambio contra baseline fenológico.
2. **Scout:** recorridas offline, punto de interés, foto/audio, severidad y cierre con evidencia.
3. **Water:** balance hídrico que combine NDMI, lluvia, suelo y riego; nunca sustituirá medición calibrada.
4. **Terrain 3D:** relieve con DEM verificado, resolución/licencia/precisión vertical visibles y sombreado útil para escurrimiento.
5. **Outcome Ledger:** relación entre señal, decisión, labor, costo y resultado para demostrar ROI sin extrapolar.

## Claims permitidos

- “Visualiza una escena Sentinel‑2 fechada y calcula índices por lote.”
- “Prioriza recorridas por comparación relativa y conserva evidencia.”
- “Integra la decisión con la operación y el costo.”

No se afirmará “detecta enfermedades”, “optimiza riego”, “aumenta rendimiento”, “centimétrico”, “tiempo real”, “homologado” o “ahorra X%” sin protocolo, datos de campo, intervalo de confianza y alcance contractual que lo respalden.
