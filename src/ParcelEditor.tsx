import { useMemo, useState, type FormEvent } from 'react';
import { CircleMarker, MapContainer, Polygon, Polyline, useMapEvents } from 'react-leaflet';
import { Check, LoaderCircle, RotateCcw, Save, Undo2 } from 'lucide-react';
import type { LeafletMouseEvent } from 'leaflet';
import { MapResize, SatelliteTiles, type MapCoordinates } from './SatelliteMap';
import { canAddVertex, createGeoJsonPolygon, geodesicAreaHectares, parseGeoJsonPolygon, polygonHasSelfIntersections, vertexAlreadyExists, type MapPoint } from './lib/geojson';
import { useCreateParcel, useUpdateParcel, type Parcel } from './lib/workspace';

function DrawEvents({enabled,onPoint}:{enabled:boolean;onPoint:(point:MapPoint)=>void}){useMapEvents({click(event:LeafletMouseEvent){if(enabled)onPoint({lat:event.latlng.lat,lng:event.latlng.lng})}});return null}

export function ParcelEditor({organizationId,establishmentId,center,parcel,onClose}:{organizationId:string;establishmentId:string;center:MapCoordinates;parcel?:Parcel;onClose?:()=>void}){
  const create=useCreateParcel();
  const update=useUpdateParcel();
  const initialGeometry=parseGeoJsonPolygon(parcel?.boundary_geojson);
  const [points,setPoints]=useState<MapPoint[]>(()=>initialGeometry?.rings[0].map(([lat,lng])=>({lat,lng}))??[]);
  const [drawing,setDrawing]=useState(!initialGeometry);
  const [shapeError,setShapeError]=useState('');
  const [form,setForm]=useState({name:parcel?.name??'',use:parcel?.use??'crop',crop:parcel?.crop??''});
  const calculatedArea=useMemo(()=>geodesicAreaHectares(points),[points]);
  const polygon=points.map(point=>[point.lat,point.lng] as [number,number]);
  function addPoint(point:MapPoint){
    if(!canAddVertex(points)){setShapeError('El límite alcanzó 500 vértices. Finalizalo o simplificá el trazado.');return}
    if(vertexAlreadyExists(points,point)){setShapeError('Ese vértice ya está marcado. Elegí otro punto del perímetro.');return}
    const candidate=[...points,point];
    if(candidate.length>=4&&polygonHasSelfIntersections(candidate)){setShapeError('Ese tramo cruza el límite actual. Deshacé o marcá el siguiente vértice sin cruzar el perímetro.');return}
    setShapeError('');setPoints(candidate);
  }
  function finishDrawing(){
    if(points.length<3){setShapeError('Marcá como mínimo 3 vértices antes de finalizar.');return}
    if(polygonHasSelfIntersections(points)){setShapeError('El perímetro se cruza a sí mismo. Corregilo antes de guardar.');return}
    if(calculatedArea<=0){setShapeError('El perímetro no forma una superficie válida.');return}
    setShapeError('');setDrawing(false);
  }
  function reset(){setPoints([]);setDrawing(true);setShapeError('')}
  function submit(event:FormEvent){event.preventDefault();if(drawing||points.length<3||calculatedArea<=0||polygonHasSelfIntersections(points))return;const input={organizationId,establishmentId,name:form.name,use:form.use,crop:form.crop||null,areaHectares:Number(calculatedArea.toFixed(2)),boundary:createGeoJsonPolygon(points)};if(parcel)update.mutate({...input,id:parcel.id},{onSuccess:()=>onClose?.()});else create.mutate(input,{onSuccess:()=>onClose?.()})}
  const mutation=parcel?update:create;
  return <section className="parcelEditor"><div className="parcelMap"><MapContainer center={[center.latitude,center.longitude]} zoom={16} scrollWheelZoom><SatelliteTiles/><DrawEvents enabled={drawing} onPoint={addPoint}/>{points.length>1&&<Polyline positions={polygon} pathOptions={{color:'#c7f36b',weight:3}}/>}{points.length>=3&&<Polygon positions={polygon} pathOptions={{color:'#c7f36b',fillColor:'#9ed451',fillOpacity:.24}}/>}{points.map((point,index)=><CircleMarker key={`${point.lat}-${point.lng}-${index}`} center={[point.lat,point.lng]} radius={index===0?7:5} pathOptions={{color:'#fff',weight:2,fillColor:index===0?'#f5d56d':'#b7dd68',fillOpacity:1}}/>)}<MapResize/></MapContainer><div className="drawGuide"><b>{points.length===0?'Marcá el primer vértice':`${points.length} vértices · ${drawing?'seguí dibujando':'perímetro finalizado'}`}</b><span>{drawing?'Hacé clic alrededor de todo el lote; no hay límite de 3 lados.':'Ya podés completar los datos y guardar.'}</span></div><div className="drawActions"><button type="button" disabled={!drawing||points.length===0} onClick={()=>{setPoints(value=>value.slice(0,-1));setShapeError('')}}><Undo2/> Deshacer</button>{drawing?<button type="button" className="finishBoundary" disabled={points.length<3} onClick={finishDrawing}><Check/> Finalizar perímetro</button>:<button type="button" onClick={()=>setDrawing(true)}>Agregar vértices</button>}</div></div><form onSubmit={submit}><div className="parcelFormHeader"><div><small>{parcel?'EDITAR LOTE':'NUEVO LOTE'}</small><h2>{parcel?'Corregir límite productivo':'Delimitar unidad productiva'}</h2></div><button type="button" onClick={reset}><RotateCcw/> Redibujar</button></div><label>Nombre<input required minLength={2} maxLength={100} value={form.name} onChange={event=>setForm({...form,name:event.target.value})} placeholder="Ej. Lote Norte"/></label><div className="coordinateGrid"><label>Uso<select value={form.use} onChange={event=>setForm({...form,use:event.target.value})}><option value="crop">Cultivo</option><option value="pasture">Pastura</option><option value="livestock">Ganadería</option><option value="fallow">Barbecho</option><option value="other">Otro</option></select></label><label>Cultivo o variedad<input value={form.crop} onChange={event=>setForm({...form,crop:event.target.value})} placeholder="Ej. Olivo"/></label></div><div className="calculatedArea"><span>Superficie geodésica aproximada</span><strong>{calculatedArea?`${calculatedArea.toFixed(2)} ha`:'—'}</strong><small>Calculada sobre la curvatura terrestre desde todos los vértices del límite.</small></div>{shapeError&&<p className="formError">{shapeError}</p>}{mutation.error&&<p className="formError">{mutation.error instanceof Error?mutation.error.message:'No se pudo guardar el lote'}</p>}<button className="primaryButton" disabled={mutation.isPending||drawing||points.length<3||form.name.trim().length<2}>{mutation.isPending?<LoaderCircle className="spin"/>:<><Save/> {drawing?'Finalizá el perímetro':parcel?'Actualizar lote':'Guardar lote real'}</>}</button></form></section>;
}
