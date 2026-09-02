import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const allowedRoles = new Set(['owner', 'admin', 'agronomist', 'operator']);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const demItemPattern = /^[A-Za-z0-9_-]{10,180}$/;
const stacUrl = 'https://planetarycomputer.microsoft.com/api/stac/v1/search';
const mosaicRegisterUrl = 'https://planetarycomputer.microsoft.com/api/data/v1/mosaic/register';
const statisticsUrl = 'https://planetarycomputer.microsoft.com/api/data/v1/item/statistics';
const collection = 'cop-dem-glo-30';
const productId = 'cop-dem-glo-30';
const algorithmVersion = 'cop-dem-glo-30-relief-v1';
const resolutionMeters = 30;
const surfaceKind = 'dsm';
const verticalDatum = 'EGM2008';
const horizontalDatum = 'WGS84';
/** Handbook LE90ABS mean excluding Greenland and Antarctica (Copernicus DEM Product Handbook v2.1). Local deviations occur. */
const publishedLe90AbsMeanM = 1.92;
const licenseName = 'Copernicus DEM License (CSCDA ESA Mission-specific Annex)';
const licenseUrl = 'https://spacedata.copernicus.eu/documents/20126/0/CSCDA_ESA_Mission-specific+Annex.pdf';
const handbookUrl = 'https://object.cloud.sdsc.edu/v1/AUTH_opentopography/www/metadata/Copernicus_metadata.pdf';
const stuckRunMinutes = 10;
const maxParcels = 100;
const concurrency = 4;

type TerrainRequest = { establishment_id?: unknown };
type GeoJsonPolygon = { type: 'Polygon'; coordinates: number[][][] };
type Parcel = { id: string; name: string; boundary_geojson: unknown };
type DemItem = { id: string; bbox: [number, number, number, number] };
type RunContext = { admin: SupabaseClient; runId: string };

class PublicError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
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

function polygonBbox(geometry: GeoJsonPolygon): [number, number, number, number] {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const ring of geometry.coordinates) {
    for (const [longitude, latitude] of ring) {
      west = Math.min(west, longitude);
      south = Math.min(south, latitude);
      east = Math.max(east, longitude);
      north = Math.max(north, latitude);
    }
  }
  return [west, south, east, north];
}

function polygonCentroid(geometry: GeoJsonPolygon): [number, number] {
  const ring = geometry.coordinates[0];
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [x0, y0] = ring[index];
    const [x1, y1] = ring[index + 1];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (Math.abs(area) < 1e-12) {
    const [west, south, east, north] = polygonBbox(geometry);
    return [(west + east) / 2, (south + north) / 2];
  }
  area *= 0.5;
  return [cx / (6 * area), cy / (6 * area)];
}

function pointInBbox(point: [number, number], bbox: [number, number, number, number]) {
  return point[0] >= bbox[0] && point[0] <= bbox[2] && point[1] >= bbox[1] && point[1] <= bbox[3];
}

function bboxOverlapArea(a: [number, number, number, number], b: [number, number, number, number]) {
  const west = Math.max(a[0], b[0]);
  const south = Math.max(a[1], b[1]);
  const east = Math.min(a[2], b[2]);
  const north = Math.min(a[3], b[3]);
  if (east <= west || north <= south) return 0;
  return (east - west) * (north - south);
}

function expandBbox(boxes: Array<[number, number, number, number]>, padDegrees = 0.01): [number, number, number, number] {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const box of boxes) {
    west = Math.min(west, box[0]);
    south = Math.min(south, box[1]);
    east = Math.max(east, box[2]);
    north = Math.max(north, box[3]);
  }
  return [
    Math.max(-180, west - padDegrees),
    Math.max(-90, south - padDegrees),
    Math.min(180, east + padDegrees),
    Math.min(90, north + padDegrees),
  ];
}

