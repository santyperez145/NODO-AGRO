export type SatelliteLayerName='reference'|'truecolor'|'ndvi'|'ndmi'|'relief';

export type SatelliteLayerDefinition={
  id:SatelliteLayerName;
  label:string;
  description:string;
  resolutionMeters:number|null;
  legend?:Array<{label:string;color:string}>;
};

export const satelliteLayers:SatelliteLayerDefinition[]=[
  {id:'reference',label:'Referencia',description:'Mosaico satelital de contexto; no representa una fecha analítica.',resolutionMeters:null},
  {id:'truecolor',label:'Color real',description:'Escena Sentinel-2 fechada en color natural.',resolutionMeters:10},
  {id:'ndvi',label:'Vigor NDVI',description:'Contraste espectral de vegetación; no diagnostica cultivo ni rendimiento.',resolutionMeters:10,legend:[
    {label:'Bajo relativo',color:'#b2182b'},{label:'Intermedio',color:'#f7f7a7'},{label:'Alto relativo',color:'#1a9850'},
  ]},
  {id:'ndmi',label:'Humedad vegetal',description:'Proxy NDMI del contenido de agua en el dosel; no mide humedad de suelo.',resolutionMeters:20,legend:[
    {label:'Menor señal',color:'#b2182b'},{label:'Intermedia',color:'#f7f7f7'},{label:'Mayor señal',color:'#2166ac'},
  ]},
  {id:'relief',label:'Relieve',description:'Sombreado Copernicus DEM GLO-30 (DSM ~30 m). Orienta el relieve; no es topografía de obra ni modelo de escurrimiento.',resolutionMeters:30,legend:[
    {label:'Sombra',color:'#1f1f1f'},{label:'Pendiente media',color:'#8a8a8a'},{label:'Iluminado',color:'#f2f2f2'},
  ]},
];

const sceneIdPattern=/^[A-Za-z0-9_-]{10,180}$/;
const mosaicIdPattern=/^[a-f0-9]{32}$/;
const tileBase='https://planetarycomputer.microsoft.com/api/data/v1/item/tiles/WebMercatorQuad/{z}/{x}/{y}@1x';
const mosaicTileBase='https://planetarycomputer.microsoft.com/api/data/v1/mosaic/tiles';

export function planetaryRasterUrl(sceneId:string,layer:Exclude<SatelliteLayerName,'reference'|'relief'>){
  if(!sceneIdPattern.test(sceneId))return null;
  const params=new URLSearchParams({collection:'sentinel-2-l2a',item:sceneId});
  if(layer==='truecolor')params.set('assets','visual');
  if(layer==='ndvi'){
    params.set('expression','(B08-B04)/(B08+B04)');params.set('rescale','-1,1');params.set('colormap_name','rdylgn');params.set('asset_as_band','true');
  }
  if(layer==='ndmi'){
    params.set('expression','(B8A-B11)/(B8A+B11)');params.set('rescale','-1,1');params.set('colormap_name','rdbu');params.set('asset_as_band','true');
  }
  return `${tileBase}?${params}`;
}

export function planetaryReliefUrl(mosaicSearchId:string){
  if(!mosaicIdPattern.test(mosaicSearchId))return null;
  const params=new URLSearchParams({
    collection:'cop-dem-glo-30',
    assets:'data',
    algorithm:'hillshade',
    colormap_name:'gray',
    buffer:'3',
    algorithm_params:JSON.stringify({azimuth:315,angle_altitude:45}),
  });
  return `${mosaicTileBase}/${mosaicSearchId}/WebMercatorQuad/{z}/{x}/{y}@1x?${params}`;
}
