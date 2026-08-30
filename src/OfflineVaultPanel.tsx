import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CloudUpload, HardDrive, KeyRound, LoaderCircle, LockKeyhole, RotateCcw, ShieldAlert, ShieldCheck, Trash2, UnlockKeyhole, WifiOff } from 'lucide-react';
import {
  listOfflineScoutingDrafts,
  lockOfflineVault,
  markOfflineDraftFailure,
  removeOfflineDraft,
  resetOfflineVault,
  setupOfflineVault,
  unlockOfflineVault,
  type OfflineDraftScope,
  type OfflineScoutingDraftView,
  type OfflineScoutingFindingDraft,
} from './lib/offlineVault';
import { useOfflineVault } from './lib/useOfflineVault';

const categoryLabels:Record<OfflineScoutingFindingDraft['category'],string>={crop_condition:'Condición del cultivo',pest_signal:'Señal de plaga',water:'Agua',soil:'Suelo',infrastructure:'Infraestructura',other:'Otro'};
const severityLabels:Record<OfflineScoutingFindingDraft['severity'],string>={info:'Informativa',low:'Baja',medium:'Media',high:'Alta',critical:'Crítica'};

function errorMessage(error:unknown){
  if(error instanceof Error)return error.message;
  if(typeof error==='object'&&error&&'message' in error&&typeof error.message==='string')return error.message;
  return 'No se pudo completar la operación';
}

