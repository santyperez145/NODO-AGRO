import { useEffect, useMemo, useState } from 'react';
import { MapContainer, Marker, Polygon, TileLayer, Tooltip, useMap } from 'react-leaflet';
import { latLngBounds, type LatLngExpression } from 'leaflet';
import { parseGeoJsonPolygon, type ParsedPolygon } from './lib/geojson';
import type { Parcel } from './lib/workspace';
import 'leaflet/dist/leaflet.css';

export type MapCoordinates = { latitude:number; longitude:number };

export type SatelliteRasterLayer={url:string;label:string;opacity:number};

export function SatelliteTiles({showLabels=true}:{showLabels?:boolean}){
  const [imageryFailed,setImageryFailed]=useState(false);
  if(imageryFailed)return <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"/>;
  return <><TileLayer attribution="Tiles &copy; Esri — Sources: Esri, Maxar, Earthstar Geographics, GIS User Community" url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" eventHandlers={{tileerror:()=>setImageryFailed(true)}}/>{showLabels&&<TileLayer attribution="Labels &copy; Esri" url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}" opacity={.85}/>}</>;
}

export function MapResize(){const map=useMap();useEffect(()=>{const timer=setTimeout(()=>map.invalidateSize(),0);return()=>clearTimeout(timer)},[map]);return null}

const parcelColors: Record<string,string> = { crop:'#c8f169', pasture:'#74d68f', livestock:'#f2bf68', fallow:'#df9f68', other:'#78c9cf' };

function MapViewport({position,polygons}:{position:MapCoordinates;polygons:ParsedPolygon[]}){
  const map=useMap();
  useEffect(()=>{
    const timer=setTimeout(()=>{
      map.invalidateSize();
      const coordinates=polygons.flatMap(polygon=>polygon.rings.flat());
      if(coordinates.length) map.fitBounds(latLngBounds(coordinates),{padding:[28,28],maxZoom:17,animate:false});
      else map.setView([position.latitude,position.longitude],15,{animate:false});
    },50);
    return()=>clearTimeout(timer);
  },[map,polygons,position.latitude,position.longitude]);
  return null;
}

export function SatelliteFarmMap({position,name,parcels=[],showParcelLabels=false,rasterLayer=null}:{position:MapCoordinates;name:string;parcels?:Parcel[];showParcelLabels?:boolean;rasterLayer?:SatelliteRasterLayer|null}){
  const center:LatLngExpression=[position.latitude,position.longitude];
  const [rasterFailed,setRasterFailed]=useState(false);
  useEffect(()=>setRasterFailed(false),[rasterLayer?.url]);
  const visibleParcels=useMemo(()=>parcels.flatMap(parcel=>{const geometry=parseGeoJsonPolygon(parcel.boundary_geojson);return geometry?[{parcel,geometry}]:[]}),[parcels]);
  const vertexCount=visibleParcels.reduce((sum,item)=>sum+item.geometry.vertexCount,0);
  const polygons=useMemo(()=>visibleParcels.map(item=>item.geometry),[visibleParcels]);
  const analyticalOverlay=Boolean(rasterLayer&&(rasterLayer.label.includes('NDVI')||rasterLayer.label.includes('Humedad')||rasterLayer.label.includes('Relieve')));
  const rasterAttribution=rasterLayer?.label.includes('Relieve')
    ? 'Copernicus DEM GLO-30 · ESA/DLR · Microsoft Planetary Computer'
    : 'Sentinel-2 L2A · Microsoft Planetary Computer';
  return <div className="satelliteFarmMap"><MapContainer center={center} zoom={15} scrollWheelZoom zoomAnimation={false}><SatelliteTiles showLabels={!rasterLayer||rasterFailed}/>{rasterLayer&&!rasterFailed&&<TileLayer key={rasterLayer.url} attribution={rasterAttribution} url={rasterLayer.url} opacity={rasterLayer.opacity} eventHandlers={{tileerror:()=>setRasterFailed(true)}}/>}{rasterLayer&&!rasterFailed&&<TileLayer attribution="Labels &copy; Esri" url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}" opacity={.82}/>}<Marker position={center} title={name}/>{visibleParcels.map(({parcel,geometry})=><Polygon key={parcel.id} positions={geometry.rings} pathOptions={{color:parcelColors[parcel.use]??parcelColors.other,fillColor:parcelColors[parcel.use]??parcelColors.other,fillOpacity:analyticalOverlay ? .12 : .26,weight:3,opacity:1,className:'parcel-boundary'}}><Tooltip permanent={showParcelLabels} direction="center" className="parcelMapLabel"><b>{parcel.name}</b><span>{parcel.area_hectares.toFixed(2)} ha{parcel.crop?` · ${parcel.crop}`:''}</span></Tooltip></Polygon>)}<MapViewport position={position} polygons={polygons}/><MapResize/></MapContainer><div className="satelliteMapCaption"><b>{name}</b><span>{visibleParcels.length?`${visibleParcels.length} lotes · ${vertexCount} vértices`:`${position.latitude.toFixed(5)}, ${position.longitude.toFixed(5)}`}</span><small>{rasterFailed?'La capa analítica no respondió · mostrando referencia':rasterLayer?`${rasterLayer.label} · límites desde NODO`:'Imagen base de referencia · límites desde NODO'}</small></div></div>;
}
