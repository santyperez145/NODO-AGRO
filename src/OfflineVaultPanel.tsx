import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Camera, CloudUpload, FileImage, HardDrive, Images, KeyRound, LoaderCircle, LockKeyhole, RotateCcw, ShieldAlert, ShieldCheck, Trash2, UnlockKeyhole, WifiOff } from 'lucide-react';
import {
  decryptOfflineScoutingMedia,
  listOfflineScoutingDrafts,
  listOfflineScoutingMedia,
  lockOfflineVault,
  markOfflineDraftFailure,
  markOfflineMediaFailure,
  removeOfflineDraft,
  removeOfflineMedia,
  requestPersistentOfflineStorage,
  resetOfflineVault,
  resolveOfflineMediaFinding,
  saveOfflineScoutingMedia,
  setOfflineMediaTusUploadUrl,
  setupOfflineVault,
  unlockOfflineVault,
  type OfflineDraftScope,
  type OfflineScoutingDraftView,
  type OfflineScoutingFindingDraft,
  type OfflineScoutingMediaDraft,
  type OfflineScoutingMediaView,
} from './lib/offlineVault';
import { useOfflineVault } from './lib/useOfflineVault';

const categoryLabels:Record<OfflineScoutingFindingDraft['category'],string>={crop_condition:'Condición del cultivo',pest_signal:'Señal de plaga',water:'Agua',soil:'Suelo',infrastructure:'Infraestructura',other:'Otro'};
const severityLabels:Record<OfflineScoutingFindingDraft['severity'],string>={info:'Informativa',low:'Baja',medium:'Media',high:'Alta',critical:'Crítica'};

function errorMessage(error:unknown){if(error instanceof Error)return error.message;if(typeof error==='object'&&error&&'message' in error&&typeof error.message==='string')return error.message;return'No se pudo completar la operación'}
function localDateTime(){const date=new Date();date.setMinutes(date.getMinutes()-date.getTimezoneOffset());return date.toISOString().slice(0,16)}
function fileSize(bytes:number){return bytes<1024*1024?`${Math.ceil(bytes/1024)} KB`:`${(bytes/1024/1024).toFixed(1)} MB`}

