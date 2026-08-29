import { useState, type FormEvent } from 'react';
import { LoaderCircle, MapPin, ShieldCheck } from 'lucide-react';
import { useBootstrap } from './lib/workspace';

export function Onboarding() {
  const bootstrap = useBootstrap();
  const [form, setForm] = useState({ organizationName: '', establishmentName: '', latitude: '', longitude: '', areaHectares: '' });
  const [locationMessage, setLocationMessage] = useState('');

  function locate() {
    setLocationMessage('Solicitando ubicación…');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => { setForm(value => ({ ...value, latitude: coords.latitude.toFixed(6), longitude: coords.longitude.toFixed(6) })); setLocationMessage('Ubicación capturada. Confirmá que corresponda al establecimiento.'); },
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
    <div className="coordinateGrid"><label>Latitud<input required type="number" min="-90" max="90" step="0.000001" value={form.latitude} onChange={event=>setForm({...form,latitude:event.target.value})} placeholder="-33.891300"/></label><label>Longitud<input required type="number" min="-180" max="180" step="0.000001" value={form.longitude} onChange={event=>setForm({...form,longitude:event.target.value})} placeholder="-60.573600"/></label></div>
    <button className="locationButton" type="button" onClick={locate}><MapPin/> Usar ubicación actual</button>{locationMessage&&<p className="formHint">{locationMessage}</p>}
    {bootstrap.error&&<p className="formError">{bootstrap.error instanceof Error?bootstrap.error.message:'No se pudo crear el establecimiento'}</p>}
    <button className="primaryButton" disabled={bootstrap.isPending}>{bootstrap.isPending?<LoaderCircle className="spin"/>:'Crear espacio operativo'}</button>
  </form></section></main>;
}
