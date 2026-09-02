import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react';
import { Activity, Beef, Bot, CloudRain, Database, Droplets, Gauge, HardDrive, KeyRound, Leaf, LoaderCircle, LogOut, Map, Pencil, Radio, RefreshCw, Satellite, ScanSearch, ShieldAlert, ShieldCheck, Target, Tractor, TrendingUp, Users, Wifi, WifiOff } from 'lucide-react';
import { AuthGate } from './auth/AuthGate';
import { Onboarding } from './Onboarding';
import { forgetOfflineIdentity, supabase } from './lib/supabase';
import { parseGeoJsonPolygon } from './lib/geojson';
import { loadOfflineFieldPackage, lockOfflineVault, offlineFieldPackageToWorkspace, saveOfflineFieldPackage, unlockOfflineVault, type OfflineFieldPackageMeta } from './lib/offlineVault';
import { useOfflineVault } from './lib/useOfflineVault';
import { useAgroWeather } from './lib/weather';
import { deviceConnectionState, useRecommendationAction, useSyncIntelligence, useWorkspace, type Recommendation, type Workspace } from './lib/workspace';
import type { ScoutSeed } from './ScoutPanel';

const sections = [[Gauge,'Centro de mando'],[Map,'Mapa vivo'],[Leaf,'Cultivos'],[Droplets,'Agua'],[ScanSearch,'Recorridas'],[Beef,'Rodeo'],[Tractor,'Maquinaria'],[Radio,'Sensores'],[TrendingUp,'Economía'],[Target,'Piloto'],[Users,'Equipo']] as const;
const SatelliteFarmMap = lazy(() => import('./SatelliteMap').then(module => ({ default:module.SatelliteFarmMap })));
const ParcelEditor = lazy(() => import('./ParcelEditor').then(module => ({ default:module.ParcelEditor })));
const SensorsPanel = lazy(() => import('./SensorsPanel').then(module => ({ default:module.SensorsPanel })));
const LivestockPanel = lazy(() => import('./OperationsPanels').then(module => ({ default:module.LivestockPanel })));
const MachineryPanel = lazy(() => import('./OperationsPanels').then(module => ({ default:module.MachineryPanel })));
const EconomyPanel = lazy(() => import('./OperationsPanels').then(module => ({ default:module.EconomyPanel })));
const IntelligenceBrief = lazy(() => import('./IntelligenceBrief').then(module => ({ default:module.IntelligenceBrief })));
const SatelliteIntelligencePanel = lazy(() => import('./SatelliteIntelligence').then(module => ({ default:module.SatelliteIntelligencePanel })));
const ScoutPanel = lazy(() => import('./ScoutPanel').then(module => ({ default:module.ScoutPanel })));
const WaterPanel = lazy(() => import('./WaterPanel').then(module => ({ default:module.WaterPanel })));
const TeamPanel = lazy(() => import('./TeamPanel').then(module => ({ default:module.TeamPanel })));
const PilotControl = lazy(() => import('./PilotControl').then(module => ({ default:module.PilotControl })));

function useConnectivity(){const [online,setOnline]=useState(()=>navigator.onLine);useEffect(()=>{const connected=()=>setOnline(true);const disconnected=()=>setOnline(false);window.addEventListener('online',connected);window.addEventListener('offline',disconnected);return()=>{window.removeEventListener('online',connected);window.removeEventListener('offline',disconnected)}},[]);return online}

type RecoveredWorkspace={workspace:Workspace;meta:OfflineFieldPackageMeta};

