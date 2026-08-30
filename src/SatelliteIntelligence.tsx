import { useMemo, useState } from 'react';
import { Database, Layers3, LoaderCircle, ScanSearch, ShieldAlert, Sparkles } from 'lucide-react';
import { SatelliteFarmMap, type SatelliteRasterLayer } from './SatelliteMap';
import { parseGeoJsonPolygon } from './lib/geojson';
import { planetaryRasterUrl, satelliteLayers, type SatelliteLayerName } from './lib/satellite';
import { useComputeSatelliteAnalytics, type ParcelSatelliteMetric, type SatelliteIndexName, type Workspace } from './lib/workspace';

const roleCanAnalyze=new Set(['owner','admin','agronomist','operator']);

function qualityLabel(metric:ParcelSatelliteMetric){
  if(metric.quality_status==='usable')return 'Apta para comparar';
  if(metric.quality_status==='cloud_limited')return 'Limitada por nubes';
  return 'Píxeles insuficientes';
}

function runLabel(status:'running'|'completed'|'partial'|'failed'){
  return status==='completed'?'Completo':status==='partial'?'Parcial':status==='failed'?'Fallido':'Procesando';
}

export function SatelliteIntelligencePanel({data}:{data:Workspace}){
  const establishment=data.establishment!;
  const [layer,setLayer]=useState<SatelliteLayerName>(data.satellite?'truecolor':'reference');
  const [opacity,setOpacity]=useState(.82);
  const analysis=useComputeSatelliteAnalytics();
  const definition=satelliteLayers.find(item=>item.id===layer)!;
  const analysisIndex:SatelliteIndexName|null=layer==='ndvi'||layer==='ndmi'?layer:null;
  const rasterLayer=useMemo<SatelliteRasterLayer|null>(()=>{
    if(layer==='reference'||!data.satellite)return null;
    const url=planetaryRasterUrl(data.satellite.external_id,layer);
    return url?{url,label:definition.label,opacity}:null;
  },[data.satellite,definition.label,layer,opacity]);
  const metrics=useMemo(()=>analysisIndex&&data.satellite?data.satelliteMetrics
    .filter(metric=>metric.satellite_scene_id===data.satellite!.id&&metric.index_name===analysisIndex)
    .sort((a,b)=>a.mean_value-b.mean_value):[],[analysisIndex,data.satellite,data.satelliteMetrics]);
  const latestRun=analysisIndex&&data.satellite?data.satelliteAnalysisRuns.find(run=>run.satellite_scene_id===data.satellite!.id&&run.index_name===analysisIndex):null;
  const usable=metrics.filter(metric=>metric.quality_status==='usable');
  const priorityMetric=usable.length>1?usable[0]:null;
  const priorityParcel=priorityMetric?data.parcels.find(parcel=>parcel.id===priorityMetric.parcel_id):null;
  const canAnalyze=roleCanAnalyze.has(data.organization!.role);
  const boundedParcels=data.parcels.filter(parcel=>parseGeoJsonPolygon(parcel.boundary_geojson));

  return <section className="earthModule">
    <div className="moduleToolbar earthToolbar"><div><small>NODO EARTH · INTELIGENCIA SATELITAL</small><h2>{establishment.name}</h2><p>Escenas Sentinel‑2 reales, índices espectrales y comparación trazable por lote.</p></div>{analysisIndex&&canAnalyze&&<button className="earthAnalyze" disabled={analysis.isPending||!data.satellite||boundedParcels.length===0} onClick={()=>analysis.mutate({establishmentId:establishment.id,indexName:analysisIndex})}>{analysis.isPending?<LoaderCircle className="spin"/>:<ScanSearch/>}{metrics.length?'Recalcular lotes':'Analizar lotes'}</button>}</div>

    {!data.satellite&&<div className="earthWarning"><ShieldAlert/><div><b>Falta una escena fechada</b><span>Usá “Sincronizar fuentes” para buscar la última escena Sentinel‑2 disponible.</span></div></div>}
    {analysis.error&&<div className="earthError"><ShieldAlert/><div><b>El análisis no se completó</b><span>{analysis.error instanceof Error?analysis.error.message:'Error no identificado'}. Las métricas anteriores permanecen intactas.</span></div></div>}
    {analysis.isSuccess&&<div className="earthSuccess"><Database/><div><b>Análisis persistido</b><span>{analysis.data.succeeded_count} lotes procesados{analysis.data.failed_count?` · ${analysis.data.failed_count} con error`:''}. Resultado {analysis.data.status==='completed'?'completo':'parcial'}.</span></div></div>}

    <div className="earthLayerBar" aria-label="Capas satelitales">{satelliteLayers.map(item=><button key={item.id} className={layer===item.id?'active':''} onClick={()=>setLayer(item.id)} disabled={item.id!=='reference'&&!data.satellite}><Layers3/><span><b>{item.label}</b><small>{item.resolutionMeters?`${item.resolutionMeters} m`:'Contexto'}</small></span></button>)}</div>

    <article className="earthMapCard">
      <SatelliteFarmMap position={{latitude:establishment.latitude,longitude:establishment.longitude}} name={establishment.name} parcels={data.parcels} showParcelLabels rasterLayer={rasterLayer}/>
      <div className="earthMapOverlay">
        <div><small>CAPA ACTIVA</small><b>{definition.label}</b><span>{definition.description}</span></div>
        {layer!=='reference'&&<label>Opacidad <input aria-label="Opacidad de capa" type="range" min="25" max="100" value={Math.round(opacity*100)} onChange={event=>setOpacity(Number(event.target.value)/100)}/><b>{Math.round(opacity*100)}%</b></label>}
        {definition.legend&&<div className="earthLegend">{definition.legend.map(item=><span key={item.label}><i style={{background:item.color}}/>{item.label}</span>)}</div>}
      </div>
    </article>

    <div className="earthEvidence">
      <article><small>ESCENA</small><b>{data.satellite?new Date(data.satellite.captured_at).toLocaleDateString('es-AR'):'—'}</b><span>{data.satellite?`${data.satellite.collection} · ${data.satellite.cloud_cover_pct?.toFixed(1)??'—'}% nubes`:'Sin fuente'}</span></article>
      <article><small>RESOLUCIÓN NOMINAL</small><b>{definition.resolutionMeters?`${definition.resolutionMeters} m`:'No aplica'}</b><span>{layer==='ndmi'?'Bandas B8A/B11 a 20 m':layer==='ndvi'?'Bandas B08/B04 a 10 m':'Según la capa seleccionada'}</span></article>
      <article><small>LOTE ANALIZADO</small><b>{metrics.length}/{boundedParcels.length}</b><span>{latestRun?`${runLabel(latestRun.status)} · ${new Date(latestRun.started_at).toLocaleString('es-AR')}`:'Sin ejecución para esta capa'}</span></article>
      <article><small>PROVEEDOR</small><b>Sentinel‑2 L2A</b><span>Microsoft Planetary Computer</span></article>
    </div>

    {analysisIndex&&<div className="earthAnalysisGrid">
      <article className="earthMetrics"><div className="earthSectionTitle"><div><small>MÉTRICAS POR POLÍGONO</small><h3>{analysisIndex==='ndvi'?'Vigor relativo NDVI':'Humedad vegetal NDMI'}</h3></div><span>{metrics.length?`${metrics.length} calculadas`:'Pendiente'}</span></div>{metrics.length?<div className="earthMetricTable">{metrics.map(metric=>{const parcel=data.parcels.find(item=>item.id===metric.parcel_id);return <div key={metric.id} className={metric.quality_status}><div><b>{parcel?.name??'Lote'}</b><small>{qualityLabel(metric)}</small></div><strong>{metric.mean_value.toFixed(3)}</strong><span>rango {metric.min_value.toFixed(3)} a {metric.max_value.toFixed(3)}</span><span>σ {metric.stddev_value.toFixed(3)} · {metric.pixel_count.toLocaleString('es-AR')} px</span></div>})}</div>:<div className="earthEmpty"><ScanSearch/><b>Todavía no hay estadísticas para esta escena</b><span>El mapa muestra píxeles reales; “Analizar lotes” calcula y guarda el resumen de cada polígono.</span></div>}</article>
      <article className="earthFieldPlan"><div className="earthSectionTitle"><div><small>RECORRIDA DIRIGIDA</small><h3>Prioridad con evidencia</h3></div><Sparkles/></div>{priorityParcel&&priorityMetric?<><div className="fieldPriority"><small>VERIFICAR PRIMERO</small><b>{priorityParcel.name}</b><strong>{priorityMetric.mean_value.toFixed(3)}</strong></div><p>Es el menor valor relativo entre los lotes comparables de esta misma escena. Revisá el área en campo antes de decidir una intervención.</p><ul><li>Comparar cultivo, estado fenológico y manejo.</li><li>Tomar fotos y observaciones georreferenciadas.</li><li>Contrastar con sensor de suelo y clima cuando estén disponibles.</li></ul></>:<div className="earthEmpty compact"><ScanSearch/><b>Se necesitan al menos dos lotes aptos</b><span>NODO no asigna prioridad con datos insuficientes o limitados por nubes.</span></div>}</article>
    </div>}

    <div className="earthBoundary"><ShieldAlert/><p><b>Límite agronómico:</b> NDVI y NDMI son proxies espectrales sin máscara de nubes por píxel en esta versión. No identifican por sí solos enfermedad, estrés, necesidad de riego ni rendimiento. Toda intervención requiere validación profesional y en campo.</p></div>
    <div className="earthRoadmap"><Layers3/><div><small>SIGUIENTE CAPACIDAD VERIFICABLE</small><b>NODO Terrain 3D</b><span>Se habilitará con un modelo digital de elevación licenciado, precisión vertical declarada y control de rendimiento. No usamos extrusión decorativa como si fuera topografía real.</span></div></div>
  </section>;
}
