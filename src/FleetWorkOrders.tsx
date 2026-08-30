import { useMemo, useState, type FormEvent } from 'react';
import { Ban, CalendarDays, CheckCircle2, ClipboardList, Coins, LoaderCircle, PauseCircle, Play, Plus, ShieldCheck, UserRound } from 'lucide-react';
import { useCreateMachineWorkOrder, useTransitionMachineWorkOrder, type MaintenanceWorkOrder, type Workspace } from './lib/workspace';

const today=()=>{const date=new Date();date.setMinutes(date.getMinutes()-date.getTimezoneOffset());return date.toISOString().slice(0,10)};
const statusLabel:Record<MaintenanceWorkOrder['status'],string>={open:'Abierta',scheduled:'Programada',in_progress:'En ejecución',blocked:'Bloqueada',completed:'Completada',cancelled:'Cancelada'};
const priorityLabel:Record<MaintenanceWorkOrder['priority'],string>={low:'Baja',medium:'Media',high:'Alta',critical:'Crítica'};
const typeLabel:Record<MaintenanceWorkOrder['work_type'],string>={preventive:'Preventiva',corrective:'Correctiva',inspection:'Inspección'};
const money=(value:number,currency:string)=>new Intl.NumberFormat('es-AR',{style:'currency',currency,maximumFractionDigits:0}).format(value);