function WorkspaceShell({userId,sessionBacked}:{userId:string;sessionBacked:boolean}) {
  const [selectedOrganizationId,setSelectedOrganizationId]=useState(()=>localStorage.getItem('nodo-selected-organization'));
  const workspace = useWorkspace(selectedOrganizationId);
  const vault=useOfflineVault(userId);
  const online=useConnectivity();
  const [recovered,setRecovered]=useState<RecoveredWorkspace|null>(null);
  const [fieldPackageMeta,setFieldPackageMeta]=useState<OfflineFieldPackageMeta|null>(null);
  const [fieldPackageError,setFieldPackageError]=useState('');
  useEffect(()=>{
    const activeId=workspace.data?.organization?.id;
    if(activeId&&activeId!==selectedOrganizationId){setSelectedOrganizationId(activeId);localStorage.setItem('nodo-selected-organization',activeId)}
  },[selectedOrganizationId,workspace.data?.organization?.id]);
  useEffect(()=>{if(vault.status==='unconfigured'){setFieldPackageMeta(null);setFieldPackageError('')}},[vault.status]);
  useEffect(()=>{
    const data=workspace.data;if(!online||vault.status!=='unlocked'||!data?.organization||!data.establishment||data.organization.userId!==userId||data.organization.role==='viewer')return;
    let cancelled=false;setFieldPackageError('');
    void saveOfflineFieldPackage({userId,organizationId:data.organization.id,establishmentId:data.establishment.id},data).then(meta=>{if(!cancelled)setFieldPackageMeta(meta)}).catch(cause=>{if(!cancelled)setFieldPackageError(cause instanceof Error?cause.message:'No se pudo preparar el paquete de campo')});
    return()=>{cancelled=true};
  },[online,userId,vault.status,workspace.data]);
  useEffect(()=>{if(!online||!recovered||!sessionBacked)return;let cancelled=false;void workspace.refetch().then(result=>{if(!cancelled&&result.data&&!result.error)setRecovered(null)});return()=>{cancelled=true}},[online,recovered,sessionBacked,workspace.refetch]);
  const data=workspace.data??recovered?.workspace;
  const contingencyMode=!online||!sessionBacked||Boolean(recovered)||Boolean(workspace.error);
  if(data?.organization&&data.establishment)return <Dashboard data={data} offlineMode={contingencyMode} offlineMeta={recovered?.meta??(!online?fieldPackageMeta:null)} fieldPackageMeta={fieldPackageMeta} fieldPackageError={fieldPackageError} onOrganizationChange={id=>{setSelectedOrganizationId(id);localStorage.setItem('nodo-selected-organization',id)}}/>;
  if(!online||workspace.error||!sessionBacked)return <OfflineWorkspaceRecovery userId={userId} selectedOrganizationId={selectedOrganizationId} vault={vault} cause={workspace.error} onLoaded={setRecovered} onRetry={()=>void workspace.refetch()}/>;
  if (workspace.isLoading) return <div className="authLoading"><LoaderCircle className="spin"/><span>Cargando operación real…</span></div>;
  if (!workspace.data?.organization || !workspace.data.establishment) return <Onboarding/>;
  return null;
}

