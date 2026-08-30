export type OfflineVaultStatus='checking'|'unsupported'|'unconfigured'|'locked'|'unlocked';

export type OfflineVaultSnapshot={
  status:OfflineVaultStatus;
  userId:string|null;
  configured:boolean;
  pendingCount:number;
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

const DB_NAME='nodo-field-vault-v1';
const DB_VERSION=1;
const PROFILE_STORE='profiles';
const DRAFT_STORE='drafts';
const PBKDF2_ITERATIONS=310_000;
const AUTO_LOCK_MS=15*60_000;
const VERIFIER_MARKER='NODO_FIELD_OFFLINE_V1';
const UUID_PATTERN=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FINDING_CATEGORIES=new Set<OfflineScoutingFindingDraft['category']>(['crop_condition','pest_signal','water','soil','infrastructure','other']);
const FINDING_SEVERITIES=new Set<OfflineScoutingFindingDraft['severity']>(['info','low','medium','high','critical']);
const encoder=new TextEncoder();
const decoder=new TextDecoder();

let snapshot:OfflineVaultSnapshot={status:'checking',userId:null,configured:false,pendingCount:0,lastLockReason:null};
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
function verifierAad(userId:string){return encoder.encode(`${VERIFIER_MARKER}|${userId}|1`)}
function draftAad(record:Pick<EncryptedDraftRecord,'id'|'userId'|'organizationId'|'establishmentId'|'kind'|'version'>){return encoder.encode(`${record.userId}|${record.organizationId}|${record.establishmentId}|${record.kind}|${record.id}|${record.version}`)}

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
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error??new Error('No se pudo abrir la bóveda offline'));
    request.onblocked=()=>reject(new Error('Otra pestaña está bloqueando la actualización de la bóveda'));
  });
}

async function getProfile(userId:string){const database=await openDatabase();try{return await requestResult(database.transaction(PROFILE_STORE).objectStore(PROFILE_STORE).get(userId)) as VaultProfile|undefined}finally{database.close()}}
async function getDrafts(userId:string){const database=await openDatabase();try{return await requestResult(database.transaction(DRAFT_STORE).objectStore(DRAFT_STORE).index('userId').getAll(userId)) as EncryptedDraftRecord[]}finally{database.close()}}
async function countDrafts(userId:string){const database=await openDatabase();try{return await requestResult(database.transaction(DRAFT_STORE).objectStore(DRAFT_STORE).index('userId').count(userId))}finally{database.close()}}

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

function scheduleAutoLock(){
  if(lockTimer)clearTimeout(lockTimer);
  lockTimer=setTimeout(()=>lockOfflineVault('timeout'),AUTO_LOCK_MS);
}

function requireUnlocked(userId:string){
  if(!unlocked||unlocked.userId!==userId)throw new Error('Desbloqueá la bóveda offline antes de continuar');
  scheduleAutoLock();
  return unlocked.key;
}

async function refreshPendingCount(userId:string){const pendingCount=await countDrafts(userId);if(snapshot.userId===userId)emit({...snapshot,pendingCount});return pendingCount}

export function subscribeOfflineVault(listener:()=>void){listeners.add(listener);return()=>listeners.delete(listener)}
export function getOfflineVaultSnapshot(){return snapshot}

export async function initializeOfflineVault(userId:string){
  const ticket=++initialization;
  if(unlocked?.userId!==userId)lockOfflineVault('session_changed');
  const alreadyUnlocked=unlocked?.userId===userId;
  if(!supported()){
    emit({status:'unsupported',userId,configured:false,pendingCount:0,lastLockReason:null});
    return snapshot;
  }
  emit({status:'checking',userId,configured:false,pendingCount:0,lastLockReason:snapshot.lastLockReason});
  let profile:VaultProfile|undefined;
  let pendingCount=0;
  try{[profile,pendingCount]=await Promise.all([getProfile(userId),countDrafts(userId)])}
  catch{
    if(ticket===initialization)emit({status:'unsupported',userId,configured:false,pendingCount:0,lastLockReason:null});
    return snapshot;
  }
  if(ticket!==initialization)return snapshot;
  if(!profile&&alreadyUnlocked){unlocked=null;if(lockTimer)clearTimeout(lockTimer);lockTimer=null}
  emit({status:profile?(alreadyUnlocked?'unlocked':'locked'):'unconfigured',userId,configured:Boolean(profile),pendingCount,lastLockReason:snapshot.lastLockReason});
  return snapshot;
}

