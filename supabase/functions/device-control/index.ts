import { createClient } from 'npm:@supabase/supabase-js@2';

const encoder=new TextEncoder();

class HttpError extends Error { constructor(public status:number,message:string){super(message)} }
function json(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}})}
async function sha256(value:string){const hash=await crypto.subtle.digest('SHA-256',encoder.encode(value));return Array.from(new Uint8Array(hash)).map(byte=>byte.toString(16).padStart(2,'0')).join('')}
function objectPayload(value:unknown,name:string){if(!value||typeof value!=='object'||Array.isArray(value))throw new HttpError(400,`${name} must be an object`);return value as Record<string,unknown>}

Deno.serve(async request=>{
  if(request.method!=='POST')return json({error:'Method not allowed'},405);
  try{
    const contentLength=Number(request.headers.get('content-length')??0);
    if(contentLength>32_768)throw new HttpError(413,'Payload too large');
    const token=request.headers.get('x-device-token');
    if(!token||token.length<32)throw new HttpError(401,'Device authentication required');
    const url=Deno.env.get('SUPABASE_URL');
    const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if(!url||!serviceKey)throw new Error('Runtime configuration is incomplete');
    const admin=createClient(url,serviceKey,{auth:{persistSession:false}});
    const {data:identity,error:identityError}=await admin.rpc('resolve_device_token',{candidate_digest:await sha256(token)});
    if(identityError)throw identityError;
    const device=identity?.[0];
    if(!device)throw new HttpError(401,'Invalid or revoked device token');
    const body=objectPayload(await request.json(),'body');
    const action=body.action;

    if(action==='poll'){
      const {data:commands,error:commandError}=await admin.rpc('claim_device_command',{target_device:device.device_id});
      if(commandError)throw commandError;
      const {data:twin,error:twinError}=await admin.from('device_twins').select('desired_state,desired_version').eq('device_id',device.device_id).single();
      if(twinError)throw twinError;
      const {error:presenceError}=await admin.from('devices').update({status:'online',last_seen_at:new Date().toISOString()}).eq('id',device.device_id);
      if(presenceError)throw presenceError;
      return json({command:commands?.[0]??null,desired_state:twin.desired_state,desired_version:twin.desired_version,server_time:new Date().toISOString()});
    }

    if(action==='ack'){
      if(typeof body.command_id!=='string'||!['succeeded','failed'].includes(String(body.status)))throw new HttpError(400,'Invalid acknowledgement');
      const result=body.result===undefined?{}:objectPayload(body.result,'result');
      const {error}=await admin.rpc('ack_device_command',{target_device:device.device_id,target_command:body.command_id,next_status:body.status,command_result:result});
      if(error)throw error;
      return json({accepted:true,received_at:new Date().toISOString()},202);
    }

    if(action==='report_state'){
      const state=objectPayload(body.state,'state');
      const stateVersion=Number(body.version);
      if(!Number.isInteger(stateVersion)||stateVersion<1)throw new HttpError(400,'version must be a positive integer');
      const {data:version,error}=await admin.rpc('report_device_state',{target_device:device.device_id,state_payload:state,state_version:stateVersion});
      if(error)throw error;
      return json({accepted:true,reported_version:version,received_at:new Date().toISOString()},202);
    }

    throw new HttpError(400,'Unsupported action');
  }catch(error){
    const status=error instanceof HttpError?error.status:500;
    console.error(JSON.stringify({event:'device_control_failed',status,message:error instanceof Error?error.message:String(error)}));
    return json({error:status===500?'Device control request failed':error instanceof Error?error.message:'Invalid request'},status);
  }
});
