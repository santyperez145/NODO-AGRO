import { lazy, Suspense, useState, type FormEvent } from 'react';
import { LoaderCircle, MapPin, ShieldCheck } from 'lucide-react';
import { useBootstrap } from './lib/workspace';

const LocationPicker = lazy(() => import('./LocationPicker').then(module => ({ default: module.LocationPicker })));

export function Onboarding() {
  const bootstrap = useBootstrap();
  const [form, setForm] = useState({ organizationName: '', establishmentName: '', latitude: '', longitude: '', areaHectares: '' });
  const [locationMessage, setLocationMessage] = useState('');
  const position = form.latitude && form.longitude ? { latitude:Number(form.latitude), longitude:Number(form.longitude) } : null;

  function locate() {
    setLocationMessage('Solicitando ubicación…');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => { setForm(value => ({ ...value, latitude: coords.latitude.toFixed(6), longitude: coords.longitude.toFixed(6) })); setLocationMessage('Ubicación capturada. Ajustá el marcador sobre el establecimiento si es necesario.'); },
      () => setLocationMessage('No se pudo obtener la ubicación. Ingresá coordenadas decimales manualmente.'),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    bootstrap.mutate({ ...form, latitude: Number(form.latitude), longitude: Number(form.longitude), areaHectares: Number(form.areaHectares) });
  }

  return <main className="onboardingPage"><section className="onboardingCard"><div className="onboardingIntro"><span><ShieldCheck/></span><small>CONFIGURACIÓN VERIFICADA</small><h1>Conectemos tu primer establecimiento</h1><p>NODO no inventa información productiva. Estas coordenadas alimentarán clima, catálogo satelital y futuras fuentes de sensores.</p></div><form onSubmit={submit}>
    <label>Empresa u organización<input required minLength={2} maxLength={120} value={form.organizationName} onChange={event=>setForm({...form,organizationName:event.target.value})} placeholder="Ej. Estancias del Sur"/></label>
    <label>Nombre del establecimiento<input required minLength={2} maxLength={120} value={form.establishmentName} onChange={event=>setForm({...form,establishmentName:event.target.value})} placeholder="Ej. La Esperanza"/></label>
    <label>Superficie total (hectáreas)<input required type="number" min="0.01" step="0.01" value={form.areaHectares} onChange={event=>setForm({...form,areaHectares:event.target.value})} placeholder="482"/></label>
    <Suspense fallback={<div className="mapLoading"><LoaderCircle className="spin"/>Cargando mapa…</div>}><LocationPicker position={position} onChange={(coordinates,label)=>{setForm(value=>({...value,latitude:coordinates.latitude.toFixed(6),longitude:coordinates.longitude.toFixed(6)}));setLocationMessage(label?`Ubicación seleccionada: ${label}`:'Punto seleccionado en el mapa.')}}/></Suspense>
    <button className="locationButton" type="button" onClick={locate}><MapPin/> Usar mi ubicación actual</button>{locationMessage&&<p className="formHint">{locationMessage}</p>}
    <details className="technicalCoordinates"><summary>Ver o ajustar coordenadas</summary><div className="coordinateGrid"><label>Latitud<input required type="number" min="-90" max="90" step="0.000001" value={form.latitude} onChange={event=>setForm({...form,latitude:event.target.value})} placeholder="Seleccioná un punto"/></label><label>Longitud<input required type="number" min="-180" max="180" step="0.000001" value={form.longitude} onChange={event=>setForm({...form,longitude:event.target.value})} placeholder="Seleccioná un punto"/></label></div></details>
    {bootstrap.error&&<p className="formError">{bootstrap.error instanceof Error?bootstrap.error.message:'No se pudo crear el establecimiento'}</p>}
    <button className="primaryButton" disabled={bootstrap.isPending||!position}>{bootstrap.isPending?<LoaderCircle className="spin"/>:'Crear espacio operativo'}</button>
  </form></section></main>;
}
