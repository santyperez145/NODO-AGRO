import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const allowedRoles = new Set(['owner', 'admin', 'agronomist', 'operator']);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sceneIdPattern = /^[A-Za-z0-9_-]{10,180}$/;
const providerBaseUrl = 'https://planetarycomputer.microsoft.com/api/data/v1/item/statistics';
const stacUrl = 'https://planetarycomputer.microsoft.com/api/stac/v1/search';
const weatherArchiveUrl = 'https://archive-api.open-meteo.com/v1/archive';
const maxScenes = 12;
const maxNewObservations = 48;
const catalogDays = 90;
const stuckRunMinutes = 12;
const cloudClassKeys = new Set(['3', '8', '9', '10']);
const clearClassKeys = new Set(['4', '5', '6', '7']);

const indexDefinitions = {
  ndvi: {
    expression: '(B08-B04)/(B08+B04)',
    algorithmVersion: 'sentinel2-l2a-ndvi-scl-v1',
    resolutionMeters: 10,
  },
  ndmi: {
    expression: '(B8A-B11)/(B8A+B11)',
    algorithmVersion: 'sentinel2-l2a-ndmi-scl-v1',
    resolutionMeters: 20,
  },
} as const;

type IndexName = keyof typeof indexDefinitions;
type AnalysisRequest = { establishment_id?: unknown; index_name?: unknown };
type GeoJsonPolygon = { type: 'Polygon'; coordinates: number[][][] };
type Parcel = { id: string; name: string; boundary_geojson: unknown };
type SceneRow = {
  id: string; provider: string; collection: string; external_id: string;
  captured_at: string; cloud_cover_pct: number | null;
};
type RunContext = { admin: SupabaseClient; runId: string };

class PublicError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

function validPolygon(value: unknown): GeoJsonPolygon | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as { type?: unknown; coordinates?: unknown };
  if (candidate.type !== 'Polygon' || !Array.isArray(candidate.coordinates) || candidate.coordinates.length < 1) return null;
  let vertices = 0;
  for (const ring of candidate.coordinates) {
    if (!Array.isArray(ring) || ring.length < 4) return null;
    vertices += ring.length;
    for (const point of ring) {
      if (!Array.isArray(point) || point.length < 2) return null;
      const longitude = point[0];
      const latitude = point[1];
      if (typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
          typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null;
    }
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) return null;
  }
  if (vertices > 500 || JSON.stringify(value).length > 100_000) return null;
  return value as GeoJsonPolygon;
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function parseSclCounts(histogram: unknown) {
  if (!Array.isArray(histogram) || histogram.length < 2 || !Array.isArray(histogram[0]) || !Array.isArray(histogram[1])) return null;
  const counts = histogram[0];
  const edges = histogram[1];
  if (counts.length < 11 || edges.length < 12) return null;
  const classCounts: Record<string, number> = {};
  let total = 0;
  let cloud = 0;
  let clear = 0;
  for (let index = 0; index < 12; index += 1) {
    const count = finiteNumber(counts[index]);
    const edge = finiteNumber(edges[index]);
    if (count === null || edge === null || count < 0 || !Number.isInteger(count) || Math.abs(edge - index) > 0.01) return null;
    if (count > 0) classCounts[String(index)] = count;
    total += count;
    if (cloudClassKeys.has(String(index))) cloud += count;
    if (clearClassKeys.has(String(index))) clear += count;
  }
  if (total < 1) return null;
  return {
    classCounts,
    cloudPercent: (cloud / total) * 100,
    clearPercent: (clear / total) * 100,
  };
}

function qualityStatus(cloudPercent: number, clearPercent: number, pixelCount: number) {
  if (cloudPercent >= 5) return 'cloud_limited' as const;
  if (clearPercent < 50 || pixelCount < 4) return 'insufficient_pixels' as const;
  return 'usable' as const;
}