function OfflineWorkspaceRecovery({userId,selectedOrganizationId,vault,cause,onLoaded,onRetry}:{userId:string;selectedOrganizationId:string|null;vault:ReturnType<typeof useOfflineVault>;cause:unknown;onLoaded:(value:RecoveredWorkspace)=>void;onRetry:()=>void}){
  const [passphrase,setPassphrase]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  async function openPackage(event?:FormEvent){event?.preventDefault();setBusy(true);setError('');try{if(vault.status==='locked')await unlockOfflineVault(userId,passphrase);const field=await loadOfflineFieldPackage(userId,selectedOrganizationId);onLoaded({workspace:offlineFieldPackageToWorkspace(field),meta:{preparedAt:field.preparedAt,expiresAt:field.expiresAt,visitCount:field.scoutingVisits.length,findingCount:field.scoutingFindings.length,mediaCount:field.scoutingFindingMedia.length}});setPassphrase('')}catch(reason){setError(reason instanceof Error?reason.message:'No se pudo abrir el paquete cifrado')}finally{setBusy(false)}}
  if(vault.status==='checking')return <div className="authLoading"><LoaderCircle className="spin"/><span>Buscando trabajo de campo cifrado…</span></div>;
  const unavailable=vault.status==='unsupported'||vault.status==='unconfigured';
  return <div className="offlineRecovery"><section><div className="offlineRecoveryMark">{unavailable?<ShieldAlert/>:<HardDrive/>}</div><small>NODO FIELD · CONTINGENCIA CIFRADA</small><h1>{unavailable?'Este dispositivo no está preparado':'Abrí tu paquete de campo'}</h1><p>{unavailable?'Conectate, ingresá a NODO, activá la bóveda y abrí Recorridas antes de salir del establecimiento.':'La red o la sesión remota no están disponibles. Tu frase local permite abrir únicamente el paquete mínimo preparado en este dispositivo.'}</p>{Boolean(cause)&&<div className="offlineRecoveryCause">Servicio remoto no disponible. No se mostrarán datos incompletos como actuales.</div>}{vault.status==='locked'&&<form onSubmit={openPackage}><label>Frase de protección<input type="password" autoComplete="off" required minLength={10} value={passphrase} onChange={event=>setPassphrase(event.target.value)} placeholder="Frase de la bóveda"/></label><button disabled={busy}>{busy?<LoaderCircle className="spin"/>:<KeyRound/>}Desbloquear y abrir</button></form>}{vault.status==='unlocked'&&<button className="offlineOpen" disabled={busy} onClick={()=>void openPackage()}>{busy?<LoaderCircle className="spin"/>:<ShieldCheck/>}Abrir paquete cifrado</button>}{error&&<div className="offlineRecoveryError"><ShieldAlert/>{error}</div>}<div className="offlineRecoveryActions"><button onClick={onRetry} disabled={!navigator.onLine}>Reintentar conexión</button><button onClick={()=>{forgetOfflineIdentity();lockOfflineVault('session_changed');window.location.reload()}}>Olvidar acceso offline</button></div></section></div>;
}