export async function setupOfflineVault(userId:string,passphrase:string){
  if(normalizedPassphrase(passphrase).length<10)throw new Error('Usá una frase de al menos 10 caracteres para proteger la bóveda');
  if(await getProfile(userId))throw new Error('La bóveda ya está configurada para este usuario');
  const salt=randomBytes(24);
  const key=await deriveKey(passphrase,salt);
  const verifier=await encrypt(key,{marker:VERIFIER_MARKER,userId},verifierAad(userId));
  const profile:VaultProfile={userId,version:1,salt:bytesToBase64(salt),verifierIv:verifier.iv,verifierCiphertext:verifier.ciphertext,createdAt:new Date().toISOString()};
  const database=await openDatabase();
  try{const transaction=database.transaction(PROFILE_STORE,'readwrite');transaction.objectStore(PROFILE_STORE).add(profile);await transactionDone(transaction)}finally{database.close()}
  unlocked={userId,key};scheduleAutoLock();
  emit({status:'unlocked',userId,configured:true,pendingCount:await countDrafts(userId),lastLockReason:null});
}

export async function unlockOfflineVault(userId:string,passphrase:string){
  const profile=await getProfile(userId);
  if(!profile)throw new Error('Primero activá la bóveda offline');
  try{
    const key=await deriveKey(passphrase,base64ToBytes(profile.salt));
    const verifier=await decrypt<{marker:string;userId:string}>(key,profile.verifierIv,profile.verifierCiphertext,verifierAad(userId));
    if(verifier.marker!==VERIFIER_MARKER||verifier.userId!==userId)throw new Error('invalid verifier');
    unlocked={userId,key};scheduleAutoLock();
    emit({status:'unlocked',userId,configured:true,pendingCount:await countDrafts(userId),lastLockReason:null});
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
  await refreshPendingCount(scope.userId);
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

export async function removeOfflineDraft(userId:string,id:string){
  requireUnlocked(userId);
  const database=await openDatabase();
  try{
    const transaction=database.transaction(DRAFT_STORE,'readwrite');
    const store=transaction.objectStore(DRAFT_STORE);
    const record=await requestResult(store.get(id)) as EncryptedDraftRecord|undefined;
    if(!record||record.userId!==userId)throw new Error('El borrador no pertenece a la sesión activa');
    store.delete(id);await transactionDone(transaction);
  }finally{database.close()}
  await refreshPendingCount(userId);
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

export async function resetOfflineVault(userId:string){
  if(snapshot.userId!==userId)throw new Error('La bóveda no pertenece a la sesión activa');
  const database=await openDatabase();
  try{
    const transaction=database.transaction([PROFILE_STORE,DRAFT_STORE],'readwrite');
    const draftStore=transaction.objectStore(DRAFT_STORE);
    const records=await requestResult(draftStore.index('userId').getAllKeys(userId));
    records.forEach(key=>draftStore.delete(key));
    transaction.objectStore(PROFILE_STORE).delete(userId);
    await transactionDone(transaction);
  }finally{database.close()}
  if(lockTimer)clearTimeout(lockTimer);lockTimer=null;unlocked=null;
  emit({status:'unconfigured',userId,configured:false,pendingCount:0,lastLockReason:'manual'});
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
  return{roundTrip:opened.marker===VERIFIER_MARKER&&opened.userId===userId,tamperRejected};
}
