import { useState } from 'react';
import { Activity, Beef, Bot, CloudRain, Database, Gauge, Leaf, LoaderCircle, LogOut, Map, Radio, RefreshCw, Satellite, ShieldAlert, Tractor, TrendingUp, Wifi } from 'lucide-react';
import { AuthGate } from './auth/AuthGate';
import { Onboarding } from './Onboarding';
import { supabase } from './lib/supabase';
import { useAgroWeather } from './lib/weather';
import { useRecommendationAction, useSyncIntelligence, useWorkspace, type Recommendation, type Workspace } from './lib/workspace';

const sections = [[Gauge,'Centro de mando'],[Map,'Mapa vivo'],[Leaf,'Cultivos'],[Beef,'Rodeo'],[Tractor,'Maquinaria'],[Radio,'Sensores'],[TrendingUp,'Economía']] as const;

function WorkspaceShell() {
  const workspace = useWorkspace();
  if (workspace.isLoading) return <div className="authLoading"><LoaderCircle className="spin"/><span>Cargando operación real…</span></div>;
  if (workspace.error) return <div className="fatalState"><ShieldAlert/><h1>No pudimos cargar tu operación</h1><p>{workspace.error instanceof Error?workspace.error.message:'Error inesperado'}</p><button onClick={()=>workspace.refetch()}>Reintentar</button></div>;
  if (!workspace.data?.organization || !workspace.data.establishment) return <Onboarding/>;
  return <Dashboard data={workspace.data}/>;
}

function Dashboard({data}: {data: Workspace}) {
  const [active,setActive]=useState<(typeof sections)[number][1]>('Centro de mando');
  const establishment = data.establishment!;
  const liveWeather = useAgroWeather(establishment.latitude, establishment.longitude);
  const sync = useSyncIntelligence();
  const recommendationAction = useRecommendationAction();
  const online = data.devices.filter(device=>device.status==='online').length;
  const staleDevices = data.devices.filter(device=>!device.last_seen_at || Date.now()-new Date(device.last_seen_at).getTime()>3_600_000).length;
  const evidenceScore = Math.round((Number(Boolean(data.weather))+Number(Boolean(data.satellite))+Number(data.devices.length>0)+Number(data.parcels.length>0))*25);
  const sourceWeather = data.weather ?? (liveWeather.data ? { observed_at:new Date().toISOString(), temperature_c:liveWeather.data.temperature, humidity_pct:liveWeather.data.humidity, precipitation_mm:liveWeather.data.precipitationNow, wind_kmh:liveWeather.data.wind, forecast_rain_7d_mm:liveWeather.data.rain7d, source:liveWeather.data.source } : null);

  return <div className="app"><aside>
    <div className="logo"><span><Activity/></span><div><b>NODO</b><small>AGRO INTELLIGENCE</small></div></div>
    <div className="farm"><small>ESTABLECIMIENTO</small><b>{establishment.name}</b><span>{establishment.area_hectares?.toLocaleString('es-AR') ?? '—'} ha · {data.organization!.name}</span></div>
    <nav>{sections.map(([Icon,name])=><button className={active===name?'active':''} onClick={()=>setActive(name)} key={name}><Icon/><span>{name}</span></button>)}</nav>
    <div className="network"><Wifi/><div><b>{online?'Red NODO · Conectada':'Red NODO · Sin telemetría'}</b><small>{online} en línea · {data.devices.length} dispositivos</small></div></div>
    <button className="logout" onClick={()=>void supabase?.auth.signOut()}><LogOut/> Cerrar sesión</button>
  </aside><main>
    <header><div><p>{new Intl.DateTimeFormat('es-AR',{weekday:'long',day:'numeric',month:'long'}).format(new Date()).toUpperCase()} · DATOS TRAZABLES</p><h1>{active}</h1><span>{establishment.latitude.toFixed(4)}, {establishment.longitude.toFixed(4)} · Rol {data.organization!.role}</span></div><div className="actions"><button className="syncButton" disabled={sync.isPending} onClick={()=>sync.mutate(establishment.id)}>{sync.isPending?<LoaderCircle className="spin"/>:<RefreshCw/>} Sincronizar fuentes</button></div></header>
    {sync.error&&<div className="sourceError"><ShieldAlert/>La sincronización falló: {sync.error instanceof Error?sync.error.message:'error no identificado'}. Los últimos datos válidos permanecen visibles.</div>}
    {sync.isSuccess&&<div className="sourceSuccess"><Database/>Fuentes actualizadas y persistidas con trazabilidad.</div>}
    {active==='Centro de mando'?<Overview data={data} weather={sourceWeather} evidenceScore={evidenceScore} staleDevices={staleDevices} onDecision={(id,status)=>recommendationAction.mutate({id,status})}/>:<OperationalSection name={active} data={data}/>}
  </main></div>;
}

type WeatherValue={observed_at:string;temperature_c:number;humidity_pct:number;precipitation_mm:number;wind_kmh:number;forecast_rain_7d_mm:number;source:string};

