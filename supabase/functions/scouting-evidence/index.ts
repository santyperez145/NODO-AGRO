import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, x-finding-id, x-caption, x-captured-at, x-request-id, x-capture-source, x-file-name',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
};
const allowedTypes=new Map([['image/jpeg','jpg'],['image/png','png'],['image/webp','webp']]);
const maxBytes=8*1024*1024;

type AdminClient=ReturnType<typeof createClient>;
type EvidenceMetadata={
  findingId:string;
  requestId:string;
  mimeType:string;
  sizeBytes:number;
  sha256:string;
  capturedAt:string;
  captureSource:'camera'|'library';
  caption:string;
  filename:string;
};

function response(status:number,body:Record<string,unknown>){
  return new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json','Cache-Control':'no-store'}});
}
function uuid(value:unknown){return typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)}
function validSignature(bytes:Uint8Array,mime:string){
  if(mime==='image/jpeg')return bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;
  if(mime==='image/png')return bytes.length>=8&&[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a].every((value,index)=>bytes[index]===value);
  if(mime==='image/webp')return bytes.length>=12&&new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP';
  return false;
}
function safeFilename(raw:string,extension:string){
  const leaf=raw.split(/[\\/]/).pop()?.replace(/[^\p{L}\p{N}._ -]/gu,'_').trim()||`evidencia.${extension}`;
  return leaf.slice(0,180);
}
function decodedHeader(raw:string|null){if(!raw)return '';try{return decodeURIComponent(raw)}catch{return raw}}
function digestHex(bytes:Uint8Array){return crypto.subtle.digest('SHA-256',bytes).then(value=>Array.from(new Uint8Array(value),byte=>byte.toString(16).padStart(2,'0')).join(''))}
function evidenceResult(media:{id:string;finding_id:string;sha256:string;size_bytes:number;mime_type:string},idempotent=true){return{media_id:media.id,finding_id:media.finding_id,sha256:media.sha256,size_bytes:media.size_bytes,mime_type:media.mime_type,idempotent}}

function parseMetadata(value:unknown):EvidenceMetadata|null{
  if(typeof value!=='object'||!value)return null;
  const body=value as Record<string,unknown>;
  const capturedAt=new Date(typeof body.captured_at==='string'?body.captured_at:'');
  const caption=typeof body.caption==='string'?body.caption.trim():'';
  const mimeType=typeof body.mime_type==='string'?body.mime_type.toLowerCase():'';
  const sizeBytes=Number(body.size_bytes);
  const sha256=typeof body.sha256==='string'?body.sha256.toLowerCase():'';
  const captureSource=body.capture_source;
  const extension=allowedTypes.get(mimeType);
  if(!uuid(body.finding_id)||!uuid(body.request_id)||!extension||!Number.isInteger(sizeBytes)||sizeBytes<1||sizeBytes>maxBytes||!Number.isFinite(capturedAt.getTime())||caption.length>500||!/^([0-9a-f]{64})$/.test(sha256)||(captureSource!=='camera'&&captureSource!=='library'))return null;
  return{findingId:body.finding_id as string,requestId:body.request_id as string,mimeType,sizeBytes,sha256,capturedAt:capturedAt.toISOString(),captureSource,caption,filename:safeFilename(typeof body.file_name==='string'?body.file_name:`evidencia.${extension}`,extension)};
}

async function existingMedia(admin:AdminClient,userId:string,requestId:string){
  const {data,error}=await admin.from('scouting_finding_media').select('id,finding_id,sha256,size_bytes,mime_type').eq('created_by',userId).eq('request_id',requestId).maybeSingle();
  if(error)throw error;
  return data as {id:string;finding_id:string;sha256:string;size_bytes:number;mime_type:string}|null;
}

