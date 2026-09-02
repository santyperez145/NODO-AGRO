import { useMemo, useState } from 'react';
import { CalendarRange, Database, Download, Layers3, LoaderCircle, ScanSearch, ShieldAlert, Sparkles } from 'lucide-react';
import { SatelliteFarmMap, type SatelliteRasterLayer } from './SatelliteMap';
import { parseGeoJsonPolygon } from './lib/geojson';
import { planetaryRasterUrl, satelliteLayers, type SatelliteLayerName } from './lib/satellite';
import { useComputeSatelliteAnalytics, useComputeSatelliteTimeseries, type ParcelIndexBaseline, type ParcelSatelliteMetric, type SatelliteIndexName, type Workspace } from './lib/workspace';
import type { ScoutSeed } from './ScoutPanel';

const roleCanAnalyze=new Set(['owner','admin','agronomist','operator']);
const sclAlgorithm=(index:SatelliteIndexName)=>index==='ndvi'?'sentinel2-l2a-ndvi-scl-v1':'sentinel2-l2a-ndmi-scl-v1';
const parcelColors=['#2f6f3e','#b45309','#1d4ed8','#9f1239','#0f766e','#7c3aed'];

function qualityLabel(metric:ParcelSatelliteMetric){
  if(metric.quality_status==='usable')return metric.scl_cloud_percent===null?'Apta para comparar':`Apta · SCL nubes ${metric.scl_cloud_percent.toFixed(1)}%`;
  if(metric.quality_status==='cloud_limited')return metric.scl_cloud_percent===null?'Limitada por nubes':`Nublada · SCL ${metric.scl_cloud_percent.toFixed(1)}%`;
  return 'Píxeles insuficientes';
}

function runLabel(status:'running'|'completed'|'partial'|'failed'){
  return status==='completed'?'Completo':status==='partial'?'Parcial':status==='failed'?'Fallido':'Procesando';
}