function Overview({data,weather,evidenceScore,staleDevices,onDecision}:{data:Workspace;weather:WeatherValue|null;evidenceScore:number;staleDevices:number;onDecision:(id:string,status:'accepted'|'dismissed')=>void}){
  const establishment=data.establishment!;
  const sceneAge=data.satellite?Math.floor((Date.now()-new Date(data.satellite.captured_at).getTime())/86_400_000):null;
  return <>
    <section className="hero"><article className="twin"><div className="title"><div><small>GEMELO DIGITAL · GEOREFERENCIADO</small><h2>{establishment.name}</h2></div><span>{data.satellite?`Sentinel-2 · hace ${sceneAge} días`:'Satélite aún no sincronizado'}</span></div><div className="realMap"><Map/><strong>{establishment.latitude.toFixed(5)}, {establishment.longitude.toFixed(5)}</strong><p>{data.parcels.length?`${data.parcels.length} unidades productivas registradas`:'Registrá lotes para construir el gemelo parcelario'}</p>{data.satellite?.catalog_url&&<a href={data.satellite.catalog_url} target="_blank" rel="noreferrer">Abrir evidencia satelital</a>}</div></article>
      <article className="score"><small>COBERTURA DE EVIDENCIA</small><div><strong>{evidenceScore}</strong><span>/100</span></div><h3>{evidenceScore>=75?'Base operativa conectada':evidenceScore>=50?'Integración en progreso':'Faltan fuentes críticas'}</h3><p>Mide fuentes conectadas, no rendimiento productivo. Evita presentar estimaciones como hechos.</p><i><b style={{width:`${evidenceScore}%`}}/></i>{[['Lotes',String(data.parcels.length)],['Sensores',String(data.devices.length)],['Alertas vencidas',String(staleDevices)]].map(x=><dl key={x[0]}><dt>{x[0]}</dt><dd>{x[1]}</dd></dl>)}</article></section>
    <section className="signals"><Metric icon={CloudRain} label="Lluvia 7 días" value={weather?`${weather.forecast_rain_7d_mm.toFixed(1)} mm`:'—'} detail={weather?.source??'Sin fuente'}/><Metric icon={Activity} label="Temperatura" value={weather?`${weather.temperature_c.toFixed(1)} °C`:'—'} detail={weather?`Humedad ${weather.humidity_pct.toFixed(0)}%`:'Sin observación'}/><Metric icon={Satellite} label="Escena satelital" value={sceneAge===null?'—':`${sceneAge} d`} detail={data.satellite?`${data.satellite.collection} · nubes ${data.satellite.cloud_cover_pct?.toFixed(0)??'—'}%`:'Sin escena'}/><Metric icon={Radio} label="Dispositivos" value={String(data.devices.length)} detail={`${data.devices.filter(d=>d.status==='online').length} en línea`}/></section>
    <section className="lower"><article className="panel"><div className="title"><div><h2>Decisiones con evidencia</h2><p>Reglas agronómicas transparentes; requieren aprobación humana</p></div><em>{data.recommendations.length} abiertas</em></div>{data.recommendations.length?data.recommendations.map(item=><Decision key={item.id} item={item} onDecision={onDecision}/>):<EmptyRow text="No hay alertas activas para las fuentes actuales."/>}</article>
      <article className="panel"><div className="title"><div><h2>Unidades productivas</h2><p>Inventario persistido del establecimiento</p></div></div>{data.parcels.length?data.parcels.map(parcel=><div className="lot" key={parcel.id}><i/><div><h3>{parcel.name}</h3><p>{parcel.crop??parcel.use} · {parcel.area_hectares} ha</p></div><span><b style={{width:`${parcel.health_score??0}%`}}/></span><strong>{parcel.health_score??'—'}</strong></div>):<EmptyRow text="Aún no hay lotes registrados."/>}</article></section>
    <section className="insight"><span><Bot/></span><div><small>PRINCIPIO NODO</small><h2>Decidir con evidencia, no con una cifra decorativa</h2><p>Cada recomendación conserva fuente, momento, confianza y estado. NODO nunca ejecuta una intervención sin aprobación humana.</p></div></section>
  </>;
}

function Metric({icon:Icon,label,value,detail}:{icon:typeof Activity;label:string;value:string;detail:string}){return <article><span><Icon/></span><div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div></article>}
function EmptyRow({text}:{text:string}){return <div className="emptyRow"><Database/><p>{text}</p></div>}
function Decision({item,onDecision}:{item:Recommendation;onDecision:(id:string,status:'accepted'|'dismissed')=>void}){return <div className="decision real"><span className={`priority ${item.priority}`}>{item.priority}</span><div><small>{item.confidence}% CONFIANZA · {item.valid_until?`VÁLIDA HASTA ${new Date(item.valid_until).toLocaleString('es-AR')}`:'SIN VENCIMIENTO'}</small><h3>{item.title}</h3><p>{item.rationale}</p><b>{item.action}</b></div><div className="decisionActions"><button onClick={()=>onDecision(item.id,'accepted')}>Aceptar</button><button onClick={()=>onDecision(item.id,'dismissed')}>Descartar</button></div></div>}

function OperationalSection({name,data}:{name:string;data:Workspace}){
  const content=name==='Mapa vivo'?{title:'Cobertura geoespacial',text:data.satellite?`Última escena ${data.satellite.collection}: ${new Date(data.satellite.captured_at).toLocaleString('es-AR')}.`:'Sin escena satelital persistida. Ejecutá Sincronizar fuentes.'}:name==='Cultivos'?{title:'Lotes y cultivos',text:data.parcels.length?`${data.parcels.length} unidades registradas sobre ${data.establishment?.area_hectares} ha.`:'Sin lotes. El alta parcelaria será el próximo flujo operativo.'}:name==='Sensores'?{title:'Red de sensores',text:data.devices.length?`${data.devices.length} dispositivos registrados; ${data.devices.filter(d=>d.status==='online').length} reportan en línea.`:'Sin dispositivos registrados. La ingestión está preparada para credenciales por equipo.'}:{title:name,text:'No hay activos reales registrados en este módulo. NODO no mostrará datos simulados.'};
  return <section className="moduleState"><div><Database/><small>MÓDULO OPERATIVO</small><h2>{content.title}</h2><p>{content.text}</p></div></section>;
}

export function App(){ return <AuthGate><WorkspaceShell/></AuthGate> }
