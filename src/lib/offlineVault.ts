import type { Establishment, OrganizationMembership, Parcel, ScoutingAssignee, ScoutingFinding, ScoutingFindingMedia, ScoutingVisit, Workspace } from './workspace';

export type OfflineVaultStatus='checking'|'unsupported'|'unconfigured'|'locked'|'unlocked';

export type OfflineVaultSnapshot={
  status:OfflineVaultStatus;
  userId:string|null;
  configured:boolean;
  pendingCount:number;
  pendingFindingCount:number;
  pendingMediaCount:number;
  mediaBytes:number;
  storagePersisted:boolean|null;
  storageUsage:number|null;
  storageQuota:number|null;
  lastLockReason:'manual'|'timeout'|'session_changed'|null;
};

export type OfflineScoutingFindingDraft={
  schemaVersion:1;
  requestId:string;
  visitId:string;
  category:'crop_condition'|'pest_signal'|'water'|'soil'|'infrastructure'|'other';
  severity:'info'|'low'|'medium'|'high'|'critical';
  observedAt:string;
  latitude:number|null;
  longitude:number|null;
  accuracyM:number|null;
  notes:string;
  savedAt:string;
};

export type OfflineDraftScope={userId:string;organizationId:string;establishmentId:string};

export type OfflineFieldPackagePayload={
  schemaVersion:1;
  userId:string;
  organizationId:string;
  establishmentId:string;
  preparedAt:string;
  expiresAt:string;
  organization:OrganizationMembership;
  establishment:Establishment;
  parcels:Parcel[];
  scoutingAssignees:ScoutingAssignee[];
  scoutingVisits:ScoutingVisit[];
  scoutingFindings:ScoutingFinding[];
  scoutingFindingMedia:ScoutingFindingMedia[];
};

export type OfflineFieldPackageMeta={preparedAt:string;expiresAt:string;visitCount:number;findingCount:number;mediaCount:number};

export type OfflineScoutingMediaDraft={
  schemaVersion:1;
  requestId:string;
  findingId:string|null;
  findingRequestId:string|null;
  originalFilename:string;
  mimeType:'image/jpeg'|'image/png'|'image/webp';
  sizeBytes:number;
  sha256:string;
  captureSource:'camera'|'library';
  capturedAt:string;
  caption:string;
  lastModified:number;
  tusUploadUrl:string|null;
  savedAt:string;
};

export type OfflineScoutingDraftView={
  id:string;
  organizationId:string;
  establishmentId:string;
  createdAt:string;
  updatedAt:string;
  attempts:number;
  lastError:string|null;
  payload:OfflineScoutingFindingDraft|null;
  decryptError:string|null;
};

export type OfflineScoutingMediaView={
  id:string;
  organizationId:string;
  establishmentId:string;
  createdAt:string;
  updatedAt:string;
  attempts:number;
  lastError:string|null;
  sizeBytes:number;
  payload:OfflineScoutingMediaDraft|null;
  decryptError:string|null;
};

type VaultProfile={
  userId:string;
  version:1;
  salt:string;
  verifierIv:string;
  verifierCiphertext:string;
  createdAt:string;
};

type EncryptedDraftRecord={
  id:string;
  userId:string;
  organizationId:string;
  establishmentId:string;
  kind:'scouting_finding';
  version:1;
  createdAt:string;
  updatedAt:string;
  attempts:number;
  lastError:string|null;
  iv:string;
  ciphertext:string;
};

type EncryptedMediaRecord={
  id:string;
  userId:string;
  organizationId:string;
  establishmentId:string;
  kind:'scouting_media';
  version:1;
  createdAt:string;
  updatedAt:string;
  attempts:number;
  lastError:string|null;
  sizeBytes:number;
  metadataIv:string;
  metadataCiphertext:string;
  fileIv:string;
  fileCiphertext:ArrayBuffer;
};

type EncryptedFieldPackageRecord={
  id:string;
  userId:string;
  organizationId:string;
  establishmentId:string;
  kind:'field_package';
  version:1;
  preparedAt:string;
  expiresAt:string;
  iv:string;
  ciphertext:string;
};

const DB_NAME='nodo-field-vault-v1';
const DB_VERSION=3;
const PROFILE_STORE='profiles';
const DRAFT_STORE='drafts';
const MEDIA_STORE='media';
const FIELD_PACKAGE_STORE='field_packages';
const PBKDF2_ITERATIONS=310_000;
const AUTO_LOCK_MS=15*60_000;
const VERIFIER_MARKER='NODO_FIELD_OFFLINE_V1';
const MAX_MEDIA_BYTES=8*1024*1024;
const MAX_MEDIA_ITEMS=12;
const MAX_MEDIA_TOTAL_BYTES=64*1024*1024;
const FIELD_PACKAGE_TTL_MS=24*60*60_000;
const MAX_FIELD_PACKAGE_BYTES=4*1024*1024;
const UUID_PATTERN=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FINDING_CATEGORIES=new Set<OfflineScoutingFindingDraft['category']>(['crop_condition','pest_signal','water','soil','infrastructure','other']);
const FINDING_SEVERITIES=new Set<OfflineScoutingFindingDraft['severity']>(['info','low','medium','high','critical']);
const MEDIA_TYPES=new Set<OfflineScoutingMediaDraft['mimeType']>(['image/jpeg','image/png','image/webp']);
const FIELD_ROLES=new Set<OrganizationMembership['role']>(['owner','admin','agronomist','operator']);
const encoder=new TextEncoder();
const decoder=new TextDecoder();

let snapshot:OfflineVaultSnapshot={status:'checking',userId:null,configured:false,pendingCount:0,pendingFindingCount:0,pendingMediaCount:0,mediaBytes:0,storagePersisted:null,storageUsage:null,storageQuota:null,lastLockReason:null};
let unlocked:{userId:string;key:CryptoKey}|null=null;
let lockTimer:ReturnType<typeof setTimeout>|null=null;
let initialization=0;
const listeners=new Set<()=>void>();