export function FleetWorkOrders({data}:{data:Workspace}){
  const createOrder=useCreateMachineWorkOrder();
  const transition=useTransitionMachineWorkOrder();
  const currency=data.establishment!.base_currency;
  const availableMachines=data.machineAssets.filter(asset=>asset.status!=='retired');
  const [creating,setCreating]=useState(false);
  const [closing,setClosing]=useState<{id:string;next:'completed'|'cancelled'}|null>(null);
  const [form,setForm]=useState({machineId:availableMachines[0]?.id??'',workType:'preventive',title:'',description:'',priority:'medium',dueOn:'',responsible:'',estimatedCost:''});
  const [closingForm,setClosingForm]=useState({note:'',actualCost:'0'});
  const activeOrders=data.maintenanceWorkOrders.filter(order=>!['completed','cancelled'].includes(order.status));
  const overdue=activeOrders.filter(order=>order.due_on&&order.due_on<today());
  const completedThisMonth=data.maintenanceWorkOrders.filter(order=>order.status==='completed'&&order.completed_at?.slice(0,7)===today().slice(0,7));
  const monthCost=completedThisMonth.reduce((sum,order)=>sum+Number(order.actual_cost??0),0);
  const eventsByOrder=useMemo(()=>data.maintenanceWorkOrderEvents.reduce<Record<string,number>>((result,event)=>{result[event.work_order_id]=(result[event.work_order_id]??0)+1;return result},{}),[data.maintenanceWorkOrderEvents]);

  function submit(event:FormEvent){
    event.preventDefault();
    createOrder.mutate({machineId:form.machineId||availableMachines[0]?.id||'',workType:form.workType as MaintenanceWorkOrder['work_type'],title:form.title,description:form.description,priority:form.priority as MaintenanceWorkOrder['priority'],dueOn:form.dueOn||null,responsible:form.responsible,estimatedCost:form.estimatedCost===''?null:Number(form.estimatedCost)},{onSuccess:()=>{setCreating(false);setForm({...form,title:'',description:'',dueOn:'',responsible:'',estimatedCost:''})}});
  }

  function move(order:MaintenanceWorkOrder,next:MaintenanceWorkOrder['status']){
    transition.reset();
    if(next==='completed'||next==='cancelled'){setClosing({id:order.id,next});setClosingForm({note:'',actualCost:String(order.estimated_cost??0)});return}
    transition.mutate({workOrderId:order.id,nextStatus:next,closingNote:'',finalCost:null});
  }

  function submitClosing(event:FormEvent){
    event.preventDefault();
    if(!closing)return;
    transition.mutate({workOrderId:closing.id,nextStatus:closing.next,closingNote:closingForm.note,finalCost:closing.next==='completed'?Number(closingForm.actualCost):null},{onSuccess:()=>setClosing(null)});
  }

  return <section className="fleetOrders" aria-labelledby="fleet-orders-title">
    <div className="fleetOrdersHeader"><div><small>NODO FLOTA · EJECUCIÓN TRAZABLE</small><h3 id="fleet-orders-title">Órdenes de trabajo</h3><p>Planificá la intervención, medí el costo y cerrala con evidencia. El historial no se puede reescribir desde el navegador.</p></div><button disabled={!availableMachines.length} onClick={()=>{setCreating(value=>!value);createOrder.reset()}}><Plus/> {creating?'Cerrar':'Nueva orden'}</button></div>
    <div className="fleetOrderKpis"><span><b>{activeOrders.length}</b> activas</span><span className={overdue.length?'isRisk':''}><b>{overdue.length}</b> vencidas</span><span><b>{money(monthCost,currency)}</b> costo cerrado del mes</span></div>
    {!availableMachines.length&&<div className="fleetOrderEmpty"><ClipboardList/><div><b>Primero registrá una máquina operativa real</b><span>Las órdenes quedan vinculadas al activo, su horómetro y su historial técnico.</span></div></div>}
    {creating&&availableMachines.length>0&&<form className="operationForm fleetOrderForm" onSubmit={submit}><div className="formTitle"><ClipboardList/><div><h3>Nueva orden de trabajo</h3><p>El costo estimado es operativo y no crea un asiento contable.</p></div></div><div className="operationGrid">
      <label>Activo<select required value={form.machineId||availableMachines[0]?.id||''} onChange={event=>setForm({...form,machineId:event.target.value})}>{availableMachines.map(asset=><option key={asset.id} value={asset.id}>{asset.display_name}</option>)}</select></label>
      <label>Tipo<select value={form.workType} onChange={event=>setForm({...form,workType:event.target.value})}>{Object.entries(typeLabel).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <label>Prioridad<select value={form.priority} onChange={event=>setForm({...form,priority:event.target.value})}>{Object.entries(priorityLabel).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <label className="wideField">Trabajo a realizar<input required minLength={2} maxLength={160} value={form.title} onChange={event=>setForm({...form,title:event.target.value})} placeholder="Ej. Service preventivo de 500 horas"/></label>
      <label>Vencimiento<input type="date" min={today()} value={form.dueOn} onChange={event=>setForm({...form,dueOn:event.target.value})}/></label>
      <label>Responsable / proveedor<input maxLength={120} value={form.responsible} onChange={event=>setForm({...form,responsible:event.target.value})} placeholder="Ej. Taller Norte"/></label>
      <label>Costo estimado ({currency})<input type="number" min="0" step="0.01" value={form.estimatedCost} onChange={event=>setForm({...form,estimatedCost:event.target.value})} placeholder="Opcional"/></label>
      <label className="wideField">Alcance y evidencia esperada<textarea maxLength={1500} value={form.description} onChange={event=>setForm({...form,description:event.target.value})} placeholder="Repuestos, controles y criterio de aceptación"/></label>
    </div>{createOrder.error&&<p className="operationError">{createOrder.error instanceof Error?createOrder.error.message:'No se pudo crear la orden'}</p>}<button className="primaryOperation" disabled={createOrder.isPending}>{createOrder.isPending?<LoaderCircle className="spin"/>:<ShieldCheck/>}{createOrder.isPending?'Creando…':'Crear orden auditable'}</button></form>}
    {closing&&<form className="operationForm fleetClosing" onSubmit={submitClosing}><div className="formTitle">{closing.next==='completed'?<CheckCircle2/>:<Ban/>}<div><h3>{closing.next==='completed'?'Completar orden':'Cancelar orden'}</h3><p>Este cierre genera un evento inmutable y queda asociado al activo.</p></div></div><div className="operationGrid"><label className="wideField">Evidencia / motivo<textarea required minLength={2} maxLength={1000} value={closingForm.note} onChange={event=>setClosingForm({...closingForm,note:event.target.value})}/></label>{closing.next==='completed'&&<label>Costo final ({currency})<input required type="number" min="0" step="0.01" value={closingForm.actualCost} onChange={event=>setClosingForm({...closingForm,actualCost:event.target.value})}/></label>}</div>{transition.error&&<p className="operationError">{transition.error instanceof Error?transition.error.message:'No se pudo cerrar la orden'}</p>}<div className="fleetClosingActions"><button type="button" onClick={()=>setClosing(null)}>Volver</button><button className="primaryOperation" disabled={transition.isPending}>{transition.isPending?<LoaderCircle className="spin"/>:<ShieldCheck/>} Confirmar cierre</button></div></form>}
    {transition.error&&!closing&&<p className="operationError">{transition.error instanceof Error?transition.error.message:'No se pudo cambiar el estado'}</p>}
    <div className="fleetOrderList">{data.maintenanceWorkOrders.length?data.maintenanceWorkOrders.map(order=>{const machine=data.machineAssets.find(asset=>asset.id===order.machine_id);const isOverdue=order.due_on&&order.due_on<today()&&!['completed','cancelled'].includes(order.status);return <article className={`fleetOrderCard priority-${order.priority} ${isOverdue?'overdue':''}`} key={order.id}><div className="fleetOrderIdentity"><span className={`workStatus ${order.status}`}>{statusLabel[order.status]}</span><small>{typeLabel[order.work_type]} · {priorityLabel[order.priority]}</small><h4>{order.title}</h4><p>{machine?.display_name??'Activo histórico'}</p></div><div className="fleetOrderMeta"><span><CalendarDays/><b>{order.due_on?new Date(`${order.due_on}T12:00:00`).toLocaleDateString('es-AR'):'Sin fecha'}</b>{isOverdue&&<em>Vencida</em>}</span><span><UserRound/><b>{order.responsible??'Sin asignar'}</b></span><span><Coins/><b>{order.actual_cost!==null?money(Number(order.actual_cost),order.currency):order.estimated_cost!==null?`${money(Number(order.estimated_cost),order.currency)} est.`:'Sin costo'}</b></span><span><ClipboardList/><b>{eventsByOrder[order.id]??0} eventos</b></span></div><div className="fleetOrderActions">{order.status==='open'&&<button disabled={transition.isPending} onClick={()=>move(order,'scheduled')}><CalendarDays/> Programar</button>}{['open','scheduled','blocked'].includes(order.status)&&<button disabled={transition.isPending} onClick={()=>move(order,'in_progress')}><Play/> {order.status==='blocked'?'Retomar':'Iniciar'}</button>}{order.status==='in_progress'&&<button disabled={transition.isPending} onClick={()=>move(order,'blocked')}><PauseCircle/> Bloquear</button>}{order.status==='in_progress'&&<button disabled={transition.isPending} className="completeWork" onClick={()=>move(order,'completed')}><CheckCircle2/> Completar</button>}{!['completed','cancelled'].includes(order.status)&&<button disabled={transition.isPending} className="cancelWork" onClick={()=>move(order,'cancelled')}><Ban/> Cancelar</button>}</div></article>}):availableMachines.length>0&&<div className="fleetOrderEmpty"><ClipboardList/><div><b>No hay órdenes de trabajo</b><span>Creá la primera sólo cuando exista una intervención real que planificar.</span></div></div>}</div>
  </section>;
}
