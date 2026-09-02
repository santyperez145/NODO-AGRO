# Estrategia competitiva de NODO Earth

Actualizado: 2026-09-02. Este análisis usa capacidades declaradas en sitios oficiales; no supone acceso a productos internos, precios privados ni validación independiente de resultados comerciales.

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
- NODO Scout ya conecta esa señal con una recorrida planificada, hallazgos de campo, ubicación opcional, fotografía privada con hash server-side, bitácora y cierre; la evidencia satelital original queda congelada para auditoría.

Limitación actual: `unmasked-v1` permanece como inspección de una escena. `scl-v1` ya filtra por SCL del polígono y construye serie, pero no reescribe píxeles nublados ni certifica fenología.

## NODO Earth Time implementado

- Catálogo de hasta 12 escenas Sentinel‑2 L2A en 90 días, no una sola foto.
- Calidad por lote con histograma SCL: nube/sombra/cirros ≥ 5% deja la fecha fuera de la mediana, el mismo umbral público de Auravant.
- Curva por lote, filtro de nubladas, lluvia diaria de Open‑Meteo Archive y CSV de observaciones persistidas.
- Línea base = mediana empírica del mismo polígono; el delta exige tres fechas `usable`.
- El Parte Inteligente recibe escenas, observaciones y baselines; no puede inventar una causa.

## NODO Water implementado

- Saldo de referencia por lote: lluvia persistida + riego declarado − ET0 FAO‑56 de Open‑Meteo.
- El riego es evidencia append-only, no un comando de bomba. La reversión genera contrapartida y queda en auditoría.
- NDMI usable SCL y humedad de suelo en % entran como cobertura, no como diagnóstico.
- `verify` exige NDMI bajo la mediana del mismo lote, saldo negativo y sin riego en 7 días.
- El Parte Inteligente recibe balances y eventos; no puede prescribir ETc, lámina ni ahorro.

## NODO Scout Field implementado

- Tras TUS, el servidor relee el objeto, valida firma/hash y busca políglotas (PE, ELF, ZIP, PDF, OLE, HTML/script/SVG y colas de contenedor).
- Consulta sólo el SHA‑256 en MalwareBazaar y, si hay clave, en VirusTotal. La fotografía no sale del bucket de NODO.
- `blocked` no adjunta metadatos. `unknown` declara catálogo incompleto. No se habilitan archivos arbitrarios.
- El Parte y Scout muestran el veredicto; no se afirma antivirus certificado ni autenticidad visual.

## NODO Terrain implementado

- Copernicus DEM GLO-30 vía Planetary Computer: DSM ~30 m, EGM2008, licencia CSCDA visible.
- LE90ABS media publicada ≈ 1,92 m (sin Antártida/Groenlandia); se declara como evidencia de manual, no como cota local.
- Hillshade del mosaico + min/media/máx/relieve por lote. Algoritmo `cop-dem-glo-30-relief-v1`.
- No es malla 3D, no modela escurrimiento y no afirma precisión de obra.

## Próximos productos priorizados

1. **Outcome Ledger:** relación entre señal, decisión, labor, costo y resultado para demostrar ROI sin extrapolar.
2. **Earth Time extendido:** más de 90 días, comparación entre campañas y más índices sólo después de evaluación agronómica.
3. **Terrain 3D interactivo:** malla/render con motor y licencia compatibles, sólo después de que el relieve 2D demuestre uso.

## Claims permitidos

- “Visualiza una escena Sentinel‑2 fechada y calcula índices por lote.”
- “Construye una serie de 90 días y oculta fechas con 5% o más de nube SCL dentro del lote.”
- “Prioriza recorridas por comparación relativa y conserva evidencia.”
- “Muestra un saldo de referencia con lluvia, riego declarado y ET0 FAO‑56.”
- “Rechaza evidencia de campo con políglota o hash conocido sin enviar la foto a un catálogo.”
- “Muestra relieve Copernicus DEM GLO-30 con resolución 30 m, LE90ABS publicada y licencia visibles.”
- “Integra la decisión con la operación y el costo.”

No se afirmará “detecta enfermedades”, “optimiza riego”, “aumenta rendimiento”, “centimétrico”, “tiempo real”, “homologado” o “ahorra X%” sin protocolo, datos de campo, intervalo de confianza y alcance contractual que lo respalden.
