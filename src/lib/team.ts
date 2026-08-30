import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { supabase } from './supabase';

export const teamRoleSchema=z.enum(['owner','admin','agronomist','operator','viewer']);
export type TeamRole=z.infer<typeof teamRoleSchema>;
export type EditableTeamRole=Exclude<TeamRole,'owner'>;
export type TeamMember={user_id:string;display_name:string;email:string;role:TeamRole;joined_at:string;last_sign_in_at:string|null};
export type TeamInvitation={id:string;email:string;role:EditableTeamRole;status:'pending'|'accepted'|'revoked'|'expired';delivery_status:'queued'|'sent'|'not_required'|'failed';expires_at:string;created_at:string;failure_code:string|null};

const teamSchema=z.object({
  members:z.array(z.object({user_id:z.string().uuid(),display_name:z.string(),email:z.string(),role:teamRoleSchema,joined_at:z.string(),last_sign_in_at:z.string().nullable()})),
  invitations:z.array(z.object({id:z.string().uuid(),email:z.string(),role:teamRoleSchema.exclude(['owner']),status:z.enum(['pending','accepted','revoked','expired']),delivery_status:z.enum(['queued','sent','not_required','failed']),expires_at:z.string(),created_at:z.string(),failure_code:z.string().nullable()})),
});
const inviteResponseSchema=z.object({invitation_id:z.string().uuid(),delivery_status:z.enum(['sent','not_required']),invitation_url:z.string().url().optional(),expires_at:z.string()});

async function client(){if(!supabase)throw new Error('Supabase no está configurado');return supabase}
async function functionError(error:unknown){
  if(error&&typeof error==='object'&&'context' in error&&(error as {context?:unknown}).context instanceof Response){
    try{
      const payload=await ((error as {context:Response}).context).clone().json() as {error?:unknown;provider_code?:unknown};
      if(payload.error==='invitation_delivery_failed')return `El proveedor de correo rechazó el envío (${String(payload.provider_code??'sin código')}). La invitación quedó registrada para reintento.`;
      if(payload.error==='invitation_rate_limit')return 'Se alcanzó el límite seguro de 10 invitaciones por hora.';
      if(payload.error==='already_organization_member')return 'Ese correo ya pertenece a la empresa.';
      if(payload.error==='invitation_already_pending')return 'Ya existe una invitación pendiente para ese correo.';
      if(typeof payload.error==='string')return payload.error;
    }catch{/* the function returned a non-JSON error */}
  }
  return error instanceof Error?error.message:'Error inesperado';
}
function invalidateTeam(queryClient:ReturnType<typeof useQueryClient>,organizationId:string){
  return Promise.all([
    queryClient.invalidateQueries({queryKey:['team',organizationId]}),
    queryClient.invalidateQueries({queryKey:['workspace']}),
  ]);
}

export function useOrganizationTeam(organizationId:string,enabled=true){
  return useQuery({
    queryKey:['team',organizationId],enabled,staleTime:20_000,refetchInterval:60_000,
    queryFn:async()=>{const sdk=await client();const {data,error}=await sdk.rpc('list_organization_team',{target_organization:organizationId});if(error)throw error;return teamSchema.parse(data)},
  });
}
export function useInviteOrganizationMember(organizationId:string){
  const queryClient=useQueryClient();
  return useMutation({
    mutationFn:async(input:{email:string;role:EditableTeamRole;expiresDays:number})=>{
      const sdk=await client();
      const {data,error}=await sdk.functions.invoke('team-admin',{body:{organization_id:organizationId,email:input.email.trim(),role:input.role,expires_days:input.expiresDays,request_id:crypto.randomUUID()}});
      if(error)throw new Error(await functionError(error));
      if(data?.error)throw new Error(String(data.error));
      return inviteResponseSchema.parse(data);
    },
    onSuccess:()=>invalidateTeam(queryClient,organizationId),
  });
}
export function useChangeMemberRole(organizationId:string){
  const queryClient=useQueryClient();
  return useMutation({mutationFn:async(input:{userId:string;role:EditableTeamRole})=>{const sdk=await client();const {error}=await sdk.rpc('change_organization_member_role',{target_organization:organizationId,target_user:input.userId,new_member_role:input.role,request_id:crypto.randomUUID()});if(error)throw error},onSuccess:()=>invalidateTeam(queryClient,organizationId)});
}
export function useRemoveOrganizationMember(organizationId:string){
  const queryClient=useQueryClient();
  return useMutation({mutationFn:async(userId:string)=>{const sdk=await client();const {error}=await sdk.rpc('remove_organization_member',{target_organization:organizationId,target_user:userId,request_id:crypto.randomUUID()});if(error){if(error.message.includes('member_has_open_scouting_visits'))throw new Error('Reasigná primero sus recorridas planificadas o en curso.');throw error}},onSuccess:()=>invalidateTeam(queryClient,organizationId)});
}
export function useRevokeOrganizationInvitation(organizationId:string){
  const queryClient=useQueryClient();
  return useMutation({mutationFn:async(invitationId:string)=>{const sdk=await client();const {error}=await sdk.rpc('revoke_organization_invitation',{target_invitation:invitationId,request_id:crypto.randomUUID()});if(error)throw error},onSuccess:()=>invalidateTeam(queryClient,organizationId)});
}
