import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type SyncRequest = { establishment_id?: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const authorization = request.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer ')) return json({ error: 'Authentication required' }, 401);
    const url = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !anonKey || !serviceKey) throw new Error('Runtime configuration is incomplete');

    const body = (await request.json()) as SyncRequest;
    if (!body.establishment_id) return json({ error: 'establishment_id is required' }, 400);

    const authClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
    const { data: userData, error: userError } = await authClient.auth.getUser();
    if (userError || !userData.user) return json({ error: 'Invalid session' }, 401);

    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: establishment, error: establishmentError } = await admin
      .from('establishments')
      .select('id,organization_id,name,latitude,longitude')
      .eq('id', body.establishment_id)
      .single();
    if (establishmentError || !establishment) return json({ error: 'Establishment not found' }, 404);
    const { data: membership } = await admin
      .from('organization_members')
      .select('role')
      .eq('organization_id', establishment.organization_id)
      .eq('user_id', userData.user.id)
      .maybeSingle();
    if (!membership) return json({ error: 'Forbidden' }, 403);

    const params = new URLSearchParams({
      latitude: String(establishment.latitude), longitude: String(establishment.longitude),
      current: 'temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m',
      daily: 'precipitation_sum,temperature_2m_min,wind_speed_10m_max',
      timezone: 'UTC', forecast_days: '7',
    });
    const weatherResponse = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
    if (!weatherResponse.ok) throw new Error(`Open-Meteo failed with ${weatherResponse.status}`);
    const weather = await weatherResponse.json();
    const current = weather.current;
    const rain7d = (weather.daily?.precipitation_sum ?? []).reduce((sum: number, value: number | null) => sum + (value ?? 0), 0);
    if (![current?.temperature_2m, current?.relative_humidity_2m, current?.precipitation, current?.wind_speed_10m, rain7d].every(Number.isFinite)) {
      throw new Error('Open-Meteo returned an invalid contract');
    }
    const observedAt = new Date(current.time).toISOString();
    const { error: weatherInsertError } = await admin.from('weather_observations').upsert({
      organization_id: establishment.organization_id,
      establishment_id: establishment.id,
      observed_at: observedAt,
      temperature_c: current.temperature_2m,
      humidity_pct: current.relative_humidity_2m,
      precipitation_mm: current.precipitation,
      wind_kmh: current.wind_speed_10m,
      forecast_rain_7d_mm: rain7d,
      source: 'Open-Meteo',
      source_payload: { timezone: weather.timezone, elevation: weather.elevation },
    }, { onConflict: 'establishment_id,observed_at,source' });
    if (weatherInsertError) throw weatherInsertError;

    let satellite: { captured_at: string; cloud_cover_pct: number | null; external_id: string } | null = null;
    try {
      const delta = 0.03;
      const until = new Date();
      const since = new Date(until.getTime() - 45 * 86_400_000);
      const stacResponse = await fetch('https://planetarycomputer.microsoft.com/api/stac/v1/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          collections: ['sentinel-2-l2a'],
          bbox: [establishment.longitude - delta, establishment.latitude - delta, establishment.longitude + delta, establishment.latitude + delta],
          datetime: `${since.toISOString()}/${until.toISOString()}`,
          query: { 'eo:cloud_cover': { lt: 70 } }, limit: 1,
          sortby: [{ field: 'datetime', direction: 'desc' }],
        }),
      });
      if (stacResponse.ok) {
        const stac = await stacResponse.json();
        const scene = stac.features?.[0];
        if (scene?.id && scene?.properties?.datetime) {
          satellite = { external_id: scene.id, captured_at: scene.properties.datetime, cloud_cover_pct: scene.properties['eo:cloud_cover'] ?? null };
          await admin.from('satellite_scenes').upsert({
            organization_id: establishment.organization_id, establishment_id: establishment.id,
            provider: 'Microsoft Planetary Computer', collection: 'sentinel-2-l2a', external_id: scene.id,
            captured_at: scene.properties.datetime, cloud_cover_pct: scene.properties['eo:cloud_cover'] ?? null,
            catalog_url: scene.links?.find((link: { rel?: string }) => link.rel === 'self')?.href ?? null,
            metadata: { platform: scene.properties.platform, constellation: scene.properties.constellation },
          }, { onConflict: 'provider,external_id' });
        }
      }
    } catch (satelliteError) {
      console.error(JSON.stringify({ event: 'satellite_catalog_failed', message: satelliteError instanceof Error ? satelliteError.message : String(satelliteError) }));
    }

    const today = new Date().toISOString().slice(0, 10);
    const recommendations: Record<string, unknown>[] = [];
    const base = { organization_id: establishment.organization_id, establishment_id: establishment.id, status: 'open', generated_at: new Date().toISOString() };
    if (rain7d >= 20) recommendations.push({ ...base, fingerprint: `weather:${today}:rain`, title: 'Reprogramar riego y labores sensibles', rationale: `El pronóstico acumulado es ${rain7d.toFixed(1)} mm para los próximos 7 días.`, action: 'Revisar el plan de riego y evitar labores antes de los eventos de mayor precipitación.', priority: rain7d >= 50 ? 'high' : 'medium', confidence: 86, evidence: [{ source: 'Open-Meteo', metric: 'forecast_rain_7d_mm', value: rain7d, observed_at: observedAt }], expected_value: { category: 'water_and_fuel_saving' }, valid_until: new Date(Date.now() + 72 * 3_600_000).toISOString() });
    const maxWind = Math.max(...(weather.daily?.wind_speed_10m_max ?? [current.wind_speed_10m]));
    if (maxWind >= 25) recommendations.push({ ...base, fingerprint: `weather:${today}:wind`, title: 'Evitar aplicaciones durante la ventana de viento', rationale: `Se esperan ráfagas o viento máximo de ${maxWind.toFixed(1)} km/h.`, action: 'Programar aplicaciones únicamente en una ventana con viento dentro del límite de la etiqueta del producto.', priority: 'high', confidence: 88, evidence: [{ source: 'Open-Meteo', metric: 'wind_speed_10m_max', value: maxWind, observed_at: observedAt }], expected_value: { category: 'drift_risk_reduction' }, valid_until: new Date(Date.now() + 48 * 3_600_000).toISOString() });
    const minTemperature = Math.min(...(weather.daily?.temperature_2m_min ?? [current.temperature_2m]));
    if (minTemperature <= 3) recommendations.push({ ...base, fingerprint: `weather:${today}:frost`, title: 'Activar protocolo de riesgo de helada', rationale: `La temperatura mínima prevista alcanza ${minTemperature.toFixed(1)} °C.`, action: 'Verificar cultivos sensibles y confirmar el pronóstico con una estación local antes de intervenir.', priority: minTemperature <= 0 ? 'critical' : 'high', confidence: 84, evidence: [{ source: 'Open-Meteo', metric: 'temperature_2m_min', value: minTemperature, observed_at: observedAt }], expected_value: { category: 'crop_risk_reduction' }, valid_until: new Date(Date.now() + 48 * 3_600_000).toISOString() });
    if (recommendations.length) {
      const { error: recommendationError } = await admin.from('recommendations').upsert(recommendations, { onConflict: 'establishment_id,fingerprint' });
      if (recommendationError) throw recommendationError;
    }

    return json({
      establishment_id: establishment.id,
      synchronized_at: new Date().toISOString(),
      weather: { observed_at: observedAt, rain_7d_mm: rain7d },
      satellite,
      recommendations_generated: recommendations.length,
      sources: ['Open-Meteo', ...(satellite ? ['Sentinel-2 L2A via Microsoft Planetary Computer'] : [])],
    });
  } catch (error) {
    console.error(JSON.stringify({ event: 'sync_intelligence_failed', message: error instanceof Error ? error.message : String(error) }));
    return json({ error: error instanceof Error ? error.message : 'Unexpected failure' }, 500);
  }
});