async function providerObservation(sceneId: string, indexName: IndexName, parcel: Parcel) {
  const geometry = validPolygon(parcel.boundary_geojson);
  if (!geometry) throw new PublicError(422, 'invalid_parcel_boundary', `El lote ${parcel.name} no tiene un polígono válido.`);
  const definition = indexDefinitions[indexName];
  const params = new URLSearchParams({
    collection: 'sentinel-2-l2a',
    item: sceneId,
    expression: `${definition.expression};SCL`,
    asset_as_band: 'true',
    histogram_bins: '0,1,2,3,4,5,6,7,8,9,10,11,12',
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  let response: Response;
  try {
    response = await fetch(`${providerBaseUrl}?${params}`, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'Feature', properties: { parcel_id: parcel.id }, geometry }),
    });
  } catch (error) {
    const code = error instanceof DOMException && error.name === 'AbortError' ? 'provider_timeout' : 'provider_unreachable';
    throw new PublicError(502, code, 'El proveedor satelital no respondió a tiempo.');
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    console.error(JSON.stringify({ event: 'earth_time_provider_error', parcel_id: parcel.id, status: response.status }));
    throw new PublicError(502, 'provider_error', `El proveedor satelital rechazó el análisis del lote ${parcel.name}.`);
  }
  const payload = await response.json() as Record<string, unknown>;
  const properties = payload.properties as Record<string, unknown> | undefined;
  const statistics = properties?.statistics as Record<string, unknown> | undefined;
  const raw = statistics?.[definition.expression] as Record<string, unknown> | undefined;
  const scl = statistics?.SCL as Record<string, unknown> | undefined;
  const min = finiteNumber(raw?.min);
  const max = finiteNumber(raw?.max);
  const mean = finiteNumber(raw?.mean);
  const std = finiteNumber(raw?.std);
  const validPercent = finiteNumber(raw?.valid_percent);
  const percentile02 = finiteNumber(raw?.percentile_2);
  const percentile98 = finiteNumber(raw?.percentile_98);
  const median = finiteNumber(raw?.median);
  const count = finiteNumber(raw?.count);
  const sclCounts = parseSclCounts(scl?.histogram);
  if (min === null || max === null || mean === null || std === null || validPercent === null || count === null || sclCounts === null ||
      min < -1 || max > 1 || mean < min || mean > max || std < 0 || validPercent < 0 || validPercent > 100 || !Number.isInteger(count) || count < 1) {
    throw new PublicError(502, 'provider_contract_invalid', `La respuesta satelital del lote ${parcel.name} no cumple el contrato SCL.`);
  }
  return { min, max, mean, std, validPercent, percentile02, percentile98, median, count, sclCounts };
}

async function discoverScenes(
  admin: SupabaseClient,
  establishment: { id: string; organization_id: string; latitude: number; longitude: number },
) {
  const until = new Date();
  const since = new Date(until.getTime() - catalogDays * 86_400_000);
  const delta = 0.03;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  let response: Response;
  try {
    response = await fetch(stacUrl, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collections: ['sentinel-2-l2a'],
        bbox: [establishment.longitude - delta, establishment.latitude - delta, establishment.longitude + delta, establishment.latitude + delta],
        datetime: `${since.toISOString()}/${until.toISOString()}`,
        query: { 'eo:cloud_cover': { lt: 80 } },
        limit: maxScenes,
        sortby: [{ field: 'datetime', direction: 'desc' }],
      }),
    });
  } catch {
    throw new PublicError(502, 'catalog_unreachable', 'El catálogo Sentinel‑2 no respondió a tiempo.');
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new PublicError(502, 'catalog_error', 'El catálogo Sentinel‑2 rechazó la búsqueda de escenas.');
  const payload = await response.json() as { features?: Array<{
    id?: string; properties?: Record<string, unknown>; links?: Array<{ rel?: string; href?: string }>;
  }> };
  const features = payload.features ?? [];
  for (const scene of features) {
    if (!scene.id || !sceneIdPattern.test(scene.id) || typeof scene.properties?.datetime !== 'string') continue;
    const { error } = await admin.from('satellite_scenes').upsert({
      organization_id: establishment.organization_id, establishment_id: establishment.id,
      provider: 'Microsoft Planetary Computer', collection: 'sentinel-2-l2a', external_id: scene.id,
      captured_at: scene.properties.datetime, cloud_cover_pct: finiteNumber(scene.properties['eo:cloud_cover']),
      catalog_url: scene.links?.find(link => link.rel === 'self')?.href ?? null,
      metadata: { platform: scene.properties.platform, constellation: scene.properties.constellation, earth_time: true },
    }, { onConflict: 'establishment_id,provider,external_id' });
    if (error) throw error;
  }
}