function supported(){return typeof indexedDB!=='undefined'&&typeof crypto!=='undefined'&&Boolean(crypto.subtle)}
function emit(next:OfflineVaultSnapshot){snapshot=next;listeners.forEach(listener=>listener())}
function bytesToBase64(bytes:Uint8Array){let binary='';for(let index=0;index<bytes.length;index+=0x8000)binary+=String.fromCharCode(...bytes.subarray(index,index+0x8000));return btoa(binary)}
function base64ToBytes(value:string){const binary=atob(value);const result=new Uint8Array(binary.length);for(let index=0;index<binary.length;index++)result[index]=binary.charCodeAt(index);return result}
function asBuffer(bytes:Uint8Array){return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer}
function randomBytes(length:number){return crypto.getRandomValues(new Uint8Array(length))}
function normalizedPassphrase(value:string){return value.normalize('NFKC')}
function nullableFinite(value:unknown,min:number,max:number){return value===null||(typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max)}
function validDraftPayload(value:unknown,recordId:string):value is OfflineScoutingFindingDraft{
  if(typeof value!=='object'||!value)return false;
  const draft=value as Partial<OfflineScoutingFindingDraft>;
  return draft.schemaVersion===1&&draft.requestId===recordId&&UUID_PATTERN.test(draft.requestId)&&typeof draft.visitId==='string'&&UUID_PATTERN.test(draft.visitId)
    &&typeof draft.category==='string'&&FINDING_CATEGORIES.has(draft.category as OfflineScoutingFindingDraft['category'])
    &&typeof draft.severity==='string'&&FINDING_SEVERITIES.has(draft.severity as OfflineScoutingFindingDraft['severity'])
    &&typeof draft.observedAt==='string'&&Number.isFinite(Date.parse(draft.observedAt))
    &&nullableFinite(draft.latitude,-90,90)&&nullableFinite(draft.longitude,-180,180)&&nullableFinite(draft.accuracyM,0,100_000)
    &&typeof draft.notes==='string'&&draft.notes.trim().length>=2&&draft.notes.length<=2000
    &&typeof draft.savedAt==='string'&&Number.isFinite(Date.parse(draft.savedAt));
}
function validMediaPayload(value:unknown,recordId:string):value is OfflineScoutingMediaDraft{
  if(typeof value!=='object'||!value)return false;
  const draft=value as Partial<OfflineScoutingMediaDraft>;
  const oneParent=(draft.findingId===null&&typeof draft.findingRequestId==='string'&&UUID_PATTERN.test(draft.findingRequestId))||(draft.findingRequestId===null&&typeof draft.findingId==='string'&&UUID_PATTERN.test(draft.findingId));
  return draft.schemaVersion===1&&draft.requestId===recordId&&UUID_PATTERN.test(draft.requestId)&&oneParent
    &&typeof draft.originalFilename==='string'&&draft.originalFilename.length>=1&&draft.originalFilename.length<=180
    &&typeof draft.mimeType==='string'&&MEDIA_TYPES.has(draft.mimeType as OfflineScoutingMediaDraft['mimeType'])
    &&typeof draft.sizeBytes==='number'&&Number.isInteger(draft.sizeBytes)&&draft.sizeBytes>=1&&draft.sizeBytes<=MAX_MEDIA_BYTES
    &&typeof draft.sha256==='string'&&/^[0-9a-f]{64}$/.test(draft.sha256)
    &&(draft.captureSource==='camera'||draft.captureSource==='library')&&typeof draft.capturedAt==='string'&&Number.isFinite(Date.parse(draft.capturedAt))
    &&typeof draft.caption==='string'&&draft.caption.length<=500&&typeof draft.lastModified==='number'&&Number.isFinite(draft.lastModified)
    &&(draft.tusUploadUrl===null||(typeof draft.tusUploadUrl==='string'&&draft.tusUploadUrl.startsWith('https://')&&draft.tusUploadUrl.length<=2048))
    &&typeof draft.savedAt==='string'&&Number.isFinite(Date.parse(draft.savedAt));
}
function objectValue(value:unknown):value is Record<string,unknown>{return typeof value==='object'&&value!==null&&!Array.isArray(value)}
function boundedString(value:unknown,min:number,max:number){return typeof value==='string'&&value.length>=min&&value.length<=max}
function validIso(value:unknown){return typeof value==='string'&&Number.isFinite(Date.parse(value))}
function uniqueUuid(value:string,seen:Set<string>){if(!UUID_PATTERN.test(value)||seen.has(value))return false;seen.add(value);return true}
function boundedJsonObject(value:unknown,maxBytes:number){if(!objectValue(value))return false;try{return encoder.encode(JSON.stringify(value)).byteLength<=maxBytes}catch{return false}}
function validFieldPackagePayload(value:unknown,record:EncryptedFieldPackageRecord):value is OfflineFieldPackagePayload{
  if(!objectValue(value))return false;
  const field=value as Partial<OfflineFieldPackagePayload>;
  if(field.schemaVersion!==1||field.userId!==record.userId||field.organizationId!==record.organizationId||field.establishmentId!==record.establishmentId||field.preparedAt!==record.preparedAt||field.expiresAt!==record.expiresAt||!validIso(field.preparedAt)||!validIso(field.expiresAt))return false;
  const prepared=Date.parse(field.preparedAt);const expires=Date.parse(field.expiresAt);
  if(expires<=prepared||expires-prepared>FIELD_PACKAGE_TTL_MS+60_000)return false;
  const organization=field.organization;const establishment=field.establishment;
  if(!organization||organization.id!==record.organizationId||organization.userId!==record.userId||!UUID_PATTERN.test(organization.id)||!FIELD_ROLES.has(organization.role)||!boundedString(organization.name,1,180))return false;
  if(!establishment||establishment.id!==record.establishmentId||establishment.organization_id!==record.organizationId||!UUID_PATTERN.test(establishment.id)||!boundedString(establishment.name,1,180)||typeof establishment.latitude!=='number'||!nullableFinite(establishment.latitude,-90,90)||typeof establishment.longitude!=='number'||!nullableFinite(establishment.longitude,-180,180)||!nullableFinite(establishment.area_hectares,0,1_000_000_000)||!boundedString(establishment.base_currency,3,3)||!boundedString(establishment.country_code,2,2)||!boundedString(establishment.locale,2,32)||!boundedString(establishment.timezone,1,80)||(establishment.unit_system!=='metric'&&establishment.unit_system!=='imperial'))return false;
  if(!Array.isArray(field.parcels)||field.parcels.length>500||!Array.isArray(field.scoutingAssignees)||field.scoutingAssignees.length>500||!Array.isArray(field.scoutingVisits)||field.scoutingVisits.length>200||!Array.isArray(field.scoutingFindings)||field.scoutingFindings.length>500||!Array.isArray(field.scoutingFindingMedia)||field.scoutingFindingMedia.length>500)return false;
  const parcels=field.parcels;const parcelIds=new Set<string>();
  if(!parcels.every(parcel=>uniqueUuid(parcel.id,parcelIds)&&boundedString(parcel.name,1,180)&&boundedString(parcel.use,1,100)&&(parcel.crop===null||boundedString(parcel.crop,1,120))&&Number.isFinite(parcel.area_hectares)&&parcel.area_hectares>=0&&parcel.area_hectares<=1_000_000_000&&parcel.health_score===null&&parcel.boundary_geojson===null))return false;
  const assigneeIds=new Set<string>();
  if(!field.scoutingAssignees.every(member=>uniqueUuid(member.user_id,assigneeIds)&&boundedString(member.display_name,1,180)&&['owner','admin','agronomist','operator'].includes(member.member_role)&&(organization.role!=='operator'||member.user_id===record.userId)))return false;
  const visitIds=new Set<string>();const visitParcels=new Map<string,string>();
  if(!field.scoutingVisits.every(visit=>{const valid=uniqueUuid(visit.id,visitIds)&&parcelIds.has(visit.parcel_id)&&['manual','satellite_ndvi','satellite_ndmi','weather','iot'].includes(visit.source_type)&&(visit.source_metric_id===null||UUID_PATTERN.test(visit.source_metric_id))&&boundedJsonObject(visit.source_snapshot,8192)&&boundedString(visit.title,1,160)&&(visit.objective===null||boundedString(visit.objective,0,1500))&&['low','medium','high','critical'].includes(visit.priority)&&['planned','in_progress'].includes(visit.status)&&validIso(visit.scheduled_for)&&(visit.assigned_to===null||UUID_PATTERN.test(visit.assigned_to))&&(organization.role!=='operator'||visit.assigned_to===record.userId)&&(visit.summary===null||boundedString(visit.summary,0,1500))&&(visit.started_at===null||validIso(visit.started_at))&&visit.completed_at===null&&visit.cancelled_at===null&&Number.isInteger(visit.lock_version)&&validIso(visit.created_at)&&validIso(visit.updated_at);if(valid)visitParcels.set(visit.id,visit.parcel_id);return valid}))return false;
  const findingIds=new Set<string>();const findingVisits=new Map<string,string>();
  if(!field.scoutingFindings.every(finding=>{const valid=uniqueUuid(finding.id,findingIds)&&visitParcels.get(finding.visit_id)===finding.parcel_id&&FINDING_CATEGORIES.has(finding.category)&&FINDING_SEVERITIES.has(finding.severity)&&validIso(finding.observed_at)&&nullableFinite(finding.latitude,-90,90)&&nullableFinite(finding.longitude,-180,180)&&nullableFinite(finding.accuracy_m,0,100_000)&&boundedString(finding.notes,1,2000)&&validIso(finding.created_at);if(valid)findingVisits.set(finding.id,finding.visit_id);return valid}))return false;
  const mediaIds=new Set<string>();
  if(!field.scoutingFindingMedia.every(media=>uniqueUuid(media.id,mediaIds)&&findingVisits.get(media.finding_id)===media.visit_id&&boundedString(media.object_path,1,1024)&&media.object_path.startsWith(`${record.organizationId}/${record.establishmentId}/`)&&boundedString(media.original_filename,1,180)&&MEDIA_TYPES.has(media.mime_type)&&Number.isInteger(media.size_bytes)&&media.size_bytes>=1&&media.size_bytes<=MAX_MEDIA_BYTES&&/^[0-9a-f]{64}$/.test(media.sha256)&&(media.capture_source==='camera'||media.capture_source==='library')&&validIso(media.captured_at)&&(media.caption===null||boundedString(media.caption,0,500))&&validIso(media.created_at)))return false;
  return true;
}
function verifierAad(userId:string){return encoder.encode(`${VERIFIER_MARKER}|${userId}|1`)}
function draftAad(record:Pick<EncryptedDraftRecord,'id'|'userId'|'organizationId'|'establishmentId'|'kind'|'version'>){return encoder.encode(`${record.userId}|${record.organizationId}|${record.establishmentId}|${record.kind}|${record.id}|${record.version}`)}
function mediaAad(record:Pick<EncryptedMediaRecord,'id'|'userId'|'organizationId'|'establishmentId'|'kind'|'version'>,part:'metadata'|'file'){return encoder.encode(`${record.userId}|${record.organizationId}|${record.establishmentId}|${record.kind}|${record.id}|${record.version}|${part}`)}
function fieldPackageAad(record:Pick<EncryptedFieldPackageRecord,'id'|'userId'|'organizationId'|'establishmentId'|'kind'|'version'|'preparedAt'|'expiresAt'>){return encoder.encode(`${record.userId}|${record.organizationId}|${record.establishmentId}|${record.kind}|${record.id}|${record.version}|${record.preparedAt}|${record.expiresAt}`)}

