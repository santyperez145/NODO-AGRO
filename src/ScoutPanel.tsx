import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CalendarClock, CheckCircle2, ClipboardCheck, Flag, LoaderCircle, LocateFixed, MapPin, Navigation, Plus, Route, ShieldAlert, XCircle } from 'lucide-react';
import { useCreateScoutingVisit, useRecordScoutingFinding, useTransitionScoutingVisit, type ScoutingFinding, type ScoutingVisit, type SatelliteIndexName, type Workspace } from './lib/workspace';
import './scout.css';

export type ScoutSeed={parcelId:string;metricId:string;indexName:SatelliteIndexName;meanValue:number};

const visitStatusLabels:Record<ScoutingVisit['status'],string>={planned:'Planificada',in_progress:'En curso',completed:'Completada',cancelled:'Cancelada'};
const priorityLabels:Record<ScoutingVisit['priority'],string>={low:'Baja',medium:'Media',high:'Alta',critical:'Crítica'};
const categoryLabels:Record<ScoutingFinding['category'],string>={crop_condition:'Condición del cultivo',pest_signal:'Señal de plaga',water:'Agua',soil:'Suelo',infrastructure:'Infraestructura',other:'Otro'};
const severityLabels:Record<ScoutingFinding['severity'],string>={info:'Informativa',low:'Baja',medium:'Media',high:'Alta',critical:'Crítica'};
const canOperate=new Set(['owner','admin','agronomist','operator']);

function localDateTime(offsetMinutes=0){const date=new Date(Date.now()+offsetMinutes*60_000);date.setMinutes(date.getMinutes()-date.getTimezoneOffset());return date.toISOString().slice(0,16)}
function errorMessage(error:unknown){return error instanceof Error?error.message:'No se pudo completar la operación'}

