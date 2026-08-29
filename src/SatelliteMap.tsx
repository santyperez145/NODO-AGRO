import { useState } from 'react';
import { MapContainer, Marker, TileLayer, useMap } from 'react-leaflet';
import { useEffect } from 'react';
import type { LatLngExpression } from 'leaflet';

export type MapCoordinates = { latitude:number; longitude:number };

export function SatelliteTiles(){
  const [imageryFailed,setImageryFailed]=useState(false);
  if(imageryFailed)return <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"/>;
  return <><TileLayer attribution="Tiles &copy; Esri — Sources: Esri, Maxar, Earthstar Geographics, GIS User Community" url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" eventHandlers={{tileerror:()=>setImageryFailed(true)}}/><TileLayer attribution="Labels &copy; Esri" url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}" opacity={.85}/></>;
}

export function MapResize(){const map=useMap();useEffect(()=>{const timer=setTimeout(()=>map.invalidateSize(),0);return()=>clearTimeout(timer)},[map]);return null}

export function SatelliteFarmMap({position,name}:{position:MapCoordinates;name:string}){
  const center:LatLngExpression=[position.latitude,position.longitude];
  return <div className="satelliteFarmMap"><MapContainer center={center} zoom={15} scrollWheelZoom><SatelliteTiles/><Marker position={center} title={name}/><MapResize/></MapContainer><div className="satelliteMapCaption"><b>{name}</b><span>{position.latitude.toFixed(5)}, {position.longitude.toFixed(5)}</span><small>Imagen base de referencia · la fecha puede variar según proveedor</small></div></div>;
}