function requestResult<T>(request:IDBRequest<T>){return new Promise<T>((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error??new Error('No se pudo acceder al almacenamiento local'))})}
function transactionDone(transaction:IDBTransaction){return new Promise<void>((resolve,reject)=>{transaction.oncomplete=()=>resolve();transaction.onerror=()=>reject(transaction.error??new Error('Falló la transacción local'));transaction.onabort=()=>reject(transaction.error??new Error('La transacción local fue cancelada'))})}

function openDatabase(){
  if(!supported())return Promise.reject(new Error('Este navegador no ofrece cifrado y almacenamiento local compatibles'));
  return new Promise<IDBDatabase>((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,DB_VERSION);
    request.onupgradeneeded=()=>{
      const database=request.result;
      if(!database.objectStoreNames.contains(PROFILE_STORE))database.createObjectStore(PROFILE_STORE,{keyPath:'userId'});
      if(!database.objectStoreNames.contains(DRAFT_STORE)){
        const drafts=database.createObjectStore(DRAFT_STORE,{keyPath:'id'});
        drafts.createIndex('userId','userId',{unique:false});
      }
      if(!database.objectStoreNames.contains(MEDIA_STORE)){
        const media=database.createObjectStore(MEDIA_STORE,{keyPath:'id'});
        media.createIndex('userId','userId',{unique:false});
      }
      if(!database.objectStoreNames.contains(FIELD_PACKAGE_STORE)){
        const packages=database.createObjectStore(FIELD_PACKAGE_STORE,{keyPath:'id'});
        packages.createIndex('userId','userId',{unique:false});
      }
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error??new Error('No se pudo abrir la bóveda offline'));
    request.onblocked=()=>reject(new Error('Otra pestaña está bloqueando la actualización de la bóveda'));
  });
}

async function getProfile(userId:string){const database=await openDatabase();try{return await requestResult(database.transaction(PROFILE_STORE).objectStore(PROFILE_STORE).get(userId)) as VaultProfile|undefined}finally{database.close()}}
async function getDrafts(userId:string){const database=await openDatabase();try{return await requestResult(database.transaction(DRAFT_STORE).objectStore(DRAFT_STORE).index('userId').getAll(userId)) as EncryptedDraftRecord[]}finally{database.close()}}
async function getMediaRecords(userId:string){const database=await openDatabase();try{return await requestResult(database.transaction(MEDIA_STORE).objectStore(MEDIA_STORE).index('userId').getAll(userId)) as EncryptedMediaRecord[]}finally{database.close()}}
async function getFieldPackageRecords(userId:string){const database=await openDatabase();try{return await requestResult(database.transaction(FIELD_PACKAGE_STORE).objectStore(FIELD_PACKAGE_STORE).index('userId').getAll(userId)) as EncryptedFieldPackageRecord[]}finally{database.close()}}

async function vaultMetrics(userId:string){
  const [drafts,media]=await Promise.all([getDrafts(userId),getMediaRecords(userId)]);
  let storagePersisted:boolean|null=null;let storageUsage:number|null=null;let storageQuota:number|null=null;
  try{
    if(navigator.storage?.persisted)storagePersisted=await navigator.storage.persisted();
    if(navigator.storage?.estimate){const estimate=await navigator.storage.estimate();storageUsage=estimate.usage??null;storageQuota=estimate.quota??null}
  }catch{/* El estado de cuota es informativo; IndexedDB conserva el error operativo real. */}
  return{pendingFindingCount:drafts.length,pendingMediaCount:media.length,mediaBytes:media.reduce((total,item)=>total+item.sizeBytes,0),storagePersisted,storageUsage,storageQuota};
}

