# NODO Scout Field

Actualizado: 2026-09-02. Esta capacidad cierra la evidencia fotográfica con un análisis de campo verificable. No habilita PDFs ni archivos arbitrarios y no afirma un antivirus certificado.

## Decisión de producto

SIMA y Auravant aceptan fotos de recorrida. El riesgo de NODO no es “tener cámara”: es adjuntar bytes no controlados a un bucket privado y un historial auditable. Vault, TUS, firma binaria y SHA‑256 ya existían. Faltaba un gate que rechace políglotas y hashes conocidos **antes** de registrar metadatos.

No se copia un producto de ciberseguridad. Se usa tecnología externa (catálogos públicos de malware) y un microservicio propio que nunca envía la fotografía.

## Alcance v1

- Sigue aceptando únicamente JPEG, PNG o WebP de hasta 8 MB.
- Tras TUS, `scouting-evidence` vuelve a descargar el objeto y comprueba tamaño, MIME, firma y SHA‑256.
- El análisis estructural busca ejecutables, ZIP, PDF, OLE, HTML/script/SVG embebidos y colas posteriores al contenedor de imagen.
- Consulta el hash en [MalwareBazaar](https://bazaar.abuse.ch/api/). Si existe `VIRUSTOTAL_API_KEY`, consulta además el informe de hash de VirusTotal.
- **La foto no se sube a ningún catálogo.** Sólo viaja el SHA‑256.
- `blocked` elimina el objeto y no crea `scouting_finding_media`.
- `clean` exige al menos un catálogo que confirme que el hash no está listado.
- `unknown` se adjunta con limitaciones visibles si el catálogo no respondió, pero el análisis estructural no encontró políglota.
- Algoritmo: `field-scan-v1`. El adjunto exige un escaneo de esa versión en las últimas dos horas.

## Qué no hace

- No habilita documentos, videos ni archivos no controlados.
- No es ClamAV, EDR ni una certificación AV.
- No hace moderación visual ni prueba de autenticidad de la escena.
- No sustituye un dispositivo administrado ni un pentest.
- El paquete offline no escanea en el teléfono; el gate corre al sincronizar.

## Operación

1. Capturar o elegir una imagen permitida.
2. Transferir por TUS o el endpoint binario de compatibilidad.
3. El servidor persiste `scouting_media_scans` y, si el veredicto no es `blocked`, adjunta la evidencia.
4. La galería muestra si el hash se consultó, si el catálogo quedó incompleto o si el archivo fue rechazado.

El navegador no escribe escaneos. `record_scouting_media_scan_server` es exclusivo de `service_role`.
