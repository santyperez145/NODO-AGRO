import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, x-finding-id, x-caption, x-captured-at, x-request-id, x-capture-source, x-file-name',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
};
const allowedTypes=new Map([['image/jpeg','jpg'],['image/png','png'],['image/webp','webp']]);
const maxBytes=8*1024*1024;

function response(status:number,body:Record<string,unknown>){
  return new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json','Cache-Control':'no-store'}});
}
function uuid(value:string|null){return Boolean(value&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))}
function validSignature(bytes:Uint8Array,mime:string){
  if(mime==='image/jpeg')return bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;
  if(mime==='image/png')return bytes.length>=8&&[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a].every((value,index)=>bytes[index]===value);
  if(mime==='image/webp')return bytes.length>=12&&new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP';
  return false;
}
function safeFilename(raw:string|null,extension:string){
  let decoded='evidencia.'+extension;
  if(raw){try{decoded=decodeURIComponent(raw)}catch{decoded=raw}}
  const leaf=decoded.split(/[\\/]/).pop()?.replace(/[^\p{L}\p{N}._ -]/gu,'_').trim()||`evidencia.${extension}`;
  return leaf.slice(0,180);
}
function decodedHeader(raw:string|null){if(!raw)return '';try{return decodeURIComponent(raw)}catch{return raw}}

Deno.serve(async request=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(request.method!=='POST')return response(405,{error:'method_not_allowed'});

  const url=Deno.env.get('SUPABASE_URL');
  const anonKey=Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!anonKey||!serviceKey)return response(500,{error:'service_not_configured'});
  const authorization=request.headers.get('authorization');
  if(!authorization)return response(401,{error:'authentication_required'});

  const authClient=createClient(url,anonKey,{global:{headers:{Authorization:authorization}},auth:{persistSession:false}});
  const {data:userData,error:userError}=await authClient.auth.getUser();
  if(userError||!userData.user)return response(401,{error:'invalid_session'});

  const findingId=request.headers.get('x-finding-id');
  const requestId=request.headers.get('x-request-id');
  if(!uuid(findingId)||!uuid(requestId))return response(400,{error:'invalid_identifiers'});
  const mime=(request.headers.get('content-type')||'').split(';')[0].toLowerCase();
  const extension=allowedTypes.get(mime);
  if(!extension)return response(415,{error:'unsupported_media_type',allowed:[...allowedTypes.keys()]});
  const declaredLength=Number(request.headers.get('content-length')||0);
  if(declaredLength>maxBytes)return response(413,{error:'file_too_large',max_bytes:maxBytes});

  const capturedAtRaw=request.headers.get('x-captured-at');
  const capturedAt=new Date(capturedAtRaw||'');
  if(!Number.isFinite(capturedAt.getTime()))return response(400,{error:'invalid_capture_time'});
  const caption=decodedHeader(request.headers.get('x-caption')).trim();
  if(caption.length>500)return response(400,{error:'caption_too_long'});
  const captureSource=request.headers.get('x-capture-source');
  if(captureSource!=='camera'&&captureSource!=='library')return response(400,{error:'invalid_capture_source'});

  const bytes=new Uint8Array(await request.arrayBuffer());
  if(bytes.length<1||bytes.length>maxBytes)return response(413,{error:'invalid_file_size',max_bytes:maxBytes});
  if(!validSignature(bytes,mime))return response(415,{error:'file_signature_mismatch'});

  const admin=createClient(url,serviceKey,{auth:{persistSession:false}});
  const {data:existing}=await admin.from('scouting_finding_media').select('id,finding_id').eq('created_by',userData.user.id).eq('request_id',requestId).maybeSingle();
  if(existing)return response(200,{media_id:existing.id,finding_id:existing.finding_id,idempotent:true});

  const {data:finding,error:findingError}=await admin.from('scouting_findings')
    .select('id,organization_id,establishment_id,visit_id').eq('id',findingId).maybeSingle();
  if(findingError||!finding)return response(404,{error:'finding_not_found'});
  const {data:membership}=await admin.from('organization_members').select('role')
    .eq('organization_id',finding.organization_id).eq('user_id',userData.user.id).maybeSingle();
  if(!membership||!['owner','admin','agronomist','operator'].includes(membership.role))return response(403,{error:'insufficient_role'});
  const {data:visit}=await admin.from('scouting_visits').select('status,assigned_to').eq('id',finding.visit_id).maybeSingle();
  if(!visit||visit.status!=='in_progress')return response(409,{error:'visit_not_in_progress'});
  if(membership.role==='operator'&&visit.assigned_to!==userData.user.id)return response(403,{error:'visit_assigned_to_another_member'});

  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  const sha256=Array.from(digest,value=>value.toString(16).padStart(2,'0')).join('');
  const objectPath=`${finding.organization_id}/${finding.establishment_id}/${finding.visit_id}/${finding.id}/${crypto.randomUUID()}.${extension}`;
  const filename=safeFilename(request.headers.get('x-file-name'),extension);
  const {error:uploadError}=await admin.storage.from('scouting-evidence').upload(objectPath,bytes,{contentType:mime,cacheControl:'3600',upsert:false});
  if(uploadError)return response(502,{error:'storage_upload_failed',detail:uploadError.message});

  const {data:mediaId,error:attachError}=await admin.rpc('attach_scouting_media_server',{
    target_finding:finding.id,target_object_path:objectPath,media_filename:filename,media_mime_type:mime,media_size_bytes:bytes.length,
    media_sha256:sha256,media_capture_source:captureSource,media_captured_at:capturedAt.toISOString(),media_caption:caption,
    request_id:requestId,actor_user:userData.user.id,
  });
  if(attachError){
    await admin.storage.from('scouting-evidence').remove([objectPath]);
    return response(409,{error:'evidence_attach_failed',detail:attachError.message});
  }
  return response(201,{media_id:mediaId,finding_id:finding.id,sha256,size_bytes:bytes.length,mime_type:mime});
});