async function deriveKey(passphrase:string,salt:Uint8Array){
  const material=await crypto.subtle.importKey('raw',asBuffer(encoder.encode(normalizedPassphrase(passphrase))),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt:asBuffer(salt),iterations:PBKDF2_ITERATIONS,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}

async function encrypt(key:CryptoKey,value:unknown,aad:Uint8Array){
  const iv=randomBytes(12);
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv:asBuffer(iv),additionalData:asBuffer(aad)},key,asBuffer(encoder.encode(JSON.stringify(value))));
  return {iv:bytesToBase64(iv),ciphertext:bytesToBase64(new Uint8Array(ciphertext))};
}

async function decrypt<T>(key:CryptoKey,iv:string,ciphertext:string,aad:Uint8Array){
  const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:asBuffer(base64ToBytes(iv)),additionalData:asBuffer(aad)},key,asBuffer(base64ToBytes(ciphertext)));
  return JSON.parse(decoder.decode(plaintext)) as T;
}

async function encryptBytes(key:CryptoKey,value:ArrayBuffer,aad:Uint8Array){
  const iv=randomBytes(12);
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv:asBuffer(iv),additionalData:asBuffer(aad)},key,value);
  return{iv:bytesToBase64(iv),ciphertext};
}

async function decryptBytes(key:CryptoKey,iv:string,ciphertext:ArrayBuffer,aad:Uint8Array){
  return crypto.subtle.decrypt({name:'AES-GCM',iv:asBuffer(base64ToBytes(iv)),additionalData:asBuffer(aad)},key,ciphertext);
}

async function verifyBinaryCryptoRuntime(key:CryptoKey,userId:string){
  const sample=randomBytes(1024);const aad=encoder.encode(`vault-binary-self-test|${userId}`);const sealed=await encryptBytes(key,asBuffer(sample),aad);const opened=new Uint8Array(await decryptBytes(key,sealed.iv,sealed.ciphertext,aad));
  if(!sample.every((value,index)=>opened[index]===value))throw new Error('El navegador no superó la verificación criptográfica binaria');
  const tampered=new Uint8Array(sealed.ciphertext.slice(0));tampered[0]^=1;let rejected=false;try{await decryptBytes(key,sealed.iv,asBuffer(tampered),aad)}catch{rejected=true}if(!rejected)throw new Error('El navegador no rechazó contenido binario alterado');
  const preparedAt=new Date().toISOString();const packageRecord:EncryptedFieldPackageRecord={id:`${userId}|${userId}|${userId}`,userId,organizationId:userId,establishmentId:userId,kind:'field_package',version:1,preparedAt,expiresAt:new Date(Date.parse(preparedAt)+FIELD_PACKAGE_TTL_MS).toISOString(),iv:'',ciphertext:''};
  const packageSealed=await encrypt(key,{marker:'field-package'},fieldPackageAad(packageRecord));const packageOpened=await decrypt<{marker:string}>(key,packageSealed.iv,packageSealed.ciphertext,fieldPackageAad(packageRecord));if(packageOpened.marker!=='field-package')throw new Error('El navegador no superó la verificación del paquete de campo');let packageTamperRejected=false;try{await decrypt(key,packageSealed.iv,packageSealed.ciphertext,fieldPackageAad({...packageRecord,expiresAt:new Date(Date.parse(packageRecord.expiresAt)+1_000).toISOString()}))}catch{packageTamperRejected=true}if(!packageTamperRejected)throw new Error('El navegador no rechazó metadatos alterados del paquete de campo');
}

function scheduleAutoLock(){
  if(lockTimer)clearTimeout(lockTimer);
  lockTimer=setTimeout(()=>lockOfflineVault('timeout'),AUTO_LOCK_MS);
}

function requireUnlocked(userId:string){
  if(!unlocked||unlocked.userId!==userId)throw new Error('Desbloqueá la bóveda offline antes de continuar');
  scheduleAutoLock();
  return unlocked.key;
}

async function refreshVaultMetrics(userId:string){
  const metrics=await vaultMetrics(userId);
  if(snapshot.userId===userId)emit({...snapshot,...metrics,pendingCount:metrics.pendingFindingCount+metrics.pendingMediaCount});
  return metrics;
}

export function subscribeOfflineVault(listener:()=>void){listeners.add(listener);return()=>listeners.delete(listener)}
export function getOfflineVaultSnapshot(){return snapshot}

export async function initializeOfflineVault(userId:string){
  const ticket=++initialization;
  if(unlocked?.userId!==userId)lockOfflineVault('session_changed');
  const alreadyUnlocked=unlocked?.userId===userId;
  if(!supported()){
    emit({status:'unsupported',userId,configured:false,pendingCount:0,pendingFindingCount:0,pendingMediaCount:0,mediaBytes:0,storagePersisted:null,storageUsage:null,storageQuota:null,lastLockReason:null});
    return snapshot;
  }
  emit({status:'checking',userId,configured:false,pendingCount:0,pendingFindingCount:0,pendingMediaCount:0,mediaBytes:0,storagePersisted:null,storageUsage:null,storageQuota:null,lastLockReason:snapshot.lastLockReason});
  let profile:VaultProfile|undefined;
  let metrics:Awaited<ReturnType<typeof vaultMetrics>>={pendingFindingCount:0,pendingMediaCount:0,mediaBytes:0,storagePersisted:null,storageUsage:null,storageQuota:null};
  try{[profile,metrics]=await Promise.all([getProfile(userId),vaultMetrics(userId)])}
  catch{
    if(ticket===initialization)emit({status:'unsupported',userId,configured:false,pendingCount:0,pendingFindingCount:0,pendingMediaCount:0,mediaBytes:0,storagePersisted:null,storageUsage:null,storageQuota:null,lastLockReason:null});
    return snapshot;
  }
  if(ticket!==initialization)return snapshot;
  if(!profile&&alreadyUnlocked){unlocked=null;if(lockTimer)clearTimeout(lockTimer);lockTimer=null}
  emit({status:profile?(alreadyUnlocked?'unlocked':'locked'):'unconfigured',userId,configured:Boolean(profile),...metrics,pendingCount:metrics.pendingFindingCount+metrics.pendingMediaCount,lastLockReason:snapshot.lastLockReason});
  return snapshot;
}

export async function setupOfflineVault(userId:string,passphrase:string){
  if(normalizedPassphrase(passphrase).length<10)throw new Error('Usá una frase de al menos 10 caracteres para proteger la bóveda');
  if(await getProfile(userId))throw new Error('La bóveda ya está configurada para este usuario');
  const salt=randomBytes(24);
  const key=await deriveKey(passphrase,salt);
  await verifyBinaryCryptoRuntime(key,userId);
  const verifier=await encrypt(key,{marker:VERIFIER_MARKER,userId},verifierAad(userId));
  const profile:VaultProfile={userId,version:1,salt:bytesToBase64(salt),verifierIv:verifier.iv,verifierCiphertext:verifier.ciphertext,createdAt:new Date().toISOString()};
  const database=await openDatabase();
  try{const transaction=database.transaction(PROFILE_STORE,'readwrite');transaction.objectStore(PROFILE_STORE).add(profile);await transactionDone(transaction)}finally{database.close()}
  unlocked={userId,key};scheduleAutoLock();
  const metrics=await vaultMetrics(userId);
  emit({status:'unlocked',userId,configured:true,...metrics,pendingCount:metrics.pendingFindingCount+metrics.pendingMediaCount,lastLockReason:null});
}

