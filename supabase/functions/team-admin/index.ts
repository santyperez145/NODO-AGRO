import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
};
const roles=['admin','agronomist','operator','viewer'] as const;
type TeamRole=(typeof roles)[number];

function response(status:number,body:Record<string,unknown>){
  return new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json','Cache-Control':'no-store'}});
}
function uuid(value:unknown):value is string{
  return typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function email(value:unknown){
  if(typeof value!=='string')return null;
  const normalized=value.trim().toLowerCase();
  return normalized.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)?normalized:null;
}
function safeFailureCode(error:{code?:string;status?:number;message?:string}){
  const source=error.code||String(error.status||'provider_error');
  return source.toLowerCase().replace(/[^a-z0-9_-]/g,'_').slice(0,120)||'provider_error';
}
function allowedRedirectOrigin(request:Request){
  const raw=request.headers.get('origin');
  if(!raw)return null;
  try{
    const parsed=new URL(raw);
    const loopback=(parsed.hostname==='localhost'||parsed.hostname==='127.0.0.1')&&parsed.protocol==='http:';
    if(loopback)return parsed.origin;
    const configured=(Deno.env.get('TEAM_ALLOWED_REDIRECT_ORIGINS')||'').split(',').map(value=>value.trim()).filter(Boolean);
    return parsed.protocol==='https:'&&configured.includes(parsed.origin)?parsed.origin:null;
  }catch{return null}
}

Deno.serve(async request=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(request.method!=='POST')return response(405,{error:'method_not_allowed'});

  const url=Deno.env.get('SUPABASE_URL');
  const anonKey=Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!anonKey||!serviceKey)return response(500,{error:'service_not_configured'});
  const authorization=request.headers.get('authorization');
  if(!authorization)return response(401,{error:'authentication_required'});
  const redirectOrigin=allowedRedirectOrigin(request);
  if(!redirectOrigin)return response(400,{error:'invalid_redirect_origin'});

  let payload:Record<string,unknown>;
  try{payload=await request.json()}catch{return response(400,{error:'invalid_json'})}
  const organizationId=payload.organization_id;
  const invitationEmail=email(payload.email);
  const invitationRole=payload.role;
  const requestId=payload.request_id;
  const expiresDays=Number(payload.expires_days??7);
  if(!uuid(organizationId)||!uuid(requestId)||!invitationEmail||!roles.includes(invitationRole as TeamRole)||!Number.isInteger(expiresDays)||expiresDays<1||expiresDays>14){
    return response(400,{error:'invalid_invitation'});
  }

  const authClient=createClient(url,anonKey,{global:{headers:{Authorization:authorization}},auth:{persistSession:false}});
  const {data:userData,error:userError}=await authClient.auth.getUser();
  if(userError||!userData.user)return response(401,{error:'invalid_session'});
  const admin=createClient(url,serviceKey,{auth:{persistSession:false}});
  const expiresAt=new Date(Date.now()+expiresDays*86_400_000).toISOString();
  const {data:invitationId,error:prepareError}=await admin.rpc('prepare_organization_invitation_server',{
    target_organization:organizationId,
    invitation_email:invitationEmail,
    invitation_role:invitationRole,
    invitation_expires_at:expiresAt,
    invitation_request_id:requestId,
    actor_user:userData.user.id,
  });
  if(prepareError){
    const code=safeFailureCode(prepareError);
    const status=code.includes('rate_limit')?429:code.includes('role')?403:409;
    return response(status,{error:code});
  }
  if(!uuid(invitationId))return response(500,{error:'invitation_not_created'});

  const invitationUrl=`${redirectOrigin}/?invitation=${invitationId}`;
  const {data:existingUserId,error:existingLookupError}=await admin.rpc('lookup_organization_invitation_user_server',{target_invitation:invitationId});
  if(existingLookupError)return response(500,{error:'existing_user_lookup_failed',invitation_id:invitationId});
  if(uuid(existingUserId)){
    const {error:markExistingError}=await admin.rpc('mark_organization_invitation_delivery_server',{
      target_invitation:invitationId,
      next_delivery_status:'not_required',
      target_provider_user:existingUserId,
      target_failure_code:null,
    });
    if(markExistingError)return response(500,{error:'delivery_state_not_persisted',invitation_id:invitationId});
    return response(200,{invitation_id:invitationId,delivery_status:'not_required',invitation_url:invitationUrl,expires_at:expiresAt});
  }
  const {data:inviteData,error:inviteError}=await admin.auth.admin.inviteUserByEmail(invitationEmail,{
    redirectTo:invitationUrl,
    data:{nodo_invitation_id:invitationId,nodo_organization_id:organizationId},
  });
  if(inviteError){
    const code=safeFailureCode(inviteError);
    const existingAccount=code.includes('email_exists')||code.includes('user_already_exists')||/already.{0,30}(registered|exists)/i.test(inviteError.message||'');
    await admin.rpc('mark_organization_invitation_delivery_server',{
      target_invitation:invitationId,
      next_delivery_status:existingAccount?'not_required':'failed',
      target_provider_user:null,
      target_failure_code:existingAccount?null:code,
    });
    if(existingAccount)return response(200,{invitation_id:invitationId,delivery_status:'not_required',invitation_url:invitationUrl,expires_at:expiresAt});
    return response(502,{error:'invitation_delivery_failed',provider_code:code,invitation_id:invitationId});
  }

  const {error:markError}=await admin.rpc('mark_organization_invitation_delivery_server',{
    target_invitation:invitationId,
    next_delivery_status:'sent',
    target_provider_user:inviteData.user?.id??null,
    target_failure_code:null,
  });
  if(markError)return response(500,{error:'delivery_state_not_persisted',invitation_id:invitationId});
  return response(201,{invitation_id:invitationId,delivery_status:'sent',expires_at:expiresAt});
});