async function authorizeFinding(admin:AdminClient,userId:string,findingId:string){
  const {data:finding,error:findingError}=await admin.from('scouting_findings').select('id,organization_id,establishment_id,visit_id').eq('id',findingId).maybeSingle();
  if(findingError||!finding)return{error:response(404,{error:'finding_not_found'})} as const;
  const {data:membership}=await admin.from('organization_members').select('role').eq('organization_id',finding.organization_id).eq('user_id',userId).maybeSingle();
  if(!membership||!['owner','admin','agronomist','operator'].includes(membership.role))return{error:response(403,{error:'insufficient_role'})} as const;
  const {data:visit}=await admin.from('scouting_visits').select('status,assigned_to').eq('id',finding.visit_id).maybeSingle();
  if(!visit||visit.status!=='in_progress')return{error:response(409,{error:'visit_not_in_progress'})} as const;
  if(membership.role==='operator'&&visit.assigned_to!==userId)return{error:response(403,{error:'visit_assigned_to_another_member'})} as const;
  return{finding} as const;
}

function objectPath(finding:{organization_id:string;establishment_id:string;visit_id:string;id:string},requestId:string,extension:string){return`${finding.organization_id}/${finding.establishment_id}/${finding.visit_id}/${finding.id}/${requestId}.${extension}`}

async function storedObject(admin:AdminClient,path:string){
  const separator=path.lastIndexOf('/');const folder=path.slice(0,separator);const filename=path.slice(separator+1);
  const {data,error}=await admin.storage.from('scouting-evidence').list(folder,{limit:2,search:filename});
  if(error)throw error;
  return data?.find(item=>item.name===filename)??null;
}