export async function unlockOfflineVault(userId:string,passphrase:string){
  const profile=await getProfile(userId);
  if(!profile)throw new Error('Primero activá la bóveda offline');
  try{
    const key=await deriveKey(passphrase,base64ToBytes(profile.salt));
    const verifier=await decrypt<{marker:string;userId:string}>(key,profile.verifierIv,profile.verifierCiphertext,verifierAad(userId));
    if(verifier.marker!==VERIFIER_MARKER||verifier.userId!==userId)throw new Error('invalid verifier');
    unlocked={userId,key};scheduleAutoLock();
    const metrics=await vaultMetrics(userId);
    emit({status:'unlocked',userId,configured:true,...metrics,pendingCount:metrics.pendingFindingCount+metrics.pendingMediaCount,lastLockReason:null});
  }catch{throw new Error('La frase no es correcta o la bóveda fue alterada')}
}

export function lockOfflineVault(reason:OfflineVaultSnapshot['lastLockReason']='manual'){
  if(lockTimer)clearTimeout(lockTimer);lockTimer=null;unlocked=null;
  if(snapshot.userId)emit({...snapshot,status:snapshot.configured?'locked':'unconfigured',lastLockReason:reason});
}

export async function saveOfflineScoutingDraft(scope:OfflineDraftScope,payload:OfflineScoutingFindingDraft){
  if(!validDraftPayload(payload,payload.requestId))throw new Error('El hallazgo no cumple el contrato offline seguro');
  const key=requireUnlocked(scope.userId);
  const now=new Date().toISOString();
  const identity={id:payload.requestId,userId:scope.userId,organizationId:scope.organizationId,establishmentId:scope.establishmentId,kind:'scouting_finding' as const,version:1 as const};
  const protectedPayload=await encrypt(key,payload,draftAad(identity));
  const record:EncryptedDraftRecord={...identity,createdAt:now,updatedAt:now,attempts:0,lastError:null,...protectedPayload};
  const database=await openDatabase();
  try{const transaction=database.transaction(DRAFT_STORE,'readwrite');transaction.objectStore(DRAFT_STORE).add(record);await transactionDone(transaction)}finally{database.close()}
  await refreshVaultMetrics(scope.userId);
  return record.id;
}

export async function listOfflineScoutingDrafts(scope:OfflineDraftScope){
  const key=requireUnlocked(scope.userId);
  const records=(await getDrafts(scope.userId)).filter(record=>record.organizationId===scope.organizationId&&record.establishmentId===scope.establishmentId&&record.kind==='scouting_finding').sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
  return Promise.all(records.map(async(record):Promise<OfflineScoutingDraftView>=>{
    try{
      const payload=await decrypt<unknown>(key,record.iv,record.ciphertext,draftAad(record));
      if(!validDraftPayload(payload,record.id))throw new Error('invalid offline contract');
      return{id:record.id,organizationId:record.organizationId,establishmentId:record.establishmentId,createdAt:record.createdAt,updatedAt:record.updatedAt,attempts:record.attempts,lastError:record.lastError,payload,decryptError:null};
    }
    catch{return{id:record.id,organizationId:record.organizationId,establishmentId:record.establishmentId,createdAt:record.createdAt,updatedAt:record.updatedAt,attempts:record.attempts,lastError:record.lastError,payload:null,decryptError:'No se pudo autenticar el contenido cifrado. No se sincronizó.'}}
  }));
}

export async function removeOfflineDraft(userId:string,id:string,options:{cascadeMedia?:boolean}={}){
  const key=requireUnlocked(userId);
  const mediaRecords=await getMediaRecords(userId);
  const dependentMedia:string[]=[];
  for(const media of mediaRecords){
    try{const payload=await decrypt<unknown>(key,media.metadataIv,media.metadataCiphertext,mediaAad(media,'metadata'));if(validMediaPayload(payload,media.id)&&payload.findingRequestId===id)dependentMedia.push(media.id)}catch{/* Unreadable media cannot be silently cascaded. */}
  }
  if(dependentMedia.length&&!options.cascadeMedia)throw new Error(`El hallazgo tiene ${dependentMedia.length} foto${dependentMedia.length===1?'':'s'} cifrada${dependentMedia.length===1?'':'s'}. Confirmá el descarte conjunto.`);
  const database=await openDatabase();
  try{
    const transaction=database.transaction([DRAFT_STORE,MEDIA_STORE],'readwrite');
    const store=transaction.objectStore(DRAFT_STORE);
    const record=await requestResult(store.get(id)) as EncryptedDraftRecord|undefined;
    if(!record||record.userId!==userId)throw new Error('El borrador no pertenece a la sesión activa');
    store.delete(id);dependentMedia.forEach(mediaId=>transaction.objectStore(MEDIA_STORE).delete(mediaId));await transactionDone(transaction);
  }finally{database.close()}
  await refreshVaultMetrics(userId);
}

export async function markOfflineDraftFailure(userId:string,id:string,error:unknown){
  requireUnlocked(userId);
  const database=await openDatabase();
  try{
    const transaction=database.transaction(DRAFT_STORE,'readwrite');
    const store=transaction.objectStore(DRAFT_STORE);
    const record=await requestResult(store.get(id)) as EncryptedDraftRecord|undefined;
    if(!record||record.userId!==userId)throw new Error('El borrador no pertenece a la sesión activa');
    const message=(error instanceof Error?error.message:typeof error==='object'&&error&&'message' in error&&typeof error.message==='string'?error.message:'Error no identificado').slice(0,300);
    store.put({...record,attempts:record.attempts+1,lastError:message,updatedAt:new Date().toISOString()});
    await transactionDone(transaction);
  }finally{database.close()}
}

function validMediaSignature(bytes:Uint8Array,mime:OfflineScoutingMediaDraft['mimeType']){
  if(mime==='image/jpeg')return bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;
  if(mime==='image/png')return bytes.length>=8&&[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a].every((value,index)=>bytes[index]===value);
  return bytes.length>=12&&decoder.decode(bytes.slice(0,4))==='RIFF'&&decoder.decode(bytes.slice(8,12))==='WEBP';
}

function digestHex(buffer:ArrayBuffer){return crypto.subtle.digest('SHA-256',buffer).then(value=>Array.from(new Uint8Array(value),byte=>byte.toString(16).padStart(2,'0')).join(''))}

export async function requestPersistentOfflineStorage(userId:string){
  requireUnlocked(userId);
  if(!navigator.storage?.persist)throw new Error('Este navegador no permite solicitar almacenamiento persistente');
  const granted=await navigator.storage.persist();
  await refreshVaultMetrics(userId);
  if(!granted)throw new Error('El navegador no concedió persistencia. La bóveda funciona, pero el sistema podría liberar espacio bajo presión.');
  return true;
}

