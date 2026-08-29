import { useMemo, useState, type FormEvent } from 'react';
import { CircleMarker, MapContainer, Polygon, Polyline, useMapEvents } from 'react-leaflet';
import { LoaderCircle, RotateCcw, Save } from 'lucide-react';
import type { LeafletMouseEvent } from 'leaflet';
import { MapResize, SatelliteTiles, type MapCoordinates } from './SatelliteMap';
import { useCreateParcel } from './lib/workspace';

type Point={lat:number;lng:number};

function DrawEvents({enabled,onPoint}:{enabled:boolean;onPoint:(point:Point)=>void}){useMapEvents({click(event:LeafletMouseEvent){if(enabled)onPoint({lat:event.latlng.lat,lng:event.latlng.lng})}});return null}

function areaHectares(points:Point[]){
  if(points.length<3)return 0;
  const meanLatitude=points.reduce((sum,point)=>sum+point.lat,0)/points.length*Math.PI/180;
  const projected=points.map(point=>({x:point.lng*111_320*Math.cos(meanLatitude),y:point.lat*110_540}));
  let area=0;for(let index=0;index<projected.length;index++){const next=projected[(index+1)%projected.length];area+=projected[index].x*next.y-next.x*projected[index].y}
  return Math.abs(area)/2/10_000;
}

export function ParcelEditor({organizationId,establishmentId,center,onClose}:{organizationId:string;establishmentId:string;center:MapCoordinates;onClose?:()=>void}){
  const create=useCreateParcel();
  const [points,setPoints]=useState<Point[]>([]);
  const [drawing,setDrawing]=useState(true);
  const [form,setForm]=useState({name:'',use:'crop',crop:''});
  const calculatedArea=useMemo(()=>areaHectares(points),[points]);
  const polygon=points.map(point=>[point.lat,point.lng] as [number,number]);
  function submit(event:FormEvent){event.preventDefault();if(points.length<3||calculatedArea<=0)return;const ring=[...points.map(point=>[point.lng,point.lat]),[points[0].lng,points[0].lat]];create.mutate({organizationId,establishmentId,name:form.name,use:form.use,crop:form.crop||null,areaHectares:Number(calculatedArea.toFixed(2)),boundary:{type:'Polygon',coordinates:[ring]}},{onSuccess:()=>onClose?.()})}
  return <section className="parcelEditor"><div className="parcelMap"><MapContainer center={[center.latitude,center.longitude]} zoom={16} scrollWheelZoom><SatelliteTiles/><DrawEvents enabled={drawing} onPoint={point=>setPoints(value=>[...value,point])}/>{points.length>1&&<Polyline positions={polygon} pathOptions={{color:'#c7f36b',weight:3}}/>}{points.length>=3&&<Polygon positions={polygon} pathOptions={{color:'#c7f36b',fillColor:'#9ed451',fillOpacity:.24}}/>}{points.map((point,index)=><CircleMarker key={`${point.lat}-${point.lng}-${index}`} center={[point.lat,point.lng]} radius={5} pathOptions={{color:'#fff',fillColor:'#b7dd68',fillOpacity:1}}/>)}<MapResize/></MapContainer><div className="drawGuide"><b>{points.length<3?'Marcá al menos 3 vértices':'Límite listo para guardar'}</b><span>Hacé clic siguiendo el perímetro del lote.</span></div></div><form onSubmit={submit}><div className="parcelFormHeader"><div><small>NUEVO LOTE</small><h2>Delimitar unidad productiva</h2></div><button type="button" onClick={()=>{setPoints([]);setDrawing(true)}}><RotateCcw/> Reiniciar</button></div><label>Nombre<input required minLength={2} maxLength={100} value={form.name} onChange={event=>setForm({...form,name:event.target.value})} placeholder="Ej. Lote Norte"/></label><div className="coordinateGrid"><label>Uso<select value={form.use} onChange={event=>setForm({...form,use:event.target.value})}><option value="crop">Cultivo</option><option value="pasture">Pastura</option><option value="livestock">Ganadería</option><option value="fallow">Barbecho</option><option value="other">Otro</option></select></label><label>Cultivo o variedad<input value={form.crop} onChange={event=>setForm({...form,crop:event.target.value})} placeholder="Ej. Olivo"/></label></div><div className="calculatedArea"><span>Superficie aproximada</span><strong>{calculatedArea?`${calculatedArea.toFixed(2)} ha`:'—'}</strong><small>Calculada desde el polígono; puede ajustarse luego con mensura.</small></div>{create.error&&<p className="formError">{create.error instanceof Error?create.error.message:'No se pudo guardar el lote'}</p>}<button className="primaryButton" disabled={create.isPending||points.length<3||form.name.trim().length<2}>{create.isPending?<LoaderCircle className="spin"/>:<><Save/> Guardar lote real</>}</button></form></section>;
}