async function attachVerified(admin:AdminClient,userId:string,metadata:EvidenceMetadata,path:string,bytes:Uint8Array){
  if(bytes.length!==metadata.sizeBytes||!validSignature(bytes,metadata.mimeType)){
    await admin.storage.from('scouting-evidence').remove([path]);
    return response(415,{error:'uploaded_file_validation_failed'});
  }
  const sha256=await digestHex(bytes);
  if(sha256!==metadata.sha256){await admin.storage.from('scouting-evidence').remove([path]);return response(409,{error:'uploaded_file_digest_mismatch'});}
  const {data:mediaId,error:attachError}=await admin.rpc('attach_scouting_media_server',{
    target_finding:metadata.findingId,target_object_path:path,media_filename:metadata.filename,media_mime_type:metadata.mimeType,media_size_bytes:bytes.length,
    media_sha256:sha256,media_capture_source:metadata.captureSource,media_captured_at:metadata.capturedAt,media_caption:metadata.caption,
    request_id:metadata.requestId,actor_user:userId,
  });
  if(attachError){await admin.storage.from('scouting-evidence').remove([path]);return response(409,{error:'evidence_attach_failed',detail:attachError.message});}
  return response(201,{media_id:mediaId,finding_id:metadata.findingId,sha256,size_bytes:bytes.length,mime_type:metadata.mimeType});
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

  const authClient=createClient(url,anonKey,{global:{headers:{Authorization:authorization}},auth:{persistSession:false}});
  const {data:userData,error:userError}=await authClient.auth.getUser();
  if(userError||!userData.user)return response(401,{error:'invalid_session'});
  const admin=createClient(url,serviceKey,{auth:{persistSession:false}});

  const contentType=(request.headers.get('content-type')||'').split(';')[0].toLowerCase();
  if(contentType==='application/json'){
    let body:Record<string,unknown>;
    try{body=await request.json()}catch{return response(400,{error:'invalid_json'})}
    const action=body.action;
    const metadata=parseMetadata(body);
    if(!metadata)return response(400,{error:'invalid_evidence_metadata'});
    const existing=await existingMedia(admin,userData.user.id,metadata.requestId);
    if(existing){if(existing.finding_id!==metadata.findingId)return response(409,{error:'idempotency_conflict'});return response(200,{...evidenceResult(existing),status:'completed'});}
    const authorizationResult=await authorizeFinding(admin,userData.user.id,metadata.findingId);
    if('error' in authorizationResult)return authorizationResult.error;
    const extension=allowedTypes.get(metadata.mimeType)!;
    const path=objectPath(authorizationResult.finding,metadata.requestId,extension);

    if(action==='prepare_resumable'){
      const stored=await storedObject(admin,path);
      if(stored)return response(200,{status:'uploaded_pending_finalize',object_path:path});
      const {data,error}=await admin.storage.from('scouting-evidence').createSignedUploadUrl(path,{upsert:false});
      if(error||!data?.token)return response(502,{error:'signed_upload_failed',detail:error?.message??'missing_upload_token'});
      const projectRef=new URL(url).hostname.split('.')[0];
      const tusEndpoint=new URL(url).hostname.endsWith('.supabase.co')?`https://${projectRef}.storage.supabase.co/storage/v1/upload/resumable`:`${url.replace(/\/$/,'')}/storage/v1/upload/resumable`;
      return response(200,{status:'prepared',object_path:path,upload_token:data.token,tus_endpoint:tusEndpoint,expires_in_seconds:7200});
    }

    if(action==='finalize_resumable'){
      if(body.object_path!==path)return response(400,{error:'invalid_object_path'});
      const {data:blob,error:downloadError}=await admin.storage.from('scouting-evidence').download(path);
      if(downloadError||!blob)return response(404,{error:'uploaded_object_not_found',detail:downloadError?.message});
      return attachVerified(admin,userData.user.id,metadata,path,new Uint8Array(await blob.arrayBuffer()));
    }
    return response(400,{error:'invalid_action'});
  }

  const findingId=request.headers.get('x-finding-id');
  const requestId=request.headers.get('x-request-id');
  if(!uuid(findingId)||!uuid(requestId))return response(400,{error:'invalid_identifiers'});
  const extension=allowedTypes.get(contentType);
  if(!extension)return response(415,{error:'unsupported_media_type',allowed:[...allowedTypes.keys()]});
  const declaredLength=Number(request.headers.get('content-length')||0);
  if(declaredLength>maxBytes)return response(413,{error:'file_too_large',max_bytes:maxBytes});
  const capturedAt=new Date(request.headers.get('x-captured-at')||'');
  const caption=decodedHeader(request.headers.get('x-caption')).trim();
  const captureSource=request.headers.get('x-capture-source');
  if(!Number.isFinite(capturedAt.getTime())||caption.length>500||(captureSource!=='camera'&&captureSource!=='library'))return response(400,{error:'invalid_evidence_metadata'});
  const existing=await existingMedia(admin,userData.user.id,requestId as string);
  if(existing){if(existing.finding_id!==findingId)return response(409,{error:'idempotency_conflict'});return response(200,evidenceResult(existing));}
  const authorizationResult=await authorizeFinding(admin,userData.user.id,findingId as string);
  if('error' in authorizationResult)return authorizationResult.error;
  const bytes=new Uint8Array(await request.arrayBuffer());
  if(bytes.length<1||bytes.length>maxBytes)return response(413,{error:'invalid_file_size',max_bytes:maxBytes});
  if(!validSignature(bytes,contentType))return response(415,{error:'file_signature_mismatch'});
  const path=objectPath(authorizationResult.finding,requestId as string,extension);
  const filename=safeFilename(decodedHeader(request.headers.get('x-file-name')),extension);
  const {error:uploadError}=await admin.storage.from('scouting-evidence').upload(path,bytes,{contentType,cacheControl:'3600',upsert:false});
  if(uploadError)return response(502,{error:'storage_upload_failed',detail:uploadError.message});
  const metadata:EvidenceMetadata={findingId:findingId as string,requestId:requestId as string,mimeType:contentType,sizeBytes:bytes.length,sha256:await digestHex(bytes),capturedAt:capturedAt.toISOString(),captureSource,caption,filename};
  return attachVerified(admin,userData.user.id,metadata,path,bytes);
});
