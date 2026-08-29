import { useState } from 'react';
import { Activity, Beef, Bot, CloudRain, Droplets, Gauge, Leaf, LogOut, Map, Radio, Search, Tractor, TrendingUp, Wifi, ArrowRight } from 'lucide-react';
import { AuthGate } from './auth/AuthGate';
import { supabase } from './lib/supabase';
import { useAgroWeather } from './lib/weather';

const decisions = [
  ['AHORA', 'Mover el rodeo del Potrero 6', 'La oferta forrajera caerá bajo el objetivo en 36 h.', '+8 días de pasto'],
  ['HOY', 'Recorrer 14 ha del Lote Norte', 'El satélite detectó una anomalía que no coincide con humedad.', 'Riesgo medio'],
  ['ANTES DEL MARTES', 'Revisar sembradora Pionera', 'La vibración del cuerpo 7 aumentó 18%.', '126 ha protegidas'],
];
const lots = [['Lote Norte','Trigo · 142 ha',91],['Bajo Grande','Pastura · 86 ha',64],['La Loma','Soja · 118 ha',82],['Potrero 6','Ganadería · 54 ha',42]] as const;

function Dashboard(){
  const [active,setActive]=useState('Centro de mando');
  const weather = useAgroWeather();
  const signals = [
    [Droplets, 'Suelo', weather.data ? `${weather.data.humidity}%` : '—', 'Humedad relativa ambiente'],
    [CloudRain, 'Clima', weather.data ? `${weather.data.rain7d.toFixed(1)} mm` : '—', weather.isError ? 'Error de fuente' : 'Lluvia prevista · 7 días'],
    [Beef, 'Rodeo', '486', '2 con atención'], [Tractor, 'Máquinas', '87%', 'Disponibilidad'],
  ] as const;
  return <div className="app"><aside>
    <div className="logo"><span><Activity/></span><div><b>NODO</b><small>AGRO INTELLIGENCE</small></div></div>
    <div className="farm"><small>ESTABLECIMIENTO</small><b>Los Aromos</b><span>482 ha · Mixto</span></div>
    <nav>{[[Gauge,'Centro de mando'],[Map,'Mapa vivo'],[Leaf,'Cultivos'],[Beef,'Rodeo'],[Tractor,'Maquinaria'],[Radio,'Sensores'],[TrendingUp,'Economía']].map(([Icon,n])=><button className={active===n?'active':''} onClick={()=>setActive(n as string)} key={n as string}><Icon/><span>{n as string}</span></button>)}</nav>
    <div className="network"><Wifi/><div><b>Red NODO · En línea</b><small>12 sensores · 4 gateways</small></div></div><button className="logout" onClick={()=>void supabase?.auth.signOut()}><LogOut/> Cerrar sesión</button>
  </aside><main>
    <header><div><p>SÁBADO, 29 DE AGOSTO · CAMPAÑA 26/27</p><h1>El campo, en una sola mirada.</h1><span>NODO procesó 18.420 señales desde tu última visita.</span></div><div className="actions"><label><Search/><input placeholder="Buscar lote, animal o máquina"/></label><button><Bot/> Preguntar a NODO</button></div></header>
    <section className="hero"><article className="twin"><div className="title"><div><small>GEMELO DIGITAL · EN VIVO</small><h2>Los Aromos</h2></div><span>● Actualizado ahora</span></div><div className="map"><svg viewBox="0 0 700 330"><path className="p1" d="M60 55L287 35 315 145 205 207 48 170Z"/><path className="p2" d="M322 35L535 62 601 150 450 180 315 145Z"/><path className="p3" d="M48 178L205 214 303 163 375 292 102 302Z"/><path className="p4" d="M311 155L450 187 602 158 640 275 386 296Z"/><path className="road" d="M0 225Q245 198 365 135T700 94"/><circle cx="165" cy="112" r="8"/><circle cx="462" cy="109" r="8"/><circle className="alert" cx="520" cy="235" r="10"/><circle cx="210" cy="260" r="8"/><text x="125" y="118">Lote Norte</text><text x="425" y="115">La Loma</text><text x="164" y="266">Bajo Grande</text><text x="483" y="241">Potrero 6</text></svg></div></article>
      <article className="score"><small>ÍNDICE NODO</small><div><strong>78</strong><span>/100</span></div><h3>Operación estable</h3><p>El riesgo hídrico bajó, pero el Potrero 6 requiere una decisión hoy.</p><i><b/></i>{[['Producción','84'],['Recursos','76'],['Operación','73']].map(x=><dl key={x[0]}><dt>{x[0]}</dt><dd>{x[1]}</dd></dl>)}</article></section>
    <section className="signals">{signals.map(([Icon,a,b,c])=><article key={a} title={a==='Clima' ? weather.data?.source : undefined}><span><Icon/></span><div><small>{a}</small><strong>{weather.isLoading&&a==='Clima'?'…':b}</strong><p>{c}</p></div></article>)}</section>
    <section className="lower"><article className="panel"><div className="title"><div><h2>Decisiones prioritarias</h2><p>Ordenadas por impacto productivo y económico</p></div><em>3 activas</em></div>{decisions.map((d,i)=><div className="decision" key={d[1]}><span className={`num n${i}`}>{i+1}</span><div><small>{d[0]}</small><h3>{d[1]}</h3><p>{d[2]}</p></div><b>{d[3]}</b><button><ArrowRight/></button></div>)}</article>
      <article className="panel"><div className="title"><div><h2>Unidades productivas</h2><p>Estado integrado de cada ambiente</p></div></div>{lots.map((l,i)=><div className="lot" key={l[0]}><i className={`c${i}`}/><div><h3>{l[0]}</h3><p>{l[1]}</p></div><span><b style={{width:`${l[2]}%`}}/></span><strong>{l[2]}</strong></div>)}</article></section>
    <section className="insight"><span><Bot/></span><div><small>INSIGHT DEL DÍA</small><h2>La lluvia cambia el plan de la semana</h2><p>Podés postergar el riego del Lote Norte y reasignar 6 horas de tractor. Ahorro estimado: <b>US$ 186</b>.</p></div><button>Simular decisión <ArrowRight/></button></section>
  </main></div>
}

export function App(){ return <AuthGate><Dashboard/></AuthGate> }
