import { useMemo, useState, type FormEvent } from 'react';
import { CheckCircle2, CircleDollarSign, GitBranch, Link2, LoaderCircle, ShieldAlert, ShieldCheck, Sparkles, Waypoints } from 'lucide-react';
import {
  useDeclareOutcomeResult,
  useLinkOutcomeCost,
  useLinkOutcomeLabor,
  useOpenOutcomeCycle,
  useReviewOutcomeCycle,
  type OutcomeCycle,
  type OutcomeLaborKind,
  type OutcomeResultCategory,
  type OutcomeSignalKind,
  type Workspace,
} from './lib/workspace';
import './outcome.css';

const signalLabels: Record<OutcomeSignalKind, string> = {
  satellite_metric: 'Métrica satelital',
  water_balance: 'Saldo hídrico',
  recommendation: 'Recomendación',
  scouting_visit: 'Recorrida',
  manual: 'Observación manual',
};
const laborLabels: Record<OutcomeLaborKind, string> = {
  scouting_visit: 'Recorrida',
  maintenance_work_order: 'Orden de flota',
  irrigation_event: 'Riego declarado',
};
const categoryLabels: Record<OutcomeResultCategory, string> = {
  avoided_loss: 'Pérdida evitada',
  input_saving: 'Ahorro de insumos',
  labor_saving: 'Ahorro de labor',
  maintenance_saving: 'Ahorro de mantenimiento',
  incremental_income: 'Ingreso incremental',
  other: 'Otro documentado',
};
const statusLabels: Record<OutcomeCycle['status'], string> = {
  open: 'Señal abierta',
  labor_linked: 'Labor enlazada',
  cost_linked: 'Costo enlazado',
  outcome_declared: 'Resultado declarado',
  internally_verified: 'Verificado interno',
  rejected: 'Rechazado',
};
const canOpen = new Set(['owner', 'admin', 'agronomist', 'operator']);
const canCost = new Set(['owner', 'admin', 'agronomist']);
const canReview = new Set(['owner', 'admin']);

function money(amount: number, currency: string) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
}

function CircuitTrack({ cycle }: { cycle: OutcomeCycle }) {
  const steps = [
    { key: 'signal', label: 'Señal', done: true },
    { key: 'labor', label: 'Labor', done: Boolean(cycle.labor_kind) || ['labor_linked', 'cost_linked', 'outcome_declared', 'internally_verified', 'rejected'].includes(cycle.status) },
    { key: 'cost', label: 'Costo', done: Boolean(cycle.financial_entry_id) },
    { key: 'result', label: 'Resultado', done: Boolean(cycle.result_category) },
    { key: 'review', label: 'Revisión', done: cycle.status === 'internally_verified' || cycle.status === 'rejected' },
  ];
  return (
    <ol className="outcomeCircuit" aria-label="Circuito del ciclo">
      {steps.map((step, index) => (
        <li key={step.key} className={step.done ? 'done' : ''}>
          <b>{String(index + 1).padStart(2, '0')}</b>
          <span>{step.label}</span>
        </li>
      ))}
    </ol>
  );
}

