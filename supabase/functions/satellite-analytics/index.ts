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

const indexDefinitions = {
  ndvi: {
    expression: '(B08-B04)/(B08+B04)',
    algorithmVersion: 'sentinel2-l2a-ndvi-unmasked-v1',
    resolutionMeters: 10,
  },
  ndmi: {
    expression: '(B8A-B11)/(B8A+B11)',
    algorithmVersion: 'sentinel2-l2a-ndmi-unmasked-v1',
    resolutionMeters: 20,
  },
} as const;

type IndexName = keyof typeof indexDefinitions;
type AnalysisRequest = { establishment_id?: unknown; index_name?: unknown };
type GeoJsonPolygon = { type: 'Polygon'; coordinates: number[][][] };
type Parcel = { id: string; name: string; boundary_geojson: unknown };
type RunContext = { admin: SupabaseClient; runId: string; parcelCount: number };

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

async function providerStatistics(sceneId: string, indexName: IndexName, parcel: Parcel) {
  const geometry = validPolygon(parcel.boundary_geojson);
  if (!geometry) throw new PublicError(422, 'invalid_parcel_boundary', `El lote ${parcel.name} no tiene un polígono válido.`);
  const definition = indexDefinitions[indexName];
  const params = new URLSearchParams({
    collection: 'sentinel-2-l2a', item: sceneId, expression: definition.expression,
    rescale: '-1,1', asset_as_band: 'true',
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
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
    console.error(JSON.stringify({ event: 'satellite_statistics_provider_error', parcel_id: parcel.id, status: response.status }));
    throw new PublicError(502, 'provider_error', `El proveedor satelital rechazó el análisis del lote ${parcel.name}.`);
  }
  const payload = await response.json() as Record<string, unknown>;
  const properties = payload.properties as Record<string, unknown> | undefined;
  const statistics = properties?.statistics as Record<string, unknown> | undefined;
  const raw = statistics?.[definition.expression] as Record<string, unknown> | undefined;
  const min = finiteNumber(raw?.min);
  const max = finiteNumber(raw?.max);
  const mean = finiteNumber(raw?.mean);
  const std = finiteNumber(raw?.std);
  const validPercent = finiteNumber(raw?.valid_percent);
  const percentile02 = finiteNumber(raw?.percentile_2);
  const percentile98 = finiteNumber(raw?.percentile_98);
  const count = finiteNumber(raw?.count);
  if (min === null || max === null || mean === null || std === null || validPercent === null || count === null ||
      min < -1 || max > 1 || mean < min || mean > max || std < 0 || validPercent < 0 || validPercent > 100 || !Number.isInteger(count) || count < 1) {
    throw new PublicError(502, 'provider_contract_invalid', `La respuesta satelital del lote ${parcel.name} no cumple el contrato esperado.`);
  }
  return { min, max, mean, std, validPercent, percentile02, percentile98, count };
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

    const authClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
    const { data: userData, error: userError } = await authClient.auth.getUser();
    if (userError || !userData.user) throw new PublicError(401, 'invalid_session', 'La sesión ya no es válida.');
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    const { data: establishment, error: establishmentError } = await admin.from('establishments')
      .select('id,organization_id').eq('id', body.establishment_id).maybeSingle();
    if (establishmentError) throw establishmentError;
    if (!establishment) throw new PublicError(404, 'establishment_not_found', 'No encontramos el establecimiento.');
    const { data: membership, error: membershipError } = await admin.from('organization_members')
      .select('role').eq('organization_id', establishment.organization_id).eq('user_id', userData.user.id).maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership || !allowedRoles.has(membership.role)) throw new PublicError(403, 'forbidden', 'Tu rol no puede ejecutar análisis satelitales.');

    const { data: scene, error: sceneError } = await admin.from('satellite_scenes')
      .select('id,provider,collection,external_id,captured_at,cloud_cover_pct')
      .eq('establishment_id', establishment.id).order('captured_at', { ascending: false }).limit(1).maybeSingle();
    if (sceneError) throw sceneError;
    if (!scene) throw new PublicError(409, 'scene_required', 'Primero sincronizá una escena satelital.');
    if (scene.provider !== 'Microsoft Planetary Computer' || scene.collection !== 'sentinel-2-l2a' || !sceneIdPattern.test(scene.external_id)) {
      throw new PublicError(409, 'scene_not_supported', 'La escena actual no es compatible con este motor de análisis.');
    }

    const { data: parcels, error: parcelsError } = await admin.from('land_parcels')
      .select('id,name,boundary_geojson').eq('establishment_id', establishment.id).not('boundary_geojson', 'is', null).order('name').limit(101);
    if (parcelsError) throw parcelsError;
    if (!parcels?.length) throw new PublicError(409, 'parcel_boundaries_required', 'Delimitá al menos un lote antes de analizar.');
    if (parcels.length > 100) throw new PublicError(409, 'parcel_limit_exceeded', 'El análisis admite hasta 100 lotes por ejecución.');

    const { data: run, error: runError } = await admin.from('satellite_analysis_runs').insert({
      organization_id: establishment.organization_id, establishment_id: establishment.id,
      satellite_scene_id: scene.id, index_name: indexName, requested_by: userData.user.id,
      parcel_count: parcels.length,
    }).select('id').single();
    if (runError || !run) throw runError ?? new Error('analysis_run_not_created');
    runContext = { admin, runId: run.id, parcelCount: parcels.length };

    const successes: Array<{ parcel: Parcel; stats: Awaited<ReturnType<typeof providerStatistics>> }> = [];
    const failures: Array<{ parcel_id: string; code: string }> = [];
    for (let offset = 0; offset < parcels.length; offset += 4) {
      const chunk = parcels.slice(offset, offset + 4) as Parcel[];
      const results = await Promise.all(chunk.map(async parcel => {
        try { return { ok: true as const, parcel, stats: await providerStatistics(scene.external_id, indexName, parcel) }; }
        catch (error) {
          const code = error instanceof PublicError ? error.code : 'statistics_failed';
          console.error(JSON.stringify({ event: 'parcel_satellite_analysis_failed', run_id: run.id, parcel_id: parcel.id, code }));
          return { ok: false as const, parcel, code };
        }
      }));
      for (const result of results) {
        if (result.ok) successes.push({ parcel: result.parcel, stats: result.stats });
        else failures.push({ parcel_id: result.parcel.id, code: result.code });
      }
    }

    const definition = indexDefinitions[indexName];
    if (successes.length) {
      const records = successes.map(({ parcel, stats }) => ({
        organization_id: establishment.organization_id, establishment_id: establishment.id,
        parcel_id: parcel.id, satellite_scene_id: scene.id, analysis_run_id: run.id,
        index_name: indexName, captured_at: scene.captured_at, cloud_cover_pct: scene.cloud_cover_pct,
        mean_value: stats.mean, min_value: stats.min, max_value: stats.max, stddev_value: stats.std,
        percentile_02: stats.percentile02, percentile_98: stats.percentile98,
        valid_percent: stats.validPercent, pixel_count: stats.count,
        quality_status: (Number(scene.cloud_cover_pct ?? 100) > 40 ? 'cloud_limited' : stats.count < 4 ? 'insufficient_pixels' : 'usable'),
        source_provider: 'Sentinel-2 L2A via Microsoft Planetary Computer', algorithm_version: definition.algorithmVersion,
        computed_at: new Date().toISOString(),
      }));
      const { error: metricsError } = await admin.from('parcel_satellite_metrics').upsert(records, {
        onConflict: 'parcel_id,satellite_scene_id,index_name,algorithm_version',
      });
      if (metricsError) throw metricsError;
    }

    const status = failures.length === 0 ? 'completed' : successes.length ? 'partial' : 'failed';
    const { error: completionError } = await admin.from('satellite_analysis_runs').update({
      status, succeeded_count: successes.length, failed_count: failures.length,
      error_code: failures.length ? 'parcel_statistics_failed' : null, completed_at: new Date().toISOString(),
    }).eq('id', run.id).eq('status', 'running');
    if (completionError) throw completionError;
    runContext = null;

    const responseBody = {
      run_id: run.id, status, index_name: indexName, scene: {
        id: scene.id, external_id: scene.external_id, captured_at: scene.captured_at,
        cloud_cover_pct: scene.cloud_cover_pct, resolution_meters: definition.resolutionMeters,
      },
      succeeded_count: successes.length, failed_count: failures.length, failures,
      limitations: ['Índice espectral sin máscara de nubes por píxel.', 'La calidad usa nubosidad global de escena y cantidad de píxeles interiores.', 'La lectura es un proxy y requiere validación agronómica en campo.'],
    };
    return json(responseBody, status === 'failed' ? 502 : 200);
  } catch (error) {
    if (runContext) {
      await runContext.admin.from('satellite_analysis_runs').update({
        status: 'failed', succeeded_count: 0, failed_count: runContext.parcelCount,
        error_code: error instanceof PublicError ? error.code : 'analysis_failed', completed_at: new Date().toISOString(),
      }).eq('id', runContext.runId).eq('status', 'running');
    }
    const publicError = error instanceof PublicError ? error : new PublicError(500, 'analysis_failed', 'No pudimos completar el análisis satelital. Los datos anteriores siguen intactos.');
    console.error(JSON.stringify({ event: 'satellite_analysis_failed', code: publicError.code, message: error instanceof Error ? error.message : String(error) }));
    return json({ error: publicError.message, code: publicError.code }, publicError.status);
  }
});
