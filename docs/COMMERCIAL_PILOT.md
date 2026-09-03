# Checklist de piloto comercial pagable

Actualizado: 2026-09-03. Instrumento operativo; **no** declara que NODO ya está listo para vender. Cada ítem debe tener evidencia fechada.

Fuente de verdad de gates: `docs/LAUNCH_READINESS.md`.

## Producto ya construible (código)

| Capacidad | Evidencia en repo |
|---|---|
| Circuito señal → labor → costo → resultado | Outcome Ledger + Outcome v2 (aceptar recomendación abre ciclo) |
| Serie satelital verificable | Earth Time 90/180 días, SCL por lote, campañas julio–junio |
| Agua de referencia | Water FAO-56 + riego declarado |
| Scout con evidencia | Recorridas, hash, field-scan |
| Relieve 2D licenciado | Terrain Copernicus DEM GLO-30 |
| Piloto medible | Pilot Control con línea base y claims de dos identidades |
| Onboarding multiempresa | Invitaciones server-owned + roles |

## Gate P0 — piloto interno (equipo)

- [ ] CI de aplicación y base de datos en verde
- [ ] Migraciones Outcome v2 / Earth Time aplicadas en el proyecto Supabase del piloto
- [ ] Sin datos ni dispositivos simulados presentados como reales
- [ ] Inventario de secretos y subencargados actualizado
- [ ] Backup restaurado al menos una vez

## Gate P1 — piloto externo pagable (bloquea cobro serio)

Estos ítems **no se cumplen por código**; requieren operación humana:

- [ ] Dominio definitivo apuntando a la app (DNS + TLS)
- [ ] SMTP transaccional propio con SPF/DKIM/DMARC verificados
- [ ] Flujo de invitación/offboarding ensayado con correos reales del cliente
- [ ] Contrato de piloto + anexo de datos firmados
- [ ] Hipótesis, criterio de éxito y línea base en Pilot Control antes de intervenir
- [ ] Outcome Ledger usado para al menos un ciclo completo con asiento real
- [ ] Responsable de soporte y canal de incidentes nombrados

## Gate M1 — venta comercial (fuera de alcance de este checklist)

Ver `LAUNCH_READINESS.md`: marca, privacidad, pentest, seguro, tres pilotos y ROI con revisión externa. `internally_verified` **no** alcanza.

## Onboarding SaaS / dominio (pasos reales)

1. Definir URL canónica (ej. `app.tudominio.com`) y configurar Auth redirect URLs en Supabase.
2. Configurar proveedor SMTP en Supabase Auth (no usar el SMTP compartido de desarrollo para clientes).
3. Publicar aviso de privacidad y términos revisados legalmente.
4. Crear la organización del cliente vía onboarding; invitar owner/admin reales.
5. Congelar línea base en Piloto; operar Earth Time / Water / Scout; cerrar Resultados.

## Qué no afirmar

- “Listo para vender” sin P1 cerrado.
- Ahorro %, detección de enfermedades, riego óptimo, precisión centimétrica o Terrain 3D sin motor licenciado.
