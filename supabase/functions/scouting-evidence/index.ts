import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, x-finding-id, x-caption, x-captured-at, x-request-id, x-capture-source, x-file-name',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
};
const allowedTypes=new Map([['image/jpeg','jpg'],['image/png','png'],['image/webp','webp']]);
const maxBytes=8*1024*1024;
const scanAlgorithm='field-scan-v1';
const bazaarUrl='https://mb-api.abuse.ch/api/v1/';
const virusTotalUrl='https://www.virustotal.com/api/v3/files/';

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

function indexOfBytes(haystack:Uint8Array,needle:number[],start=0){
  outer:for(let index=start;index<=haystack.length-needle.length;index+=1){
    for(let offset=0;offset<needle.length;offset+=1)if(haystack[index+offset]!==needle[offset])continue outer;
    return index;
  }
  return -1;
}
function lastIndexOfBytes(haystack:Uint8Array,needle:number[]){
  for(let index=haystack.length-needle.length;index>=0;index-=1){
    if(needle.every((value,offset)=>haystack[index+offset]===value))return index;
  }
  return -1;
}
function riffPayloadSize(bytes:Uint8Array){
  if(bytes.length<8)return null;
  return bytes[4]|bytes[5]<<8|bytes[6]<<16|bytes[7]<<24;
}

function structuralFindings(bytes:Uint8Array,mime:string){
  const findings:string[]=[];
  const searchFrom=mime==='image/webp'?12:16;
  const signatures:[string,number[]][]=[
    ['embedded_pe',[0x4d,0x5a]],
    ['embedded_elf',[0x7f,0x45,0x4c,0x46]],
    ['embedded_zip',[0x50,0x4b,0x03,0x04]],
    ['embedded_pdf',[0x25,0x50,0x44,0x46]],
    ['embedded_ole',[0xd0,0xcf,0x11,0xe0]],
    ['embedded_html',[0x3c,0x68,0x74,0x6d,0x6c]],
    ['embedded_script',[0x3c,0x73,0x63,0x72,0x69,0x70,0x74]],
    ['embedded_svg',[0x3c,0x73,0x76,0x67]],
  ];
  for(const [code,needle] of signatures){
    if(indexOfBytes(bytes,needle,searchFrom)>=0)findings.push(code);
  }
  if(mime==='image/jpeg'){
    const eoi=lastIndexOfBytes(bytes,[0xff,0xd9]);
    if(eoi>=0&&bytes.length-eoi-2>32)findings.push('jpeg_trailer');
  }
  if(mime==='image/png'){
    const iend=lastIndexOfBytes(bytes,[0x00,0x00,0x00,0x00,0x49,0x45,0x4e,0x44,0xae,0x42,0x60,0x82]);
    if(iend>=0&&bytes.length-iend-12>8)findings.push('png_trailer');
  }
  if(mime==='image/webp'){
    const declared=riffPayloadSize(bytes);
    if(declared!==null&&declared+8<bytes.length-16)findings.push('riff_trailer');
  }
  return findings;
}

async function fetchJson(url:string,init:RequestInit,timeoutMs=8000){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const result=await fetch(url,{...init,signal:controller.signal});
    const payload=await result.json().catch(()=>null);
    return{ok:result.ok,status:result.status,payload};
  }finally{clearTimeout(timeout)}
}

async function catalogHits(sha256:string){
  const hits:Array<Record<string,unknown>>=[];
  const limitations:string[]=[];
  const providers:string[]=['nodo-structural'];
  let catalogMiss=false;
  try{
    const bazaar=await fetchJson(bazaarUrl,{
      method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'NODO-ScoutField/field-scan-v1'},
      body:new URLSearchParams({query:'get_info',hash:sha256}),
    });
    providers.push('malwarebazaar');
    const status=typeof (bazaar.payload as {query_status?:unknown}|null)?.query_status==='string'?(bazaar.payload as {query_status:string}).query_status:'';
    if(bazaar.ok&&status==='ok')hits.push({provider:'malwarebazaar',result:'known_sample'});
    else if(bazaar.ok&&(status==='hash_not_found'||status==='no_results'||status===''))catalogMiss=true;
    else limitations.push('MalwareBazaar no confirmó ausencia; sólo se consultó el hash.');
  }catch{
    limitations.push('El catálogo MalwareBazaar no respondió; no se envió el archivo.');
  }

  const virusTotalKey=Deno.env.get('VIRUSTOTAL_API_KEY')?.trim();
  if(virusTotalKey){
    try{
      const report=await fetchJson(`${virusTotalUrl}${sha256}`,{headers:{'x-apikey':virusTotalKey,'Accept':'application/json'}});
      providers.push('virustotal');
      if(report.status===404){
        catalogMiss=true;
      }else if(report.ok){
        const stats=(report.payload as {data?:{attributes?:{last_analysis_stats?:{malicious?:unknown;suspicious?:unknown}}}}|null)?.data?.attributes?.last_analysis_stats;
        const malicious=typeof stats?.malicious==='number'?stats.malicious:0;
        const suspicious=typeof stats?.suspicious==='number'?stats.suspicious:0;
        if(malicious>0||suspicious>0)hits.push({provider:'virustotal',malicious,suspicious});
        else catalogMiss=true;
      }else{
        limitations.push('VirusTotal no devolvió un informe de hash.');
      }
    }catch{
      limitations.push('VirusTotal no respondió; no se envió el archivo.');
    }
  }else{
    limitations.push('Sin clave VirusTotal: no hay segundo catálogo de hashes.');
  }
  return{hits,limitations,providers,catalogMiss};
}