export function OfflineVaultPanel({scope,onSyncDraft}:{scope:OfflineDraftScope;onSyncDraft:(draft:OfflineScoutingFindingDraft)=>Promise<unknown>}){
  const vault=useOfflineVault(scope.userId);
  const [expanded,setExpanded]=useState(false);
  const [passphrase,setPassphrase]=useState('');
  const [confirmation,setConfirmation]=useState('');
  const [busy,setBusy]=useState<'access'|'sync'|'reset'|'delete'|null>(null);
  const [drafts,setDrafts]=useState<OfflineScoutingDraftView[]>([]);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [confirmReset,setConfirmReset]=useState(false);
  const [confirmDelete,setConfirmDelete]=useState<string|null>(null);

  const refresh=useCallback(async()=>{
    if(vault.status!=='unlocked'){setDrafts([]);return}
    try{setDrafts(await listOfflineScoutingDrafts(scope));setError('')}
    catch(cause){setError(errorMessage(cause))}
  },[scope.establishmentId,scope.organizationId,scope.userId,vault.status]);

  useEffect(()=>{void refresh()},[refresh,vault.pendingCount]);

  async function access(event:FormEvent){
    event.preventDefault();setError('');setNotice('');setBusy('access');
    try{
      if(vault.status==='unconfigured'){
        if(passphrase!==confirmation)throw new Error('Las frases de protección no coinciden');
        await setupOfflineVault(scope.userId,passphrase);
        setNotice('Bóveda activada y desbloqueada en este dispositivo.');
      }else{
        await unlockOfflineVault(scope.userId,passphrase);
        setNotice('Bóveda desbloqueada por 15 minutos de inactividad.');
      }
      setPassphrase('');setConfirmation('');
    }catch(cause){setError(errorMessage(cause))}
    finally{setBusy(null)}
  }

  async function synchronize(){
    if(!navigator.onLine){setError('Seguís sin conexión. Los borradores permanecen cifrados y no se descartaron.');return}
    setBusy('sync');setError('');setNotice('');
    let synced=0;let failed=0;
    try{
      const pending=await listOfflineScoutingDrafts(scope);
      for(const draft of pending){
        if(!draft.payload){failed++;continue}
        try{await onSyncDraft(draft.payload);await removeOfflineDraft(scope.userId,draft.id);synced++}
        catch(cause){await markOfflineDraftFailure(scope.userId,draft.id,cause);failed++}
      }
      await refresh();
      if(failed)setError(`${synced} sincronizados · ${failed} pendientes. Revisá el error de cada registro; no se descartó ninguno.`);
      else setNotice(synced?`${synced} hallazgo${synced===1?'':'s'} sincronizado${synced===1?'':'s'} sin duplicados.`:'No había borradores de este establecimiento para sincronizar.');
    }catch(cause){setError(errorMessage(cause))}
    finally{setBusy(null)}
  }

  async function deleteDraft(id:string){
    setBusy('delete');setError('');
    try{await removeOfflineDraft(scope.userId,id);setConfirmDelete(null);setNotice('Borrador cifrado eliminado de este dispositivo.');await refresh()}
    catch(cause){setError(errorMessage(cause))}
    finally{setBusy(null)}
  }

  async function reset(){
    setBusy('reset');setError('');
    try{await resetOfflineVault(scope.userId);setDrafts([]);setConfirmReset(false);setNotice('Bóveda restablecida. Los borradores cifrados locales fueron eliminados.');setPassphrase('');setConfirmation('')}
    catch(cause){setError(errorMessage(cause))}
    finally{setBusy(null)}
  }

  const localPending=drafts.length;
  return <section className={`offlineVault ${vault.status==='unlocked'?'unlocked':''}`}>
    <button className="offlineVaultSummary" type="button" onClick={()=>setExpanded(value=>!value)} aria-expanded={expanded}>
      <span>{vault.status==='unlocked'?<ShieldCheck/>:<LockKeyhole/>}<span><small>NODO FIELD OFFLINE · BÓVEDA CIFRADA</small><b>{vault.status==='unsupported'?'No disponible en este navegador':vault.status==='unconfigured'?'Activar trabajo sin señal':vault.status==='unlocked'?`${vault.pendingCount} borradores protegidos`:'Bóveda bloqueada'}</b></span></span>
      <em>{expanded?'Cerrar':'Gestionar'}</em>
    </button>
    {expanded&&<div className="offlineVaultBody">
      {vault.status==='checking'&&<div className="vaultState"><LoaderCircle className="spin"/>Verificando cifrado y almacenamiento local…</div>}
      {vault.status==='unsupported'&&<div className="vaultWarning"><ShieldAlert/><span><b>Modo offline seguro no disponible</b>Este navegador bloqueó IndexedDB o Web Crypto. NODO no guardará datos sensibles sin cifrado.</span></div>}
      {(vault.status==='unconfigured'||vault.status==='locked')&&<form className="vaultAccess" onSubmit={access}>
        <div><KeyRound/><span><b>{vault.status==='unconfigured'?'Creá una frase local':'Desbloqueá la bóveda'}</b><small>No es tu contraseña de NODO, no sale del dispositivo y no puede recuperarse.</small></span></div>
        <label>Frase de protección<input type="password" autoComplete="new-password" required minLength={10} value={passphrase} onChange={event=>setPassphrase(event.target.value)} placeholder="Mínimo 10 caracteres"/></label>
        {vault.status==='unconfigured'&&<label>Repetir frase<input type="password" autoComplete="new-password" required minLength={10} value={confirmation} onChange={event=>setConfirmation(event.target.value)}/></label>}
        <button disabled={busy!==null}>{busy==='access'?<LoaderCircle className="spin"/>:vault.status==='unconfigured'?<ShieldCheck/>:<UnlockKeyhole/>}{vault.status==='unconfigured'?'Activar bóveda':'Desbloquear'}</button>
      </form>}
      {vault.status==='unlocked'&&<>
        <div className="vaultControls"><div><HardDrive/><span><b>{localPending} en este establecimiento · {vault.pendingCount} en este usuario</b><small>AES‑GCM · clave sólo en memoria · bloqueo tras 15 min de inactividad</small></span></div><div><button type="button" disabled={busy!==null||localPending===0||!navigator.onLine} onClick={()=>void synchronize()}>{busy==='sync'?<LoaderCircle className="spin"/>:navigator.onLine?<CloudUpload/>:<WifiOff/>}Sincronizar</button><button type="button" onClick={()=>lockOfflineVault('manual')}><LockKeyhole/>Bloquear</button></div></div>
        <div className="vaultLimits"><ShieldCheck/><span><b>Alcance seguro v1</b>Guarda hallazgos estructurados, coordenadas y notas cifradas. Las fotos no se almacenan offline todavía.</span></div>
        {drafts.length?<div className="vaultDrafts">{drafts.map(draft=><article key={draft.id} className={draft.decryptError?'corrupt':''}>
          <div><b>{draft.payload?categoryLabels[draft.payload.category]:'Contenido no autenticado'}</b><small>{draft.payload?`${severityLabels[draft.payload.severity]} · ${new Date(draft.payload.observedAt).toLocaleString('es-AR')}`:draft.decryptError}</small>{draft.lastError&&<em>Último intento: {draft.lastError}</em>}</div>
          {confirmDelete===draft.id?<span><button type="button" disabled={busy!==null} onClick={()=>void deleteDraft(draft.id)}><Trash2/>Confirmar descarte</button><button type="button" onClick={()=>setConfirmDelete(null)}>Conservar</button></span>:<button className="vaultDelete" type="button" aria-label="Descartar borrador cifrado" onClick={()=>setConfirmDelete(draft.id)}><Trash2/></button>}
        </article>)}</div>:<div className="vaultEmpty">No hay hallazgos offline pendientes para este establecimiento.</div>}
        <div className="vaultReset">{confirmReset?<><p>Esto elimina todos los borradores cifrados del usuario en este dispositivo. No puede deshacerse.</p><button type="button" disabled={busy!==null} onClick={()=>void reset()}><Trash2/>{busy==='reset'?'Eliminando…':'Confirmar restablecimiento'}</button><button type="button" onClick={()=>setConfirmReset(false)}>Cancelar</button></>:<button type="button" onClick={()=>setConfirmReset(true)}><RotateCcw/>Restablecer bóveda local</button>}</div>
      </>}
      {notice&&<p className="vaultNotice"><ShieldCheck/>{notice}</p>}
      {error&&<p className="vaultError"><ShieldAlert/>{error}</p>}
    </div>}
  </section>;
}