export async function saveOfflineScoutingMedia(scope:OfflineDraftScope,input:{file:File;findingId:string|null;findingRequestId:string|null;requestId?:string;captureSource:'camera'|'library';capturedAt:string;caption:string}){
  const key=requireUnlocked(scope.userId);
  if(!MEDIA_TYPES.has(input.file.type as OfflineScoutingMediaDraft['mimeType'])||input.file.size<1||input.file.size>MAX_MEDIA_BYTES)throw new Error('Usá una imagen JPEG, PNG o WebP de hasta 8 MB');
  const oneParent=(input.findingId===null&&typeof input.findingRequestId==='string'&&UUID_PATTERN.test(input.findingRequestId))||(input.findingRequestId===null&&typeof input.findingId==='string'&&UUID_PATTERN.test(input.findingId));
  if(!oneParent)throw new Error('La foto debe pertenecer a un hallazgo remoto o a un borrador local válido');
  if(input.findingRequestId){const parent=(await getDrafts(scope.userId)).find(record=>record.id===input.findingRequestId);if(!parent||parent.organizationId!==scope.organizationId||parent.establishmentId!==scope.establishmentId)throw new Error('El hallazgo local asociado no pertenece al contexto activo')}
  if(input.caption.length>500||!Number.isFinite(Date.parse(input.capturedAt)))throw new Error('La descripción o fecha de captura no es válida');
  const metrics=await vaultMetrics(scope.userId);
  if(metrics.pendingMediaCount>=MAX_MEDIA_ITEMS)throw new Error(`La bóveda admite hasta ${MAX_MEDIA_ITEMS} fotos pendientes por usuario. Sincronizá o descartá antes de continuar.`);
  if(metrics.mediaBytes+input.file.size>MAX_MEDIA_TOTAL_BYTES)throw new Error('La bóveda admite hasta 64 MB de fotos pendientes por usuario');
  const requiredBytes=input.file.size+1024*1024;
  if(metrics.storageQuota!==null&&metrics.storageUsage!==null&&metrics.storageUsage+requiredBytes>metrics.storageQuota*.9)throw new Error('No hay margen seguro de almacenamiento local. Liberá espacio o sincronizá pendientes.');
  const fileBuffer=await input.file.arrayBuffer();
  const fileBytes=new Uint8Array(fileBuffer);
  const mime=input.file.type as OfflineScoutingMediaDraft['mimeType'];
  if(!validMediaSignature(fileBytes,mime))throw new Error('La firma binaria no coincide con el tipo de imagen');
  const requestId=input.requestId??crypto.randomUUID();
  const originalFilename=(input.file.name.split(/[\\/]/).pop()||'evidencia').replace(/[^\p{L}\p{N}._ -]/gu,'_').trim().slice(0,180)||'evidencia';
  const payload:OfflineScoutingMediaDraft={schemaVersion:1,requestId,findingId:input.findingId,findingRequestId:input.findingRequestId,originalFilename,mimeType:mime,sizeBytes:input.file.size,sha256:await digestHex(fileBuffer),captureSource:input.captureSource,capturedAt:new Date(input.capturedAt).toISOString(),caption:input.caption.trim(),lastModified:input.file.lastModified,tusUploadUrl:null,savedAt:new Date().toISOString()};
  if(!validMediaPayload(payload,requestId))throw new Error('La evidencia no cumple el contrato offline seguro');
  const identity={id:requestId,userId:scope.userId,organizationId:scope.organizationId,establishmentId:scope.establishmentId,kind:'scouting_media' as const,version:1 as const};
  const [metadata,file]=await Promise.all([encrypt(key,payload,mediaAad(identity,'metadata')),encryptBytes(key,fileBuffer,mediaAad(identity,'file'))]);
  const now=new Date().toISOString();
  const record:EncryptedMediaRecord={...identity,createdAt:now,updatedAt:now,attempts:0,lastError:null,sizeBytes:payload.sizeBytes,metadataIv:metadata.iv,metadataCiphertext:metadata.ciphertext,fileIv:file.iv,fileCiphertext:file.ciphertext};
  const database=await openDatabase();
  try{const transaction=database.transaction(MEDIA_STORE,'readwrite');transaction.objectStore(MEDIA_STORE).add(record);await transactionDone(transaction)}finally{database.close()}
  await refreshVaultMetrics(scope.userId);
  return{id:requestId,sha256:payload.sha256};
}

export async function listOfflineScoutingMedia(scope:OfflineDraftScope){
  const key=requireUnlocked(scope.userId);
  const records=(await getMediaRecords(scope.userId)).filter(record=>record.organizationId===scope.organizationId&&record.establishmentId===scope.establishmentId).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
  return Promise.all(records.map(async(record):Promise<OfflineScoutingMediaView>=>{
    try{
      const payload=await decrypt<unknown>(key,record.metadataIv,record.metadataCiphertext,mediaAad(record,'metadata'));
      if(!validMediaPayload(payload,record.id)||payload.sizeBytes!==record.sizeBytes)throw new Error('invalid offline media contract');
      return{id:record.id,organizationId:record.organizationId,establishmentId:record.establishmentId,createdAt:record.createdAt,updatedAt:record.updatedAt,attempts:record.attempts,lastError:record.lastError,sizeBytes:record.sizeBytes,payload,decryptError:null};
    }catch{return{id:record.id,organizationId:record.organizationId,establishmentId:record.establishmentId,createdAt:record.createdAt,updatedAt:record.updatedAt,attempts:record.attempts,lastError:record.lastError,sizeBytes:record.sizeBytes,payload:null,decryptError:'No se pudo autenticar la foto cifrada. No se sincronizó.'}}
  }));
}

export async function decryptOfflineScoutingMedia(scope:OfflineDraftScope,id:string){
  const key=requireUnlocked(scope.userId);
  const database=await openDatabase();let record:EncryptedMediaRecord|undefined;
  try{record=await requestResult(database.transaction(MEDIA_STORE).objectStore(MEDIA_STORE).get(id)) as EncryptedMediaRecord|undefined}finally{database.close()}
  if(!record||record.userId!==scope.userId||record.organizationId!==scope.organizationId||record.establishmentId!==scope.establishmentId)throw new Error('La foto no pertenece al contexto activo');
  const payload=await decrypt<unknown>(key,record.metadataIv,record.metadataCiphertext,mediaAad(record,'metadata'));
  if(!validMediaPayload(payload,record.id)||payload.sizeBytes!==record.sizeBytes)throw new Error('No se pudo autenticar el contrato de la foto');
  const fileBuffer=await decryptBytes(key,record.fileIv,record.fileCiphertext,mediaAad(record,'file'));
  if(fileBuffer.byteLength!==payload.sizeBytes||await digestHex(fileBuffer)!==payload.sha256||!validMediaSignature(new Uint8Array(fileBuffer),payload.mimeType))throw new Error('La foto cifrada no superó la verificación de integridad');
  return{payload,file:new File([fileBuffer],payload.originalFilename,{type:payload.mimeType,lastModified:payload.lastModified})};
}

