import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Camera, CheckCircle2, ClipboardCheck, CloudUpload, FileImage, Flag, Images, LoaderCircle, LocateFixed, MapPin, Navigation, Plus, Route, ShieldAlert, ShieldCheck, UserRound, Users, XCircle } from 'lucide-react';
import {
  useCreateScoutingVisit,
  useRecordScoutingFinding,
  useReassignScoutingVisit,
  useScoutingEvidenceUrls,
  useTransitionScoutingVisit,
  useUploadScoutingEvidence,
  type ScoutingFinding,
  type ScoutingFindingMedia,
  type ScoutingVisit,
  type SatelliteIndexName,
  type Workspace,
} from './lib/workspace';
import { OfflineVaultPanel } from './OfflineVaultPanel';
import { saveOfflineScoutingDraft, saveOfflineScoutingMedia, type OfflineScoutingFindingDraft } from './lib/offlineVault';
import './scout.css';

export type ScoutSeed={parcelId:string;metricId:string;indexName:SatelliteIndexName;meanValue:number};

const visitStatusLabels:Record<ScoutingVisit['status'],string>={planned:'Planificada',in_progress:'En curso',completed:'Completada',cancelled:'Cancelada'};
const priorityLabels:Record<ScoutingVisit['priority'],string>={low:'Baja',medium:'Media',high:'Alta',critical:'Crítica'};
const categoryLabels:Record<ScoutingFinding['category'],string>={crop_condition:'Condición del cultivo',pest_signal:'Señal de plaga',water:'Agua',soil:'Suelo',infrastructure:'Infraestructura',other:'Otro'};
const severityLabels:Record<ScoutingFinding['severity'],string>={info:'Informativa',low:'Baja',medium:'Media',high:'Alta',critical:'Crítica'};
const memberRoleLabels:Record<string,string>={owner:'Propietario',admin:'Administrador',agronomist:'Agrónomo',operator:'Operador'};
const canOperate=new Set(['owner','admin','agronomist','operator']);
const canSupervise=new Set(['owner','admin','agronomist']);

function localDateTime(offsetMinutes=0){const date=new Date(Date.now()+offsetMinutes*60_000);date.setMinutes(date.getMinutes()-date.getTimezoneOffset());return date.toISOString().slice(0,16)}
function errorMessage(error:unknown){return error instanceof Error?error.message:typeof error==='object'&&error&&'message' in error&&typeof error.message==='string'?error.message:'No se pudo completar la operación'}
function fileSize(bytes:number){return bytes<1024*1024?`${Math.ceil(bytes/1024)} KB`:`${(bytes/1024/1024).toFixed(1)} MB`}

function EvidenceGallery({media,urls,offline}:{media:ScoutingFindingMedia[];urls:Record<string,string>;offline:boolean}){
  if(!media.length)return null;
  return <div className="evidenceGallery">{media.map(item=>{
    const url=urls[item.id];
    return <article key={item.id}>
      {url?<a href={url} target="_blank" rel="noreferrer"><img src={url} alt={item.caption||'Evidencia fotográfica de campo'}/></a>:<div className="evidenceLoading">{offline?<FileImage/>:<LoaderCircle className="spin"/>}</div>}
      <div><b>{item.caption||item.original_filename}</b><span>{fileSize(item.size_bytes)} · {item.capture_source==='camera'?'cámara':'archivo'} · {new Date(item.captured_at).toLocaleString('es-AR')}</span><small>SHA‑256 {item.sha256.slice(0,12)}…</small></div>
    </article>;
  })}</div>;
}