export function OutcomePanel({ data }: { data: Workspace }) {
  const role = data.organization!.role;
  const establishment = data.establishment!;
  const openCycle = useOpenOutcomeCycle();
  const linkLabor = useLinkOutcomeLabor();
  const linkCost = useLinkOutcomeCost();
  const declareResult = useDeclareOutcomeResult();
  const review = useReviewOutcomeCycle();
  const [selectedId, setSelectedId] = useState<string | null>(data.outcomeCycles[0]?.id ?? null);
  const [signalKind, setSignalKind] = useState<OutcomeSignalKind>('recommendation');
  const [signalRef, setSignalRef] = useState('');
  const [title, setTitle] = useState('');
  const [manualNotes, setManualNotes] = useState('');
  const [laborKind, setLaborKind] = useState<OutcomeLaborKind>('scouting_visit');
  const [laborRef, setLaborRef] = useState('');
  const [entryId, setEntryId] = useState('');
  const [category, setCategory] = useState<OutcomeResultCategory>('avoided_loss');
  const [methodNote, setMethodNote] = useState('');
  const [reviewNote, setReviewNote] = useState('');

  const selected = data.outcomeCycles.find(cycle => cycle.id === selectedId) ?? data.outcomeCycles[0] ?? null;
  const events = useMemo(
    () => (selected ? data.outcomeCycleEvents.filter(event => event.cycle_id === selected.id) : []),
    [data.outcomeCycleEvents, selected],
  );
  const summary = data.outcomeLedgerSummary;
  const reversed = useMemo(() => new Set(data.financialEntries.map(entry => entry.reversal_of).filter(Boolean)), [data.financialEntries]);
  const linkableEntries = data.financialEntries.filter(entry => !entry.reversal_of && !reversed.has(entry.id));
  const signalOptions = useMemo(() => {
    if (signalKind === 'recommendation') return data.recommendations.map(item => ({ id: item.id, label: item.title }));
    if (signalKind === 'satellite_metric') {
      return data.satelliteMetrics.slice(0, 40).map(item => {
        const parcel = data.parcels.find(row => row.id === item.parcel_id);
        return { id: item.id, label: `${parcel?.name ?? 'Lote'} · ${item.index_name.toUpperCase()} ${item.mean_value.toFixed(3)}` };
      });
    }
    if (signalKind === 'water_balance') {
      return data.parcelWaterBalances.map(item => {
        const parcel = data.parcels.find(row => row.id === item.parcel_id);
        return { id: item.id, label: `${parcel?.name ?? 'Lote'} · saldo ${item.reference_balance_mm.toFixed(0)} mm` };
      });
    }
    if (signalKind === 'scouting_visit') {
      return data.scoutingVisits.map(item => {
        const parcel = data.parcels.find(row => row.id === item.parcel_id);
        return { id: item.id, label: `${item.title} · ${parcel?.name ?? 'Lote'}` };
      });
    }
    return [];
  }, [signalKind, data.recommendations, data.satelliteMetrics, data.parcelWaterBalances, data.scoutingVisits, data.parcels]);

  const laborOptions = useMemo(() => {
    if (laborKind === 'scouting_visit') return data.scoutingVisits.map(item => ({ id: item.id, label: item.title }));
    if (laborKind === 'maintenance_work_order') return data.maintenanceWorkOrders.map(item => ({ id: item.id, label: item.title }));
    return data.irrigationEvents.filter(item => !item.reversal_of).map(item => {
      const parcel = data.parcels.find(row => row.id === item.parcel_id);
      return { id: item.id, label: `${parcel?.name ?? 'Lote'} · ${item.depth_mm} mm` };
    });
  }, [laborKind, data.scoutingVisits, data.maintenanceWorkOrders, data.irrigationEvents, data.parcels]);

  async function submitOpen(event: FormEvent) {
    event.preventDefault();
    const id = await openCycle.mutateAsync({
      establishmentId: establishment.id,
      title: title.trim() || (signalKind === 'manual' ? 'Ciclo manual' : signalOptions.find(item => item.id === signalRef)?.label ?? 'Ciclo de resultado'),
      signalKind,
      signalRef: signalKind === 'manual' ? null : signalRef,
      manualNotes: signalKind === 'manual' ? manualNotes : null,
    });
    setSelectedId(id);
    setTitle('');
    setManualNotes('');
  }

  return (
    <section className="outcomeModule">
      <div className="moduleToolbar outcomeToolbar">
        <div>
          <small>NODO OUTCOME LEDGER</small>
          <h2>El circuito que nadie más cierra</h2>
          <p>Señal → labor → costo del libro → resultado revisado por otra identidad. Sin montos inventados ni ROI publicitario.</p>
        </div>
        <div className="outcomeHeroStat">
          <Waypoints />
          <div>
            <b>{summary?.internally_verified_cycles ?? 0}</b>
            <span>ciclos verificados · {money(Number(summary?.internally_verified_amount ?? 0), establishment.base_currency)}</span>
          </div>
        </div>
      </div>

      <div className="outcomeStats">
        <article><GitBranch /><div><small>CICLOS</small><b>{data.outcomeCycles.length}</b><span>historial longitudinal</span></div></article>
        <article><Link2 /><div><small>ACTIVOS</small><b>{summary?.open_or_active_cycles ?? 0}</b><span>sin rechazar</span></div></article>
        <article><CircleDollarSign /><div><small>VERIFICADO INTERNO</small><b>{money(Number(summary?.internally_verified_amount ?? 0), establishment.base_currency)}</b><span>solo desde asientos reales</span></div></article>
        <article><ShieldCheck /><div><small>REGLA</small><b>2 identidades</b><span>quien abre no puede auto-verificar</span></div></article>
      </div>

      <div className="outcomeLayout">
        <article className="outcomeOpenCard">
          <div className="earthSectionTitle"><div><small>ABRIR CICLO</small><h3>Congelar una señal</h3></div><Sparkles /></div>
          {canOpen.has(role) ? (
            <form className="outcomeForm" onSubmit={submitOpen}>
              <label>Tipo de señal
                <select value={signalKind} onChange={event => { setSignalKind(event.target.value as OutcomeSignalKind); setSignalRef(''); }}>
                  {Object.entries(signalLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              {signalKind !== 'manual' ? (
                <label>Evidencia
                  <select required value={signalRef} onChange={event => setSignalRef(event.target.value)}>
                    <option value="">Elegí una evidencia persistida…</option>
                    {signalOptions.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                  </select>
                </label>
              ) : (
                <label>Notas (mín. 20)
                  <textarea required minLength={20} maxLength={800} value={manualNotes} onChange={event => setManualNotes(event.target.value)} placeholder="Qué se observó y por qué abre un ciclo…" />
                </label>
              )}
              <label>Título del ciclo
                <input maxLength={180} value={title} onChange={event => setTitle(event.target.value)} placeholder="Ej.: Verificar Lote Bajo tras NDVI bajo" />
              </label>
              <button disabled={openCycle.isPending || (signalKind !== 'manual' && !signalRef)}>
                {openCycle.isPending ? <LoaderCircle className="spin" /> : <GitBranch />}Abrir ciclo
              </button>
              {openCycle.error && <p className="outcomeError"><ShieldAlert />{openCycle.error instanceof Error ? openCycle.error.message : 'No se pudo abrir'}</p>}
            </form>
          ) : <p className="outcomeHint">Tu rol sólo puede consultar el ledger.</p>}
          <p className="outcomeHint">El snapshot de la señal se congela en servidor. El monto sólo aparece cuando enlazás un asiento del libro.</p>
        </article>

        <article className="outcomeListCard">
          <div className="earthSectionTitle"><div><small>HISTORIAL</small><h3>Ciclos del establecimiento</h3></div><em>{data.outcomeCycles.length}</em></div>
          {data.outcomeCycles.length ? (
            <div className="outcomeList">
              {data.outcomeCycles.map(cycle => (
                <button key={cycle.id} type="button" className={selected?.id === cycle.id ? 'active' : ''} onClick={() => setSelectedId(cycle.id)}>
                  <span className={`outcomeStatus ${cycle.status}`}>{statusLabels[cycle.status]}</span>
                  <b>{cycle.title}</b>
                  <small>{signalLabels[cycle.signal_kind]} · {new Date(cycle.created_at).toLocaleString('es-AR')}</small>
                  {cycle.result_amount != null && cycle.result_currency && <strong>{money(Number(cycle.result_amount), cycle.result_currency)}</strong>}
                </button>
              ))}
            </div>
          ) : (
            <div className="earthEmpty compact"><GitBranch /><b>Todavía no hay ciclos</b><span>Abrí el primero desde una recomendación, métrica, saldo hídrico o recorrida real.</span></div>
          )}
        </article>
      </div>

      {selected && (
        <article className="outcomeDetail">
          <div className="outcomeDetailHead">
            <div>
              <small>CICLO ACTIVO</small>
              <h3>{selected.title}</h3>
              <p>{signalLabels[selected.signal_kind]} · {statusLabels[selected.status]}</p>
            </div>
            <span className={`outcomeStatus ${selected.status}`}>{statusLabels[selected.status]}</span>
          </div>
          <CircuitTrack cycle={selected} />

          <div className="outcomeDetailGrid">
            <div>
              <h4>Señal congelada</h4>
              <pre>{JSON.stringify(selected.signal_snapshot, null, 2)}</pre>
            </div>
            <div>
              <h4>Enlaces</h4>
              <ul>
                <li>Labor: {selected.labor_kind ? laborLabels[selected.labor_kind] : 'Pendiente'}</li>
                <li>Asiento: {selected.financial_entry_id ? selected.financial_entry_id.slice(0, 8) : 'Pendiente'}</li>
                <li>Resultado: {selected.result_category ? categoryLabels[selected.result_category] : 'Pendiente'}</li>
                <li>Monto: {selected.result_amount != null && selected.result_currency ? money(Number(selected.result_amount), selected.result_currency) : 'Sólo desde el libro'}</li>
              </ul>
              {(selected.limitations ?? []).map(item => <p key={item} className="outcomeLimit"><ShieldAlert />{item}</p>)}
            </div>
          </div>

          {canOpen.has(role) && (selected.status === 'open' || selected.status === 'labor_linked') && !selected.labor_kind && (
            <form className="outcomeForm inline" onSubmit={event => {
              event.preventDefault();
              void linkLabor.mutateAsync({ cycleId: selected.id, laborKind, laborRef });
            }}>
              <label>Labor
                <select value={laborKind} onChange={event => { setLaborKind(event.target.value as OutcomeLaborKind); setLaborRef(''); }}>
                  {Object.entries(laborLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label>Referencia
                <select required value={laborRef} onChange={event => setLaborRef(event.target.value)}>
                  <option value="">Elegí…</option>
                  {laborOptions.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </label>
              <button disabled={linkLabor.isPending || !laborRef}>{linkLabor.isPending ? <LoaderCircle className="spin" /> : <Link2 />}Enlazar labor</button>
            </form>
          )}

          {canCost.has(role) && ['open', 'labor_linked', 'cost_linked'].includes(selected.status) && !['outcome_declared', 'internally_verified', 'rejected'].includes(selected.status) && (
            <form className="outcomeForm inline" onSubmit={event => {
              event.preventDefault();
              void linkCost.mutateAsync({ cycleId: selected.id, entryId });
            }}>
              <label>Asiento del libro
                <select required value={entryId} onChange={event => setEntryId(event.target.value)}>
                  <option value="">Elegí un movimiento real…</option>
                  {linkableEntries.map(entry => (
                    <option key={entry.id} value={entry.id}>
                      {entry.description} · {money(entry.amount, entry.currency)}
                    </option>
                  ))}
                </select>
              </label>
              <button disabled={linkCost.isPending || !entryId}>{linkCost.isPending ? <LoaderCircle className="spin" /> : <CircleDollarSign />}Enlazar costo</button>
            </form>
          )}

          {canCost.has(role) && selected.status === 'cost_linked' && (
            <form className="outcomeForm inline" onSubmit={event => {
              event.preventDefault();
              void declareResult.mutateAsync({ cycleId: selected.id, category, methodNote });
            }}>
              <label>Categoría
                <select value={category} onChange={event => setCategory(event.target.value as OutcomeResultCategory)}>
                  {Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label>Método de cálculo (mín. 20)
                <textarea required minLength={20} maxLength={1500} value={methodNote} onChange={event => setMethodNote(event.target.value)} placeholder="Cómo el asiento enlazado demuestra el resultado, sin extrapolar…" />
              </label>
              <button disabled={declareResult.isPending}>{declareResult.isPending ? <LoaderCircle className="spin" /> : <CheckCircle2 />}Declarar resultado</button>
            </form>
          )}

          {canReview.has(role) && selected.status === 'outcome_declared' && selected.opened_by !== data.organization!.userId && (
            <form className="outcomeForm inline" onSubmit={event => {
              event.preventDefault();
              void review.mutateAsync({ cycleId: selected.id, accepted: true, reviewNote });
            }}>
              <label>Nota de revisión
                <textarea required minLength={5} maxLength={1000} value={reviewNote} onChange={event => setReviewNote(event.target.value)} placeholder="Por qué aceptás o rechazás la verificación interna…" />
              </label>
              <div className="outcomeReviewActions">
                <button type="submit" disabled={review.isPending}>{review.isPending ? <LoaderCircle className="spin" /> : <ShieldCheck />}Verificar interno</button>
                <button type="button" className="ghost" disabled={review.isPending} onClick={() => void review.mutateAsync({ cycleId: selected.id, accepted: false, reviewNote })}>Rechazar</button>
              </div>
            </form>
          )}

          {selected.status === 'outcome_declared' && selected.opened_by === data.organization!.userId && (
            <p className="outcomeHint">Esperá a otra identidad owner/admin para la verificación interna.</p>
          )}

          <div className="outcomeEvents">
            <h4>Bitácora</h4>
            {events.length ? events.map(event => (
              <div key={event.id}>
                <b>{event.action}</b>
                <span>{event.previous_status ?? '—'} → {event.next_status}</span>
                <small>{new Date(event.created_at).toLocaleString('es-AR')}</small>
              </div>
            )) : <p className="outcomeHint">Sin eventos todavía.</p>}
          </div>
        </article>
      )}

      <div className="earthBoundary"><ShieldAlert /><p><b>Límite comercial:</b> `internally_verified` es control interno de dos identidades. No es ROI externo, causalidad científica ni aprobación contable. Los montos salen únicamente de `financial_entries` enlazados.</p></div>
    </section>
  );
}