export async function resolveOfflineMediaFinding(scope:OfflineDraftScope,findingRequestId:string,findingId:string){
  if(!UUID_PATTERN.test(findingRequestId)||!UUID_PATTERN.test(findingId))throw new Error('La referencia de hallazgo no es válida');
  const key=requireUnlocked(scope.userId);
  const records=(await getMediaRecords(scope.userId)).filter(record=>record.organizationId===scope.organizationId&&record.establishmentId===scope.establishmentId);
  const updates:EncryptedMediaRecord[]=[];
  for(const record of records){
    try{
      const payload=await decrypt<unknown>(key,record.metadataIv,record.metadataCiphertext,mediaAad(record,'metadata'));
      if(validMediaPayload(payload,record.id)&&payload.findingRequestId===findingRequestId){
        const next:OfflineScoutingMediaDraft={...payload,findingId,findingRequestId:null};
        const metadata=await encrypt(key,next,mediaAad(record,'metadata'));
        updates.push({...record,metadataIv:metadata.iv,metadataCiphertext:metadata.ciphertext,updatedAt:new Date().toISOString()});
      }
    }catch{/* La sincronización mostrará el registro que no puede autenticarse. */}
  }
  if(updates.length){const database=await openDatabase();try{const transaction=database.transaction(MEDIA_STORE,'readwrite');const store=transaction.objectStore(MEDIA_STORE);updates.forEach(record=>store.put(record));await transactionDone(transaction)}finally{database.close()}}
  return updates.length;
}

export async function setOfflineMediaTusUploadUrl(scope:OfflineDraftScope,id:string,url:string|null){
  if(url!==null&&(!url.startsWith('https://')||url.length>2048))throw new Error('La URL de reanudación TUS no es válida');
  const key=requireUnlocked(scope.userId);
  const database=await openDatabase();let record:EncryptedMediaRecord|undefined;
  try{record=await requestResult(database.transaction(MEDIA_STORE).objectStore(MEDIA_STORE).get(id)) as EncryptedMediaRecord|undefined}finally{database.close()}
  if(!record||record.userId!==scope.userId||record.organizationId!==scope.organizationId||record.establishmentId!==scope.establishmentId)throw new Error('La foto no pertenece al contexto activo');
  const payload=await decrypt<unknown>(key,record.metadataIv,record.metadataCiphertext,mediaAad(record,'metadata'));
  if(!validMediaPayload(payload,record.id))throw new Error('No se pudo autenticar el contrato de la foto');
  const metadata=await encrypt(key,{...payload,tusUploadUrl:url},mediaAad(record,'metadata'));
  const updated={...record,metadataIv:metadata.iv,metadataCiphertext:metadata.ciphertext,updatedAt:new Date().toISOString()};
  const updateDatabase=await openDatabase();try{const transaction=updateDatabase.transaction(MEDIA_STORE,'readwrite');transaction.objectStore(MEDIA_STORE).put(updated);await transactionDone(transaction)}finally{updateDatabase.close()}
}

export async function removeOfflineMedia(userId:string,id:string){
  requireUnlocked(userId);
  const database=await openDatabase();
  try{const transaction=database.transaction(MEDIA_STORE,'readwrite');const store=transaction.objectStore(MEDIA_STORE);const record=await requestResult(store.get(id)) as EncryptedMediaRecord|undefined;if(!record||record.userId!==userId)throw new Error('La foto no pertenece a la sesión activa');store.delete(id);await transactionDone(transaction)}finally{database.close()}
  await refreshVaultMetrics(userId);
}

export async function markOfflineMediaFailure(userId:string,id:string,error:unknown){
  requireUnlocked(userId);
  const database=await openDatabase();
  try{const transaction=database.transaction(MEDIA_STORE,'readwrite');const store=transaction.objectStore(MEDIA_STORE);const record=await requestResult(store.get(id)) as EncryptedMediaRecord|undefined;if(!record||record.userId!==userId)throw new Error('La foto no pertenece a la sesión activa');const message=(error instanceof Error?error.message:typeof error==='object'&&error&&'message' in error&&typeof error.message==='string'?error.message:'Error no identificado').slice(0,300);store.put({...record,attempts:record.attempts+1,lastError:message,updatedAt:new Date().toISOString()});await transactionDone(transaction)}finally{database.close()}
}

function fieldPackageId(scope:OfflineDraftScope){return`${scope.userId}|${scope.organizationId}|${scope.establishmentId}`}

export async function saveOfflineFieldPackage(scope:OfflineDraftScope,workspace:Workspace):Promise<OfflineFieldPackageMeta>{
  const key=requireUnlocked(scope.userId);
  if(!workspace.organization||!workspace.establishment||workspace.organization.id!==scope.organizationId||workspace.organization.userId!==scope.userId||workspace.establishment.id!==scope.establishmentId||workspace.establishment.organization_id!==scope.organizationId)throw new Error('El paquete de campo no coincide con la operación activa');
  if(!FIELD_ROLES.has(workspace.organization.role))throw new Error('Este rol no puede preparar trabajo operativo sin conexión');
  const visits=workspace.scoutingVisits.filter(visit=>(visit.status==='planned'||visit.status==='in_progress')&&(workspace.organization!.role!=='operator'||visit.assigned_to===scope.userId));
  const visitIds=new Set(visits.map(visit=>visit.id));
  const parcelIds=new Set(visits.map(visit=>visit.parcel_id));
  const findings=workspace.scoutingFindings.filter(finding=>visitIds.has(finding.visit_id));
  const findingIds=new Set(findings.map(finding=>finding.id));
  const preparedAt=new Date().toISOString();
  const payload:OfflineFieldPackagePayload={
    schemaVersion:1,userId:scope.userId,organizationId:scope.organizationId,establishmentId:scope.establishmentId,preparedAt,expiresAt:new Date(Date.parse(preparedAt)+FIELD_PACKAGE_TTL_MS).toISOString(),
    organization:{...workspace.organization},establishment:{...workspace.establishment},parcels:workspace.parcels.filter(parcel=>parcelIds.has(parcel.id)).map(parcel=>({...parcel,health_score:null,boundary_geojson:null})),
    scoutingAssignees:workspace.organization.role==='operator'?workspace.scoutingAssignees.filter(member=>member.user_id===scope.userId):workspace.scoutingAssignees,
    scoutingVisits:visits,scoutingFindings:findings,scoutingFindingMedia:workspace.scoutingFindingMedia.filter(media=>findingIds.has(media.finding_id)),
  };
  const recordIdentity:EncryptedFieldPackageRecord={id:fieldPackageId(scope),userId:scope.userId,organizationId:scope.organizationId,establishmentId:scope.establishmentId,kind:'field_package',version:1,preparedAt:payload.preparedAt,expiresAt:payload.expiresAt,iv:'',ciphertext:''};
  if(!validFieldPackagePayload(payload,recordIdentity))throw new Error('Los datos remotos no cumplen el contrato mínimo del paquete de campo');
  if(new Blob([JSON.stringify(payload)]).size>MAX_FIELD_PACKAGE_BYTES)throw new Error('El paquete de campo supera 4 MB. Cerrá o archivá recorridas antes de prepararlo.');
  const protectedPayload=await encrypt(key,payload,fieldPackageAad(recordIdentity));
  const record={...recordIdentity,...protectedPayload};
  const database=await openDatabase();
  try{const transaction=database.transaction(FIELD_PACKAGE_STORE,'readwrite');transaction.objectStore(FIELD_PACKAGE_STORE).put(record);await transactionDone(transaction)}finally{database.close()}
  return{preparedAt:payload.preparedAt,expiresAt:payload.expiresAt,visitCount:visits.length,findingCount:findings.length,mediaCount:payload.scoutingFindingMedia.length};
}

