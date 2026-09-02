import { useMemo, useState, type FormEvent } from 'react';
import { CloudRain, Database, Droplets, LoaderCircle, RotateCcw, ScanSearch, ShieldAlert, Sprout } from 'lucide-react';
import {
  useComputeWaterBalance,
  useRecordIrrigationEvent,
  useReverseIrrigationEvent,
  type IrrigationMethod,
  type ParcelWaterBalance,
  type Workspace,
} from './lib/workspace';
import type { ScoutSeed } from './ScoutPanel';
import './water.css';

const canOperate = new Set(['owner', 'admin', 'agronomist', 'operator']);
const canReverse = new Set(['owner', 'admin', 'agronomist']);
const methodLabels: Record<IrrigationMethod, string> = {
  sprinkler: 'Aspersión', drip: 'Goteo', flood: 'Inundación', pivot: 'Pivote', unknown: 'No declarado',
};
const reviewLabels: Record<ParcelWaterBalance['review_status'], string> = {
  watch: 'Observar', verify: 'Verificar', insufficient: 'Insuficiente',
};
const coverageLabels: Record<ParcelWaterBalance['coverage_status'], string> = {
  reference_only: 'Sólo referencia', with_irrigation: 'Con riego declarado', with_soil: 'Con suelo',
  with_canopy: 'Con NDMI', instrumented: 'Instrumentado',
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function WaterChart({ days }: { days: Array<{ date: string; rain: number; et0: number; irrigation: number; forecast: boolean }> }) {
  const width = 920;
  const height = 220;
  const pad = { l: 40, r: 16, t: 14, b: 26 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const maxY = Math.max(1, ...days.flatMap(day => [day.rain, day.et0, day.irrigation]));
  const barW = days.length ? Math.max(3, innerW / days.length - 2) : 6;
  const xAt = (index: number) => pad.l + (days.length <= 1 ? innerW / 2 : (index / (days.length - 1)) * innerW);
  const yAt = (value: number) => pad.t + ((maxY - value) / maxY) * innerH;
  const et0Path = days.map((day, index) => `${index ? 'L' : 'M'}${xAt(index)},${yAt(day.et0)}`).join(' ');
  return (
    <svg className="waterSvg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Lluvia, ET0 de referencia y riego declarado">
      {days.map((day, index) => (
        <g key={day.date} opacity={day.forecast ? 0.45 : 1}>
          <rect x={xAt(index) - barW / 2} y={yAt(day.rain)} width={barW} height={Math.max(0, yAt(0) - yAt(day.rain))} fill="#7ea7c9" />
          {day.irrigation > 0 && <rect x={xAt(index) - barW / 2} y={yAt(day.irrigation)} width={Math.max(2, barW / 2)} height={Math.max(0, yAt(0) - yAt(day.irrigation))} fill="#2f6f3e" />}
        </g>
      ))}
      {days.length > 1 && <path d={et0Path} fill="none" stroke="#b45309" strokeWidth="1.8" />}
      <text x={pad.l} y={height - 6} className="waterTick">{days[0] ? new Date(`${days[0].date}T00:00:00Z`).toLocaleDateString('es-AR') : ''}</text>
      <text x={width - pad.r} y={height - 6} textAnchor="end" className="waterTick">{days.at(-1) ? new Date(`${days.at(-1)!.date}T00:00:00Z`).toLocaleDateString('es-AR') : ''}</text>
      <text x={pad.l - 6} y={yAt(maxY) + 3} textAnchor="end" className="waterTick">{maxY.toFixed(0)}</text>
    </svg>
  );
}

export function WaterPanel({ data, onPlanScout }: { data: Workspace; onPlanScout?: (seed: ScoutSeed) => void }) {
  const establishment = data.establishment!;
  const compute = useComputeWaterBalance();
  const record = useRecordIrrigationEvent();
  const reverse = useReverseIrrigationEvent();
  const writable = canOperate.has(data.organization!.role);
  const reversing = canReverse.has(data.organization!.role);
  const [form, setForm] = useState({
    parcelId: data.parcels[0]?.id ?? '',
    appliedOn: todayIso(),
    depthMm: '10',
    method: 'unknown' as IrrigationMethod,
    notes: '',
  });
  const [reversal, setReversal] = useState<{ eventId: string; reason: string } | null>(null);

  const reversedIds = useMemo(() => new Set(data.irrigationEvents.filter(item => item.reversal_of).map(item => item.reversal_of as string)), [data.irrigationEvents]);
  const activeEvents = useMemo(() => data.irrigationEvents.filter(item => !item.reversal_of && !reversedIds.has(item.id)), [data.irrigationEvents, reversedIds]);
  const latestRun = data.waterBalanceRuns[0] ?? null;
  const balances = data.parcelWaterBalances;
  const verifyCount = balances.filter(item => item.review_status === 'verify').length;
  const reference = balances[0] ?? null;

  const chartDays = useMemo(() => {
    const irrigationByDay = new Map<string, number>();
    for (const event of activeEvents) {
      irrigationByDay.set(event.applied_on, (irrigationByDay.get(event.applied_on) ?? 0) + Number(event.depth_mm));
    }
    const byDay = new Map<string, { date: string; rain: number; et0: number; irrigation: number; forecast: boolean }>();
    for (const day of data.weatherDaily) {
      const current = byDay.get(day.observed_on);
      const forecast = day.observation_kind === 'forecast';
      if (!current || (current.forecast && !forecast)) {
        byDay.set(day.observed_on, {
          date: day.observed_on,
          rain: day.precipitation_mm,
          et0: day.et0_mm ?? 0,
          irrigation: irrigationByDay.get(day.observed_on) ?? 0,
          forecast,
        });
      }
    }
    for (const [date, mm] of irrigationByDay) {
      if (!byDay.has(date)) byDay.set(date, { date, rain: 0, et0: 0, irrigation: mm, forecast: false });
    }
    return [...byDay.values()].sort((left, right) => left.date.localeCompare(right.date)).slice(-37);
  }, [activeEvents, data.weatherDaily]);

  function latestNdmiMetric(parcelId: string) {
    return data.satelliteMetrics
      .filter(metric => metric.parcel_id === parcelId && metric.index_name === 'ndmi' && metric.quality_status === 'usable')
      .sort((left, right) => right.captured_at.localeCompare(left.captured_at))[0] ?? null;
  }

  function submitIrrigation(event: FormEvent) {
    event.preventDefault();
    const depth = Number(form.depthMm);
    if (!form.parcelId || !Number.isFinite(depth)) return;
    record.mutate({
      establishmentId: establishment.id,
      parcelId: form.parcelId,
      appliedOn: form.appliedOn,
      depthMm: depth,
      method: form.method,
      notes: form.notes,
    }, { onSuccess: () => setForm(current => ({ ...current, notes: '' })) });
  }

  return (
    <section className="waterModule">
      <div className="moduleToolbar waterToolbar">
        <div>
          <small>NODO WATER · SALDO DE REFERENCIA</small>
          <h2>{establishment.name}</h2>
          <p>Lluvia persistida + riego declarado − ET0 FAO‑56. NDMI y suelo son evidencia, no una prescripción ni un control de bombas.</p>
        </div>
        {writable && (
          <button disabled={compute.isPending || data.parcels.length === 0} onClick={() => compute.mutate(establishment.id)}>
            {compute.isPending ? <LoaderCircle className="spin" /> : <Droplets />}
            {balances.length ? 'Actualizar saldo' : 'Calcular saldo'}
          </button>
        )}
      </div>

      {compute.error && <div className="waterAlert error"><ShieldAlert /><div><b>El saldo no se completó</b><span>{compute.error instanceof Error ? compute.error.message : 'Error no identificado'}. Los registros anteriores permanecen intactos.</span></div></div>}
      {record.error && <div className="waterAlert error"><ShieldAlert /><div><b>No se registró el riego</b><span>{record.error instanceof Error ? record.error.message : 'Error no identificado'}</span></div></div>}
      {reverse.error && <div className="waterAlert error"><ShieldAlert /><div><b>No se revirtió el evento</b><span>{reverse.error instanceof Error ? reverse.error.message : 'Error no identificado'}</span></div></div>}
      {compute.isSuccess && <div className="waterAlert success"><Database /><div><b>Saldo persistido</b><span>{compute.data.parcel_count} lotes · {compute.data.weather_days} días observados · {compute.data.verify_count} a verificar. Ventana {new Date(compute.data.window.start).toLocaleDateString('es-AR')} – {new Date(compute.data.window.end).toLocaleDateString('es-AR')}.</span></div></div>}
      {record.isSuccess && <div className="waterAlert success"><Database /><div><b>Riego declarado</b><span>Quedó como evidencia append-only. Recalculá el saldo para incorporarlo a la ventana.</span></div></div>}

      <div className="waterKpis">
        <article><small>LLUVIA OBSERVADA</small><b>{reference ? `${reference.rain_mm.toFixed(1)} mm` : '—'}</b><span>{reference ? `${reference.weather_days} días de archivo` : 'Sin saldo calculado'}</span></article>
        <article><small>ET0 FAO‑56</small><b>{reference ? `${reference.et0_mm.toFixed(1)} mm` : '—'}</b><span>Referencia, no consumo de cultivo</span></article>
        <article><small>RIEGO DECLARADO</small><b>{reference ? `${reference.irrigation_mm.toFixed(1)} mm` : `${activeEvents.reduce((sum, item) => sum + Number(item.depth_mm), 0).toFixed(1)} mm`}</b><span>{activeEvents.length} eventos activos</span></article>
        <article className={verifyCount ? 'attention' : ''}><small>REVISIÓN</small><b>{verifyCount}</b><span>{latestRun ? `Última corrida ${new Date(latestRun.started_at).toLocaleString('es-AR')}` : 'Sin ejecución'}</span></article>
      </div>

      <article className="waterChartCard">
        <div className="waterSectionTitle">
          <div><small>SERIE DIARIA</small><h3>Lluvia, ET0 y riego</h3></div>
          <div className="waterLegend"><span><i className="rain" />Lluvia</span><span><i className="et0" />ET0</span><span><i className="irrig" />Riego declarado</span></div>
        </div>
        {chartDays.length ? <WaterChart days={chartDays} /> : <div className="waterEmpty compact"><CloudRain /><b>Todavía no hay una serie climática</b><span>Calculá el saldo para persistir lluvia y ET0 de Open‑Meteo Archive, más el pronóstico de 7 días.</span></div>}
        <p className="waterChartNote">Las barras claras son pronóstico. El saldo de lote usa sólo días observados. Un lote de secano sin riego declarado no es un faltante.</p>
      </article>

      <div className="waterGrid">
        <article className="waterParcels">
          <div className="waterSectionTitle"><div><small>LOTES</small><h3>Saldo por polígono</h3></div><span>{balances.length ? `${balances.length} calculados` : 'Pendiente'}</span></div>
          {balances.length ? balances.map(balance => {
            const parcel = data.parcels.find(item => item.id === balance.parcel_id);
            const metric = latestNdmiMetric(balance.parcel_id);
            const limitations = Array.isArray(balance.limitations) ? balance.limitations : [];
            return (
              <div key={balance.id} className={`waterParcel ${balance.review_status}`}>
                <div>
                  <small>{reviewLabels[balance.review_status]} · {coverageLabels[balance.coverage_status]}</small>
                  <b>{parcel?.name ?? 'Lote'}</b>
                  <span>Saldo {balance.reference_balance_mm >= 0 ? '+' : ''}{balance.reference_balance_mm.toFixed(1)} mm · riego {balance.irrigation_mm.toFixed(1)} mm</span>
                  <em>{balance.ndmi_latest !== null ? `NDMI ${balance.ndmi_latest.toFixed(3)}${balance.ndmi_delta !== null ? ` · Δ ${balance.ndmi_delta >= 0 ? '+' : ''}${balance.ndmi_delta.toFixed(3)}` : ''}` : 'Sin NDMI usable SCL'}{balance.soil_moisture_pct !== null ? ` · suelo ${balance.soil_moisture_pct.toFixed(1)}%` : ''}</em>
                  {limitations[0] && <p>{limitations[0]}</p>}
                </div>
                <strong>{balance.reference_balance_mm.toFixed(0)}<small>mm</small></strong>
                {onPlanScout && balance.review_status === 'verify' && metric && (
                  <button onClick={() => onPlanScout({
                    parcelId: balance.parcel_id,
                    metricId: metric.id,
                    indexName: 'ndmi',
                    meanValue: metric.mean_value,
                    objective: `Verificar en campo el saldo de referencia ${balance.reference_balance_mm.toFixed(1)} mm (lluvia + riego declarado − ET0 FAO-56) y contrastar NDMI ${metric.mean_value.toFixed(3)}. No es una prescripción de lámina.`,
                  })}><ScanSearch />Planificar Scout</button>
                )}
                {balance.review_status === 'verify' && !metric && <small className="waterHint">Construí la serie NDMI SCL antes de planificar Scout.</small>}
              </div>
            );
          }) : <div className="waterEmpty"><Droplets /><b>Todavía no hay un saldo por lote</b><span>El cálculo usa Open‑Meteo, el riego declarado y, si existen, NDMI usable y humedad de suelo en %.</span></div>}
        </article>

        <div className="waterOps">
          {writable && (
            <form className="waterForm" onSubmit={submitIrrigation}>
              <div className="waterFormTitle"><Sprout /><div><h3>Declarar riego</h3><p>Queda como evidencia. No enciende una bomba ni estima una lámina futura.</p></div></div>
              <div className="waterFormGrid">
                <label>Lote
                  <select required value={form.parcelId} onChange={event => setForm({ ...form, parcelId: event.target.value })}>
                    {data.parcels.map(parcel => <option key={parcel.id} value={parcel.id}>{parcel.name}</option>)}
                  </select>
                </label>
                <label>Fecha
                  <input required type="date" max={todayIso()} value={form.appliedOn} onChange={event => setForm({ ...form, appliedOn: event.target.value })} />
                </label>
                <label>Lámina declarada (mm)
                  <input required type="number" min="0.01" max="500" step="0.01" value={form.depthMm} onChange={event => setForm({ ...form, depthMm: event.target.value })} />
                </label>
                <label>Método
                  <select value={form.method} onChange={event => setForm({ ...form, method: event.target.value as IrrigationMethod })}>
                    {(Object.keys(methodLabels) as IrrigationMethod[]).map(method => <option key={method} value={method}>{methodLabels[method]}</option>)}
                  </select>
                </label>
                <label className="wide">Notas
                  <input maxLength={500} value={form.notes} onChange={event => setForm({ ...form, notes: event.target.value })} placeholder="Opcional" />
                </label>
              </div>
              <button className="waterPrimary" disabled={record.isPending || !data.parcels.length}>{record.isPending ? <LoaderCircle className="spin" /> : <Droplets />}Registrar evento</button>
            </form>
          )}

          <article className="waterHistory">
            <div className="waterSectionTitle"><div><small>BITÁCORA</small><h3>Riego declarado</h3></div><span>{data.irrigationEvents.length}</span></div>
            {data.irrigationEvents.length ? data.irrigationEvents.map(event => {
              const parcel = data.parcels.find(item => item.id === event.parcel_id);
              const isReversal = Boolean(event.reversal_of);
              const alreadyReversed = reversedIds.has(event.id);
              return (
                <div key={event.id} className={`waterEvent ${isReversal || alreadyReversed ? 'reversed' : ''}`}>
                  <div>
                    <b>{parcel?.name ?? 'Lote'}</b>
                    <span>{new Date(`${event.applied_on}T00:00:00`).toLocaleDateString('es-AR')} · {methodLabels[event.method]}{isReversal ? ' · reversión' : alreadyReversed ? ' · revertido' : ''}</span>
                    {event.notes && <small>{event.notes}</small>}
                  </div>
                  <strong>{Number(event.depth_mm).toFixed(1)} mm</strong>
                  {reversing && !isReversal && !alreadyReversed && <button onClick={() => setReversal({ eventId: event.id, reason: '' })}><RotateCcw /></button>}
                </div>
              );
            }) : <div className="waterEmpty compact"><Droplets /><b>Sin riego declarado</b><span>Un lote de secano se informa como tal; no se inventa una aplicación.</span></div>}
            {reversal && (
              <form className="waterReversal" onSubmit={event => {
                event.preventDefault();
                reverse.mutate({ eventId: reversal.eventId, reason: reversal.reason }, { onSuccess: () => setReversal(null) });
              }}>
                <label>Motivo de reversión
                  <input required minLength={2} maxLength={300} value={reversal.reason} onChange={event => setReversal({ ...reversal, reason: event.target.value })} placeholder="Por qué se anula este evento" />
                </label>
                <button disabled={reverse.isPending}>{reverse.isPending ? <LoaderCircle className="spin" /> : <RotateCcw />}Confirmar</button>
                <button type="button" onClick={() => setReversal(null)}>Cancelar</button>
              </form>
            )}
          </article>
        </div>
      </div>

      <div className="waterBoundary">
        <ShieldAlert />
        <p><b>Límite agronómico:</b> el saldo es lluvia + riego declarado − ET0 de referencia FAO‑56. No es ETc, no usa Kc, no incluye escorrentía ni capacidad de campo y no prescribe una lámina. NDMI y humedad de suelo no diagnostican estrés. NODO no controla bombas ni afirma ahorro de agua.</p>
      </div>
    </section>
  );
}
