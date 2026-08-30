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

export function scrubAuthCallbackUrl() {
  if (typeof window === 'undefined') return;
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const search = new URLSearchParams(window.location.search);
  const hasSensitiveFragment = ['access_token','refresh_token','provider_token','provider_refresh_token','error','error_description']
    .some(key => hash.has(key));
  const hasPkceCallback = search.has('code') || search.has('error') || search.has('error_description');
  if (hasSensitiveFragment || hasPkceCallback) window.history.replaceState(window.history.state, document.title, window.location.pathname);
}