export function ScoutPanel({data,seed,onSeedConsumed,offlineMode=false}:{data:Workspace;seed:ScoutSeed|null;onSeedConsumed:()=>void;offlineMode?:boolean}){
  const createVisit=useCreateScoutingVisit();
  const transitionVisit=useTransitionScoutingVisit();
  const reassignVisit=useReassignScoutingVisit();
  const recordFinding=useRecordScoutingFinding();
  const uploadEvidence=useUploadScoutingEvidence();
  const evidenceUrls=useScoutingEvidenceUrls(offlineMode?[]:data.scoutingFindingMedia);
  const supervisory=canSupervise.has(data.organization!.role);
  const defaultAssigneeId=data.scoutingAssignees.find(member=>member.user_id===data.organization!.userId)?.user_id??data.scoutingAssignees[0]?.user_id??data.organization!.userId;
  const assignableMembers=supervisory?data.scoutingAssignees:data.scoutingAssignees.filter(member=>member.user_id===data.organization!.userId);
  const [creating,setCreating]=useState(false);
  const [visitFilter,setVisitFilter]=useState<'all'|'mine'|'unassigned'>('all');
  const [closing,setClosing]=useState<{visitId:string;status:'completed'|'cancelled'}|null>(null);
  const [closingSummary,setClosingSummary]=useState('');
  const [findingVisit,setFindingVisit]=useState<string|null>(null);
  const [mediaFinding,setMediaFinding]=useState<string|null>(null);
  const [mediaSelection,setMediaSelection]=useState<{file:File;source:'camera'|'library'}|null>(null);
  const [mediaCaption,setMediaCaption]=useState('');
  const [mediaCapturedAt,setMediaCapturedAt]=useState(localDateTime());
  const [mediaValidation,setMediaValidation]=useState('');
  const [locationState,setLocationState]=useState<{latitude:number;longitude:number;accuracy:number}|null>(null);
  const [locationError,setLocationError]=useState('');
  const [locating,setLocating]=useState(false);
  const [browserOnline,setBrowserOnline]=useState(()=>navigator.onLine);
  const [savingOffline,setSavingOffline]=useState(false);
  const [savingOfflineMedia,setSavingOfflineMedia]=useState(false);
  const [mediaUploadProgress,setMediaUploadProgress]=useState(0);
  const [fieldError,setFieldError]=useState('');
  const [fieldNotice,setFieldNotice]=useState('');
  const [form,setForm]=useState({parcelId:data.parcels[0]?.id??'',sourceMetricId:'',title:'Recorrida de lote',objective:'',priority:'medium' as ScoutingVisit['priority'],scheduledFor:localDateTime(60),assigneeId:defaultAssigneeId});
  const [findingForm,setFindingForm]=useState({category:'crop_condition' as ScoutingFinding['category'],severity:'info' as ScoutingFinding['severity'],observedAt:localDateTime(),notes:''});
  const writable=canOperate.has(data.organization!.role);
  const connected=browserOnline&&!offlineMode;

  useEffect(()=>{
    if(!seed)return;
    const parcel=data.parcels.find(item=>item.id===seed.parcelId);
    setForm({parcelId:seed.parcelId,sourceMetricId:seed.metricId,title:`Verificar señal ${seed.indexName.toUpperCase()} · ${parcel?.name??'Lote'}`,objective:`Contrastar en campo la señal relativa ${seed.meanValue.toFixed(3)} de la escena satelital y registrar evidencia antes de decidir una intervención.`,priority:'high',scheduledFor:localDateTime(60),assigneeId:defaultAssigneeId});
    setCreating(true);
  },[data.parcels,defaultAssigneeId,seed]);

  useEffect(()=>{
    setLocationState(null);setLocationError('');setLocating(false);
    setFindingForm({category:'crop_condition',severity:'info',observedAt:localDateTime(),notes:''});
    setFieldError('');recordFinding.reset();
  },[findingVisit]);

  useEffect(()=>{const online=()=>setBrowserOnline(true);const offline=()=>setBrowserOnline(false);window.addEventListener('online',online);window.addEventListener('offline',offline);return()=>{window.removeEventListener('online',online);window.removeEventListener('offline',offline)}},[]);
  useEffect(()=>{if(offlineMode){setCreating(false);setClosing(null)}},[offlineMode]);

  useEffect(()=>{setMediaSelection(null);setMediaCaption('');setMediaCapturedAt(localDateTime());setMediaValidation('');setMediaUploadProgress(0);uploadEvidence.reset()},[mediaFinding]);

  const openVisits=data.scoutingVisits.filter(visit=>visit.status==='planned'||visit.status==='in_progress');
  const myOpenVisits=openVisits.filter(visit=>visit.assigned_to===data.organization!.userId);
  const overdue=openVisits.filter(visit=>new Date(visit.scheduled_for).getTime()<Date.now()).length;
  const criticalFindings=data.scoutingFindings.filter(finding=>(finding.severity==='high'||finding.severity==='critical')&&Date.now()-new Date(finding.observed_at).getTime()<30*86_400_000).length;
  const orderedVisits=useMemo(()=>data.scoutingVisits.filter(visit=>visitFilter==='all'||(visitFilter==='mine'&&visit.assigned_to===data.organization!.userId)||(visitFilter==='unassigned'&&!visit.assigned_to)).sort((a,b)=>{
    const stateOrder=(value:ScoutingVisit['status'])=>value==='in_progress'?0:value==='planned'?1:value==='completed'?2:3;
    return stateOrder(a.status)-stateOrder(b.status)||new Date(a.scheduled_for).getTime()-new Date(b.scheduled_for).getTime();
  }),[data.organization, data.scoutingVisits,visitFilter]);
  const mediaByFinding=useMemo(()=>data.scoutingFindingMedia.reduce<Record<string,ScoutingFindingMedia[]>>((groups,item)=>{
    (groups[item.finding_id]??=[]).push(item);return groups;
  },{}),[data.scoutingFindingMedia]);

  function closeCreate(){setCreating(false);if(seed)onSeedConsumed()}
  function startManual(){setForm({parcelId:data.parcels[0]?.id??'',sourceMetricId:'',title:'Recorrida de lote',objective:'',priority:'medium',scheduledFor:localDateTime(60),assigneeId:defaultAssigneeId});onSeedConsumed();setCreating(true)}
  function closeFinding(){setFindingVisit(null);setLocationState(null);setLocationError('');setFieldError('');setLocating(false)}
  function submitVisit(event:FormEvent){event.preventDefault();createVisit.mutate({establishmentId:data.establishment!.id,parcelId:form.parcelId,sourceMetricId:form.sourceMetricId||null,title:form.title,objective:form.objective,priority:form.priority,scheduledFor:new Date(form.scheduledFor).toISOString(),assignedUserId:form.assigneeId},{onSuccess:()=>{setCreating(false);onSeedConsumed()}})}
  function transition(visitId:string,status:ScoutingVisit['status'],summary=''){transitionVisit.mutate({visitId,nextStatus:status,summary},{onSuccess:()=>{setClosing(null);setClosingSummary('')}})}
  function requestLocation(){
    setLocationError('');
    if(!navigator.geolocation){setLocationError('Este dispositivo no ofrece geolocalización. Podés guardar el hallazgo sin punto.');return}
    setLocating(true);
    navigator.geolocation.getCurrentPosition(position=>{setLocationState({latitude:position.coords.latitude,longitude:position.coords.longitude,accuracy:position.coords.accuracy});setLocating(false)},error=>{setLocationError(error.code===1?'No autorizaste la ubicación. El hallazgo puede guardarse sin punto.':'No pudimos obtener una ubicación confiable.');setLocating(false)},{enableHighAccuracy:true,timeout:12_000,maximumAge:0});
  }
  function findingPayload(requestId=crypto.randomUUID()):OfflineScoutingFindingDraft{
    if(!findingVisit)throw new Error('Elegí una recorrida en curso');
    return{schemaVersion:1,requestId,visitId:findingVisit,category:findingForm.category,severity:findingForm.severity,observedAt:new Date(findingForm.observedAt).toISOString(),latitude:locationState?.latitude??null,longitude:locationState?.longitude??null,accuracyM:locationState?.accuracy??null,notes:findingForm.notes.trim(),savedAt:new Date().toISOString()};
  }
  async function saveFindingEncrypted(){
    setSavingOffline(true);setFieldError('');setFieldNotice('');
    try{
      await saveOfflineScoutingDraft({userId:data.organization!.userId,organizationId:data.organization!.id,establishmentId:data.establishment!.id},findingPayload());
      setFieldNotice('Hallazgo guardado cifrado en este dispositivo. Sincronizalo desde la bóveda al recuperar conexión.');closeFinding();
    }catch(cause){setFieldError(errorMessage(cause))}
    finally{setSavingOffline(false)}
  }
  function submitFinding(event:FormEvent){
    event.preventDefault();if(!findingVisit)return;
    if(!connected){void saveFindingEncrypted();return}
    const payload=findingPayload();
    recordFinding.mutate({visitId:payload.visitId,category:payload.category,severity:payload.severity,observedAt:payload.observedAt,latitude:payload.latitude,longitude:payload.longitude,accuracyM:payload.accuracyM,notes:payload.notes,requestId:payload.requestId},{onSuccess:()=>{setFieldNotice('Hallazgo sincronizado y persistido con trazabilidad.');closeFinding()}});
  }
  function chooseMedia(file:File|undefined,source:'camera'|'library'){
    if(!file)return;
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size<1||file.size>8*1024*1024){setMediaSelection(null);setMediaValidation('Usá una imagen JPEG, PNG o WebP de hasta 8 MB.');return}
    setMediaSelection({file,source});setMediaValidation('');uploadEvidence.reset();
  }
  async function saveMediaEncrypted(){
    if(!mediaFinding||!mediaSelection)return;setSavingOfflineMedia(true);setMediaValidation('');setFieldNotice('');
    try{await saveOfflineScoutingMedia({userId:data.organization!.userId,organizationId:data.organization!.id,establishmentId:data.establishment!.id},{file:mediaSelection.file,findingId:mediaFinding,findingRequestId:null,captureSource:mediaSelection.source,capturedAt:new Date(mediaCapturedAt).toISOString(),caption:mediaCaption});setFieldNotice('Foto cifrada en la bóveda. Sincronizala al recuperar conexión.');setMediaFinding(null)}
    catch(cause){setMediaValidation(errorMessage(cause))}finally{setSavingOfflineMedia(false)}
  }
  function submitMedia(event:FormEvent){
    event.preventDefault();
    if(!mediaFinding||!mediaSelection)return;
    if(!connected){void saveMediaEncrypted();return}
    setMediaUploadProgress(0);
    uploadEvidence.mutate({findingId:mediaFinding,file:mediaSelection.file,caption:mediaCaption,capturedAt:new Date(mediaCapturedAt).toISOString(),captureSource:mediaSelection.source,onProgress:setMediaUploadProgress},{onSuccess:()=>{setFieldNotice('Foto transferida por TUS, verificada y adjuntada al hallazgo.');setMediaFinding(null)}});
  }

  return <section className="scoutModule">
    <div className="moduleToolbar"><div><small>NODO SCOUT · VERIFICACIÓN EN CAMPO</small><h2>Recorridas</h2><p>{offlineMode?'Agenda cifrada preparada: sólo captura de hallazgos y fotos sobre recorridas ya iniciadas.':'Conecta señales, responsables, hallazgos georreferenciados y cierre auditable.'}</p></div><button disabled={offlineMode||!writable||data.parcels.length===0} onClick={()=>creating?closeCreate():startManual()}>{creating?<XCircle/>:<Plus/>}{offlineMode?'Agenda preparada':creating?'Cerrar carga':'Nueva recorrida'}</button></div>

    <div className="scoutKpis"><article><small>MIS ABIERTAS</small><strong>{myOpenVisits.length}</strong><span>{openVisits.length} abiertas en el equipo</span></article><article className={overdue?'risk':''}><small>VENCIDAS</small><strong>{overdue}</strong><span>Requieren reprogramación o inicio</span></article><article className={criticalFindings?'risk':''}><small>HALLAZGOS RELEVANTES · 30 D</small><strong>{criticalFindings}</strong><span>Severidad alta o crítica</span></article><article><small>EVIDENCIAS</small><strong>{data.scoutingFindings.length+data.scoutingFindingMedia.length}</strong><span>{data.scoutingFindings.length} observaciones · {data.scoutingFindingMedia.length} fotos</span></article></div>

    <OfflineVaultPanel scope={{userId:data.organization!.userId,organizationId:data.organization!.id,establishmentId:data.establishment!.id}} networkAvailable={connected} onSyncDraft={draft=>recordFinding.mutateAsync({visitId:draft.visitId,category:draft.category,severity:draft.severity,observedAt:draft.observedAt,latitude:draft.latitude,longitude:draft.longitude,accuracyM:draft.accuracyM,notes:draft.notes,requestId:draft.requestId})} onSyncMedia={(draft,file,onProgress,onUploadUrl)=>uploadEvidence.mutateAsync({findingId:draft.findingId!,file,caption:draft.caption,capturedAt:draft.capturedAt,captureSource:draft.captureSource,requestId:draft.requestId,sha256:draft.sha256,resumeUrl:draft.tusUploadUrl,onProgress,onUploadUrl})}/>
    {fieldNotice&&<p className="vaultNotice fieldNotice"><ShieldCheck/>{fieldNotice}</p>}

    <div className="scoutFilters" aria-label="Filtrar recorridas"><span><Users/>Agenda del equipo</span><button className={visitFilter==='all'?'active':''} onClick={()=>setVisitFilter('all')}>Todas · {data.scoutingVisits.length}</button><button className={visitFilter==='mine'?'active':''} onClick={()=>setVisitFilter('mine')}>Mías · {data.scoutingVisits.filter(visit=>visit.assigned_to===data.organization!.userId).length}</button><button className={visitFilter==='unassigned'?'active':''} onClick={()=>setVisitFilter('unassigned')}>Sin responsable · {data.scoutingVisits.filter(visit=>!visit.assigned_to).length}</button></div>

    {creating&&<form className="scoutForm" onSubmit={submitVisit}><div className="scoutFormTitle"><Route/><div><h3>Planificar recorrida</h3><p>{form.sourceMetricId?'Origen satelital enlazado y conservado como snapshot inmutable.':'Recorrida manual sobre un lote persistido.'}</p></div></div>{form.sourceMetricId&&<div className="sourceEvidence"><Flag/><span><b>Evidencia NODO Earth</b><small>{seed?.indexName.toUpperCase()??'Índice satelital'} · valor relativo {seed?.meanValue.toFixed(3)??'persistido'}</small></span></div>}<div className="scoutGrid"><label>Lote<select required value={form.parcelId} onChange={event=>setForm({...form,parcelId:event.target.value,sourceMetricId:event.target.value===seed?.parcelId?form.sourceMetricId:''})}>{data.parcels.map(parcel=><option key={parcel.id} value={parcel.id}>{parcel.name} · {parcel.area_hectares.toFixed(2)} ha</option>)}</select></label><label>Prioridad<select value={form.priority} onChange={event=>setForm({...form,priority:event.target.value as ScoutingVisit['priority']})}>{Object.entries(priorityLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>Responsable<select required value={form.assigneeId} onChange={event=>setForm({...form,assigneeId:event.target.value})}>{assignableMembers.map(member=><option key={member.user_id} value={member.user_id}>{member.display_name} · {memberRoleLabels[member.member_role]}</option>)}</select></label><label>Programada para<input required type="datetime-local" value={form.scheduledFor} onChange={event=>setForm({...form,scheduledFor:event.target.value})}/></label><label className="wide">Título<input required minLength={2} maxLength={160} value={form.title} onChange={event=>setForm({...form,title:event.target.value})}/></label><label className="wide">Objetivo<textarea maxLength={1500} value={form.objective} onChange={event=>setForm({...form,objective:event.target.value})}/></label></div>{createVisit.error&&<p className="scoutError"><ShieldAlert/>{errorMessage(createVisit.error)}</p>}<button className="scoutPrimary" disabled={createVisit.isPending||!form.assigneeId}>{createVisit.isPending?<LoaderCircle className="spin"/>:<ClipboardCheck/>}{createVisit.isPending?'Planificando…':'Guardar recorrida'}</button></form>}

    {findingVisit&&<form className="scoutForm findingForm" onSubmit={submitFinding}><div className="scoutFormTitle"><MapPin/><div><h3>Registrar hallazgo</h3><p>{connected?'Podés persistirlo ahora o conservar un borrador cifrado para trabajo de campo.':'Sin señal: NODO sólo permite guardarlo dentro de la bóveda cifrada desbloqueada.'}</p></div></div><div className="scoutGrid"><label>Categoría<select value={findingForm.category} onChange={event=>setFindingForm({...findingForm,category:event.target.value as ScoutingFinding['category']})}>{Object.entries(categoryLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>Severidad<select value={findingForm.severity} onChange={event=>setFindingForm({...findingForm,severity:event.target.value as ScoutingFinding['severity']})}>{Object.entries(severityLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>Observada el<input required type="datetime-local" value={findingForm.observedAt} onChange={event=>setFindingForm({...findingForm,observedAt:event.target.value})}/></label><label className="wide">Detalle<textarea required minLength={2} maxLength={2000} value={findingForm.notes} onChange={event=>setFindingForm({...findingForm,notes:event.target.value})}/></label></div><div className="geoCapture"><button type="button" disabled={locating} onClick={requestLocation}>{locating?<LoaderCircle className="spin"/>:<LocateFixed/>}{locating?'Obteniendo ubicación…':'Usar ubicación del dispositivo'}</button>{locationState?<span><b>Punto capturado</b>{locationState.latitude.toFixed(5)}, {locationState.longitude.toFixed(5)} · precisión ±{Math.round(locationState.accuracy)} m</span>:<span>Opcional. Si se omite, NODO lo declara sin punto en lugar de inventar coordenadas.</span>}</div>{locationError&&<p className="scoutNotice">{locationError}</p>}{fieldError&&<p className="scoutError"><ShieldAlert/>{fieldError}</p>}{recordFinding.error&&<p className="scoutError"><ShieldAlert/>{errorMessage(recordFinding.error)}</p>}<div className="scoutFormActions"><button type="button" onClick={closeFinding}>Cancelar</button>{connected&&<button className="vaultSaveButton" type="button" disabled={savingOffline||recordFinding.isPending} onClick={()=>void saveFindingEncrypted()}>{savingOffline?<LoaderCircle className="spin"/>:<ShieldCheck/>}Guardar cifrado</button>}<button className="scoutPrimary" disabled={recordFinding.isPending||savingOffline}>{recordFinding.isPending||savingOffline?<LoaderCircle className="spin"/>:connected?<MapPin/>:<ShieldCheck/>}{connected?'Guardar hallazgo':'Guardar cifrado'}</button></div></form>}

    {mediaFinding&&<form className="scoutForm mediaForm" onSubmit={submitMedia}><div className="scoutFormTitle"><Camera/><div><h3>Adjuntar evidencia privada</h3><p>{connected?'TUS retoma bloques aceptados si la red se corta; el servidor verifica la foto antes de adjuntarla.':'Sin señal, la foto sólo puede guardarse cifrada dentro de la bóveda desbloqueada.'}</p></div></div><div className="mediaPickerRow"><label><Camera/>Usar cámara<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={event=>chooseMedia(event.target.files?.[0],'camera')}/></label><label><Images/>Elegir archivo<input type="file" accept="image/jpeg,image/png,image/webp" onChange={event=>chooseMedia(event.target.files?.[0],'library')}/></label>{mediaSelection&&<span><FileImage/><b>{mediaSelection.file.name}</b><small>{fileSize(mediaSelection.file.size)} · {mediaSelection.file.type}</small></span>}</div>{mediaValidation&&<p className="scoutError"><ShieldAlert/>{mediaValidation}</p>}<div className="scoutGrid mediaFields"><label>Capturada el<input required type="datetime-local" value={mediaCapturedAt} onChange={event=>setMediaCapturedAt(event.target.value)}/></label><label className="wide">Descripción<textarea maxLength={500} value={mediaCaption} onChange={event=>setMediaCaption(event.target.value)} placeholder="Qué muestra la imagen y dónde se observó…"/></label></div><div className="privacyNote"><ShieldCheck/><span><b>Cifrado local · TUS reanudable · verificación server-side</b> IndexedDB conserva sólo ciphertext. Al sincronizar, NODO revalida asignación, firma binaria, tamaño y SHA‑256 antes de registrar evidencia.</span></div>{uploadEvidence.isPending&&<div className="mediaProgress"><i><b style={{width:`${mediaUploadProgress}%`}}/></i><span>{mediaUploadProgress}% transferido</span></div>}{uploadEvidence.error&&<p className="scoutError"><ShieldAlert/>{errorMessage(uploadEvidence.error)}</p>}<div className="scoutFormActions"><button type="button" onClick={()=>setMediaFinding(null)}>Cancelar</button>{connected&&<button className="vaultSaveButton" type="button" disabled={!mediaSelection||savingOfflineMedia||uploadEvidence.isPending} onClick={()=>void saveMediaEncrypted()}>{savingOfflineMedia?<LoaderCircle className="spin"/>:<ShieldCheck/>}Guardar cifrada</button>}<button className="scoutPrimary" disabled={!mediaSelection||uploadEvidence.isPending||savingOfflineMedia}>{uploadEvidence.isPending||savingOfflineMedia?<LoaderCircle className="spin"/>:connected?<CloudUpload/>:<ShieldCheck/>}{uploadEvidence.isPending?`Transfiriendo · ${mediaUploadProgress}%`:connected?'Subir evidencia':'Guardar cifrada'}</button></div></form>}

    {closing&&<form className="scoutClosing" onSubmit={event=>{event.preventDefault();transition(closing.visitId,closing.status,closingSummary)}}><div><h3>{closing.status==='completed'?'Completar recorrida':'Cancelar recorrida'}</h3><p>El resumen explica el resultado y queda en la bitácora.</p></div><textarea required minLength={2} maxLength={1500} value={closingSummary} onChange={event=>setClosingSummary(event.target.value)} placeholder="Resultado, decisión o motivo…"/><button type="button" onClick={()=>setClosing(null)}>Volver</button><button disabled={transitionVisit.isPending}>{transitionVisit.isPending?'Guardando…':'Confirmar'}</button></form>}
    {transitionVisit.error&&<p className="scoutError"><ShieldAlert/>{errorMessage(transitionVisit.error)}</p>}

    <div className="scoutList">{orderedVisits.length?orderedVisits.map(visit=>{
      const parcel=data.parcels.find(item=>item.id===visit.parcel_id);
      const findings=data.scoutingFindings.filter(item=>item.visit_id===visit.id);
      const mean=typeof visit.source_snapshot?.mean_value==='number'?visit.source_snapshot.mean_value:null;
      const overdueVisit=(visit.status==='planned'||visit.status==='in_progress')&&new Date(visit.scheduled_for).getTime()<Date.now();
      const assignee=data.scoutingAssignees.find(member=>member.user_id===visit.assigned_to);
      const canOperateVisit=supervisory||visit.assigned_to===data.organization!.userId;
      const open=visit.status==='planned'||visit.status==='in_progress';
      return <article key={visit.id} className={`scoutCard priority-${visit.priority} ${overdueVisit?'overdue':''}`}>
        <div className="scoutIdentity"><span className={`scoutStatus ${visit.status}`}>{visitStatusLabels[visit.status]}</span><small>{priorityLabels[visit.priority]}{overdueVisit?' · vencida':''}</small><h3>{visit.title}</h3><p>{parcel?.name??'Lote histórico'} · {new Date(visit.scheduled_for).toLocaleString('es-AR')}</p><div className="visitAssignee"><UserRound/><span><b>{assignee?.display_name??'Responsable no disponible'}</b><small>{assignee?memberRoleLabels[assignee.member_role]:'Registro histórico'}</small></span>{!offlineMode&&supervisory&&open&&<select aria-label={`Responsable de ${visit.title}`} value={visit.assigned_to??''} disabled={reassignVisit.isPending} onChange={event=>reassignVisit.mutate({visitId:visit.id,assignedUserId:event.target.value})}>{data.scoutingAssignees.map(member=><option key={member.user_id} value={member.user_id}>{member.display_name}</option>)}</select>}</div></div>
        <div className="scoutSource"><span><Flag/><b>{visit.source_type==='satellite_ndvi'?'NDVI':visit.source_type==='satellite_ndmi'?'NDMI':'Origen manual'}</b></span>{mean!==null&&<strong>{mean.toFixed(3)}</strong>}<small>{visit.objective||'Sin objetivo adicional'}</small></div>
        <div className="scoutActions">{!offlineMode&&canOperateVisit&&visit.status==='planned'&&<button disabled={transitionVisit.isPending} onClick={()=>transition(visit.id,'in_progress')}><Navigation/>Iniciar</button>}{canOperateVisit&&visit.status==='in_progress'&&<button onClick={()=>setFindingVisit(visit.id)}><MapPin/>Hallazgo</button>}{!offlineMode&&canOperateVisit&&visit.status==='in_progress'&&<button className="complete" onClick={()=>{setClosing({visitId:visit.id,status:'completed'});setClosingSummary('')}}><CheckCircle2/>Completar</button>}{!offlineMode&&canOperateVisit&&open&&<button className="cancel" onClick={()=>{setClosing({visitId:visit.id,status:'cancelled'});setClosingSummary('')}}><XCircle/>Cancelar</button>}{offlineMode&&visit.status==='planned'&&<span className="visitReadOnly"><ShieldCheck/>Debe iniciarse con conexión antes de salir</span>}{!canOperateVisit&&open&&<span className="visitReadOnly"><ShieldCheck/>Sólo el responsable o un supervisor puede intervenir</span>}</div>
        {findings.length>0&&<div className="findingList">{findings.map(finding=>{
          const media=mediaByFinding[finding.id]??[];
          return <div key={finding.id} className={`findingRecord severity-${finding.severity}`}><div className="findingDetail"><span><b>{categoryLabels[finding.category]}</b><small>{severityLabels[finding.severity]} · {new Date(finding.observed_at).toLocaleString('es-AR')}</small></span><p>{finding.notes}</p><div className="findingLinks">{finding.latitude!==null&&finding.longitude!==null&&<a href={`https://www.openstreetmap.org/?mlat=${finding.latitude}&mlon=${finding.longitude}#map=18/${finding.latitude}/${finding.longitude}`} target="_blank" rel="noreferrer"><MapPin/>Ver punto · ±{Math.round(finding.accuracy_m??0)} m</a>}{visit.status==='in_progress'&&writable&&canOperateVisit&&<button onClick={()=>setMediaFinding(finding.id)}><Camera/>Adjuntar foto</button>}</div></div><EvidenceGallery media={media} urls={evidenceUrls.data??{}} offline={offlineMode}/></div>;
        })}</div>}
        {visit.summary&&<div className="scoutSummary"><b>CIERRE</b><span>{visit.summary}</span></div>}
      </article>;
    }):<div className="scoutEmpty"><Route/><h3>No hay recorridas registradas</h3><p>Planificá una manual o creala desde una señal comparable de NODO Earth.</p></div>}</div>
    {reassignVisit.error&&<p className="scoutError"><ShieldAlert/>{errorMessage(reassignVisit.error)}</p>}
    {evidenceUrls.error&&<p className="scoutError"><ShieldAlert/>No se pudieron emitir enlaces temporales para algunas evidencias.</p>}
  </section>;
}
