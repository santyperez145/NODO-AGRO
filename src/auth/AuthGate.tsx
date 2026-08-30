import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { AlertCircle, Eye, EyeOff, LoaderCircle, LockKeyhole } from 'lucide-react';
import { authRedirectUrl, isAuthConfigured, rememberedOfflineIdentity, rememberOfflineIdentity, scrubAuthCallbackUrl, supabase } from '../lib/supabase';
import { lockOfflineVault } from '../lib/offlineVault';

export function AuthGate({ children }: { children: (identity:{userId:string;sessionBacked:boolean})=>ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(isAuthConfigured);
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ tone: 'error' | 'ok'; text: string } | null>(null);
  const [online,setOnline]=useState(()=>navigator.onLine);
  const [authUnavailable,setAuthUnavailable]=useState(false);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data, error }) => {
      if (error) {setMessage({ tone: 'error', text: error.message });setAuthUnavailable(true)}
      if(data.session)rememberOfflineIdentity(data.session.user.id);
      setSession(data.session); setLoading(false); scrubAuthCallbackUrl();
    });
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      if(next){rememberOfflineIdentity(next.user.id);setAuthUnavailable(false)}
      setSession(next); setLoading(false);
      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') scrubAuthCallbackUrl();
      if (event === 'SIGNED_OUT') lockOfflineVault('session_changed');
    });
    const connected=()=>setOnline(true);const disconnected=()=>setOnline(false);
    window.addEventListener('online',connected);window.addEventListener('offline',disconnected);
    return () => {data.subscription.unsubscribe();window.removeEventListener('online',connected);window.removeEventListener('offline',disconnected)};
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault(); setMessage(null);
    if (!supabase) return;
    if (password.length < 10) { setMessage({ tone: 'error', text: 'La contraseña debe tener al menos 10 caracteres.' }); return; }
    if (mode === 'signup' && !/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9])/.test(password)) { setMessage({ tone: 'error', text: 'Usá mayúscula, minúscula, número y símbolo.' }); return; }
    setSubmitting(true);
    const result = mode === 'login'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: authRedirectUrl() } });
    setSubmitting(false);
    if (result.error) setMessage({ tone: 'error', text: result.error.message });
    else if (mode === 'signup' && !result.data.session) setMessage({ tone: 'ok', text: 'Revisá tu correo para confirmar la cuenta.' });
  }

  async function googleLogin() {
    setMessage(null);
    if (!supabase) return;
    setSubmitting(true);
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: authRedirectUrl() } });
    if (error) { setMessage({ tone: 'error', text: error.message }); setSubmitting(false); }
  }

  if (loading) return <div className="authLoading"><LoaderCircle className="spin"/><span>Verificando sesión segura…</span></div>;
  if (session) return <>{children({userId:session.user.id,sessionBacked:true})}</>;
  const offlineIdentity=(!online||authUnavailable)?rememberedOfflineIdentity():null;
  if(offlineIdentity)return <>{children({userId:offlineIdentity,sessionBacked:false})}</>;

  return <div className="authPage"><section className="authStory"><div className="authBrand"><ActivityLogo/></div><div><small>INTELIGENCIA OPERATIVA AGROPECUARIA</small><h1>Tu campo.<br/>Conectado y predecible.</h1><p>Satélites, sensores y operaciones convertidos en decisiones claras para producir mejor.</p></div><footer>Los datos de cada establecimiento permanecen aislados y bajo control de su organización.</footer></section><section className="authPanel"><form onSubmit={submit}><div className="authMark"><LockKeyhole/></div><h2>{mode === 'login' ? 'Ingresá a NODO' : 'Creá tu cuenta'}</h2><p>{mode === 'login' ? 'Accedé al gemelo digital de tu establecimiento.' : 'Comenzá la configuración segura de tu operación.'}</p>
    {!isAuthConfigured && <div className="authMessage error"><AlertCircle/>Falta configurar Supabase. Copiá <b>.env.example</b> a <b>.env.local</b> y completá las credenciales públicas.</div>}
    {message && <div className={`authMessage ${message.tone}`}><AlertCircle/>{message.text}</div>}
    <label>Correo electrónico<input type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="nombre@empresa.com"/></label>
    <label>Contraseña<div className="password"><input type={showPassword?'text':'password'} autoComplete={mode==='login'?'current-password':'new-password'} minLength={10} required value={password} onChange={e=>setPassword(e.target.value)} placeholder="Mínimo 10 caracteres"/><button type="button" onClick={()=>setShowPassword(v=>!v)} aria-label={showPassword?'Ocultar contraseña':'Mostrar contraseña'}>{showPassword?<EyeOff/>:<Eye/>}</button></div></label>
    <button className="authSubmit" disabled={!isAuthConfigured||submitting}>{submitting?<LoaderCircle className="spin"/>:mode==='login'?'Ingresar':'Crear cuenta'}</button>
    <div className="or"><span/>o continuá con<span/></div>
    <button className="google" type="button" disabled={!isAuthConfigured||submitting} onClick={googleLogin}><GoogleIcon/> Google</button>
    <button className="mode" type="button" onClick={()=>{setMode(mode==='login'?'signup':'login');setMessage(null)}}>{mode==='login'?'¿Todavía no tenés cuenta? Crear cuenta':'¿Ya tenés cuenta? Ingresar'}</button>
  </form></section></div>;
}

function ActivityLogo(){return <div className="activityLogo"><span>⌁</span><b>NODO</b></div>}
function GoogleIcon(){return <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.5-.2-2.2H12v4.2h5.4a4.6 4.6 0 0 1-2 3v2.7h3.4c2-1.8 3.1-4.5 3.1-7.7z"/><path fill="#34A853" d="M12 22c2.8 0 5.1-.9 6.8-2.5l-3.4-2.7c-.9.6-2.1 1-3.4 1a6 6 0 0 1-5.6-4.1H2.9v2.8A10 10 0 0 0 12 22z"/><path fill="#FBBC05" d="M6.4 13.7a6 6 0 0 1 0-3.8V7.1H2.9a10 10 0 0 0 0 8.9l3.5-2.7z"/><path fill="#EA4335" d="M12 6.1c1.5 0 2.9.5 4 1.6l3-3A10 10 0 0 0 2.9 7.1l3.5 2.8A6 6 0 0 1 12 6.1z"/></svg>}