async function persistDailyRain(
  admin: SupabaseClient,
  establishment: { id: string; organization_id: string; latitude: number; longitude: number },
  windowStart: string,
  windowEnd: string,
) {
  const start = isoDate(new Date(windowStart));
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const end = isoDate(new Date(Math.min(new Date(windowEnd).getTime(), yesterday.getTime())));
  if (end < start) return 0;
  const params = new URLSearchParams({
    latitude: String(establishment.latitude), longitude: String(establishment.longitude),
    start_date: start, end_date: end, daily: 'precipitation_sum,et0_fao_evapotranspiration', timezone: 'UTC',
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${weatherArchiveUrl}?${params}`, { signal: controller.signal });
    if (!response.ok) throw new Error(`archive_${response.status}`);
    const payload = await response.json() as { daily?: { time?: unknown; precipitation_sum?: unknown; et0_fao_evapotranspiration?: unknown } };
    const days = payload.daily?.time;
    const rain = payload.daily?.precipitation_sum;
    const et0 = payload.daily?.et0_fao_evapotranspiration;
    if (!Array.isArray(days) || !Array.isArray(rain) || days.length !== rain.length) return 0;
    const records = [];
    for (let index = 0; index < days.length; index += 1) {
      const day = days[index];
      const amount = finiteNumber(rain[index]);
      const reference = Array.isArray(et0) ? finiteNumber(et0[index]) : null;
      if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || amount === null || amount < 0) continue;
      records.push({
        organization_id: establishment.organization_id, establishment_id: establishment.id,
        observed_on: day, precipitation_mm: amount, et0_mm: reference !== null && reference >= 0 ? reference : null,
        observation_kind: 'observed', source: 'Open-Meteo Archive',
      });
    }
    if (!records.length) return 0;
    const { error } = await admin.from('weather_daily_observations').upsert(records, { onConflict: 'establishment_id,observed_on,source' });
    if (error) throw error;
    return records.length;
  } catch (error) {
    console.error(JSON.stringify({ event: 'earth_time_weather_archive_failed', message: error instanceof Error ? error.message : String(error) }));
    return 0;
  } finally {
    clearTimeout(timeout);
  }
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return json({ error: 'Method not allowed', code: 'method_not_allowed' }, 405);

  let runContext: RunContext | null = null;
  try {
    const authorization = request.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer ')) throw new PublicError(401, 'authentication_required', 'Necesitás iniciar sesión.');
    const url = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !anonKey || !serviceKey) throw new Error('runtime_configuration_incomplete');

    let body: AnalysisRequest;
    try { body = await request.json() as AnalysisRequest; }
    catch { throw new PublicError(400, 'invalid_json', 'La solicitud no contiene JSON válido.'); }
    if (typeof body.establishment_id !== 'string' || !uuidPattern.test(body.establishment_id)) {
      throw new PublicError(400, 'invalid_establishment', 'El establecimiento no es válido.');
    }
    const indexName = (body.index_name ?? 'ndvi') as IndexName;
    if (!(indexName in indexDefinitions)) throw new PublicError(400, 'invalid_index', 'El índice solicitado no está habilitado.');
    const definition = indexDefinitions[indexName];

    const authClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
    const { data: userData, error: userError } = await authClient.auth.getUser();
    if (userError || !userData.user) throw new PublicError(401, 'invalid_session', 'La sesión ya no es válida.');
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    const { data: establishment, error: establishmentError } = await admin.from('establishments')
      .select('id,organization_id,latitude,longitude').eq('id', body.establishment_id).maybeSingle();
    if (establishmentError) throw establishmentError;
    if (!establishment) throw new PublicError(404, 'establishment_not_found', 'No encontramos el establecimiento.');
    const { data: membership, error: membershipError } = await admin.from('organization_members')
      .select('role').eq('organization_id', establishment.organization_id).eq('user_id', userData.user.id).maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership || !allowedRoles.has(membership.role)) throw new PublicError(403, 'forbidden', 'Tu rol no puede construir series satelitales.');

    const stuckBefore = new Date(Date.now() - stuckRunMinutes * 60_000).toISOString();
    await admin.from('satellite_timeseries_runs').update({
      status: 'failed', error_code: 'run_timeout', completed_at: new Date().toISOString(),
    }).eq('establishment_id', establishment.id).eq('status', 'running').lt('started_at', stuckBefore);

    const { data: activeRun, error: activeError } = await admin.from('satellite_timeseries_runs')
      .select('id,started_at').eq('establishment_id', establishment.id).eq('status', 'running').maybeSingle();
    if (activeError) throw activeError;
    if (activeRun) throw new PublicError(409, 'series_in_progress', 'Ya hay una serie SCL en curso para este establecimiento.');

    await discoverScenes(admin, establishment);

    const { data: scenes, error: scenesError } = await admin.from('satellite_scenes')
      .select('id,provider,collection,external_id,captured_at,cloud_cover_pct')
      .eq('establishment_id', establishment.id)
      .eq('provider', 'Microsoft Planetary Computer')
      .eq('collection', 'sentinel-2-l2a')
      .gte('captured_at', new Date(Date.now() - catalogDays * 86_400_000).toISOString())
      .order('captured_at', { ascending: false }).limit(maxScenes);
    if (scenesError) throw scenesError;
    if (!scenes?.length) throw new PublicError(409, 'scene_required', 'No hay escenas Sentinel‑2 recientes para armar la serie.');

    const { data: parcels, error: parcelsError } = await admin.from('land_parcels')
      .select('id,name,boundary_geojson').eq('establishment_id', establishment.id).not('boundary_geojson', 'is', null).order('name').limit(101);
    if (parcelsError) throw parcelsError;
    if (!parcels?.length) throw new PublicError(409, 'parcel_boundaries_required', 'Delimitá al menos un lote antes de construir la serie.');
    if (parcels.length > 100) throw new PublicError(409, 'parcel_limit_exceeded', 'La serie admite hasta 100 lotes por ejecución.');

    const { data: existingMetrics, error: existingError } = await admin.from('parcel_satellite_metrics')
      .select('parcel_id,satellite_scene_id')
      .eq('establishment_id', establishment.id)
      .eq('index_name', indexName)
      .eq('algorithm_version', definition.algorithmVersion);
    if (existingError) throw existingError;
    const existing = new Set((existingMetrics ?? []).map(row => `${row.parcel_id}:${row.satellite_scene_id}`));

    const windowStart = scenes[scenes.length - 1].captured_at;
    const windowEnd = scenes[0].captured_at;
    const observationTarget = Math.min(scenes.length * parcels.length, maxNewObservations);
    const { data: seriesRun, error: seriesError } = await admin.from('satellite_timeseries_runs').insert({
      organization_id: establishment.organization_id, establishment_id: establishment.id,
      index_name: indexName, algorithm_version: definition.algorithmVersion, requested_by: userData.user.id,
      window_start: windowStart, window_end: windowEnd, scene_count: scenes.length,
      observation_target: observationTarget,
    }).select('id').single();
    if (seriesError || !seriesRun) throw seriesError ?? new Error('timeseries_run_not_created');
    runContext = { admin, runId: seriesRun.id };

    const rainDays = await persistDailyRain(admin, establishment, windowStart, windowEnd);

    let succeeded = 0;
    let failed = 0;
    let skipped = 0;
    const failures: Array<{ parcel_id: string; scene_id: string; code: string }> = [];

    for (const scene of scenes as SceneRow[]) {
      if (succeeded + failed >= maxNewObservations) break;
      if (scene.provider !== 'Microsoft Planetary Computer' || scene.collection !== 'sentinel-2-l2a' || !sceneIdPattern.test(scene.external_id)) {
        continue;
      }
      const pending = (parcels as Parcel[]).filter(parcel => !existing.has(`${parcel.id}:${scene.id}`));
      skipped += parcels.length - pending.length;
      if (!pending.length) continue;

      const remaining = maxNewObservations - (succeeded + failed);
      const batch = pending.slice(0, remaining);
      const { data: sceneRun, error: sceneRunError } = await admin.from('satellite_analysis_runs').insert({
        organization_id: establishment.organization_id, establishment_id: establishment.id,
        satellite_scene_id: scene.id, index_name: indexName, requested_by: userData.user.id,
        parcel_count: batch.length, algorithm_version: definition.algorithmVersion, timeseries_run_id: seriesRun.id,
      }).select('id').single();
      if (sceneRunError || !sceneRun) throw sceneRunError ?? new Error('scene_run_not_created');

      const successes: Array<{ parcel: Parcel; stats: Awaited<ReturnType<typeof providerObservation>> }> = [];
      let sceneFailed = 0;
      for (let offset = 0; offset < batch.length; offset += 3) {
        const chunk = batch.slice(offset, offset + 3);
        const results = await Promise.all(chunk.map(async parcel => {
          try { return { ok: true as const, parcel, stats: await providerObservation(scene.external_id, indexName, parcel) }; }
          catch (error) {
            const code = error instanceof PublicError ? error.code : 'statistics_failed';
            console.error(JSON.stringify({ event: 'earth_time_observation_failed', run_id: seriesRun.id, parcel_id: parcel.id, scene_id: scene.id, code }));
            return { ok: false as const, parcel, code };
          }
        }));
        for (const result of results) {
          if (result.ok) successes.push({ parcel: result.parcel, stats: result.stats });
          else {
            sceneFailed += 1;
            failures.push({ parcel_id: result.parcel.id, scene_id: scene.id, code: result.code });
          }
        }
      }

      if (successes.length) {
        const records = successes.map(({ parcel, stats }) => ({
          organization_id: establishment.organization_id, establishment_id: establishment.id,
          parcel_id: parcel.id, satellite_scene_id: scene.id, analysis_run_id: sceneRun.id,
          timeseries_run_id: seriesRun.id, index_name: indexName, captured_at: scene.captured_at,
          cloud_cover_pct: scene.cloud_cover_pct, mean_value: stats.mean, min_value: stats.min, max_value: stats.max,
          stddev_value: stats.std, percentile_02: stats.percentile02, percentile_98: stats.percentile98,
          median_value: stats.median, valid_percent: stats.validPercent, pixel_count: stats.count,
          scl_clear_percent: stats.sclCounts.clearPercent, scl_cloud_percent: stats.sclCounts.cloudPercent,
          scl_class_counts: stats.sclCounts.classCounts,
          quality_status: qualityStatus(stats.sclCounts.cloudPercent, stats.sclCounts.clearPercent, stats.count),
          source_provider: 'Sentinel-2 L2A SCL via Microsoft Planetary Computer',
          algorithm_version: definition.algorithmVersion, computed_at: new Date().toISOString(),
        }));
        const { error: metricsError } = await admin.from('parcel_satellite_metrics').upsert(records, {
          onConflict: 'parcel_id,satellite_scene_id,index_name,algorithm_version',
        });
        if (metricsError) throw metricsError;
      }

      const sceneStatus = sceneFailed === 0 ? 'completed' : successes.length ? 'partial' : 'failed';
      const { error: sceneCompletionError } = await admin.from('satellite_analysis_runs').update({
        status: sceneStatus, succeeded_count: successes.length, failed_count: sceneFailed,
        error_code: sceneFailed ? 'parcel_statistics_failed' : null, completed_at: new Date().toISOString(),
      }).eq('id', sceneRun.id).eq('status', 'running');
      if (sceneCompletionError) throw sceneCompletionError;
      succeeded += successes.length;
      failed += sceneFailed;
    }

    const { data: baselineCount, error: baselineError } = await admin.rpc('refresh_parcel_index_baselines', {
      target_establishment: establishment.id, target_index: indexName, target_algorithm: definition.algorithmVersion,
    });
    if (baselineError) throw baselineError;

    const status = failed === 0 && succeeded + skipped > 0 ? 'completed' : succeeded ? 'partial' : 'failed';
    const { error: completionError } = await admin.from('satellite_timeseries_runs').update({
      status, succeeded_count: succeeded, failed_count: failed, skipped_existing_count: skipped,
      error_code: failed ? 'parcel_statistics_failed' : null, completed_at: new Date().toISOString(),
    }).eq('id', seriesRun.id).eq('status', 'running');
    if (completionError) throw completionError;
    runContext = null;

    return json({
      run_id: seriesRun.id, status, index_name: indexName, algorithm_version: definition.algorithmVersion,
      scene_count: scenes.length, succeeded_count: succeeded, failed_count: failed, skipped_existing_count: skipped,
      rain_days: rainDays, baseline_parcels: typeof baselineCount === 'number' ? baselineCount : null,
      window: { start: windowStart, end: windowEnd }, failures,
      limitations: [
        'La serie usa SCL de Sentinel‑2 L2A para aceptar o rechazar cada observación por lote.',
        'Una observación es comparable sólo si el polígono tiene menos de 5% de píxeles de nube, sombra o cirros.',
        'La media del índice no reescribe píxeles nublados: si el lote no está despejado, la observación queda limitada.',
        'La línea base es la mediana empírica del mismo lote, no un calendario fenológico certificado.',
        'La lluvia diaria proviene del archivo Open‑Meteo y no sustituye una estación calibrada.',
      ],
    }, status === 'failed' ? 502 : 200);
  } catch (error) {
    if (runContext) {
      await runContext.admin.from('satellite_timeseries_runs').update({
        status: 'failed', succeeded_count: 0, failed_count: 0,
        error_code: error instanceof PublicError ? error.code : 'series_failed', completed_at: new Date().toISOString(),
      }).eq('id', runContext.runId).eq('status', 'running');
    }
    const publicError = error instanceof PublicError ? error : new PublicError(500, 'series_failed', 'No pudimos completar la serie satelital. Las observaciones anteriores siguen intactas.');
    console.error(JSON.stringify({ event: 'earth_time_failed', code: publicError.code, message: error instanceof Error ? error.message : String(error) }));
    return json({ error: publicError.message, code: publicError.code }, publicError.status);
  }
});
