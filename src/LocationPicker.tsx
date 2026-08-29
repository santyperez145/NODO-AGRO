import { useEffect, useState } from 'react';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { LoaderCircle, Search } from 'lucide-react';
import type { LatLngExpression, LeafletMouseEvent, Marker as LeafletMarker } from 'leaflet';
import { searchPlaces, type PlaceResult } from './lib/geocoding';
import 'leaflet/dist/leaflet.css';

type Coordinates = { latitude: number; longitude: number };

function MapSelection({position,onChange}:{position:Coordinates|null;onChange:(coordinates:Coordinates)=>void}) {
  const map = useMapEvents({ click(event: LeafletMouseEvent) { onChange({ latitude:event.latlng.lat, longitude:event.latlng.lng }); } });
  useEffect(()=>{ if(position) map.setView([position.latitude,position.longitude], Math.max(map.getZoom(),13)); },[map,position]);
  return position?<Marker position={[position.latitude,position.longitude]} draggable eventHandlers={{dragend(event){const point=(event.target as LeafletMarker).getLatLng();onChange({latitude:point.lat,longitude:point.lng});}}}/>:null;
}

function MapResize(){const map=useMap();useEffect(()=>{const timer=setTimeout(()=>map.invalidateSize(),0);return()=>clearTimeout(timer)},[map]);return null}

export function LocationPicker({position,onChange}:{position:Coordinates|null;onChange:(coordinates:Coordinates,label?:string)=>void}) {
  const [term,setTerm]=useState('');
  const [results,setResults]=useState<PlaceResult[]>([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');

  async function runSearch(){setError('');setLoading(true);try{const places=await searchPlaces(term);setResults(places);if(!places.length)setError('No encontramos esa localidad. Probá agregando provincia o país.')}catch(searchError){setError(searchError instanceof Error?searchError.message:'No se pudo buscar la ubicación')}finally{setLoading(false)}}
  function choose(place:PlaceResult){onChange({latitude:place.latitude,longitude:place.longitude},place.label);setTerm(place.label);setResults([])}
  const center:LatLngExpression=position?[position.latitude,position.longitude]:[-34.6,-64.0];
  return <section className="locationPicker"><div className="mapSearch"><label htmlFor="place-search">Localidad cercana</label><div className="placeSearchControls"><Search/><input id="place-search" value={term} onChange={event=>setTerm(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();void runSearch()}}} placeholder="Ej. Pergamino, Buenos Aires" minLength={2}/><button type="button" disabled={loading||term.trim().length<2} onClick={()=>void runSearch()}>{loading?<LoaderCircle className="spin"/>:'Buscar'}</button></div>{results.length>0&&<div className="placeResults">{results.map(place=><button type="button" key={place.id} onClick={()=>choose(place)}><b>{place.name}</b><span>{place.label}</span></button>)}</div>}{error&&<p className="formError">{error}</p>}</div>
    <div className="mapPicker"><MapContainer center={center} zoom={position?13:4} scrollWheelZoom><TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"/><MapSelection position={position} onChange={coordinates=>onChange(coordinates)}/><MapResize/></MapContainer><p>Hacé clic en el lote o arrastrá el marcador para ajustar la ubicación.</p></div>
  </section>;
}
