import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

export const isAuthConfigured = Boolean(url && publishableKey);

const hotClient = import.meta.hot?.data.nodoSupabase as SupabaseClient | undefined;

export const supabase: SupabaseClient | null = isAuthConfigured
  ? hotClient ?? createClient(url!, publishableKey!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
    })
  : null;

if (import.meta.hot && supabase) import.meta.hot.data.nodoSupabase = supabase;

const invitationPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function invitationIdFromUrl() {
  if (typeof window === 'undefined') return null;
  const value = new URLSearchParams(window.location.search).get('invitation');
  return value && invitationPattern.test(value) ? value : null;
}

export function authRedirectUrl() {
  if (typeof window === 'undefined') return '';
  const redirect = new URL(window.location.pathname, window.location.origin);
  const invitation = invitationIdFromUrl();
  if (invitation) redirect.searchParams.set('invitation', invitation);
  return redirect.toString();
}

export function clearInvitationFromUrl() {
  if (typeof window === 'undefined') return;
  const invitation = invitationIdFromUrl();
  if (!invitation) return;
  const clean = new URL(window.location.href);
  clean.searchParams.delete('invitation');
  window.history.replaceState(window.history.state, document.title, `${clean.pathname}${clean.search}`);
}

export function scrubAuthCallbackUrl() {
  if (typeof window === 'undefined') return;
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const search = new URLSearchParams(window.location.search);
  const hasSensitiveFragment = ['access_token','refresh_token','provider_token','provider_refresh_token','error','error_description']
    .some(key => hash.has(key));
  const hasPkceCallback = search.has('code') || search.has('error') || search.has('error_description');
  if (hasSensitiveFragment || hasPkceCallback) {
    const invitation = invitationIdFromUrl();
    const clean = new URL(window.location.pathname, window.location.origin);
    if (invitation) clean.searchParams.set('invitation', invitation);
    window.history.replaceState(window.history.state, document.title, `${clean.pathname}${clean.search}`);
  }
}
