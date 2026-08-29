import { createClient } from 'npm:@supabase/supabase-js@2';

type Reading = { observed_at: string; metric: string; value: number; unit: string; quality?: number };
const encoder = new TextEncoder();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function sha256(value: string) {
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(hash)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async request => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const token = request.headers.get('x-device-token');
    if (!token || token.length < 32) return json({ error: 'Device authentication required' }, 401);
    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceKey) throw new Error('Runtime configuration is incomplete');
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: identity, error: identityError } = await admin.rpc('resolve_device_token', { candidate_digest: await sha256(token) });
    const device = identity?.[0];
    if (identityError) throw identityError;
    if (!device) return json({ error: 'Invalid or revoked device token' }, 401);

    const payload = await request.json();
    const readings = payload?.readings as Reading[];
    if (!Array.isArray(readings) || readings.length === 0 || readings.length > 100) return json({ error: 'readings must contain 1 to 100 observations' }, 400);
    const now = Date.now();
    for (const reading of readings) {
      const timestamp = Date.parse(reading.observed_at);
      if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > 7 * 86_400_000) return json({ error: 'observed_at must be within seven days of ingestion' }, 400);
      if (!/^[a-z][a-z0-9_.-]{1,63}$/.test(reading.metric)) return json({ error: 'Invalid metric name' }, 400);
      if (!Number.isFinite(reading.value) || !reading.unit || reading.unit.length > 24) return json({ error: 'Invalid value or unit' }, 400);
      if (reading.quality !== undefined && (!Number.isInteger(reading.quality) || reading.quality < 0 || reading.quality > 100)) return json({ error: 'quality must be an integer from 0 to 100' }, 400);
    }
    const rows = readings.map(reading => ({
      organization_id: device.organization_id, device_id: device.device_id,
      observed_at: new Date(reading.observed_at).toISOString(), metric: reading.metric,
      value: reading.value, unit: reading.unit, quality: reading.quality ?? 100,
    }));
    const { error: insertError } = await admin.from('sensor_readings').upsert(rows, { onConflict: 'device_id,observed_at,metric', ignoreDuplicates: true });
    if (insertError) throw insertError;
    const { error: deviceError } = await admin.from('devices').update({ status: 'online', last_seen_at: new Date().toISOString() }).eq('id', device.device_id);
    if (deviceError) throw deviceError;
    return json({ accepted: rows.length, duplicates_ignored: true, received_at: new Date().toISOString() }, 202);
  } catch (error) {
    console.error(JSON.stringify({ event: 'telemetry_ingestion_failed', message: error instanceof Error ? error.message : String(error) }));
    return json({ error: 'Telemetry ingestion failed' }, 500);
  }
});
