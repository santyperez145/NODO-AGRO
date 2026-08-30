import { useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, Bot, Check, ChevronRight, CircleDollarSign, Database, LoaderCircle, ShieldCheck, Sparkles, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useAiFeedback, useGenerateAiBrief, type AiAnalysisRun, type AiPriority, type Establishment, type Workspace } from './lib/workspace';
import './intelligence.css';

const domainLabels:Record<AiPriority['domain'],string>={crop:'Cultivos',livestock:'Rodeo',machinery:'Maquinaria',iot:'IoT',weather:'Clima',economy:'Economía'};
const severityLabels:Record<AiPriority['severity'],string>={critical:'Crítica',high:'Alta',medium:'Media',low:'Baja'};

function coverage(data:Workspace){
  return [
    ['Clima',Boolean(data.weather)],['Satélite',Boolean(data.satellite)],['IoT',data.devices.length>0],
    ['Cultivos',data.parcels.length>0],['Rodeo',data.livestockGroups.length>0],['Maquinaria',data.machineAssets.length>0],['Economía',data.financialEntries.length>0],
  ] as const;
}

export function IntelligenceBrief({data}:{data:Workspace}){
  const establishment=data.establishment as Establishment;
  const run=data.latestAiAnalysis as AiAnalysisRun|null;
  const [question,setQuestion]=useState('');
  const generate=useGenerateAiBrief();
  const feedback=useAiFeedback();
  const sources=useMemo(()=>coverage(data),[data]);
  const canGenerate=['owner','admin','agronomist','operator'].includes(data.organization?.role??'viewer');
  const submit=()=>generate.mutate({establishmentId:establishment.id,question});

  return <section className="intelligenceBrief" aria-labelledby="intelligence-title">
    <div className="intelligenceHeader">
      <div className="intelligenceIdentity"><span><Sparkles/></span><div><small>INTELIGENCIA TRANSVERSAL · AUDITABLE</small><h2 id="intelligence-title">Parte Inteligente NODO</h2><p>Cruza la operación completa y transforma datos trazables en prioridades accionables.</p></div></div>
      {run?<div className="qualityDial" aria-label={`Calidad de datos ${run.result.data_quality_score} de 100`}><strong>{run.result.data_quality_score}</strong><span>/100</span><small>CALIDAD DE DATOS</small></div>:<div className="intelligenceStatus"><Database/><span><b>{sources.filter(([,ready])=>ready).length}/{sources.length} dominios</b><small>listos para analizar</small></span></div>}
    </div>

    <div className="sourceCoverage" aria-label="Fuentes que alimentan el análisis">{sources.map(([label,ready])=><span className={ready?'ready':''} key={label}>{ready?<Check/>:<span/>}{label}</span>)}</div>

    {run?<div className="briefBody">
      <div className="briefSummary"><div><Bot/><span><small>LECTURA EJECUTIVA</small><time>{new Date(run.completed_at).toLocaleString(establishment.locale)}</time></span></div><p>{run.result.summary}</p>{run.question&&<blockquote>Pregunta analizada: “{run.question}”</blockquote>}</div>
      <div className="priorityGrid">{run.result.priorities.length?run.result.priorities.map((priority,index)=><PriorityCard priority={priority} index={index} key={`${priority.domain}-${priority.title}`}/>):<div className="briefEmpty"><ShieldCheck/><b>Sin prioridades críticas detectadas</b><span>El parte no encontró evidencia suficiente para elevar una acción.</span></div>}</div>
      <div className="briefFootnotes">
        <div><small>OPORTUNIDADES</small>{run.result.opportunities.length?<ul>{run.result.opportunities.map(item=><li key={item}>{item}</li>)}</ul>:<p>No se identificaron oportunidades sustentadas por los datos actuales.</p>}</div>
        <div><small>LÍMITES DEL ANÁLISIS</small>{run.result.limitations.length?<ul>{run.result.limitations.map(item=><li key={item}>{item}</li>)}</ul>:<p>El análisis no declaró limitaciones adicionales.</p>}</div>
      </div>
    </div>:<div className="intelligenceEmpty"><div><BarChart3/><h3>Tu operación ya puede convertirse en un parte ejecutivo</h3><p>El análisis utiliza sólo información persistida de {establishment.name}. No completa huecos con datos inventados y deja la evidencia exacta en auditoría.</p></div><ul><li>Prioriza riesgo productivo y continuidad operativa.</li><li>Conecta decisiones con impacto económico cualitativo.</li><li>Expone faltantes antes de afirmar conclusiones.</li></ul></div>}

    <div className="briefComposer">
      <div><label htmlFor="brief-question">Enfoque opcional</label><input id="brief-question" value={question} maxLength={500} disabled={!canGenerate||generate.isPending} onChange={event=>setQuestion(event.target.value)} placeholder="Ej.: ¿Qué debo priorizar esta semana para reducir pérdidas?"/><small>{question.length}/500 · Si lo dejás vacío, analiza toda la operación. No incluyas datos personales.</small></div>
      <button onClick={submit} disabled={!canGenerate||generate.isPending}>{generate.isPending?<LoaderCircle className="spin"/>:<Sparkles/>}{run?'Actualizar parte':'Generar parte'}</button>
    </div>
    {!canGenerate&&<div className="briefNotice"><ShieldCheck/>Tu rol puede consultar el último parte, pero sólo roles operativos autorizados pueden generar uno nuevo.</div>}
    {generate.error&&<div className="briefError" role="alert"><AlertTriangle/><div><b>No se generó el parte</b><span>{generate.error instanceof Error?generate.error.message:'Error no identificado'}</span></div></div>}
    {generate.isSuccess&&<div className="briefSuccess"><Check/>Parte actualizado, persistido y disponible para el equipo.</div>}

    <div className="intelligenceFooter"><span><ShieldCheck/>Toda acción crítica requiere validación humana. No sustituye criterio agronómico, veterinario, contable ni protocolos de seguridad.</span>{run&&<div><small>¿Fue útil?</small><button aria-label="Marcar útil" disabled={feedback.isPending} onClick={()=>feedback.mutate({runId:run.id,rating:'useful'})}><ThumbsUp/></button><button aria-label="Marcar poco útil" disabled={feedback.isPending} onClick={()=>feedback.mutate({runId:run.id,rating:'not_useful'})}><ThumbsDown/></button></div>}</div>
  </section>;
}

function PriorityCard({priority,index}:{priority:AiPriority;index:number}){
  return <article className={`aiPriority ${priority.severity}`}>
    <header><span>{String(index+1).padStart(2,'0')}</span><div><small>{domainLabels[priority.domain]}</small><strong>{priority.title}</strong></div><em>{severityLabels[priority.severity]}</em></header>
    <p>{priority.rationale}</p>
    <div className="suggestedAction"><ChevronRight/><span><small>ACCIÓN PROPUESTA</small><b>{priority.action}</b></span></div>
    <div className="priorityEconomics"><CircleDollarSign/><span><small>IMPACTO</small>{priority.economic_impact}</span></div>
    <details><summary>Evidencia usada · {priority.confidence}% confianza</summary><ul>{priority.evidence.map(item=><li key={item}>{item}</li>)}</ul></details>
    {priority.requires_human_approval&&<footer><ShieldCheck/>Requiere aprobación humana</footer>}
  </article>;
}
