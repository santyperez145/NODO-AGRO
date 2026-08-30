import { type FormEvent, useMemo, useState } from 'react';
import { AlertTriangle, Check, Clock3, Copy, LoaderCircle, Mail, ShieldCheck, Trash2, UserCog, UserPlus, Users } from 'lucide-react';
import { useChangeMemberRole, useInviteOrganizationMember, useOrganizationTeam, useRemoveOrganizationMember, useRevokeOrganizationInvitation, type EditableTeamRole, type TeamInvitation, type TeamMember, type TeamRole } from './lib/team';
import type { OrganizationMembership } from './lib/workspace';
import './team.css';

const roleLabels:Record<TeamRole,string>={owner:'Propietario',admin:'Administrador',agronomist:'Agrónomo',operator:'Operador',viewer:'Consulta'};
const editableRoles:EditableTeamRole[]=['admin','agronomist','operator','viewer'];
const invitationLabels:Record<TeamInvitation['status'],string>={pending:'Pendiente',accepted:'Aceptada',revoked:'Revocada',expired:'Vencida'};
const deliveryLabels:Record<TeamInvitation['delivery_status'],string>={queued:'En cola',sent:'Correo solicitado',not_required:'Entrega manual',failed:'Envío fallido'};

function errorText(error:unknown){return error instanceof Error?error.message:'Error inesperado'}
function dateTime(value:string|null){return value?new Intl.DateTimeFormat('es-AR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'Nunca'}

export function TeamPanel({organization}:{organization:OrganizationMembership}){
  const manager=organization.role==='owner'||organization.role==='admin';
  const team=useOrganizationTeam(organization.id,manager);
  const invite=useInviteOrganizationMember(organization.id);
  const changeRole=useChangeMemberRole(organization.id);
  const remove=useRemoveOrganizationMember(organization.id);
  const revoke=useRevokeOrganizationInvitation(organization.id);
  const [email,setEmail]=useState('');
  const [role,setRole]=useState<EditableTeamRole>('operator');
  const [expiresDays,setExpiresDays]=useState(7);
  const [confirmRemove,setConfirmRemove]=useState<string|null>(null);
  const [confirmRevoke,setConfirmRevoke]=useState<string|null>(null);
  const [notice,setNotice]=useState<{tone:'ok'|'error';text:string}|null>(null);
  const activeInvitations=useMemo(()=>team.data?.invitations.filter(item=>item.status==='pending')??[],[team.data]);

  async function submit(event:FormEvent){
    event.preventDefault();setNotice(null);
    try{
      const result=await invite.mutateAsync({email,role,expiresDays});
      setEmail('');
      setNotice(result.delivery_status==='sent'
        ?{tone:'ok',text:'Invitación registrada y entrega solicitada al proveedor de correo.'}
        :{tone:'ok',text:'La cuenta ya existe. Compartí el enlace seguro que aparece en Invitaciones.'});
    }catch(error){setNotice({tone:'error',text:errorText(error)})}
  }
  async function copyInvitation(id:string){
    try{await navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}?invitation=${id}`);setNotice({tone:'ok',text:'Enlace seguro copiado. Sólo funciona con el correo invitado.'})}
    catch{setNotice({tone:'error',text:'El navegador no permitió copiar. Abrí el sitio con HTTPS o copiá el enlace manualmente.'})}
  }
  async function updateRole(member:TeamMember,next:EditableTeamRole){
    setNotice(null);try{await changeRole.mutateAsync({userId:member.user_id,role:next});setNotice({tone:'ok',text:`Rol de ${member.display_name} actualizado.`})}catch(error){setNotice({tone:'error',text:errorText(error)})}
  }
  async function removeMember(member:TeamMember){
    setNotice(null);try{await remove.mutateAsync(member.user_id);setConfirmRemove(null);setNotice({tone:'ok',text:`${member.display_name} ya no tiene acceso a ${organization.name}.`})}catch(error){setNotice({tone:'error',text:errorText(error)})}
  }
  async function revokeInvitation(invitation:TeamInvitation){
    setNotice(null);try{await revoke.mutateAsync(invitation.id);setConfirmRevoke(null);setNotice({tone:'ok',text:`Invitación para ${invitation.email} revocada.`})}catch(error){setNotice({tone:'error',text:errorText(error)})}
  }

  if(!manager)return <section className="teamDenied"><ShieldCheck/><h2>Tu acceso está administrado</h2><p>Los propietarios y administradores gestionan integrantes, roles e invitaciones.</p></section>;
  if(team.isLoading)return <div className="mapLoading"><LoaderCircle className="spin"/>Cargando directorio seguro…</div>;
  if(team.error)return <section className="teamDenied error"><AlertTriangle/><h2>No pudimos cargar el equipo</h2><p>{errorText(team.error)}</p><button onClick={()=>team.refetch()}>Reintentar</button></section>;
  const data=team.data!;

  return <div className="teamModule">
    <section className="teamIntro"><div><small>IDENTIDAD Y ACCESO · MULTIEMPRESA</small><h2>Equipo de {organization.name}</h2><p>Asigná el menor privilegio necesario. Las bajas cortan el acceso a los datos de esta empresa sin borrar la cuenta personal.</p></div><span><ShieldCheck/> Control auditado</span></section>
    <section className="teamMetrics"><Metric icon={Users} value={data.members.length} label="miembros activos"/><Metric icon={Clock3} value={activeInvitations.length} label="invitaciones pendientes"/><Metric icon={UserCog} value={data.members.filter(item=>['owner','admin'].includes(item.role)).length} label="responsables de acceso"/></section>
    {notice&&<div className={`teamNotice ${notice.tone}`}>{notice.tone==='ok'?<Check/>:<AlertTriangle/>}<span>{notice.text}</span></div>}
    <section className="teamGrid"><form className="inviteCard" onSubmit={submit}><div className="teamTitle"><span><UserPlus/></span><div><h3>Invitar integrante</h3><p>La invitación vence y sólo puede aceptarla el correo indicado.</p></div></div>
      <label>Correo corporativo<input type="email" required value={email} onChange={event=>setEmail(event.target.value)} placeholder="persona@empresa.com" autoComplete="email"/></label>
      <div className="teamFormRow"><label>Rol<select value={role} onChange={event=>setRole(event.target.value as EditableTeamRole)}>{editableRoles.filter(item=>organization.role==='owner'||item!=='admin').map(item=><option value={item} key={item}>{roleLabels[item]}</option>)}</select></label><label>Vencimiento<select value={expiresDays} onChange={event=>setExpiresDays(Number(event.target.value))}><option value={3}>3 días</option><option value={7}>7 días</option><option value={14}>14 días</option></select></label></div>
      <RoleGuide role={role}/><button className="teamPrimary" disabled={invite.isPending}>{invite.isPending?<LoaderCircle className="spin"/>:<Mail/>} Enviar invitación</button>
      <p className="deliveryBoundary">La entrega efectiva depende del SMTP configurado. NODO informa fallos y nunca marca un correo como enviado en silencio.</p>
    </form>
    <article className="membersCard"><div className="teamTitle"><span><Users/></span><div><h3>Accesos activos</h3><p>{data.members.length} identidades con acceso a esta empresa.</p></div></div><div className="memberList">{data.members.map(member=><MemberRow key={member.user_id} member={member} actor={organization} busy={changeRole.isPending||remove.isPending} confirming={confirmRemove===member.user_id} onConfirm={()=>setConfirmRemove(member.user_id)} onCancel={()=>setConfirmRemove(null)} onRole={next=>void updateRole(member,next)} onRemove={()=>void removeMember(member)}/>)}</div></article></section>
    <section className="invitationsCard"><div className="teamTitle"><span><Mail/></span><div><h3>Invitaciones</h3><p>Historial de entrega, aceptación, vencimiento y revocación.</p></div></div>{data.invitations.length?<div className="invitationList">{data.invitations.map(invitation=><div className="invitationRow" key={invitation.id}><div><b>{invitation.email}</b><span>{roleLabels[invitation.role]} · creada {dateTime(invitation.created_at)}</span></div><div className="invitationStates"><em className={invitation.status}>{invitationLabels[invitation.status]}</em><em className={invitation.delivery_status}>{deliveryLabels[invitation.delivery_status]}</em></div><small>Vence {dateTime(invitation.expires_at)}{invitation.failure_code?` · ${invitation.failure_code}`:''}</small><div className="invitationActions">{invitation.status==='pending'&&invitation.delivery_status!=='sent'&&<button onClick={()=>void copyInvitation(invitation.id)}><Copy/> Copiar enlace</button>}{invitation.status==='pending'&&(confirmRevoke===invitation.id?<><button className="danger" disabled={revoke.isPending} onClick={()=>void revokeInvitation(invitation)}>Confirmar revocación</button><button onClick={()=>setConfirmRevoke(null)}>Cancelar</button></>:<button onClick={()=>setConfirmRevoke(invitation.id)}><Trash2/> Revocar</button>)}</div></div>)}</div>:<div className="emptyTeam"><Mail/><p>Todavía no hay invitaciones.</p></div>}</section>
  </div>;
}

function Metric({icon:Icon,value,label}:{icon:typeof Users;value:number;label:string}){return <article><Icon/><div><strong>{value}</strong><span>{label}</span></div></article>}
function RoleGuide({role}:{role:EditableTeamRole}){const text:Record<EditableTeamRole,string>={admin:'Gestiona accesos y la operación, excepto propietarios y otros administradores.',agronomist:'Planifica, valida recorridas y opera decisiones agronómicas.',operator:'Ejecuta tareas de campo asignadas y registra evidencia.',viewer:'Consulta la operación sin realizar cambios.'};return <p className="roleGuide"><ShieldCheck/>{text[role]}</p>}
function MemberRow({member,actor,busy,confirming,onConfirm,onCancel,onRole,onRemove}:{member:TeamMember;actor:OrganizationMembership;busy:boolean;confirming:boolean;onConfirm:()=>void;onCancel:()=>void;onRole:(role:EditableTeamRole)=>void;onRemove:()=>void}){
  const protectedMember=member.user_id===actor.userId||member.role==='owner'||(actor.role==='admin'&&member.role==='admin');
  const roles=editableRoles.filter(role=>actor.role==='owner'||role!=='admin');
  return <div className="memberRow"><span className="avatar">{member.display_name.slice(0,2).toUpperCase()}</span><div className="memberIdentity"><b>{member.display_name}</b><span>{member.email}</span><small>Último acceso: {dateTime(member.last_sign_in_at)}</small></div><div className="memberControls">{protectedMember?<em>{roleLabels[member.role]}</em>:<select aria-label={`Rol de ${member.display_name}`} disabled={busy} value={member.role} onChange={event=>onRole(event.target.value as EditableTeamRole)}>{roles.map(role=><option key={role} value={role}>{roleLabels[role]}</option>)}</select>}{!protectedMember&&(confirming?<div className="inlineConfirm"><span>¿Quitar acceso?</span><button className="danger" disabled={busy} onClick={onRemove}>Sí, quitar</button><button disabled={busy} onClick={onCancel}>Cancelar</button></div>:<button className="iconDanger" aria-label={`Quitar acceso a ${member.display_name}`} onClick={onConfirm}><Trash2/></button>)}</div></div>;
}