function exportSeriesCsv(rows:Array<{date:string;parcel:string;index:string;mean:number;quality:string;cloud:string;algorithm:string}>){
  const header='fecha,lote,indice,media,calidad,nubes_scl_pct,algoritmo';
  const body=rows.map(row=>[row.date,row.parcel,row.index,row.mean.toFixed(4),row.quality,row.cloud,row.algorithm].join(','));
  const blob=new Blob([`${header}\n${body.join('\n')}\n`],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=url;link.download='nodo-earth-time.csv';link.click();
  URL.revokeObjectURL(url);
}

function EarthTimeChart({points,rain,baseline,selectedParcelId}:{points:Array<{parcelId:string;parcelName:string;date:number;mean:number;usable:boolean;color:string}>;rain:Array<{date:number;mm:number}>;baseline:ParcelIndexBaseline|null;selectedParcelId:string|null}){
  const width=920;const height=240;const pad={l:42,r:18,t:16,b:28};
  const innerW=width-pad.l-pad.r;const innerH=height-pad.t-pad.b;
  const xs=points.map(point=>point.date);
  const ys=points.map(point=>point.mean);
  const minX=xs.length?Math.min(...xs):Date.now()-90*86_400_000;
  const maxX=xs.length?Math.max(...xs):Date.now();
  const minY=Math.min(-0.05,...ys,baseline?.percentile_25??1);
  const maxY=Math.max(0.2,...ys,baseline?.percentile_75??0);
  const xAt=(value:number)=>pad.l+((value-minX)/Math.max(maxX-minX,1))*innerW;
  const yAt=(value:number)=>pad.t+((maxY-value)/Math.max(maxY-minY,0.05))*innerH;
  const maxRain=Math.max(1,...rain.map(item=>item.mm));
  const grouped=new Map<string,typeof points>();
  for(const point of points){
    const list=grouped.get(point.parcelId)??[];
    list.push(point);
    grouped.set(point.parcelId,list);
  }
  const ticks=5;
  return <svg className="earthTimeSvg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Serie temporal de índice por lote">
    {rain.map(item=><rect key={item.date} x={xAt(item.date)-3} y={yAt(minY)-(item.mm/maxRain)*innerH*0.35} width="6" height={(item.mm/maxRain)*innerH*0.35} fill="#94b8d8" opacity=".35"/>)}
    {baseline&&<rect x={pad.l} y={yAt(baseline.percentile_75)} width={innerW} height={Math.max(1,yAt(baseline.percentile_25)-yAt(baseline.percentile_75))} fill="#9cbd70" opacity=".16"/>}
    {baseline&&<line x1={pad.l} x2={pad.l+innerW} y1={yAt(baseline.median_value)} y2={yAt(baseline.median_value)} stroke="#5d8437" strokeDasharray="5 4"/>}
    {Array.from(grouped.entries()).map(([parcelId,series])=>{
      const sorted=[...series].sort((a,b)=>a.date-b.date);
      const path=sorted.map((point,index)=>`${index?'L':'M'}${xAt(point.date)},${yAt(point.mean)}`).join(' ');
      return <g key={parcelId} opacity={!selectedParcelId||selectedParcelId===parcelId?1:.28}>
        <path d={path} fill="none" stroke={sorted[0]?.color??'#2f6f3e'} strokeWidth={selectedParcelId===parcelId?2.4:1.6}/>
        {sorted.map(point=><circle key={`${parcelId}-${point.date}`} cx={xAt(point.date)} cy={yAt(point.mean)} r={point.usable?4:3.2} fill={point.usable?point.color:'transparent'} stroke={point.color} strokeWidth="1.6"/>)}
      </g>;
    })}
    {Array.from({length:ticks+1},(_,index)=>{
      const value=minY+((maxY-minY)/ticks)*index;
      return <text key={value} x={pad.l-6} y={yAt(value)+3} textAnchor="end" className="earthTimeTick">{value.toFixed(2)}</text>;
    })}
    <text x={pad.l} y={height-6} className="earthTimeTick">{new Date(minX).toLocaleDateString('es-AR')}</text>
    <text x={width-pad.r} y={height-6} textAnchor="end" className="earthTimeTick">{new Date(maxX).toLocaleDateString('es-AR')}</text>
  </svg>;
}

export function SatelliteIntelligencePanel({data,onPlanScout}:{data:Workspace;onPlanScout?:(seed:ScoutSeed)=>void}){
  const establishment=data.establishment!;
  const [layer,setLayer]=useState<SatelliteLayerName>(data.satellite?'truecolor':'reference');
  const [opacity,setOpacity]=useState(.82);
  const [selectedSceneId,setSelectedSceneId]=useState<string|null>(data.satellite?.id??null);
  const [hideCloudy,setHideCloudy]=useState(true);
  const [focusedParcelId,setFocusedParcelId]=useState<string|null>(null);
  const analysis=useComputeSatelliteAnalytics();
  const series=useComputeSatelliteTimeseries();
  const definition=satelliteLayers.find(item=>item.id===layer)!;
  const analysisIndex:SatelliteIndexName|null=layer==='ndvi'||layer==='ndmi'?layer:null;
  const selectedScene=data.satelliteScenes.find(scene=>scene.id===selectedSceneId)??data.satellite;
  const rasterLayer=useMemo<SatelliteRasterLayer|null>(()=>{
    if(layer==='reference'||!selectedScene)return null;
    const url=planetaryRasterUrl(selectedScene.external_id,layer);
    return url?{url,label:definition.label,opacity}:null;
  },[selectedScene,definition.label,layer,opacity]);
  const algorithm=analysisIndex?sclAlgorithm(analysisIndex):null;
  const sceneMetrics=useMemo(()=>analysisIndex&&selectedScene?data.satelliteMetrics
    .filter(metric=>metric.satellite_scene_id===selectedScene.id&&metric.index_name===analysisIndex)
    .sort((left,right)=>{
      const leftScl=left.algorithm_version.includes('scl-v1')?0:1;
      const rightScl=right.algorithm_version.includes('scl-v1')?0:1;
      return leftScl-rightScl||left.mean_value-right.mean_value;
    }):[],[analysisIndex,data.satelliteMetrics,selectedScene]);
  const preferredMetrics=useMemo(()=>{
    const byParcel=new Map<string,ParcelSatelliteMetric>();
    for(const metric of sceneMetrics){
      const current=byParcel.get(metric.parcel_id);
      if(!current||(metric.algorithm_version.includes('scl-v1')&&!current.algorithm_version.includes('scl-v1')))byParcel.set(metric.parcel_id,metric);
    }
    return [...byParcel.values()].sort((a,b)=>a.mean_value-b.mean_value);
  },[sceneMetrics]);
  const latestRun=analysisIndex&&selectedScene?data.satelliteAnalysisRuns.find(run=>run.satellite_scene_id===selectedScene.id&&run.index_name===analysisIndex):null;
  const latestSeries=analysisIndex?data.satelliteTimeseriesRuns.find(run=>run.index_name===analysisIndex):null;
  const usable=preferredMetrics.filter(metric=>metric.quality_status==='usable');
  const priorityMetric=usable.length>1?usable[0]:null;
  const priorityParcel=priorityMetric?data.parcels.find(parcel=>parcel.id===priorityMetric.parcel_id):null;
  const canAnalyze=roleCanAnalyze.has(data.organization!.role);
  const boundedParcels=data.parcels.filter(parcel=>parseGeoJsonPolygon(parcel.boundary_geojson));
  const seriesPoints=useMemo(()=>{
    if(!analysisIndex||!algorithm)return [];
    return data.satelliteMetrics.filter(metric=>metric.index_name===analysisIndex&&metric.algorithm_version===algorithm)
      .filter(metric=>!hideCloudy||metric.quality_status==='usable')
      .map(metric=>{
        const parcel=data.parcels.find(item=>item.id===metric.parcel_id);
        const color=parcelColors[Math.max(0,data.parcels.findIndex(item=>item.id===metric.parcel_id))%parcelColors.length];
        return {parcelId:metric.parcel_id,parcelName:parcel?.name??'Lote',date:new Date(metric.captured_at).getTime(),mean:metric.mean_value,usable:metric.quality_status==='usable',color};
      }).sort((a,b)=>a.date-b.date);
  },[algorithm,analysisIndex,data.parcels,data.satelliteMetrics,hideCloudy]);
  const rain=useMemo(()=>{
    if(!seriesPoints.length)return [];
    const min=Math.min(...seriesPoints.map(point=>point.date));
    const max=Math.max(...seriesPoints.map(point=>point.date));
    return data.weatherDaily.filter(day=>{
      const time=new Date(`${day.observed_on}T00:00:00Z`).getTime();
      return time>=min-86_400_000&&time<=max+86_400_000;
    }).map(day=>({date:new Date(`${day.observed_on}T00:00:00Z`).getTime(),mm:day.precipitation_mm}));
  },[data.weatherDaily,seriesPoints]);
  const baselines=analysisIndex&&algorithm?data.parcelIndexBaselines.filter(item=>item.index_name===analysisIndex&&item.algorithm_version===algorithm):[];
  const focusedBaseline=baselines.find(item=>item.parcel_id===(focusedParcelId??priorityParcel?.id??baselines[0]?.parcel_id))??null;
  const busy=analysis.isPending||series.isPending;

  return <section className="earthModule">
    <div className="moduleToolbar earthToolbar"><div><small>NODO EARTH · INTELIGENCIA SATELITAL</small><h2>{establishment.name}</h2><p>Escenas Sentinel‑2 reales, serie SCL por lote y comparación trazable. Misma lógica que un Crop Status: fecha, nubes por polígono y curva, sin diagnosticar.</p></div>
      {analysisIndex&&canAnalyze&&<div className="earthActions">
        <button className="earthAnalyze ghost" disabled={busy||!selectedScene||boundedParcels.length===0} onClick={()=>analysis.mutate({establishmentId:establishment.id,indexName:analysisIndex})}>{analysis.isPending?<LoaderCircle className="spin"/>:<ScanSearch/>}{preferredMetrics.length?'Recalcular escena':'Analizar escena'}</button>
        <button className="earthAnalyze" disabled={busy||boundedParcels.length===0} onClick={()=>series.mutate({establishmentId:establishment.id,indexName:analysisIndex})}>{series.isPending?<LoaderCircle className="spin"/>:<CalendarRange/>}{seriesPoints.length?'Actualizar serie SCL':'Construir serie SCL'}</button>
      </div>}
    </div>

    {!data.satellite&&<div className="earthWarning"><ShieldAlert/><div><b>Falta una escena fechada</b><span>Usá “Sincronizar fuentes” o “Construir serie SCL” para buscar Sentinel‑2 de los últimos 90 días.</span></div></div>}
    {analysis.error&&<div className="earthError"><ShieldAlert/><div><b>El análisis de escena no se completó</b><span>{analysis.error instanceof Error?analysis.error.message:'Error no identificado'}. Las métricas anteriores permanecen intactas.</span></div></div>}
    {series.error&&<div className="earthError"><ShieldAlert/><div><b>La serie SCL no se completó</b><span>{series.error instanceof Error?series.error.message:'Error no identificado'}. Las observaciones anteriores permanecen intactas.</span></div></div>}
    {analysis.isSuccess&&<div className="earthSuccess"><Database/><div><b>Escena persistida</b><span>{analysis.data.succeeded_count} lotes procesados{analysis.data.failed_count?` · ${analysis.data.failed_count} con error`:''}. Resultado {analysis.data.status==='completed'?'completo':'parcial'}.</span></div></div>}
    {series.isSuccess&&<div className="earthSuccess"><Database/><div><b>Serie SCL persistida</b><span>{series.data.succeeded_count} observaciones nuevas · {series.data.skipped_existing_count} ya existían · {series.data.rain_days} días de lluvia. Ventana {new Date(series.data.window.start).toLocaleDateString('es-AR')} – {new Date(series.data.window.end).toLocaleDateString('es-AR')}.</span></div></div>}

    {data.satelliteScenes.length>0&&<div className="earthSceneRail" aria-label="Escenas fechadas">{data.satelliteScenes.map(scene=><button key={scene.id} className={selectedScene?.id===scene.id?'active':''} onClick={()=>setSelectedSceneId(scene.id)}><b>{new Date(scene.captured_at).toLocaleDateString('es-AR')}</b><small>{scene.cloud_cover_pct?.toFixed(0)??'—'}% nubes escena</small></button>)}</div>}

    <div className="earthLayerBar" aria-label="Capas satelitales">{satelliteLayers.map(item=><button key={item.id} className={layer===item.id?'active':''} onClick={()=>setLayer(item.id)} disabled={item.id!=='reference'&&!selectedScene}><Layers3/><span><b>{item.label}</b><small>{item.resolutionMeters?`${item.resolutionMeters} m`:'Contexto'}</small></span></button>)}</div>

    <article className="earthMapCard">
      <SatelliteFarmMap position={{latitude:establishment.latitude,longitude:establishment.longitude}} name={establishment.name} parcels={data.parcels} showParcelLabels rasterLayer={rasterLayer}/>
      <div className="earthMapOverlay">
        <div><small>CAPA ACTIVA</small><b>{definition.label}</b><span>{definition.description}</span></div>
        {layer!=='reference'&&<label>Opacidad <input aria-label="Opacidad de capa" type="range" min="25" max="100" value={Math.round(opacity*100)} onChange={event=>setOpacity(Number(event.target.value)/100)}/><b>{Math.round(opacity*100)}%</b></label>}
        {definition.legend&&<div className="earthLegend">{definition.legend.map(item=><span key={item.label}><i style={{background:item.color}}/>{item.label}</span>)}</div>}
      </div>
    </article>

    <div className="earthEvidence">
      <article><small>ESCENA</small><b>{selectedScene?new Date(selectedScene.captured_at).toLocaleDateString('es-AR'):'—'}</b><span>{selectedScene?`${selectedScene.collection} · ${selectedScene.cloud_cover_pct?.toFixed(1)??'—'}% nubes de escena`:'Sin fuente'}</span></article>
      <article><small>CATÁLOGO</small><b>{data.satelliteScenes.length}</b><span>Hasta 12 escenas de 90 días · Planetary Computer</span></article>
      <article><small>LOTE ANALIZADO</small><b>{preferredMetrics.length}/{boundedParcels.length}</b><span>{latestRun?`${runLabel(latestRun.status)} · ${new Date(latestRun.started_at).toLocaleString('es-AR')}`:'Sin ejecución para esta capa'}</span></article>
      <article><small>CALIDAD</small><b>{algorithm?'SCL por lote':'Escena'}</b><span>Nubosidad de polígono, no sólo el metadato global</span></article>
    </div>

    {analysisIndex&&<article className="earthTimeCard">
      <div className="earthSectionTitle"><div><small>NODO EARTH TIME</small><h3>Estado de cultivo · {analysisIndex==='ndvi'?'NDVI':'NDMI'}</h3></div>
        <div className="earthTimeTools">
          <label><input type="checkbox" checked={hideCloudy} onChange={event=>setHideCloudy(event.target.checked)}/>Ocultar nubladas</label>
          <select aria-label="Lote de la serie" value={focusedParcelId??''} onChange={event=>setFocusedParcelId(event.target.value||null)}>
            <option value="">Todos los lotes</option>
            {data.parcels.map(parcel=><option key={parcel.id} value={parcel.id}>{parcel.name}</option>)}
          </select>
          <button className="earthCsv" disabled={!seriesPoints.length} onClick={()=>exportSeriesCsv(data.satelliteMetrics.filter(metric=>metric.index_name===analysisIndex&&metric.algorithm_version===algorithm).map(metric=>({
            date:new Date(metric.captured_at).toISOString().slice(0,10),
            parcel:data.parcels.find(item=>item.id===metric.parcel_id)?.name??metric.parcel_id,
            index:analysisIndex,mean:metric.mean_value,quality:metric.quality_status,
            cloud:metric.scl_cloud_percent?.toFixed(2)??'',algorithm:metric.algorithm_version,
          })))}><Download/>CSV</button>
        </div>
      </div>
      {seriesPoints.length?<EarthTimeChart points={focusedParcelId?seriesPoints.filter(point=>point.parcelId===focusedParcelId):seriesPoints} rain={rain} baseline={focusedBaseline} selectedParcelId={focusedParcelId}/>:<div className="earthEmpty compact"><CalendarRange/><b>Todavía no hay una serie SCL</b><span>Construí la serie para obtener fechas, filtro de nubes por lote, lluvia diaria y una mediana empírica del mismo polígono.</span></div>}
      <div className="earthTimeMeta">
        <span>{latestSeries?`Última serie ${runLabel(latestSeries.status)} · ${new Date(latestSeries.started_at).toLocaleString('es-AR')}`:'Sin ejecución de serie'}</span>
        <span>{rain.length?`${rain.reduce((sum,item)=>sum+item.mm,0).toFixed(1)} mm de lluvia en la ventana`:'Sin archivo de lluvia persistido'}</span>
        <span>Las barras azules son precipitación diaria. La banda verde es el rango intercuartil del lote enfocado.</span>
      </div>
    </article>}

    {analysisIndex&&<div className="earthAnalysisGrid">
      <article className="earthMetrics"><div className="earthSectionTitle"><div><small>MÉTRICAS POR POLÍGONO</small><h3>{analysisIndex==='ndvi'?'Vigor relativo NDVI':'Humedad vegetal NDMI'}</h3></div><span>{preferredMetrics.length?`${preferredMetrics.length} calculadas`:'Pendiente'}</span></div>{preferredMetrics.length?<div className="earthMetricTable">{preferredMetrics.map(metric=>{const parcel=data.parcels.find(item=>item.id===metric.parcel_id);const baseline=baselines.find(item=>item.parcel_id===metric.parcel_id);return <div key={metric.id} className={metric.quality_status}><div><b>{parcel?.name??'Lote'}</b><small>{qualityLabel(metric)}{metric.algorithm_version.includes('scl-v1')?' · SCL':' · sin máscara'}</small></div><strong>{metric.mean_value.toFixed(3)}</strong><span>rango {metric.min_value.toFixed(3)} a {metric.max_value.toFixed(3)}</span><span>{baseline?.latest_delta!==undefined&&baseline?.latest_delta!==null?`Δ ${baseline.latest_delta>=0?'+':''}${baseline.latest_delta.toFixed(3)} vs mediana`:`σ ${metric.stddev_value.toFixed(3)} · ${metric.pixel_count.toLocaleString('es-AR')} px`}</span></div>})}</div>:<div className="earthEmpty"><ScanSearch/><b>Todavía no hay estadísticas para esta escena</b><span>El mapa muestra píxeles reales; “Analizar escena” o “Construir serie SCL” calcula y guarda el resumen de cada polígono.</span></div>}</article>
      <article className="earthFieldPlan"><div className="earthSectionTitle"><div><small>RECORRIDA DIRIGIDA</small><h3>Prioridad con evidencia</h3></div><Sparkles/></div>{priorityParcel&&priorityMetric?<><div className="fieldPriority"><small>VERIFICAR PRIMERO</small><b>{priorityParcel.name}</b><strong>{priorityMetric.mean_value.toFixed(3)}</strong></div><p>{focusedBaseline&&focusedBaseline.latest_delta!==null&&focusedBaseline.observation_count>=3?`La última observación usable quedó ${focusedBaseline.latest_delta.toFixed(3)} respecto de la mediana del mismo lote. `:'Es el menor valor relativo entre los lotes comparables de esta misma escena. '}Revisá el área en campo antes de decidir una intervención.</p><ul><li>Comparar cultivo, estado fenológico y manejo.</li><li>Tomar observaciones georreferenciadas.</li><li>Contrastar con sensor de suelo y clima cuando estén disponibles.</li></ul>{onPlanScout&&<button className="earthScoutAction" onClick={()=>onPlanScout({parcelId:priorityParcel.id,metricId:priorityMetric.id,indexName:analysisIndex,meanValue:priorityMetric.mean_value})}><ScanSearch/>Planificar en NODO Scout</button>}</>:<div className="earthEmpty compact"><ScanSearch/><b>Se necesitan al menos dos lotes aptos</b><span>NODO no asigna prioridad con datos insuficientes o limitados por nubes.</span></div>}</article>
    </div>}

    {baselines.length>0&&<div className="earthBaselineGrid">{baselines.map(item=>{const parcel=data.parcels.find(row=>row.id===item.parcel_id);return <article key={item.id}><small>{parcel?.name??'Lote'}</small><b>{item.median_value.toFixed(3)}</b><span>{item.observation_count} observaciones usable · p25 {item.percentile_25.toFixed(3)} · p75 {item.percentile_75.toFixed(3)}</span><em>{item.latest_delta===null?'Mediana empírica: se necesitan 3 fechas despejadas para un delta.':`Última vs mediana: ${item.latest_delta>=0?'+':''}${item.latest_delta.toFixed(3)}`}</em></article>})}</div>}

    <div className="earthBoundary"><ShieldAlert/><p><b>Límite agronómico:</b> Earth Time acepta una fecha sólo si SCL marca menos de 5% de nube, sombra o cirros dentro del polígono, igual que el criterio público de Auravant. No identifica enfermedad, estrés, necesidad de riego ni rendimiento. La línea base es la mediana del mismo lote, no un modelo fenológico certificado. Toda intervención requiere validación profesional y en campo.</p></div>
    <div className="earthRoadmap"><Layers3/><div><small>SIGUIENTE CAPACIDAD VERIFICABLE</small><b>NODO Terrain 3D</b><span>Relieve con DEM licenciado, resolución y precisión vertical declaradas. Water ya combina ET0, lluvia, riego declarado y NDMI como evidencia, no como prescripción.</span></div></div>
  </section>;
}
