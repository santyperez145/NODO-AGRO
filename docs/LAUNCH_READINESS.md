# Preparación de NODO para pilotos y mercado

Actualizado: 2026-08-29. Esta matriz es un instrumento de gestión; **no constituye asesoramiento legal ni otorga una homologación**. Cada obligación debe confirmarse para el SKU, contrato, flujo de datos, provincia y actividad concretos con profesionales y organismos competentes antes de vender.

## Decisión de alcance

NODO es una plataforma de inteligencia operativa e integradora de hardware industrial. No fabricará silicio ni declarará que reemplaza sistemas oficiales, mensuras, contabilidad, diagnóstico profesional o controles de seguridad locales. Esa frontera reduce riesgo, acelera pilotos y concentra la propiedad intelectual en interoperabilidad, trazabilidad y resultados verificables.

## Matriz argentina de habilitación

| Frente | Cuándo aplica | Estado verificable | Evidencia exigida antes de vender |
|---|---|---|---|
| Privacidad y datos personales | Usuarios, responsables, técnicos, ubicación de recorridas, imágenes o identificadores vinculables a personas | RLS multiempresa, auditoría server-owned, ubicación opcional con precisión declarada y minimización de contexto de inteligencia implementadas. Aviso de privacidad, inventario, retención, ejercicio de derechos, contratos con encargados y análisis de transferencias: pendientes | Mapa de tratamientos y subencargados; finalidad/base legal para ubicación de personal; aviso y términos revisados; proceso de acceso, rectificación y supresión; plazos de retención; evaluación de transferencias internacionales; decisión documentada sobre inscripción de bases. La [AAIP exige informar finalidad, responsable y derechos, y aplicar seguridad y confidencialidad](https://www.argentina.gob.ar/aaip/datospersonales/responsables/obligaciones). |
| Radio y telecomunicaciones | NODO fabrica, importa o comercializa gateways, módems, LoRa, Wi-Fi, Bluetooth, RFID u otro equipo radioeléctrico | Arquitectura agnóstica y credenciales por dispositivo implementadas. No existe todavía un BOM comercial aprobado | Matriz por marca/modelo/frecuencia; certificado o registro del modelo; evidencia del proveedor; definición de quién importa/comercializa; inscripción de actividad cuando corresponda. ENACOM indica que [RAMATEL registra actividades y modelos para autorización/homologación](https://www.enacom.gob.ar/buscador/RAMATEL/pagina/tramite). Usar módulos ya homologados no se dará por supuesto: se verificará cada producto final. |
| Seguridad eléctrica y máquinas | NODO fabrica o importa fuentes, cargadores, equipos eléctricos o máquinas alcanzadas | No hay kit propio liberado; por diseño se seleccionará hardware industrial certificado | Clasificación arancelaria/técnica por SKU; ficha, manual, certificados/ensayos aceptables, declaración de conformidad y marcado que correspondan. Los reglamentos vigentes alcanzan productos definidos por las Resoluciones 16/2025 y 17/2025 y requieren el procedimiento aplicable de evaluación de conformidad, según la [Dirección Nacional de Reglamentos Técnicos](https://www.argentina.gob.ar/node/56435). |
| Identificación animal | NODO lee o gestiona RFID oficial de bovinos, bubalinos o cérvidos | Lector RFID contemplado; NODO todavía no emite identificadores ni integra SIGSA | Aceptar sólo dispositivos/proveedores oficiales; conservar correspondencia visual-electrónica; exportar el formato requerido; validar lector en campo; nunca presentar NODO como registro oficial. SENASA establece identificación electrónica desde 2026 y señala que [ICAR es el certificador habilitado para esos dispositivos](https://www.argentina.gob.ar/senasa/sistema-de-identificacion-electronica-de-animales). |
| Propiedad intelectual | Marca, código, diseños de hardware, algoritmos o invenciones | Repositorio y trazabilidad de autoría disponibles; búsquedas y solicitudes no realizadas | Buscar disponibilidad antes de invertir en marca; definir titularidad societaria y cesiones de fundadores/contratistas; solicitar marca en clases determinadas por agente; evaluar novedad antes de divulgar una invención; depositar versiones relevantes del software. INPI explica el [registro de marca](https://www.argentina.gob.ar/inpi/marcas/registrar-una-marca) y la DNDA permite [registrar software publicado](https://www.argentina.gob.ar/servicio/registrar-un-software-puesto-en-conocimiento-publico). |
| Seguridad y continuidad | Todo piloto con datos o control remoto | Tokens hasheados, RLS, allowlist de comandos, TTL, acuse, auditoría y CI implementados | Inventario de activos y secretos; MFA para cuentas privilegiadas; rotación y revocación; backups con restauración ensayada; registro de incidentes; canal privado de vulnerabilidades; pentest independiente; SLO y guardias. No se afirmará ISO 27001, SOC 2 u otra certificación sin auditoría y certificado vigentes. |
| Seguridad física y responsabilidad profesional | Bombas, maquinaria, fitosanitarios, animales o decisiones de alto impacto | NODO sólo permite comandos de diagnóstico/comunicación; la inteligencia exige aprobación humana | HAZOP/FMEA por integración; interlocks locales; parada segura; límites y permisos por capacidad; manual, capacitación y registro de aceptación; validación por agrónomo/veterinario/ingeniero según el caso; seguro de responsabilidad. Sin estos controles no se habilitan actuadores. |
| Teledetección y cartografía | Imágenes, índices, mapas térmicos, relieve y recomendaciones por lote | Sentinel‑2 fechado, NDVI/NDMI por polígono, fuente/resolución/nubosidad/algoritmo visibles y límites explícitos implementados | Inventario de licencias y atribuciones; protocolo de máscara de nubes y control de calidad; comparación contra recorridas y sensores; precisión por cultivo/zona; versionado de algoritmo; revisión de claims. GeoJSON y superficie estimada no sustituyen mensura ni catastro. |
| Contratos y operación comercial | Pilotos pagos, instalación, soporte y uso de datos | Hipótesis comercial y límites de producto documentados | Persona jurídica, impuestos y facturación; contrato de piloto; términos SaaS; DPA/anexo de datos; SLA/SLO; propiedad y portabilidad de datos; soporte, garantía y RMA; límites de responsabilidad revisados; seguro; consentimiento separado para benchmarks o entrenamiento cruzado. |

## Gates que impiden un lanzamiento prematuro

### Gate P0 — Piloto interno

- CI de aplicación y base de datos en verde.
- Migraciones reproducibles, RLS y auditoría verificadas.
- No hay datos, respuestas ni dispositivos simulados presentados como reales.
- Inventario de proveedores, secretos y subencargados actualizado.
- Restauración de backup y revocación de un dispositivo ensayadas.

### Gate P1 — Piloto en campo

- Contrato de piloto y anexo de datos firmados.
- BOM cerrado con certificados y números de modelo conservados.
- Instalación relevada, fotos/serie/calibración y responsable registrados.
- Plan de incidentes, soporte y retiro seguro del hardware.
- Métricas de éxito y daño potencial acordadas antes de observar resultados.

### Gate M1 — Venta comercial en Argentina

- Dictamen de aplicabilidad y expedientes/certificados exigibles por SKU.
- Marca y titularidad de software/contratos de desarrollo ordenadas.
- Aviso de privacidad, términos, DPA, retención y derechos operativos.
- Pentest independiente sin hallazgos críticos abiertos y restauración ensayada.
- Seguro, soporte, garantías y proceso RMA contratados.
- Tres pilotos activos, dos disposiciones de pago y dos casos de ROI documentados sin extrapolaciones engañosas.

### Gate E1 — Escala y exportación

- Matriz normativa por país, radios, seguridad eléctrica, datos y ganadería.
- Residencia/transferencias de datos y contratos regionales revisados.
- Canal de instaladores con capacitación, trazabilidad y auditoría.
- SRE, respuesta a incidentes, SBOM, gestión de vulnerabilidades y continuidad con evidencia trimestral.

## Registro de evidencia obligatorio

Cada afirmación comercial o de cumplimiento debe guardar: alcance exacto, producto/modelo/versión, organismo o estándar, número de expediente/certificado, titular, emisor, fecha, vencimiento, archivo original y responsable de renovación. El estado permitido es `no aplica`, `pendiente de evaluación`, `en trámite`, `vigente` o `vencido`; nunca “certificado” por inferencia.

## Próximas decisiones del directorio fundador

1. Constituir y definir la entidad que será titular de marca, software, contratos y datos.
2. Encargar búsqueda de marca NODO y estrategia de clases antes de comunicación masiva.
3. Elegir un único kit piloto y armar su expediente técnico por SKU antes de comprar volumen.
4. Contratar revisión legal argentina de privacidad, piloto, SaaS, hardware y responsabilidad.
5. Seleccionar el primer establecimiento por acceso semanal y capacidad de medir parada/costo, no por notoriedad.
6. Nombrar responsables explícitos de seguridad, privacidad, hardware, agronomía y soporte, aunque inicialmente una persona cubra más de un rol.