export function OfflineVaultPanel({scope,onSyncDraft,onSyncMedia,networkAvailable=true}:{scope:OfflineDraftScope;networkAvailable?:boolean;onSyncDraft:(draft:OfflineScoutingFindingDraft)=>Promise<string>;onSyncMedia:(draft:OfflineScoutingMediaDraft,file:File,onProgress:(percentage:number)=>void,onUploadUrl:(url:string|null)=>Promise<void>)=>Promise<unknown>}){
  const vault=useOfflineVault(scope.userId);
  const [expanded,setExpanded]=useState(false);
  const [passphrase,setPassphrase]=useState('');
  const [confirmation,setConfirmation]=useState('');
  const [busy,setBusy]=useState<'access'|'sync'|'reset'|'delete'|'media'|'persist'|null>(null);
  const [drafts,setDrafts]=useState<OfflineScoutingDraftView[]>([]);
  const [media,setMedia]=useState<OfflineScoutingMediaView[]>([]);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [confirmReset,setConfirmReset]=useState(false);
  const [confirmDelete,setConfirmDelete]=useState<string|null>(null);
  const [confirmMediaDelete,setConfirmMediaDelete]=useState<string|null>(null);
  const [mediaTarget,setMediaTarget]=useState<string|null>(null);
  const [mediaSelection,setMediaSelection]=useState<{file:File;source:'camera'|'library'}|null>(null);
  const [mediaCaption,setMediaCaption]=useState('');
  const [mediaCapturedAt,setMediaCapturedAt]=useState(localDateTime());
  const [syncProgress,setSyncProgress]=useState<Record<string,number>>({});

  const refresh=useCallback(async()=>{
    if(vault.status!=='unlocked'){setDrafts([]);setMedia([]);return}
    try{const [nextDrafts,nextMedia]=await Promise.all([listOfflineScoutingDrafts(scope),listOfflineScoutingMedia(scope)]);setDrafts(nextDrafts);setMedia(nextMedia);setError('')}
    catch(cause){setError(errorMessage(cause))}
  },[scope.establishmentId,scope.organizationId,scope.userId,vault.status]);

  useEffect(()=>{void refresh()},[refresh,vault.pendingCount]);

  async function access(event:FormEvent){
    event.preventDefault();setError('');setNotice('');setBusy('access');
    try{
      if(vault.status==='unconfigured'){
        if(passphrase!==confirmation)throw new Error('Las frases de protección no coinciden');
        await setupOfflineVault(scope.userId,passphrase);setNotice('Bóveda activada y desbloqueada en este dispositivo.');
      }else{await unlockOfflineVault(scope.userId,passphrase);setNotice('Bóveda desbloqueada por 15 minutos de inactividad.');}
      setPassphrase('');setConfirmation('');
    }catch(cause){setError(errorMessage(cause))}finally{setBusy(null)}
  }

  async function synchronize(){
    if(!networkAvailable){setError('El servidor no está disponible. Los hallazgos y fotos permanecen cifrados; no se descartó nada.');return}
    setBusy('sync');setError('');setNotice('');setSyncProgress({});
    let syncedFindings=0;let syncedMedia=0;let failed=0;
    try{
      const pendingFindings=await listOfflineScoutingDrafts(scope);
      for(const draft of pendingFindings){
        if(!draft.payload){failed++;continue}
        try{const findingId=await onSyncDraft(draft.payload);await resolveOfflineMediaFinding(scope,draft.id,findingId);await removeOfflineDraft(scope.userId,draft.id);syncedFindings++}
        catch(cause){await markOfflineDraftFailure(scope.userId,draft.id,cause);failed++}
      }
      const pendingMedia=await listOfflineScoutingMedia(scope);
      for(const item of pendingMedia){
        if(!item.payload||!item.payload.findingId){failed++;continue}
        try{
          const decrypted=await decryptOfflineScoutingMedia(scope,item.id);
          await onSyncMedia(decrypted.payload,decrypted.file,percentage=>setSyncProgress(current=>({...current,[item.id]:percentage})),url=>setOfflineMediaTusUploadUrl(scope,item.id,url));
          await removeOfflineMedia(scope.userId,item.id);syncedMedia++;
        }catch(cause){await markOfflineMediaFailure(scope.userId,item.id,cause);failed++}
      }
      await refresh();
      if(failed)setError(`${syncedFindings} hallazgos y ${syncedMedia} fotos sincronizados · ${failed} pendientes. El error queda visible y ningún pendiente fallido fue descartado.`);
      else setNotice(syncedFindings||syncedMedia?`${syncedFindings} hallazgos y ${syncedMedia} fotos sincronizados con idempotencia y verificación de hash.`:'No había pendientes de este establecimiento para sincronizar.');
    }catch(cause){setError(errorMessage(cause))}finally{setBusy(null);setSyncProgress({})}
  }

  function chooseMedia(file:File|undefined,source:'camera'|'library'){if(!file)return;if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size<1||file.size>8*1024*1024){setMediaSelection(null);setError('Usá una imagen JPEG, PNG o WebP de hasta 8 MB.');return}setMediaSelection({file,source});setError('')}

  async function saveMedia(event:FormEvent){
    event.preventDefault();if(!mediaTarget||!mediaSelection)return;setBusy('media');setError('');
    try{
      await saveOfflineScoutingMedia(scope,{file:mediaSelection.file,findingId:null,findingRequestId:mediaTarget,captureSource:mediaSelection.source,capturedAt:new Date(mediaCapturedAt).toISOString(),caption:mediaCaption});
      setMediaTarget(null);setMediaSelection(null);setMediaCaption('');setMediaCapturedAt(localDateTime());setNotice('Foto cifrada y vinculada al hallazgo local.');await refresh();
    }catch(cause){setError(errorMessage(cause))}finally{setBusy(null)}
  }

  async function deleteDraft(id:string){setBusy('delete');setError('');try{await removeOfflineDraft(scope.userId,id,{cascadeMedia:true});setConfirmDelete(null);setNotice('Hallazgo y fotos dependientes eliminados de este dispositivo.');await refresh()}catch(cause){setError(errorMessage(cause))}finally{setBusy(null)}}
  async function deleteMedia(id:string){setBusy('delete');setError('');try{await removeOfflineMedia(scope.userId,id);setConfirmMediaDelete(null);setNotice('Foto cifrada eliminada de este dispositivo.');await refresh()}catch(cause){setError(errorMessage(cause))}finally{setBusy(null)}}
  async function persist(){setBusy('persist');setError('');try{await requestPersistentOfflineStorage(scope.userId);setNotice('El navegador confirmó almacenamiento persistente para este origen.')}catch(cause){setError(errorMessage(cause))}finally{setBusy(null)}}
  async function reset(){setBusy('reset');setError('');try{await resetOfflineVault(scope.userId);setDrafts([]);setMedia([]);setConfirmReset(false);setNotice('Bóveda restablecida. Hallazgos, fotos y paquete de campo cifrados fueron eliminados.');setPassphrase('');setConfirmation('')}catch(cause){setError(errorMessage(cause))}finally{setBusy(null)}}

  const localPending=drafts.length+media.length;
  return <section className={`offlineVault ${vault.status==='unlocked'?'unlocked':''}`}>
    <button className="offlineVaultSummary" type="button" onClick={()=>setExpanded(value=>!value)} aria-expanded={expanded}>
      <span>{vault.status==='unlocked'?<ShieldCheck/>:<LockKeyhole/>}<span><small>NODO FIELD OFFLINE · BÓVEDA CIFRADA</small><b>{vault.status==='unsupported'?'No disponible en este navegador':vault.status==='unconfigured'?'Activar trabajo sin señal':vault.status==='unlocked'?`${vault.pendingCount} pendientes protegidos`:'Bóveda bloqueada'}</b></span></span><em>{expanded?'Cerrar':'Gestionar'}</em>
    </button>
    {expanded&&<div className="offlineVaultBody">
      {vault.status==='checking'&&<div className="vaultState"><LoaderCircle className="spin"/>Verificando cifrado, binarios y almacenamiento local…</div>}
      {vault.status==='unsupported'&&<div className="vaultWarning"><ShieldAlert/><span><b>Modo offline seguro no disponible</b>Este navegador bloqueó IndexedDB o Web Crypto. NODO no guardará datos sensibles sin cifrado.</span></div>}
      {(vault.status==='unconfigured'||vault.status==='locked')&&<form className="vaultAccess" onSubmit={access}>
        <div><KeyRound/><span><b>{vault.status==='unconfigured'?'Creá una frase local':'Desbloqueá la bóveda'}</b><small>No es tu contraseña de NODO, no sale del dispositivo y no puede recuperarse.</small></span></div>
        <label>Frase de protección<input type="password" autoComplete="new-password" required minLength={10} value={passphrase} onChange={event=>setPassphrase(event.target.value)} placeholder="Mínimo 10 caracteres"/></label>
        {vault.status==='unconfigured'&&<label>Repetir frase<input type="password" autoComplete="new-password" required minLength={10} value={confirmation} onChange={event=>setConfirmation(event.target.value)}/></label>}
        <button disabled={busy!==null}>{busy==='access'?<LoaderCircle className="spin"/>:vault.status==='unconfigured'?<ShieldCheck/>:<UnlockKeyhole/>}{vault.status==='unconfigured'?'Activar bóveda':'Desbloquear'}</button>
      </form>}
      {vault.status==='unlocked'&&<>
        <div className="vaultControls"><div><HardDrive/><span><b>{drafts.length} hallazgos · {media.length} fotos ({fileSize(media.reduce((total,item)=>total+item.sizeBytes,0))}) en este establecimiento</b><small>{vault.pendingCount} pendientes del usuario · AES‑GCM · bloqueo tras 15 min</small></span></div><div><button type="button" disabled={busy!==null||localPending===0||!networkAvailable} onClick={()=>void synchronize()}>{busy==='sync'?<LoaderCircle className="spin"/>:networkAvailable?<CloudUpload/>:<WifiOff/>}Sincronizar</button><button type="button" onClick={()=>lockOfflineVault('manual')}><LockKeyhole/>Bloquear</button></div></div>
        <div className="vaultLimits"><ShieldCheck/><span><b>NODO Field Offline v3</b>El paquete de trabajo, los hallazgos y las fotos se cifran antes de tocar IndexedDB. La transferencia usa TUS reanudable y el servidor vuelve a verificar permisos, firma y SHA‑256.</span></div>
        {vault.storagePersisted===false&&<div className="vaultPersistence"><ShieldAlert/><span><b>Persistencia no confirmada</b>El sistema puede liberar datos locales bajo presión de espacio.</span><button type="button" disabled={busy!==null} onClick={()=>void persist()}>{busy==='persist'?<LoaderCircle className="spin"/>:<HardDrive/>}Solicitar persistencia</button></div>}
        {drafts.length?<div className="vaultDrafts">{drafts.map(draft=>{const photoCount=media.filter(item=>item.payload?.findingRequestId===draft.id).length;return <article key={draft.id} className={draft.decryptError?'corrupt':''}>
          <div className="vaultDraftMain"><div><b>{draft.payload?categoryLabels[draft.payload.category]:'Contenido no autenticado'}</b><small>{draft.payload?`${severityLabels[draft.payload.severity]} · ${new Date(draft.payload.observedAt).toLocaleString('es-AR')} · ${photoCount} foto${photoCount===1?'':'s'}`:draft.decryptError}</small>{draft.lastError&&<em>Último intento: {draft.lastError}</em>}</div><span><button type="button" disabled={!draft.payload||busy!==null} onClick={()=>{setMediaTarget(draft.id);setMediaSelection(null);setMediaCaption('');setMediaCapturedAt(localDateTime())}}><Camera/>Agregar foto</button>{confirmDelete===draft.id?<><button type="button" disabled={busy!==null} onClick={()=>void deleteDraft(draft.id)}><Trash2/>Descartar todo</button><button type="button" onClick={()=>setConfirmDelete(null)}>Conservar</button></>:<button className="vaultDelete" type="button" aria-label="Descartar hallazgo cifrado" onClick={()=>setConfirmDelete(draft.id)}><Trash2/></button>}</span></div>
          {mediaTarget===draft.id&&<form className="vaultMediaForm" onSubmit={saveMedia}><div className="mediaPickerRow"><label><Camera/>Cámara<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={event=>chooseMedia(event.target.files?.[0],'camera')}/></label><label><Images/>Archivo<input type="file" accept="image/jpeg,image/png,image/webp" onChange={event=>chooseMedia(event.target.files?.[0],'library')}/></label>{mediaSelection&&<span><FileImage/><b>{mediaSelection.file.name}</b><small>{fileSize(mediaSelection.file.size)}</small></span>}</div><div><label>Capturada el<input required type="datetime-local" value={mediaCapturedAt} onChange={event=>setMediaCapturedAt(event.target.value)}/></label><label>Descripción<input maxLength={500} value={mediaCaption} onChange={event=>setMediaCaption(event.target.value)}/></label></div><span><button type="button" onClick={()=>setMediaTarget(null)}>Cancelar</button><button type="submit" disabled={!mediaSelection||busy!==null}>{busy==='media'?<LoaderCircle className="spin"/>:<ShieldCheck/>}Cifrar foto</button></span></form>}
        </article>})}</div>:<div className="vaultEmpty">No hay hallazgos offline pendientes para este establecimiento.</div>}
        {media.length>0&&<div className="vaultMediaList"><h4><FileImage/>Fotos cifradas pendientes</h4>{media.map(item=><article key={item.id} className={item.decryptError?'corrupt':''}><div><b>{item.payload?.originalFilename??'Contenido no autenticado'}</b><small>{fileSize(item.sizeBytes)} · {item.payload?.findingRequestId?'espera su hallazgo':'hallazgo remoto listo'}{syncProgress[item.id]!==undefined?` · ${syncProgress[item.id]}%`:''}</small>{item.lastError&&<em>Último intento: {item.lastError}</em>}</div>{confirmMediaDelete===item.id?<span><button type="button" disabled={busy!==null} onClick={()=>void deleteMedia(item.id)}><Trash2/>Confirmar</button><button type="button" onClick={()=>setConfirmMediaDelete(null)}>Conservar</button></span>:<button className="vaultDelete" type="button" aria-label="Descartar foto cifrada" onClick={()=>setConfirmMediaDelete(item.id)}><Trash2/></button>}</article>)}</div>}
        <div className="vaultReset">{confirmReset?<><p>Esto elimina todos los hallazgos, fotos y paquetes de campo cifrados del usuario en este dispositivo. No puede deshacerse.</p><button type="button" disabled={busy!==null} onClick={()=>void reset()}><Trash2/>{busy==='reset'?'Eliminando…':'Confirmar restablecimiento'}</button><button type="button" onClick={()=>setConfirmReset(false)}>Cancelar</button></>:<button type="button" onClick={()=>setConfirmReset(true)}><RotateCcw/>Restablecer bóveda local</button>}</div>
      </>}
      {notice&&<p className="vaultNotice"><ShieldCheck/>{notice}</p>}{error&&<p className="vaultError"><ShieldAlert/>{error}</p>}
    </div>}
  </section>;
}