async function fetchDemCatalog(bbox: [number, number, number, number]) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  let response: Response;
  try {
    response = await fetch(stacUrl, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collections: [collection], bbox, limit: 24 }),
    });
  } catch (error) {
    const code = error instanceof DOMException && error.name === 'AbortError' ? 'provider_timeout' : 'provider_unreachable';
    throw new PublicError(502, code, 'El catálogo DEM no respondió a tiempo.');
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new PublicError(502, 'provider_error', 'El catálogo DEM rechazó la búsqueda.');
  const payload = await response.json() as { features?: Array<{ id?: unknown; bbox?: unknown }> };
  const items: DemItem[] = [];
  for (const feature of payload.features ?? []) {
    if (typeof feature.id !== 'string' || !demItemPattern.test(feature.id) || !Array.isArray(feature.bbox) || feature.bbox.length !== 4) continue;
    const west = finiteNumber(feature.bbox[0]);
    const south = finiteNumber(feature.bbox[1]);
    const east = finiteNumber(feature.bbox[2]);
    const north = finiteNumber(feature.bbox[3]);
    if (west === null || south === null || east === null || north === null) continue;
    items.push({ id: feature.id, bbox: [west, south, east, north] });
  }
  if (!items.length) throw new PublicError(409, 'dem_coverage_missing', 'No hay Copernicus DEM GLO-30 para el polígono del establecimiento.');
  return items;
}

async function registerMosaic(bbox: [number, number, number, number]) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  let response: Response;
  try {
    response = await fetch(mosaicRegisterUrl, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collections: [collection], bbox }),
    });
  } catch (error) {
    const code = error instanceof DOMException && error.name === 'AbortError' ? 'provider_timeout' : 'provider_unreachable';
    throw new PublicError(502, code, 'No se pudo registrar el mosaico de relieve.');
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new PublicError(502, 'mosaic_register_failed', 'El proveedor no registró el mosaico DEM.');
  const payload = await response.json() as { searchid?: unknown; id?: unknown };
  const searchId = typeof payload.searchid === 'string' ? payload.searchid : typeof payload.id === 'string' ? payload.id : null;
  if (!searchId || !/^[a-f0-9]{32}$/.test(searchId)) {
    throw new PublicError(502, 'mosaic_contract_invalid', 'El mosaico DEM no devolvió un identificador válido.');
  }
  return searchId;
}

function chooseDemItem(parcelBbox: [number, number, number, number], centroid: [number, number], items: DemItem[]) {
  const containing = items.filter(item => pointInBbox(centroid, item.bbox));
  const pool = containing.length ? containing : items;
  let best = pool[0];
  let bestArea = -1;
  for (const item of pool) {
    const area = bboxOverlapArea(parcelBbox, item.bbox);
    if (area > bestArea) {
      best = item;
      bestArea = area;
    }
  }
  const crossing = items.filter(item => bboxOverlapArea(parcelBbox, item.bbox) > 0).length > 1;
  return { item: best, crossing };
}

async function parcelElevation(itemId: string, parcel: Parcel, geometry: GeoJsonPolygon) {
  const params = new URLSearchParams({ collection, item: itemId, assets: 'data' });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  let response: Response;
  try {
    response = await fetch(`${statisticsUrl}?${params}`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'Feature', properties: { parcel_id: parcel.id }, geometry }),
    });
  } catch (error) {
    const code = error instanceof DOMException && error.name === 'AbortError' ? 'provider_timeout' : 'provider_unreachable';
    throw new PublicError(502, code, `El DEM no respondió para el lote ${parcel.name}.`);
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    console.error(JSON.stringify({ event: 'terrain_provider_error', parcel_id: parcel.id, status: response.status }));
    throw new PublicError(502, 'provider_error', `El DEM rechazó el lote ${parcel.name}.`);
  }
  const payload = await response.json() as { properties?: { statistics?: Record<string, Record<string, unknown>> } };
  const stats = payload.properties?.statistics?.data_b1;
  if (!stats) throw new PublicError(502, 'provider_contract_invalid', `Sin estadísticas DEM para ${parcel.name}.`);
  const elevMin = finiteNumber(stats.min);
  const elevMax = finiteNumber(stats.max);
  const elevMean = finiteNumber(stats.mean);
  const elevMedian = finiteNumber(stats.median);
  const elevStd = finiteNumber(stats.std);
  const validPercent = finiteNumber(stats.valid_percent);
  const count = finiteNumber(stats.count);
  if (elevMin === null || elevMax === null || elevMean === null || elevStd === null || validPercent === null || count === null ||
      elevMin > elevMax || elevMean < elevMin || elevMean > elevMax || elevStd < 0 || validPercent < 0 || validPercent > 100 ||
      !Number.isInteger(count) || count < 0 || elevMin < -500 || elevMax > 9000) {
    throw new PublicError(502, 'provider_contract_invalid', `La respuesta DEM de ${parcel.name} no cumple el contrato.`);
  }
  return {
    elevMin, elevMax, elevMean, elevMedian, elevStd, validPercent, count,
    relief: elevMax - elevMin,
    quality: (validPercent >= 50 && count >= 4 ? 'usable' : 'insufficient_pixels') as 'usable' | 'insufficient_pixels',
  };
}