function Dashboard({data,onOrganizationChange,offlineMode=false,offlineMeta,fieldPackageMeta,fieldPackageError}: {data: Workspace;onOrganizationChange:(id:string)=>void;offlineMode?:boolean;offlineMeta:OfflineFieldPackageMeta|null;fieldPackageMeta:OfflineFieldPackageMeta|null;fieldPackageError:string}) {
  const [active,setActive]=useState<(typeof sections)[number][1]>(offlineMode?'Recorridas':'Centro de mando');
  const [scoutSeed,setScoutSeed]=useState<ScoutSeed|null>(null);
  const establishment = data.establishment!;
  const liveWeather = useAgroWeather(establishment.latitude, establishment.longitude,!offlineMode);
  const sync = useSyncIntelligence();
  const recommendationAction = useRecommendationAction();
  const online = data.devices.filter(device=>deviceConnectionState(device)==='online').length;
  const staleDevices = data.devices.filter(device=>deviceConnectionState(device)!=='online').length;
  const evidenceScore = Math.round((Number(Boolean(data.weather))+Number(Boolean(data.satellite))+Number(data.devices.length>0)+Number(data.parcels.length>0))*25);
  const sourceWeather = data.weather ?? (liveWeather.data ? { observed_at:new Date().toISOString(), temperature_c:liveWeather.data.temperature, humidity_pct:liveWeather.data.humidity, precipitation_mm:liveWeather.data.precipitationNow, wind_kmh:liveWeather.data.wind, forecast_rain_7d_mm:liveWeather.data.rain7d, source:liveWeather.data.source } : null);
  const managesTeam=data.organization!.role==='owner'||data.organization!.role==='admin';
  const visibleSections=offlineMode?sections.filter(([,name])=>name==='Recorridas'):managesTeam?sections:sections.filter(([,name])=>name!=='Equipo');
  useEffect(()=>{if(active==='Equipo'&&!managesTeam)setActive('Centro de mando')},[active,managesTeam]);
  useEffect(()=>{if(offlineMode&&active!=='Recorridas')setActive('Recorridas')},[active,offlineMode]);

  return <div className="app"><aside>
    <div className="logo"><span><Activity/></span><div><b>NODO</b><small>AGRO INTELLIGENCE</small></div></div>
    <div className="farm"><small>ESTABLECIMIENTO</small><b>{establishment.name}</b><span>{establishment.area_hectares?.toLocaleString('es-AR') ?? '—'} ha</span>{data.organizations.length>1?<select aria-label="Empresa activa" value={data.organization!.id} onChange={event=>onOrganizationChange(event.target.value)}>{data.organizations.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>:<em>{data.organization!.name}</em>}</div>
    <nav>{visibleSections.map(([Icon,name])=><button aria-label={name} className={active===name?'active':''} onClick={()=>setActive(name)} key={name}><Icon/><span>{name}</span></button>)}</nav>
    <div className="network">{offlineMode?<WifiOff/>:<Wifi/>}<div><b>{offlineMode?'NODO Field · Contingencia':online?'Red NODO · Conectada':'Red NODO · Sin telemetría'}</b><small>{offlineMode?'Sólo paquete cifrado de Scout':`${online} en línea · ${data.devices.length} dispositivos`}</small></div></div>
    <button className="logout" onClick={()=>{forgetOfflineIdentity();lockOfflineVault('session_changed');void supabase?.auth.signOut({scope:'local'})}}><LogOut/> Cerrar sesión</button>
  </aside><main>
    <header><div><p>{new Intl.DateTimeFormat('es-AR',{weekday:'long',day:'numeric',month:'long'}).format(new Date()).toUpperCase()} · {offlineMode?'PAQUETE DE CAMPO CIFRADO':'DATOS TRAZABLES'}</p><h1>{active}</h1><span>{establishment.latitude.toFixed(4)}, {establishment.longitude.toFixed(4)} · Rol {data.organization!.role}</span></div>{!offlineMode&&<div className="actions"><button className="syncButton" disabled={sync.isPending} onClick={()=>sync.mutate(establishment.id)}>{sync.isPending?<LoaderCircle className="spin"/>:<RefreshCw/>} Sincronizar fuentes</button></div>}</header>
    <ConnectivityBanner forcedOffline={offlineMode} meta={offlineMeta}/>
    {fieldPackageError&&<div className="sourceError"><ShieldAlert/>No se pudo actualizar el paquete de campo: {fieldPackageError}</div>}
    {!offlineMode&&fieldPackageMeta&&<div className="fieldPackageReady"><ShieldCheck/>Paquete de campo preparado hasta {new Date(fieldPackageMeta.expiresAt).toLocaleString('es-AR')} · {fieldPackageMeta.visitCount} recorridas abiertas</div>}
    {!offlineMode&&sync.error&&<div className="sourceError"><ShieldAlert/>La sincronización falló: {sync.error instanceof Error?sync.error.message:'error no identificado'}. Los últimos datos válidos permanecen visibles.</div>}
    {!offlineMode&&sync.isSuccess&&<div className="sourceSuccess"><Database/>Fuentes actualizadas y persistidas con trazabilidad.</div>}
    {active==='Centro de mando'?<Overview data={data} weather={sourceWeather} evidenceScore={evidenceScore} staleDevices={staleDevices} onDecision={(id,status)=>recommendationAction.mutate({id,status})}/>:active==='Mapa vivo'?<MapPanel data={data} onPlanScout={seed=>{setScoutSeed(seed);setActive('Recorridas')}}/>:active==='Cultivos'?<CultivosPanel data={data}/>:active==='Agua'?<Suspense fallback={<div className="mapLoading"><LoaderCircle className="spin"/>Cargando saldo hídrico…</div>}><WaterPanel data={data} onPlanScout={seed=>{setScoutSeed(seed);setActive('Recorridas')}}/></Suspense>:active==='Recorridas'?<Suspense fallback={<div className="mapLoading"><LoaderCircle className="spin"/>Cargando recorridas…</div>}><ScoutPanel data={data} seed={scoutSeed} onSeedConsumed={()=>setScoutSeed(null)} offlineMode={offlineMode}/></Suspense>:active==='Sensores'?<Suspense fallback={<div className="mapLoading"><LoaderCircle className="spin"/>Cargando red de sensores…</div>}><SensorsPanel data={data}/></Suspense>:active==='Rodeo'?<Suspense fallback={<div className="mapLoading"><LoaderCircle className="spin"/>Cargando trazabilidad del rodeo…</div>}><LivestockPanel data={data}/></Suspense>:active==='Maquinaria'?<Suspense fallback={<div className="mapLoading"><LoaderCircle className="spin"/>Cargando activos y mantenimiento…</div>}><MachineryPanel data={data}/></Suspense>:active==='Piloto'?<Suspense fallback={<div className="mapLoading"><LoaderCircle className="spin"/>Cargando evidencia del piloto…</div>}><PilotControl data={data}/></Suspense>:active==='Equipo'?<Suspense fallback={<div className="mapLoading"><LoaderCircle className="spin"/>Cargando gestión de acceso…</div>}><TeamPanel organization={data.organization!}/></Suspense>:<Suspense fallback={<div className="mapLoading"><LoaderCircle className="spin"/>Cargando libro operativo…</div>}><EconomyPanel data={data}/></Suspense>}
  </main></div>;
}

function ConnectivityBanner({forcedOffline=false,meta}:{forcedOffline?:boolean;meta:OfflineFieldPackageMeta|null}){
  const online=useConnectivity();
  if(online&&!forcedOffline)return null;
  return <div className="offlineBanner"><WifiOff/><div><b>Modo contingencia · NODO Field Offline</b><span>{meta?`Paquete preparado ${new Date(meta.preparedAt).toLocaleString('es-AR')} y válido hasta ${new Date(meta.expiresAt).toLocaleString('es-AR')}. `:''}Sólo Scout y la bóveda están habilitados; hallazgos y fotos quedan cifrados hasta recuperar el servidor.</span></div></div>;
}

type WeatherValue={observed_at:string;temperature_c:number;humidity_pct:number;precipitation_mm:number;wind_kmh:number;forecast_rain_7d_mm:number;source:string};

function Overview({data,weather,evidenceScore,staleDevices,onDecision}:{data:Workspace;weather:WeatherValue|null;evidenceScore:number;staleDevices:number;onDecision:(id:string,status:'accepted'|'dismissed')=>void}){
  const establishment=data.establishment!;
  const sceneAge=data.satellite?Math.floor((Date.now()-new Date(data.satellite.captured_at).getTime())/86_400_000):null;
  return <>
    <section className="hero"><article className="twin"><div className="title"><div><small>GEMELO DIGITAL · GEOREFERENCIADO</small><h2>{establishment.name}</h2></div><span>{data.satellite?`Sentinel-2 · hace ${sceneAge} días · ${data.satelliteScenes.length} escenas`:'Satélite aún no sincronizado'}</span></div><Suspense fallback={<div className="realMap"><LoaderCircle className="spin"/><p>Cargando imagen satelital…</p></div>}><SatelliteFarmMap position={{latitude:establishment.latitude,longitude:establishment.longitude}} name={establishment.name} parcels={data.parcels}/></Suspense><div className="mapEvidence"><span>{data.parcels.length?`${data.parcels.length} unidades productivas registradas · ${data.parcels.filter(parcel=>parseGeoJsonPolygon(parcel.boundary_geojson)).length} delimitadas`:'Registrá lotes para construir el gemelo parcelario'}</span>{data.satellite?.catalog_url&&<a href={data.satellite.catalog_url} target="_blank" rel="noreferrer">Abrir escena Sentinel‑2 fechada</a>}</div></article>
      <article className="score"><small>COBERTURA DE EVIDENCIA</small><div><strong>{evidenceScore}</strong><span>/100</span></div><h3>{evidenceScore>=75?'Base operativa conectada':evidenceScore>=50?'Integración en progreso':'Faltan fuentes críticas'}</h3><p>Mide fuentes conectadas, no rendimiento productivo. Evita presentar estimaciones como hechos.</p><i><b style={{width:`${evidenceScore}%`}}/></i>{[['Lotes',String(data.parcels.length)],['Sensores',String(data.devices.length)],['Alertas vencidas',String(staleDevices)]].map(x=><dl key={x[0]}><dt>{x[0]}</dt><dd>{x[1]}</dd></dl>)}</article></section>
    <section className="signals"><Metric icon={CloudRain} label="Lluvia 7 días" value={weather?`${weather.forecast_rain_7d_mm.toFixed(1)} mm`:'—'} detail={weather?.source??'Sin fuente'}/><Metric icon={Activity} label="Temperatura" value={weather?`${weather.temperature_c.toFixed(1)} °C`:'—'} detail={weather?`Humedad ${weather.humidity_pct.toFixed(0)}%`:'Sin observación'}/><Metric icon={Droplets} label="Saldo de referencia" value={data.parcelWaterBalances[0]?`${data.parcelWaterBalances[0].reference_balance_mm>=0?'+':''}${data.parcelWaterBalances[0].reference_balance_mm.toFixed(0)} mm`:'—'} detail={data.parcelWaterBalances[0]?`ET0 ${data.parcelWaterBalances[0].et0_mm.toFixed(0)} mm · ${data.parcelWaterBalances.filter(item=>item.review_status==='verify').length} a verificar`:'Sin saldo hídrico'}/><Metric icon={Satellite} label="Escena satelital" value={sceneAge===null?'—':`${sceneAge} d`} detail={data.satellite?`${data.satelliteScenes.length} fechas · nubes ${data.satellite.cloud_cover_pct?.toFixed(0)??'—'}%`:'Sin escena'}/><Metric icon={Radio} label="Dispositivos" value={String(data.devices.length)} detail={`${data.devices.filter(device=>deviceConnectionState(device)==='online').length} en línea`}/><Metric icon={Beef} label="Rodeo activo" value={String(data.operationalSummary?.livestock_heads??0)} detail={`${data.operationalSummary?.active_livestock_groups??0} grupos trazados`}/><Metric icon={Tractor} label="Maquinaria" value={String(data.operationalSummary?.active_machines??0)} detail={`${data.operationalSummary?.maintenance_due??0} services · ${data.operationalSummary?.open_work_orders??0} OT abiertas`}/><Metric icon={TrendingUp} label="Flujo del mes" value={new Intl.NumberFormat('es-AR',{style:'currency',currency:data.establishment!.base_currency,maximumFractionDigits:0,notation:'compact'}).format(Number(data.operationalSummary?.month_income??0)-Number(data.operationalSummary?.month_expense??0))} detail={`Base ${data.establishment!.base_currency} · no es resultado contable`}/></section>
    <Suspense fallback={<div className="mapLoading"><LoaderCircle className="spin"/>Preparando inteligencia transversal…</div>}><IntelligenceBrief data={data}/></Suspense>
    <section className="lower"><article className="panel"><div className="title"><div><h2>Decisiones con evidencia</h2><p>Reglas agronómicas transparentes; requieren aprobación humana</p></div><em>{data.recommendations.length} abiertas</em></div>{data.recommendations.length?data.recommendations.map(item=><Decision key={item.id} item={item} onDecision={onDecision}/>):<EmptyRow text="No hay alertas activas para las fuentes actuales."/>}</article>
      <article className="panel"><div className="title"><div><h2>Unidades productivas</h2><p>Inventario persistido del establecimiento</p></div></div>{data.parcels.length?data.parcels.map(parcel=><div className="lot" key={parcel.id}><i/><div><h3>{parcel.name}</h3><p>{parcel.crop??parcel.use} · {parcel.area_hectares} ha</p></div><span><b style={{width:`${parcel.health_score??0}%`}}/></span><strong>{parcel.health_score??'—'}</strong></div>):<EmptyRow text="Aún no hay lotes registrados."/>}</article></section>
    <section className="insight"><span><Bot/></span><div><small>PRINCIPIO NODO</small><h2>Decidir con evidencia, no con una cifra decorativa</h2><p>Cada recomendación conserva fuente, momento, confianza y estado. NODO nunca ejecuta una intervención sin aprobación humana.</p></div></section>
  </>;
}

function Metric({icon:Icon,label,value,detail}:{icon:typeof Activity;label:string;value:string;detail:string}){return <article><span><Icon/></span><div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div></article>}
function EmptyRow({text}:{text:string}){return <div className="emptyRow"><Database/><p>{text}</p></div>}
function Decision({item,onDecision}:{item:Recommendation;onDecision:(id:string,status:'accepted'|'dismissed')=>void}){return <div className="decision real"><span className={`priority ${item.priority}`}>{item.priority}</span><div><small>{item.confidence}% CONFIANZA · {item.valid_until?`VÁLIDA HASTA ${new Date(item.valid_until).toLocaleString('es-AR')}`:'SIN VENCIMIENTO'}</small><h3>{item.title}</h3><p>{item.rationale}</p><b>{item.action}</b></div><div className="decisionActions"><button onClick={()=>onDecision(item.id,'accepted')}>Aceptar</button><button onClick={()=>onDecision(item.id,'dismissed')}>Descartar</button></div></div>}

function CultivosPanel({data}:{data:Workspace}){
  const [editor,setEditor]=useState<string|null>(data.parcels.length===0?'new':null);
  const establishment=data.establishment!;
  const selectedParcel=editor&&editor!=='new'?data.parcels.find(parcel=>parcel.id===editor):undefined;
  return <section className="cultivosModule"><div className="moduleToolbar"><div><small>GESTIÓN PARCELARIA</small><h2>Lotes y cultivos</h2><p>{data.parcels.length?`${data.parcels.length} lotes delimitados y persistidos.`:'Dibujá el primer lote sobre la imagen satelital.'}</p></div><button onClick={()=>setEditor(editor?null:'new')}>{editor?'Ver inventario':'Agregar lote'}</button></div>{editor?<Suspense fallback={<div className="mapLoading"><LoaderCircle className="spin"/>Cargando editor parcelario…</div>}><ParcelEditor key={editor} organizationId={data.organization!.id} establishmentId={establishment.id} center={{latitude:establishment.latitude,longitude:establishment.longitude}} parcel={selectedParcel} onClose={()=>setEditor(null)}/></Suspense>:<article className="panel">{data.parcels.map(parcel=><div className="lot detailed" key={parcel.id}><i/><div><h3>{parcel.name}</h3><p>{parcel.crop??parcel.use}</p></div><span>{parseGeoJsonPolygon(parcel.boundary_geojson)?'Polígono validado':'Sin límite válido'}</span><strong>{parcel.area_hectares.toFixed(2)} ha</strong><button className="editParcel" onClick={()=>setEditor(parcel.id)}><Pencil/> Editar límite</button></div>)}</article>}</section>;
}

function MapPanel({data,onPlanScout}:{data:Workspace;onPlanScout:(seed:ScoutSeed)=>void}){
  return <Suspense fallback={<div className="mapLoading"><LoaderCircle className="spin"/>Cargando NODO Earth…</div>}><SatelliteIntelligencePanel data={data} onPlanScout={onPlanScout}/></Suspense>;
}

export function App(){ return <AuthGate>{identity=><WorkspaceShell {...identity}/>}</AuthGate> }