export function ScoutPanel({data,seed,onSeedConsumed}:{data:Workspace;seed:ScoutSeed|null;onSeedConsumed:()=>void}){
  const createVisit=useCreateScoutingVisit();
  const transitionVisit=useTransitionScoutingVisit();
  const recordFinding=useRecordScoutingFinding();
  const [creating,setCreating]=useState(false);
  const [closing,setClosing]=useState<{visitId:string;status:'completed'|'cancelled'}|null>(null);
  const [closingSummary,setClosingSummary]=useState('');
  const [findingVisit,setFindingVisit]=useState<string|null>(null);
  const [locationState,setLocationState]=useState<{latitude:number;longitude:number;accuracy:number}|null>(null);
  const [locationError,setLocationError]=useState('');
  const [locating,setLocating]=useState(false);
  const [form,setForm]=useState({parcelId:data.parcels[0]?.id??'',sourceMetricId:'',title:'Recorrida de lote',objective:'',priority:'medium' as ScoutingVisit['priority'],scheduledFor:localDateTime(60)});
  const [findingForm,setFindingForm]=useState({category:'crop_condition' as ScoutingFinding['category'],severity:'info' as ScoutingFinding['severity'],observedAt:localDateTime(),notes:''});
  const writable=canOperate.has(data.organization!.role);

  useEffect(()=>{
    if(!seed)return;
    const parcel=data.parcels.find(item=>item.id===seed.parcelId);
    setForm({parcelId:seed.parcelId,sourceMetricId:seed.metricId,title:`Verificar señal ${seed.indexName.toUpperCase()} · ${parcel?.name??'Lote'}`,objective:`Contrastar en campo la señal relativa ${seed.meanValue.toFixed(3)} de la escena satelital y registrar evidencia antes de decidir una intervención.`,priority:'high',scheduledFor:localDateTime(60)});
    setCreating(true);
  },[data.parcels,seed]);

  useEffect(()=>{
    setLocationState(null);
    setLocationError('');
    setLocating(false);
    setFindingForm({category:'crop_condition',severity:'info',observedAt:localDateTime(),notes:''});
  },[findingVisit]);

  const openVisits=data.scoutingVisits.filter(visit=>visit.status==='planned'||visit.status==='in_progress');
  const overdue=openVisits.filter(visit=>new Date(visit.scheduled_for).getTime()<Date.now()).length;
  const criticalFindings=data.scoutingFindings.filter(finding=>(finding.severity==='high'||finding.severity==='critical')&&Date.now()-new Date(finding.observed_at).getTime()<30*86_400_000).length;
  const orderedVisits=useMemo(()=>[...data.scoutingVisits].sort((a,b)=>{
    const stateOrder=(value:ScoutingVisit['status'])=>value==='in_progress'?0:value==='planned'?1:value==='completed'?2:3;
    return stateOrder(a.status)-stateOrder(b.status)||new Date(a.scheduled_for).getTime()-new Date(b.scheduled_for).getTime();
  }),[data.scoutingVisits]);

  function closeCreate(){setCreating(false);if(seed)onSeedConsumed()}
  function startManual(){setForm({parcelId:data.parcels[0]?.id??'',sourceMetricId:'',title:'Recorrida de lote',objective:'',priority:'medium',scheduledFor:localDateTime(60)});onSeedConsumed();setCreating(true)}
  function closeFinding(){setFindingVisit(null);setLocationState(null);setLocationError('');setLocating(false)}
  function submitVisit(event:FormEvent){event.preventDefault();createVisit.mutate({establishmentId:data.establishment!.id,parcelId:form.parcelId,sourceMetricId:form.sourceMetricId||null,title:form.title,objective:form.objective,priority:form.priority,scheduledFor:new Date(form.scheduledFor).toISOString()},{onSuccess:()=>{setCreating(false);onSeedConsumed()}})}
  function transition(visitId:string,status:ScoutingVisit['status'],summary=''){transitionVisit.mutate({visitId,nextStatus:status,summary},{onSuccess:()=>{setClosing(null);setClosingSummary('')}})}
  function requestLocation(){
    setLocationError('');
    if(!navigator.geolocation){setLocationError('Este dispositivo no ofrece geolocalización. Podés guardar el hallazgo sin punto.');return}
    setLocating(true);
    navigator.geolocation.getCurrentPosition(position=>{setLocationState({latitude:position.coords.latitude,longitude:position.coords.longitude,accuracy:position.coords.accuracy});setLocating(false)},error=>{setLocationError(error.code===1?'No autorizaste la ubicación. El hallazgo puede guardarse sin punto.':'No pudimos obtener una ubicación confiable.');setLocating(false)},{enableHighAccuracy:true,timeout:12_000,maximumAge:0});
  }
  function submitFinding(event:FormEvent){event.preventDefault();if(!findingVisit)return;recordFinding.mutate({visitId:findingVisit,category:findingForm.category,severity:findingForm.severity,observedAt:new Date(findingForm.observedAt).toISOString(),latitude:locationState?.latitude??null,longitude:locationState?.longitude??null,accuracyM:locationState?.accuracy??null,notes:findingForm.notes},{onSuccess:closeFinding})}

  return <section className="scoutModule">
    <div className="moduleToolbar"><div><small>NODO SCOUT · VERIFICACIÓN EN CAMPO</small><h2>Recorridas</h2><p>Conecta señales, responsables, hallazgos georreferenciados y cierre auditable.</p></div><button disabled={!writable||data.parcels.length===0} onClick={()=>creating?closeCreate():startManual()}><Plus/>{creating?'Cerrar carga':'Nueva recorrida'}</button></div>

    <div className="scoutKpis"><article><small>ABIERTAS</small><strong>{openVisits.length}</strong><span>Planificadas o en curso</span></article><article className={overdue?'risk':''}><small>VENCIDAS</small><strong>{overdue}</strong><span>Requieren reprogramación o inicio</span></article><article className={criticalFindings?'risk':''}><small>HALLAZGOS RELEVANTES · 30 D</small><strong>{criticalFindings}</strong><span>Severidad alta o crítica</span></article><article><small>EVIDENCIAS</small><strong>{data.scoutingFindings.length}</strong><span>Observaciones append-only</span></article></div>

    {creating&&<form className="scoutForm" onSubmit={submitVisit}><div className="scoutFormTitle"><Route/><div><h3>Planificar recorrida</h3><p>{form.sourceMetricId?'Origen satelital enlazado y conservado como snapshot inmutable.':'Recorrida manual sobre un lote persistido.'}</p></div></div>{form.sourceMetricId&&<div className="sourceEvidence"><Flag/><span><b>Evidencia NODO Earth</b><small>{seed?.indexName.toUpperCase()??'Índice satelital'} · valor relativo {seed?.meanValue.toFixed(3)??'persistido'}</small></span></div>}<div className="scoutGrid"><label>Lote<select required value={form.parcelId} onChange={event=>setForm({...form,parcelId:event.target.value,sourceMetricId:event.target.value===seed?.parcelId?form.sourceMetricId:''})}>{data.parcels.map(parcel=><option key={parcel.id} value={parcel.id}>{parcel.name} · {parcel.area_hectares.toFixed(2)} ha</option>)}</select></label><label>Prioridad<select value={form.priority} onChange={event=>setForm({...form,priority:event.target.value as ScoutingVisit['priority']})}>{Object.entries(priorityLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>Programada para<input required type="datetime-local" value={form.scheduledFor} onChange={event=>setForm({...form,scheduledFor:event.target.value})}/></label><label className="wide">Título<input required minLength={2} maxLength={160} value={form.title} onChange={event=>setForm({...form,title:event.target.value})}/></label><label className="wide">Objetivo<textarea maxLength={1500} value={form.objective} onChange={event=>setForm({...form,objective:event.target.value})}/></label></div>{createVisit.error&&<p className="scoutError"><ShieldAlert/>{errorMessage(createVisit.error)}</p>}<button className="scoutPrimary" disabled={createVisit.isPending}>{createVisit.isPending?<LoaderCircle className="spin"/>:<ClipboardCheck/>}{createVisit.isPending?'Planificando…':'Guardar recorrida'}</button></form>}

    {findingVisit&&<form className="scoutForm findingForm" onSubmit={submitFinding}><div className="scoutFormTitle"><MapPin/><div><h3>Registrar hallazgo</h3><p>La observación queda inmutable y enlazada a la recorrida en curso.</p></div></div><div className="scoutGrid"><label>Categoría<select value={findingForm.category} onChange={event=>setFindingForm({...findingForm,category:event.target.value as ScoutingFinding['category']})}>{Object.entries(categoryLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>Severidad<select value={findingForm.severity} onChange={event=>setFindingForm({...findingForm,severity:event.target.value as ScoutingFinding['severity']})}>{Object.entries(severityLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>Observada el<input required type="datetime-local" value={findingForm.observedAt} onChange={event=>setFindingForm({...findingForm,observedAt:event.target.value})}/></label><label className="wide">Detalle<textarea required minLength={2} maxLength={2000} value={findingForm.notes} onChange={event=>setFindingForm({...findingForm,notes:event.target.value})}/></label></div><div className="geoCapture"><button type="button" disabled={locating} onClick={requestLocation}>{locating?<LoaderCircle className="spin"/>:<LocateFixed/>}{locating?'Obteniendo ubicación…':'Usar ubicación del dispositivo'}</button>{locationState?<span><b>Punto capturado</b>{locationState.latitude.toFixed(5)}, {locationState.longitude.toFixed(5)} · precisión ±{Math.round(locationState.accuracy)} m</span>:<span>Opcional. Si se omite, NODO lo declara sin punto en lugar de inventar coordenadas.</span>}</div>{locationError&&<p className="scoutNotice">{locationError}</p>}{recordFinding.error&&<p className="scoutError"><ShieldAlert/>{errorMessage(recordFinding.error)}</p>}<div className="scoutFormActions"><button type="button" onClick={()=>setFindingVisit(null)}>Cancelar</button><button className="scoutPrimary" disabled={recordFinding.isPending}>{recordFinding.isPending?<LoaderCircle className="spin"/>:<MapPin/>}Guardar hallazgo</button></div></form>}

    {closing&&<form className="scoutClosing" onSubmit={event=>{event.preventDefault();transition(closing.visitId,closing.status,closingSummary)}}><div><h3>{closing.status==='completed'?'Completar recorrida':'Cancelar recorrida'}</h3><p>El resumen explica el resultado y queda en la bitácora.</p></div><textarea required minLength={2} maxLength={1500} value={closingSummary} onChange={event=>setClosingSummary(event.target.value)} placeholder="Resultado, decisión o motivo…"/><button type="button" onClick={()=>setClosing(null)}>Volver</button><button disabled={transitionVisit.isPending}>{transitionVisit.isPending?'Guardando…':'Confirmar'}</button></form>}
    {transitionVisit.error&&<p className="scoutError"><ShieldAlert/>{errorMessage(transitionVisit.error)}</p>}

    <div className="scoutList">{orderedVisits.length?orderedVisits.map(visit=>{const parcel=data.parcels.find(item=>item.id===visit.parcel_id);const findings=data.scoutingFindings.filter(item=>item.visit_id===visit.id);const mean=typeof visit.source_snapshot?.mean_value==='number'?visit.source_snapshot.mean_value:null;const overdueVisit=(visit.status==='planned'||visit.status==='in_progress')&&new Date(visit.scheduled_for).getTime()<Date.now();return <article key={visit.id} className={`scoutCard priority-${visit.priority} ${overdueVisit?'overdue':''}`}><div className="scoutIdentity"><span className={`scoutStatus ${visit.status}`}>{visitStatusLabels[visit.status]}</span><small>{priorityLabels[visit.priority]}{overdueVisit?' · vencida':''}</small><h3>{visit.title}</h3><p>{parcel?.name??'Lote histórico'} · {new Date(visit.scheduled_for).toLocaleString('es-AR')}</p></div><div className="scoutSource"><span><Flag/><b>{visit.source_type==='satellite_ndvi'?'NDVI':visit.source_type==='satellite_ndmi'?'NDMI':'Origen manual'}</b></span>{mean!==null&&<strong>{mean.toFixed(3)}</strong>}<small>{visit.objective||'Sin objetivo adicional'}</small></div><div className="scoutActions">{visit.status==='planned'&&<button disabled={transitionVisit.isPending} onClick={()=>transition(visit.id,'in_progress')}><Navigation/>Iniciar</button>}{visit.status==='in_progress'&&<button onClick={()=>setFindingVisit(visit.id)}><MapPin/>Hallazgo</button>}{visit.status==='in_progress'&&<button className="complete" onClick={()=>{setClosing({visitId:visit.id,status:'completed'});setClosingSummary('')}}><CheckCircle2/>Completar</button>}{(visit.status==='planned'||visit.status==='in_progress')&&<button className="cancel" onClick={()=>{setClosing({visitId:visit.id,status:'cancelled'});setClosingSummary('')}}><XCircle/>Cancelar</button>}</div>{findings.length>0&&<div className="findingList">{findings.map(finding=><div key={finding.id} className={`severity-${finding.severity}`}><span><b>{categoryLabels[finding.category]}</b><small>{severityLabels[finding.severity]} · {new Date(finding.observed_at).toLocaleString('es-AR')}</small></span><p>{finding.notes}</p>{finding.latitude!==null&&finding.longitude!==null&&<a href={`https://www.openstreetmap.org/?mlat=${finding.latitude}&mlon=${finding.longitude}#map=18/${finding.latitude}/${finding.longitude}`} target="_blank" rel="noreferrer"><MapPin/>Ver punto · ±{Math.round(finding.accuracy_m??0)} m</a>}</div>)}</div>}{visit.summary&&<div className="scoutSummary"><b>CIERRE</b><span>{visit.summary}</span></div>}</article>}):<div className="scoutEmpty"><Route/><h3>No hay recorridas registradas</h3><p>Planificá una manual o creala desde una señal comparable de NODO Earth.</p></div>}</div>
  </section>;
}