async function mapPool<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>) {
  const results: R[] = [];
  let cursor = 0;
  async function next() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => next()));
  return results;
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

    let body: TerrainRequest;
    try { body = await request.json() as TerrainRequest; }
    catch { throw new PublicError(400, 'invalid_json', 'La solicitud no contiene JSON válido.'); }
    if (typeof body.establishment_id !== 'string' || !uuidPattern.test(body.establishment_id)) {
      throw new PublicError(400, 'invalid_establishment', 'El establecimiento no es válido.');
    }

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
    if (!membership || !allowedRoles.has(membership.role)) {
      throw new PublicError(403, 'forbidden', 'Tu rol no puede construir el relieve del establecimiento.');
    }

    const stuckBefore = new Date(Date.now() - stuckRunMinutes * 60_000).toISOString();
    await admin.from('terrain_relief_runs').update({
      status: 'failed', error_code: 'run_timeout', completed_at: new Date().toISOString(),
    }).eq('establishment_id', establishment.id).eq('status', 'running').lt('started_at', stuckBefore);

    const { data: activeRun, error: activeError } = await admin.from('terrain_relief_runs')
      .select('id').eq('establishment_id', establishment.id).eq('status', 'running').maybeSingle();
    if (activeError) throw activeError;
    if (activeRun) throw new PublicError(409, 'terrain_in_progress', 'Ya hay un relieve en curso para este establecimiento.');

    const { data: parcels, error: parcelsError } = await admin.from('land_parcels')
      .select('id,name,boundary_geojson').eq('establishment_id', establishment.id).order('name').limit(maxParcels + 1);
    if (parcelsError) throw parcelsError;
    if (!parcels?.length) throw new PublicError(409, 'parcels_required', 'Registrá al menos un lote con polígono antes de construir el relieve.');
    if (parcels.length > maxParcels) throw new PublicError(409, 'parcel_limit_exceeded', 'El relieve admite hasta 100 lotes.');

    const prepared: Array<{ parcel: Parcel; geometry: GeoJsonPolygon; bbox: [number, number, number, number]; centroid: [number, number] }> = [];
    for (const parcel of parcels) {
      const geometry = validPolygon(parcel.boundary_geojson);
      if (!geometry) continue;
      const bbox = polygonBbox(geometry);
      prepared.push({ parcel, geometry, bbox, centroid: polygonCentroid(geometry) });
    }
    if (!prepared.length) throw new PublicError(409, 'parcel_boundary_required', 'Ningún lote tiene un polígono válido para el DEM.');

    const establishmentBbox = expandBbox(prepared.map(item => item.bbox));
    const demItems = await fetchDemCatalog(establishmentBbox);
    const mosaicSearchId = await registerMosaic(establishmentBbox);

    const runLimitations = [
      'Fuente: Copernicus DEM GLO-30 vía Microsoft Planetary Computer.',
      `Resolución horizontal nominal: ${resolutionMeters} m. Es un DSM (incluye vegetación y construcciones), no un DTM de suelo desnudo.`,
      `Precisión vertical publicada LE90ABS media (~sin Antártida/Groenlandia): ${publishedLe90AbsMeanM} m. Hay desviaciones locales; no es cota de obra.`,
      'El sombreado orienta el relieve; no modela escurrimiento, inundación ni transitabilidad.',
      `Licencia: ${licenseName}. Manual: ${handbookUrl}`,
    ];

    const { data: run, error: runError } = await admin.from('terrain_relief_runs').insert({
      organization_id: establishment.organization_id,
      establishment_id: establishment.id,
      algorithm_version: algorithmVersion,
      requested_by: userData.user.id,
      product_id: productId,
      collection,
      resolution_meters: resolutionMeters,
      surface_kind: surfaceKind,
      vertical_datum: verticalDatum,
      horizontal_datum: horizontalDatum,
      published_le90abs_mean_m: publishedLe90AbsMeanM,
      license_name: licenseName,
      license_url: licenseUrl,
      mosaic_search_id: mosaicSearchId,
      dem_item_ids: demItems.map(item => item.id),
      bbox_west: establishmentBbox[0],
      bbox_south: establishmentBbox[1],
      bbox_east: establishmentBbox[2],
      bbox_north: establishmentBbox[3],
      parcel_count: prepared.length,
      limitations: runLimitations,
    }).select('id').single();
    if (runError || !run) throw runError ?? new Error('terrain_run_not_created');
    runContext = { admin, runId: run.id };

    const failures: Array<{ parcel_id: string; code: string }> = [];
    const records: Array<Record<string, unknown>> = [];

    await mapPool(prepared, concurrency, async item => {
      try {
        const choice = chooseDemItem(item.bbox, item.centroid, demItems);
        if (!choice.item) throw new PublicError(409, 'dem_item_missing', 'Sin baldosa DEM para el lote.');
        const elevation = await parcelElevation(choice.item.id, item.parcel, item.geometry);
        const limitations = [
          ...(choice.crossing ? ['El lote cruza más de una baldosa DEM; las estadísticas usan la baldosa principal.'] : []),
          'Elevación DSM sobre EGM2008; no sustituye un relevamiento topográfico.',
        ];
        records.push({
          organization_id: establishment.organization_id,
          establishment_id: establishment.id,
          parcel_id: item.parcel.id,
          run_id: run.id,
          algorithm_version: algorithmVersion,
          product_id: productId,
          dem_item_id: choice.item.id,
          elev_min_m: elevation.elevMin,
          elev_max_m: elevation.elevMax,
          elev_mean_m: elevation.elevMean,
          elev_median_m: elevation.elevMedian,
          elev_stddev_m: elevation.elevStd,
          relief_m: elevation.relief,
          valid_percent: elevation.validPercent,
          pixel_count: elevation.count,
          quality_status: elevation.quality,
          resolution_meters: resolutionMeters,
          surface_kind: surfaceKind,
          vertical_datum: verticalDatum,
          published_le90abs_mean_m: publishedLe90AbsMeanM,
          license_name: licenseName,
          license_url: licenseUrl,
          limitations,
          computed_at: new Date().toISOString(),
        });
      } catch (error) {
        failures.push({
          parcel_id: item.parcel.id,
          code: error instanceof PublicError ? error.code : 'terrain_parcel_failed',
        });
      }
    });

    if (records.length) {
      const { error: upsertError } = await admin.from('parcel_terrain_metrics').upsert(records, {
        onConflict: 'parcel_id,algorithm_version',
      });
      if (upsertError) throw upsertError;
    }

    const status = records.length === 0 ? 'failed' : failures.length ? 'partial' : 'completed';
    if (status === 'failed') {
      throw new PublicError(502, 'terrain_failed', 'Ningún lote obtuvo elevación DEM usable.');
    }

    const { error: completionError } = await admin.from('terrain_relief_runs').update({
      status,
      succeeded_count: records.length,
      failed_count: failures.length,
      completed_at: new Date().toISOString(),
    }).eq('id', run.id).eq('status', 'running');
    if (completionError) throw completionError;
    runContext = null;

    return json({
      run_id: run.id,
      status,
      algorithm_version: algorithmVersion,
      product_id: productId,
      collection,
      resolution_meters: resolutionMeters,
      surface_kind: surfaceKind,
      vertical_datum: verticalDatum,
      horizontal_datum: horizontalDatum,
      published_le90abs_mean_m: publishedLe90AbsMeanM,
      license_name: licenseName,
      license_url: licenseUrl,
      mosaic_search_id: mosaicSearchId,
      dem_item_ids: demItems.map(item => item.id),
      parcel_count: prepared.length,
      succeeded_count: records.length,
      failed_count: failures.length,
      failures,
      bbox: {
        west: establishmentBbox[0],
        south: establishmentBbox[1],
        east: establishmentBbox[2],
        north: establishmentBbox[3],
      },
      limitations: runLimitations,
    });
  } catch (error) {
    if (runContext) {
      await runContext.admin.from('terrain_relief_runs').update({
        status: 'failed',
        succeeded_count: 0,
        failed_count: 0,
        error_code: error instanceof PublicError ? error.code : 'terrain_failed',
        completed_at: new Date().toISOString(),
      }).eq('id', runContext.runId).eq('status', 'running');
    }
    const publicError = error instanceof PublicError
      ? error
      : new PublicError(500, 'terrain_failed', 'No pudimos completar el relieve. Las métricas anteriores siguen intactas.');
    console.error(JSON.stringify({
      event: 'terrain_relief_failed',
      code: publicError.code,
      message: error instanceof Error ? error.message : String(error),
    }));
    return json({ error: publicError.message, code: publicError.code }, publicError.status);
  }
});