async function deleteFieldPackageRecord(id:string){const database=await openDatabase();try{const transaction=database.transaction(FIELD_PACKAGE_STORE,'readwrite');transaction.objectStore(FIELD_PACKAGE_STORE).delete(id);await transactionDone(transaction)}finally{database.close()}}

export async function loadOfflineFieldPackage(userId:string,organizationId?:string|null){
  const key=requireUnlocked(userId);
  const records=(await getFieldPackageRecords(userId)).filter(record=>!organizationId||record.organizationId===organizationId).sort((a,b)=>b.preparedAt.localeCompare(a.preparedAt));
  const record=records[0];
  if(!record)throw new Error(organizationId?'No hay un paquete de campo preparado para la empresa seleccionada. Conectate, desbloqueá la bóveda y abrí Recorridas antes de salir.':'No hay un paquete de campo preparado en este dispositivo.');
  if(!validIso(record.expiresAt)||Date.parse(record.expiresAt)<=Date.now()){await deleteFieldPackageRecord(record.id);throw new Error('El paquete de campo venció y fue eliminado. Conectate para preparar uno nuevo con permisos y recorridas actuales.');}
  let payload:unknown;
  try{payload=await decrypt(key,record.iv,record.ciphertext,fieldPackageAad(record))}catch{throw new Error('No se pudo autenticar el paquete de campo cifrado. No se abrió ningún dato.');}
  if(!validFieldPackagePayload(payload,record))throw new Error('El paquete de campo no cumple el contrato seguro actual. Conectate para regenerarlo.');
  return payload;
}

export function offlineFieldPackageToWorkspace(field:OfflineFieldPackagePayload):Workspace{
  return{organizations:[field.organization],organization:field.organization,establishment:field.establishment,parcels:field.parcels,devices:[],sensorReadings:[],deviceTwins:[],deviceCommands:[],weather:null,satellite:null,satelliteScenes:[],satelliteMetrics:[],satelliteAnalysisRuns:[],satelliteTimeseriesRuns:[],parcelIndexBaselines:[],weatherDaily:[],irrigationEvents:[],waterBalanceRuns:[],parcelWaterBalances:[],terrainReliefRuns:[],parcelTerrainMetrics:[],outcomeCycles:[],outcomeCycleEvents:[],outcomeLedgerSummary:null,scoutingVisits:field.scoutingVisits,scoutingVisitEvents:[],scoutingAssignees:field.scoutingAssignees,scoutingFindings:field.scoutingFindings,scoutingFindingMedia:field.scoutingFindingMedia,recommendations:[],livestockGroups:[],livestockEvents:[],machineAssets:[],machineEvents:[],maintenanceWorkOrders:[],maintenanceWorkOrderEvents:[],financialEntries:[],operationalSummary:null,latestAiAnalysis:null};
}

export async function resetOfflineVault(userId:string){
  if(snapshot.userId!==userId)throw new Error('La bóveda no pertenece a la sesión activa');
  const database=await openDatabase();
  try{
    const transaction=database.transaction([PROFILE_STORE,DRAFT_STORE,MEDIA_STORE,FIELD_PACKAGE_STORE],'readwrite');
    const draftStore=transaction.objectStore(DRAFT_STORE);
    const mediaStore=transaction.objectStore(MEDIA_STORE);
    const packageStore=transaction.objectStore(FIELD_PACKAGE_STORE);
    const [records,mediaRecords,packageRecords]=await Promise.all([requestResult(draftStore.index('userId').getAllKeys(userId)),requestResult(mediaStore.index('userId').getAllKeys(userId)),requestResult(packageStore.index('userId').getAllKeys(userId))]);
    records.forEach(key=>draftStore.delete(key));mediaRecords.forEach(key=>mediaStore.delete(key));packageRecords.forEach(key=>packageStore.delete(key));
    transaction.objectStore(PROFILE_STORE).delete(userId);
    await transactionDone(transaction);
  }finally{database.close()}
  if(lockTimer)clearTimeout(lockTimer);lockTimer=null;unlocked=null;
  emit({status:'unconfigured',userId,configured:false,pendingCount:0,pendingFindingCount:0,pendingMediaCount:0,mediaBytes:0,storagePersisted:null,storageUsage:null,storageQuota:null,lastLockReason:'manual'});
}

export async function runOfflineVaultCryptoSelfTest(){
  if(!supported())return{roundTrip:false,tamperRejected:false};
  const userId=crypto.randomUUID();
  const key=await deriveKey('nodo-self-test-passphrase',randomBytes(24));
  const aad=verifierAad(userId);
  const sealed=await encrypt(key,{marker:VERIFIER_MARKER,userId},aad);
  const opened=await decrypt<{marker:string;userId:string}>(key,sealed.iv,sealed.ciphertext,aad);
  const tampered=base64ToBytes(sealed.ciphertext);tampered[0]^=1;
  let tamperRejected=false;
  try{await decrypt(key,sealed.iv,bytesToBase64(tampered),aad)}catch{tamperRejected=true}
  const binary=randomBytes(1024);const binarySealed=await encryptBytes(key,asBuffer(binary),encoder.encode(`binary|${userId}`));const binaryOpened=new Uint8Array(await decryptBytes(key,binarySealed.iv,binarySealed.ciphertext,encoder.encode(`binary|${userId}`)));
  const binaryTampered=new Uint8Array(binarySealed.ciphertext.slice(0));binaryTampered[0]^=1;let binaryTamperRejected=false;try{await decryptBytes(key,binarySealed.iv,asBuffer(binaryTampered),encoder.encode(`binary|${userId}`))}catch{binaryTamperRejected=true}
  const preparedAt=new Date().toISOString();const packageRecord:EncryptedFieldPackageRecord={id:`${userId}|${userId}|${userId}`,userId,organizationId:userId,establishmentId:userId,kind:'field_package',version:1,preparedAt,expiresAt:new Date(Date.parse(preparedAt)+FIELD_PACKAGE_TTL_MS).toISOString(),iv:'',ciphertext:''};const packageSealed=await encrypt(key,{marker:'field-package'},fieldPackageAad(packageRecord));const packageOpened=await decrypt<{marker:string}>(key,packageSealed.iv,packageSealed.ciphertext,fieldPackageAad(packageRecord));let packageAadTamperRejected=false;try{await decrypt(key,packageSealed.iv,packageSealed.ciphertext,fieldPackageAad({...packageRecord,expiresAt:new Date(Date.parse(packageRecord.expiresAt)+1_000).toISOString()}))}catch{packageAadTamperRejected=true}
  return{roundTrip:opened.marker===VERIFIER_MARKER&&opened.userId===userId,tamperRejected,binaryRoundTrip:binary.every((value,index)=>binaryOpened[index]===value),binaryTamperRejected,packageRoundTrip:packageOpened.marker==='field-package',packageAadTamperRejected};
}