function scanVerdict(findings:string[],hits:Array<Record<string,unknown>>,catalogMiss:boolean){
  if(findings.length||hits.length)return 'blocked' as const;
  return catalogMiss?'clean' as const:'unknown' as const;
}

async function persistScan(admin:AdminClient,input:{
  organizationId:string;establishmentId:string;mediaId:string|null;objectPath:string;sha256:string;
  verdict:'clean'|'unknown'|'blocked';providers:string[];findings:string[];hits:Array<Record<string,unknown>>;
  limitations:string[];requestId:string;
}){
  const {data,error}=await admin.rpc('record_scouting_media_scan_server',{
    target_organization:input.organizationId,target_establishment:input.establishmentId,target_media:input.mediaId,
    target_object_path:input.objectPath,media_sha256:input.sha256,scan_verdict:input.verdict,scan_algorithm:scanAlgorithm,
    scan_providers:input.providers,structural_findings:input.findings,catalog_hits:input.hits,scan_limitations:input.limitations,
    request_id:input.requestId,
  });
  if(error)throw error;
  return data as string;
}

async function cachedBlockedScan(admin:AdminClient,organizationId:string,sha256:string){
  const {data,error}=await admin.from('scouting_media_scans')
    .select('id,verdict,structural_findings,catalog_hits,providers,limitations')
    .eq('organization_id',organizationId).eq('sha256',sha256).eq('algorithm_version',scanAlgorithm).eq('verdict','blocked')
    .order('scanned_at',{ascending:false}).limit(1).maybeSingle();
  if(error)throw error;
  return data;
}

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

async function attachVerified(admin:AdminClient,userId:string,finding:{organization_id:string;establishment_id:string},metadata:EvidenceMetadata,path:string,bytes:Uint8Array){
  if(bytes.length!==metadata.sizeBytes||!validSignature(bytes,metadata.mimeType)){
    await admin.storage.from('scouting-evidence').remove([path]);
    return response(415,{error:'uploaded_file_validation_failed'});
  }
  const sha256=await digestHex(bytes);
  if(sha256!==metadata.sha256){await admin.storage.from('scouting-evidence').remove([path]);return response(409,{error:'uploaded_file_digest_mismatch'});}

  const cached=await cachedBlockedScan(admin,finding.organization_id,sha256);
  const findings=cached?((cached.structural_findings as string[])??[]):structuralFindings(bytes,metadata.mimeType);
  const catalogs=cached?{hits:(cached.catalog_hits as Array<Record<string,unknown>>)??[],limitations:(cached.limitations as string[])??[],providers:(cached.providers as string[])??['nodo-structural'],catalogMiss:false}:await catalogHits(sha256);
  const verdict=cached?'blocked':scanVerdict(findings,catalogs.hits,catalogs.catalogMiss);
  const limitations=[
    ...(catalogs.limitations??[]),
    'NODO consulta hashes, no envía la fotografía a un catálogo.',
    'Esto no es un antivirus certificado ni una moderación visual.',
  ];
  try{
    await persistScan(admin,{
      organizationId:finding.organization_id,establishmentId:finding.establishment_id,mediaId:null,objectPath:path,sha256,
      verdict,providers:catalogs.providers,findings,hits:catalogs.hits,limitations,requestId:metadata.requestId,
    });
  }catch(error){
    await admin.storage.from('scouting-evidence').remove([path]);
    return response(502,{error:'field_scan_persist_failed',detail:error instanceof Error?error.message:'scan_write_failed'});
  }
  if(verdict==='blocked'){
    await admin.storage.from('scouting-evidence').remove([path]);
    return response(415,{error:'media_blocked_by_field_scan',findings,catalog_hits:catalogs.hits});
  }

  const {data:mediaId,error:attachError}=await admin.rpc('attach_scouting_media_server',{
    target_finding:metadata.findingId,target_object_path:path,media_filename:metadata.filename,media_mime_type:metadata.mimeType,media_size_bytes:bytes.length,
    media_sha256:sha256,media_capture_source:metadata.captureSource,media_captured_at:metadata.capturedAt,media_caption:metadata.caption,
    request_id:metadata.requestId,actor_user:userId,
  });
  if(attachError){await admin.storage.from('scouting-evidence').remove([path]);return response(409,{error:'evidence_attach_failed',detail:attachError.message});}
  return response(201,{media_id:mediaId,finding_id:metadata.findingId,sha256,size_bytes:bytes.length,mime_type:metadata.mimeType,scan_verdict:verdict,scan_algorithm:scanAlgorithm});
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
      const blocked=await cachedBlockedScan(admin,authorizationResult.finding.organization_id,metadata.sha256);
      if(blocked)return response(415,{error:'media_blocked_by_field_scan'});
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
      return attachVerified(admin,userData.user.id,authorizationResult.finding,metadata,path,new Uint8Array(await blob.arrayBuffer()));
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
  return attachVerified(admin,userData.user.id,authorizationResult.finding,metadata,path,bytes);
});
